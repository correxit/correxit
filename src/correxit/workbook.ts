import { ICodeCellModel } from '@jupyterlab/cells';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import {
  INotebookModel,
  Notebook,
  NotebookActions
} from '@jupyterlab/notebook';
import { Kernel, KernelMessage } from '@jupyterlab/services';
import { find, findIndex, range, reduce } from '@lumino/algorithm';
import { Correxit } from './correxit';
import { Rubric } from './rubric';
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
      cell.setSource(await security.decrypt(cell.getSource(), key));

      const raw = cell.toJSON();
      delete raw.metadata.editable;
      raw.metadata.trusted = true;
      sharedModel.transact(() => {
        sharedModel.deleteCell(index);
        sharedModel.insertCell(index, { ...raw, cell_type: 'code' });
      }, false);
      if (workbook.content) {
        const { widgets } = workbook.content;
        const widget = find(widgets, ({ model }) => model.id === reference);
        if (widget) {
          widget.inputHidden = false;
        }
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

      const cell = sharedModel.cells[index]
      cell.setSource(await security.encrypt(cell.getSource(), key));

      const raw = cell.toJSON();
      raw.metadata.editable = false;
      delete raw.metadata.trusted;
      sharedModel.transact(() => {
        sharedModel.deleteCell(index);
        sharedModel.insertCell(index, { ...raw, cell_type: 'raw' });
      }, false);
      if (workbook.content) {
        const { widgets } = workbook.content;
        const widget = find(widgets, ({ model }) => model.id === reference);
        if (widget) {
          widget.inputHidden = true;
        }
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

  /**
   * Add a cell to a workbook's rubric.
   */
  export function add(workbook: Workbook, cell: Rubric.Cell): Rubric.Unlocked {
    const rubric = open(workbook, quiet);
    if (!rubric || rubric.locked || Rubric.has(rubric, cell.id, deep)) {
      throw new Error('add error');
    }
    (cell.shared ? rubric.shared : rubric.secret).cells[cell.id] = cell;
    return update(workbook, { ...rubric, accessed: Date.now() });
  }

  /**
   * Audits a rubric, prunes unknown or invalid cells. Never throws.
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
        const { is, payload, reference } = cells[id];
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
   * @returns a score for the cell or the whole workbook.
   */
  export async function correct(
    workbook: Workbook,
    id?: string
  ): Promise<Rubric.Score> {
    const { sum, UNSCORED } = Rubric;
    const rubric = open(workbook, quiet);
    if (!rubric) {
      return UNSCORED;
    }

    const outputs = await execute(workbook, rubric, id);
    if (!outputs) {
      return UNSCORED;
    }
    if (id) {
      return Rubric.score(rubric, id, outputs);
    }

    const initial = Promise.resolve([0, 0] as Rubric.Score);
    return Object.keys(outputs).reduce(async (total, id) =>
      sum(await total, await Rubric.score(rubric, id, outputs)), initial);
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
      const { is, reference } = cells[id];
      if (is === 'comparable' || is === 'correctable') {
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
  ): Promise<Rubric.Outputs | null> {
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
          1 + findIndex(cells, ({ id }) => id === cell.reference) :
          Number.NEGATIVE_INFINITY
      );
    }

    const { kernelManager, kernelPreference } = context.sessionContext;
    const { name } = kernelPreference;
    const kernel = await (kernelManager?.startNew({ name }).catch(_ => {}));
    if (!kernel) {
      console.warn('execute error, could not start kernel');
      return null;
    }

    const outputs: Rubric.Outputs = {};
    for (const index of range(stop)) {
      const model = cells.get(index);
      if (model.type === 'code') {
        outputs[model.id] = await Cell.execute(model as ICodeCellModel, kernel);
      }
    }
    void kernel.shutdown().catch(_ => {});
    return outputs;
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
      const { is, reference } = rubric.secret.cells[id];
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
   * Each of these steps may throw an error or return null. If every step is
   * successful and the audit leaves the rubric unmodified, it is returned
   * immediately. If the audit changes the rubric, it is returned immediately
   * but also schedules a notebook metadata update.
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
      // Only update workbook metadata if rubric is pruned.
      if (audit.pruned.length) {
        return update(workbook, rubric, audit);
      }
      // Update the pool and return the locked rubric.
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
  export function toggle(workbook: Workbook, id: string): Rubric.Unlocked {
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
}

const deep = true;

const quiet = true;

const [get, set] = (pool => {
  const get = (workbook: Workbook) => pool.get(workbook) || null;
  const set = (workbook: Workbook, rubric: Rubric | null) =>
    pool.set(workbook, rubric).has(workbook);
  return [get, set];
})(new WeakMap<Workbook, Rubric | null>());

/**
 * Updates the workbook metadata with an audited rubric.
 *
 * #### Notes
 * If an `audit` is passed in, its results are used.
 *
 * If `rubric` is `null`, the workbook is reset back to a notebook.
 *
 * If the given rubric passes an audit, which may prune broken cells, it is
 * asynchronously written to the notebook metadata `correxit` key if the audit
 * made rubric changes. The audited rubric is returned synchronously.
 */
function update(
  workbook: Workbook,
  rubric: Rubric.Locked,
  audit?: Workbook.Audit
): Rubric.Locked;
function update(
  workbook: Workbook,
  rubric: Rubric.Unlocked,
  audit?: Workbook.Audit
): Rubric.Unlocked;
function update(
  workbook: Workbook,
  rubric: null
): null;
function update(
  workbook: Workbook,
  rubric: Rubric | null,
  audit = Workbook.audit(workbook, rubric)
): Rubric | null {
  const { sharedModel } = workbook.context.model;
  set(workbook, null);
  if (!audit || !rubric) {
    sharedModel.deleteMetadata('correxit');
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
  // Schedule a metadata write and return the audited rubric immediately.
  (async (notebook, locked) => notebook.setMetadata('correxit', await locked))
    (sharedModel, Rubric.lock(audit.rubric));
  return audit.rubric;
}
