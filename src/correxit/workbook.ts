import { ICodeCellModel } from '@jupyterlab/cells';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import {
  INotebookModel,
  Notebook,
  NotebookActions
} from '@jupyterlab/notebook';
import {
  Kernel,
  KernelMessage,
  KernelSpec
} from '@jupyterlab/services';
import { findIndex, range, reduce } from '@lumino/algorithm';
import { Correxit, Rubric } from '.';
import * as executor from './executor';
import * as security from './security';

/**
 * A headed or headless Correxit workbook.
 */
export type Workbook = Workbook.Headed | Workbook.Headless;

export namespace Workbook {
  /**
   * The result of an audit on a workbook's rubric.
   */
  export type Audit = Audit.Pass | Audit.Fail;

  namespace Audit {
    export type Pass = {
      ok: true;
      pruned: { cell: Rubric.Cell; reason: string; }[];
      rubric: Rubric;
    };

    export type Fail = { ok: false; error: string; rubric: Rubric | null; };
  }

  export type Credentials = |
    { path: string; passphrase: null; key: null; } |
    { path: string; passphrase: null; key: string; } |
    { path: string; passphrase: string; key: null; };

  export namespace Credentials {
    export function normalize (credentials: Partial<Credentials> | null) {
      const { key, passphrase, path } = credentials || {};
      if (key && passphrase || !path) {
        return null;
      }
      return {
        key: key || null, passphrase: passphrase || null, path
      } as Credentials;
    }
  }

  export type Grade = {
    path: string;
    score: Rubric.Score;
    spec: KernelSpec.ISpecModel | null;
  };

  export type Headed = {
    readonly content: Notebook;
    readonly context: DocumentRegistry.IContext<INotebookModel>;
  };

  export type Headless = {
    readonly content: null;
    readonly context: DocumentRegistry.IContext<INotebookModel>;
  };

  export namespace Cell {
    /**
     * Decrypts a workbook cell, modifying its source and changing its cell type
     * from `raw` to `code`.
     */
    export async function decrypt(
      workbook: Workbook,
      reference: string,
      key: string
    ): Promise<void> {
      const { model: { sharedModel } } = workbook.context;
      const index = findIndex(sharedModel.cells, ({ id }) => id === reference);
      if (!key || index === -1) {
        throw new Error('decrypt error');
      }

      const cell = sharedModel.cells[index];
      const decrypted = await security.decrypt(cell.getSource(), key);
      cell.transact(() => {
        const jupyter = (cell.getMetadata('jupyter') as any || {});
        delete jupyter['source_hidden'];
        cell.setMetadata('jupyter', jupyter);
        cell.setMetadata('trusted', true);
        cell.deleteMetadata('editable');
        cell.setSource(decrypted);
      });

      const code = { ...cell.toJSON(), cell_type: 'code' };
      sharedModel.transact(() => {
        sharedModel.deleteCell(index);
        sharedModel.insertCell(index, code);
      }, false);
      if (workbook.content) {
        NotebookActions.clearAllOutputs(workbook.content);
        NotebookActions.deselectAll(workbook.content);
      }
    }

    /**
     * Encrypts a workbook cell, modifying its source and changing its cell type
     * from `code` to `raw`.
     */
    export async function encrypt(
      workbook: Workbook,
      reference: string,
      key: string
    ): Promise<void> {
      const { model: { sharedModel } } = workbook.context;
      const index = findIndex(sharedModel.cells, ({ id }) => id === reference);
      if (!key || index === -1) {
        throw new Error('encrypt error');
      }

      const cell = sharedModel.cells[index];
      const encrypted = await security.encrypt(cell.getSource(), key);
      cell.transact(() => {
        const jupyter = (cell.getMetadata('jupyter') || {}) as any;
        cell.setMetadata('jupyter', { ...jupyter, 'source_hidden': true });
        cell.deleteMetadata('trusted');
        cell.setMetadata('editable', false);
        cell.setSource(encrypted);
      });

      const raw = { ...cell.toJSON(), cell_type: 'raw' };
      sharedModel.transact(() => {
        sharedModel.deleteCell(index);
        sharedModel.insertCell(index, raw);
      }, false);
      if (workbook.content) {
        NotebookActions.clearAllOutputs(workbook.content);
        NotebookActions.deselectAll(workbook.content);
      }
    }

    /**
     * Execute one cell's source in a kernel.
     *
     * @param kernel - the kernel to use.
     * @param cell - the model of the cell to execute.
     *
     * @returns an array of of cell outputs.
     */
    export async function execute(
      { sharedModel }: ICodeCellModel,
      kernel: Kernel.IKernelConnection
    ): Promise<Rubric.Cell.Output[]> {
      const outputs: Rubric.Cell.Output[] = [];
      const code = sharedModel.getSource();
      if (!code.length) {
        return outputs;
      }

      const future = kernel.requestExecute({ code });
      future.onIOPub = (message: KernelMessage.IIOPubMessage) => {
        if (message.header.msg_type === 'execute_result' ||
            message.header.msg_type === 'display_data' ||
            message.header.msg_type === 'stream' ||
            message.header.msg_type === 'error') {
          outputs.push(message as Rubric.Cell.Output);
        }
      };
      await future.done;
      return outputs;
    }
  }

  const quiet = true;
  const [get, set] = (pool => {
    const get = (workbook: Workbook) => pool.get(workbook) || null;
    const set = (workbook: Workbook, rubric: Rubric | null) =>
      pool.set(workbook, rubric).has(workbook);
    return [get, set];
  })(new WeakMap<Workbook, Rubric | null>());

  /**
   * Add a cell to a workbook's rubric.
   */
  export async function add(
    workbook: Workbook,
    cell: Rubric.Cell
  ): Promise<Rubric.Unlocked> {
    const rubric = open(workbook, quiet);
    const deep = true;
    if (!rubric || rubric.locked || Rubric.has(rubric, cell.id, deep)) {
      throw new Error('add error');
    }
    (cell.shared ? rubric.shared : rubric.secret).cells[cell.id] = cell;
    return update(workbook, { ...rubric, accessed: Date.now() });
  }

  export async function assign(
    workbook: Workbook,
    { assignee, roster }: Partial<Rubric.Assignment> = {}
  ): Promise<Rubric.Unlocked> {
    const rubric = open(workbook, quiet);
    if (!rubric || rubric.locked) {
      throw new Error('assign error');
    }
    const assigned = await Rubric.assign(rubric, assignee || '', roster || []);
    return update(workbook, assigned);
  }

  /**
   * Audits a workbook's rubric, prunes unknown or invalid cells. Never throws.
   */
  export function audit(workbook: Workbook, rubric: Rubric | null): Audit {
    if (!rubric) {
      return { ok: false, error: 'null rubric', rubric };
    }

    const pruned: { cell: Rubric.Cell; reason: string; }[] = [];
    const { locked, secret, shared } = rubric;
    const known = reduce(workbook.context.model.sharedModel.cells,
      (accumulator, { id, cell_type }) => ({
        ...accumulator,
        [id]: cell_type === 'code' || cell_type === 'raw'
      }), Object.create(null) as { [id: string]: boolean; }
    );
    for (const { cells } of locked ? [shared] : [secret, shared]) {
      for (const id in cells) {
        const { is, payload } = cells[id];
        const reference = cells[id].reference?.[0] ?? '';
        const valid = is === 'answerable' ? !!payload.length : known[reference];
        if (known[id] && valid) {
          continue;
        }
        pruned.push({
          cell: { ...cells[id] },
          reason: known[id] ? 'invalid cell' : 'unknown cell'
        });
        delete cells[id];
      }
    };
    return { ok: true, pruned, rubric: { ...rubric, accessed: Date.now() } };
  }

  /**
   * Convert a plain notebook into a workbook and return its rubric.
   */
  export async function convert(
    workbook: Workbook,
    passphrase: string
  ): Promise<Rubric.Unlocked> {
    try {
      const opened = open(workbook)!;
      const key = await security.keygen(passphrase, opened.id);
      const rubric = opened.locked ? await Rubric.unlock(opened, key) : opened;
      return update(workbook, rubric);
    } catch (error) {
      if (error === Correxit.NO_CORREXIT_METADATA) {
        const created = Rubric.create();
        const key = await security.keygen(passphrase, created.id);
        return update(workbook, { ...created, key });
      }
      throw error;
    }
  }

  /**
   * Correct a cell (if `id` is provided) or an entire workbook.
   *
   * @param workbook - the workbook to correct.
   * @param id - the id of the cell to correct.
   *
   * @returns a promise that resolves to the correction result, i.e.,
   *  - the score for the cell or the whole workbook
   *  - the spec of the kernel used to get that score
   */
  export async function correct(
    workbook: Workbook,
    id?:string
  ): Promise<Omit<Grade, 'path'>> {
    const { sum, UNSCORED } = Rubric;
    const rubric = open(workbook, quiet);
    if (!rubric) {
      return { spec: null, score: UNSCORED}
    }

    const result = await execute(workbook, rubric, id);
    if (!result) {
      return { spec: null, score: UNSCORED};
    }

    const { spec, outputs } = result;
    if (id) {
      return { spec, score: (await Rubric.score(rubric, id, outputs))[0] };
    }

    const initial = Promise.resolve([0, 0] as Rubric.Score);
    const score =  await Object.keys(outputs).reduce(async (total, id) =>
      sum(await total, (await Rubric.score(rubric, id, outputs))[0]), initial);
    return { spec, score };
  }

  /**
   * Decrypts workbook content.
   */
  export async function decrypt(workbook: Workbook, rubric: Rubric.Unlocked) {
    const audit = Workbook.audit(workbook, rubric);
    if (!audit.ok) {
      throw new Error(`decrypt error: ${audit.error}`);
    }
    const { key, secret: { cells } } = audit.rubric as Rubric.Unlocked;
    for (const id in cells) {
      const reference = cells[id].reference?.[0] ?? '';
      if (cells[id].is === 'comparable' || cells[id].is === 'correctable') {
        await Cell.decrypt(workbook, reference, key)
      }
    };
    return update(workbook, rubric, audit);
  }

  /**
   * Executes the code cells of a workbook.
   *
   * @param workbook - the workbook to run.
   * @param id - the ID of the target cell.
   *
   * @returns a promise that resolves to a collection of executed cell outputs.
   *
   * #### Notes
   * If `id` is not provided, the whole workbook is executed.
   * If `id` is provided and the target cell is 'answerable', the workbook is
   * executed up to this cell.
   * If `id` is provided and the target cell is `comparable` or `correctable`,
   * the workbook is executed up to both target and reference cells.
   */
  export async function execute(
    workbook: Workbook,
    rubric: Rubric,
    id?: string
  ): Promise<{
    spec: KernelSpec.ISpecModel | null;
    outputs: Rubric.Outputs;
  } | null> {
    if (!rubric) {
      throw new Error('execute error');
    }

    const { context } = workbook;
    const { model: { cells } } = context;
    let stop = cells.length;
    if (id) {
      const cell = Rubric.get(rubric, id);
      if (!cell) {
        return null;
      }
      stop = Math.max(
        1 + findIndex(cells, ({ id }) => id === cell.id),
        cell.is === 'correctable' || cell.is === 'comparable' ?
          1 + findIndex(cells, ({ id }) => id === cell.reference?.[0]) :
          Number.NEGATIVE_INFINITY
      );
    }

    const outputs: Rubric.Outputs = {};
    const [kernel, release] = await executor.initialize(context, true);
    if (!kernel) {
      return null;
    }
    for (const index of range(stop)) {
      const cell = cells.get(index);
      if (cell.type === 'code') {
        outputs[cell.id] = await Cell.execute(cell as ICodeCellModel, kernel);
      }
    }
    release();
    return { spec: await kernel.spec || null, outputs };
  }

  /**
   * Lock a workbook if its rubric is unlocked.
   */
  export async function lock(workbook: Workbook): Promise<void> {
    const rubric = open(workbook, quiet);
    if (!rubric || rubric.locked) {
      return;
    }
    for (const id in rubric.secret.cells) {
      const { is } = rubric.secret.cells[id];
      const reference = rubric.secret.cells[id].reference?.[0] ?? '';
      if (is === 'comparable' || is === 'correctable') {
        await Cell.encrypt(workbook, reference, rubric.key);
      }
    };
    update(workbook, await Rubric.lock(rubric));
  }

  /**
   * Synchronously returns a workbook's rubric or `null` from notebook metadata.
   *
   * @param workbook - The current workbook. May be `null`.
   * @param quiet - Whether to return `null` or throw errors.
   *
   * #### Notes
   * If a rubric exists in the pool for the given workbook, it is returned.
   *
   * If no rubric exists in the pool for the given workbook, its notebook
   * metadata for the key `correxit` is read, parsed, normalized, and audited.
   * Each of these steps may throw an error or return null.
   * @see update
   */
  export function open(
    workbook: Workbook | null,
    quiet = false
  ): Rubric | null {
    if (!workbook) {
      if (quiet) {
        return null;
      }
      throw new TypeError('open error');
    }
    if (get(workbook)) {
      return get(workbook);
    }

    const metadata = workbook.context.model.sharedModel.getMetadata('correxit');
    try {
      if (!metadata) {
        throw Correxit.NO_CORREXIT_METADATA;
      }
      const rubric = Rubric.normalize(metadata as Partial<Rubric.Locked>);
      const audit = Workbook.audit(workbook, rubric);
      if (!audit.ok) {
        throw new Error(`open error: ${audit.error}`);
      }
      set(workbook, audit.rubric);
      return audit.rubric;
    } catch (error) {
      if (quiet) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Remove a cell from a workbook's rubric.
   */
  export function remove(workbook: Workbook, id: string): void {
    const rubric = open(workbook, quiet);
    const cell = rubric && !rubric.locked && Rubric.get(rubric, id);
    if (cell) {
      delete (cell.shared ? rubric.shared : rubric.secret).cells[id];
      update(workbook, { ...rubric, accessed: Date.now() });
    }
  }

  /**
   * Reset a workbook back to a plain Jupyter notebook.
   */
  export async function reset(workbook: Workbook) {
    const rubric = open(workbook, quiet);
    if (!rubric || rubric.locked) {
      throw new Error('reset error');
    }
    update(workbook, null);
  }

  /**
   * Toggle a workbook cell between `secret` and `shared` sections of rubric.
   */
  export async function toggle(
    workbook: Workbook, id: string
  ): Promise<Rubric.Unlocked> {
    const rubric = open(workbook, quiet);
    if (!rubric || rubric.locked || !Rubric.has(rubric, id)) {
      throw new Error('toggle error');
    }
    return update(workbook, Rubric.toggle(rubric, id));
  }

  /**
   * Unlocks a workbook's rubric, decrypts its contents, and returns the rubric.
   */
  export async function unlock(
    workbook: Workbook,
    key: string
  ): Promise<Rubric.Unlocked> {
    const rubric = open(workbook, quiet);
    if (!rubric) {
      throw new Error('unlock error');
    }
    if (rubric.locked) {
      return decrypt(workbook, await Rubric.unlock(rubric, key));
    }
    return rubric;
  }

  /**
   * Updates the workbook metadata with an audited rubric.
   *
   * #### Notes
   * If an `audit` is passed in, its results are used.
   *
   * If `rubric` is `null`, the workbook is reset back to a notebook.
   *
   * If the given rubric passes an audit, which may prune broken cells, it is
   * written to the notebook metadata `correxit` key if the audit changes the
   * rubric.
   */
  export async function update(
    workbook: Workbook,
    rubric: Rubric.Locked,
    audit?: Audit
  ): Promise<Rubric.Locked>;
  export async function update(
    workbook: Workbook,
    rubric: Rubric.Unlocked,
    audit?: Audit
  ): Promise<Rubric.Unlocked>;
  export async function update(
    workbook: Workbook,
    rubric: null
  ): Promise<null>;
  export async function update(
    workbook: Workbook,
    rubric: Rubric | null,
    audit = Workbook.audit(workbook, rubric)
  ): Promise<Rubric | null> {
    const { sharedModel } = workbook.context.model;
    set(workbook, null);
    if (!audit || !rubric) {
      sharedModel.deleteMetadata('correxit');
      sharedModel.clearUndoHistory();
      return null;
    }
    if (!audit.ok) {
      throw new Error(`update error: ${audit.error}`);
    }
    set(workbook, audit.rubric);
    for (const { cell: { id, is }, reason } of audit.pruned) {
      // TODO: Emit these warnings as events instead.
      console.warn(`pruned ${is} (${id} ${reason}) from ${audit.rubric.id}`);
    }
    sharedModel.setMetadata('correxit', await Rubric.lock(audit.rubric));
    return audit.rubric;
  }
}
