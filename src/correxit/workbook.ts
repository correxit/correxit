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
      pruned: { cell: Cell; reason: string; }[];
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

  /**
   * The collection of outputs for every scorable workbook cell.
   */
  export type Outputs = { [id: string]: Cell.Output[]; }

  /**
   * A workbook cell definition defines how to score a notebook cell.
   */
  export type Cell = {
    readonly id: string;
    readonly is: 'answerable';
    readonly payload: string[];
    readonly reference: null;
    readonly shared: boolean;
  } | {
    readonly id: string;
    readonly is: 'comparable' | 'correctable';
    readonly payload: null;
    readonly reference: string;
    readonly shared: boolean;
  };

  export namespace Cell {
    /**
     * An output is an `iopub` message of interest.
     */
    export type Output =
      | KernelMessage.IIOPubMessage<'execute_result'>
      | KernelMessage.IIOPubMessage<'display_data'>
      | KernelMessage.IIOPubMessage<'stream'>
      | KernelMessage.IIOPubMessage<'error'>;

    const answer = async (expected: string[], given: Output[]) => {
        const { CORRECT, INCORRECT, UNSCORED } = Rubric;
        if (!given.length) {
          return INCORRECT;
        }

        const message = given.slice(-1)[0];
        if (message.header.msg_type === 'error') {
          return INCORRECT;
        }
        if (message.header.msg_type === 'stream') {
          const { content } = message as KernelMessage.IStreamMsg;
          if (content.name === 'stdout') {
            const value = await security.digest(content.text.trim());
            return value === expected?.[0] ? CORRECT : INCORRECT;
          }
          return INCORRECT;
        }
      return UNSCORED;
    };

    const compare = (expected: Output[], given: Output[]) => {
      const { CORRECT, INCORRECT, UNSCORED } = Rubric;
      if (!expected.length) {
        return UNSCORED;
      }
      if (!given.length) {
        return INCORRECT;
      }

      const keys = (obj: Output['content']) => Object.keys(obj).sort().join('');
      const x = given.slice(-1)[0].content;
      const y = expected.slice(-1)[0].content;
      if (keys(x) !== keys(y)) {
        return INCORRECT;
      }
      if ('data' in x && 'data' in y) {
        const equal = JSON.stringify(x.data) === JSON.stringify(y.data);
        return equal ? CORRECT : INCORRECT;
      }
      if ('name' in x && 'name' in y) {
        return x.name === y.name && x.text === y.text ? CORRECT : INCORRECT;
      }
      return UNSCORED;
    };

    const correct = (expected: Output[]) =>
      expected.some(message => message.header.msg_type === 'error') ?
        Rubric.INCORRECT : Rubric.CORRECT;

    /**
     * Add a cell to a workbook's rubric.
     */
    export function add(workbook: Workbook, cell: Cell): Rubric.Unlocked {
      const rubric = open(workbook, quiet);
      if (!rubric || rubric.locked || Rubric.has(rubric, cell.id)) {
        throw new Error('add error');
      }
      (cell.shared ? rubric.shared : rubric.secret).cells[cell.id] = cell;
      return update(workbook, { ...rubric, accessed: Date.now() });
    }

    /**
     * Decrypts a workbook cell, modifying its source and changing its cell type
     * from `raw` to `code`.
     */
    export async function decrypt(
      workbook: Workbook,
      reference: string,
      key: string
    ): Promise<void> {
      if (!key || !workbook.context.model) {
        throw new Error('decrypt error');
      }
      const { model } = workbook.context;
      const index = findIndex(model.cells, ({ id }) => id === reference);
      if (index === -1) {
        throw new Error('decrypt error');
      }

      const source = model.cells.get(index).sharedModel.getSource();
      const decrypted = await security.decrypt(source, key);
      const { sharedModel } = model;
      model.cells.get(index).sharedModel.deleteMetadata('editable');
      model.cells.get(index).sharedModel.setSource(decrypted);
      sharedModel.transact(() => {
        const raw = model.cells.get(index).toJSON();
        raw.metadata.trusted = true;
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
      const { model } = workbook.context;
      const index = findIndex(model.cells, ({ id }) => id === reference);
      if (!key || index === -1) {
        throw new Error('encrypt error');
      }

      const source = model.cells.get(index).sharedModel.getSource();
      const encrypted = await security.encrypt(source, key);
      const { sharedModel } = model;
      model.cells.get(index).sharedModel.setSource(encrypted);
      model.cells.get(index).sharedModel.setMetadata('editable', false);
      sharedModel.transact(() => {
        const raw = model.cells.get(index).toJSON();
        delete raw.metadata.trusted;
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
      { sharedModel: { source } }: ICodeCellModel,
      kernel: Kernel.IKernelConnection
    ): Promise<Output[]> {
      const outputs: Output[] = [];
      if (!source) {
        return outputs;
      }
      const future = kernel.requestExecute({ code: source });
      future.onIOPub = (message: KernelMessage.IIOPubMessage) => {
        if (message.header.msg_type === 'execute_result' ||
            message.header.msg_type === 'display_data' ||
            message.header.msg_type === 'stream' ||
            message.header.msg_type === 'error') {
          outputs.push(message as Output);
        }
      };
      await future.done;
      return outputs;
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
     * Get the score for a single cell.
     *
     * @param workbook - the workbook that contains the cell.
     * @param id - the id of the cell to score.
     * @param outputs - the outputs of all the executed workbook cells.
     *
     * @returns the score for this cell.
     *
     * #### Notes
     * Currently the score is only 0/1 or 1/1 whether it is correct or not.
     */
    export async function score(
      workbook: Workbook,
      id: string,
      outputs: Outputs,
    ): Promise<Rubric.Score> {
      const rubric = open(workbook, quiet);
      if (!rubric) {
        return Rubric.UNSCORED;
      }

      const cell = Rubric.get(rubric, id);
      const given = outputs[id];
      if (!cell || !given) {
        return Rubric.UNSCORED;
      }
      if (cell.is === 'answerable') {
        return answer(cell.payload, given);
      }

      const expected = outputs[cell.reference];
      if (!expected) {
        return Rubric.UNSCORED;
      }
      if (cell.is === 'comparable') {
        return compare(expected, given);
      }
      if (cell.is === 'correctable') {
        return correct(expected);
      }
      return Rubric.UNSCORED;
    }

    /**
     * Toggle a rubric cell between `secret` and `shared` sections of rubric.
     */
    export function toggle(workbook: Workbook, id: string): Rubric.Unlocked {
      const rubric = open(workbook, quiet);
      if (!rubric || rubric.locked || !Rubric.has(rubric, id)) {
        throw new Error('toggle error');
      }
      return update(workbook, Rubric.toggle(rubric, id));
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
   * Audits a rubric, prunes unknown or invalid cells. Never throws.
   */
  export function audit(workbook: Workbook, rubric: Rubric): Audit {
    if (!workbook.context.model) {
      return { ok: false, error: 'null notebook model', rubric };
    }

    const pruned: { cell: Cell; reason: string; }[] = [];
    const { locked, secret, shared } = rubric;
    const known = reduce(workbook.context.model.cells,
      (accumulator, { id, type }) => ({
        ...accumulator,
        [id]: locked ? type === 'code' || type === 'raw' : type === 'code'
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
      return Cell.score(workbook, id, outputs);
    }

    const initial = Promise.resolve([0, 0] as Rubric.Score);
    return Object.keys(outputs).reduce(async (total, id) =>
      sum(await total, await Cell.score(workbook, id, outputs)), initial);
  }

  /**
   * Decrypts workbook content.
   */
  export async function decrypt(workbook: Workbook, rubric: Rubric.Unlocked) {
    const { key, secret: { cells } } = rubric;
    for (const id in cells) {
      const { is, reference } = cells[id];
      if (is === 'comparable' || is === 'correctable') {
        await Cell.decrypt(workbook, reference, key)
      }
    };
    return update(workbook, { ...rubric, accessed: Date.now() });
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
  ): Promise<Outputs | null> {
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

    const outputs: Outputs = {};
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
   * metadata for the key `correxit` is read, parsed, and normalized. Each of
   * these steps may throw an error or return null. If every step is successful,
   * a workbook `update` is invoked, which will `audit` the rubric and
   * schedule a notebook metadata update.
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
      const normalized = Rubric.normalize(metadata as Partial<Rubric.Locked>);
      return update(workbook, { ...normalized, accessed: Date.now() });
    } catch (error) {
      if (quiet) {
        return null;
      }
      throw error;
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
    set(workbook, null);
    workbook.context.model.sharedModel.deleteMetadata('correxit');
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
   * Updates the workbook metadata after auditing the given rubric.
   *
   * #### Notes
   * If the given rubric passes an audit, which may prune broken cells, it is
   * asynchronously written to the notebook metadata `correxit` key while
   * synchronously the audited rubric is returned.
   *
   * This function is typically invoked by functions that modify a workbook's
   * rubric (e.g., `decrypt`, `encrypt`, etc.) in the `Workbook` namespace.
   */
  export function update(
    workbook: Workbook,
    rubric: Rubric.Locked
  ): Rubric.Locked
  export function update(
    workbook: Workbook,
    rubric: Rubric.Unlocked
  ): Rubric.Unlocked
  export function update(workbook: Workbook, rubric: Rubric): Rubric {
    const audited = audit(workbook, rubric);
    const metadata = async ({ sharedModel }: INotebookModel, rubric: Rubric) =>
      sharedModel.setMetadata('correxit', await Rubric.lock(rubric));
    set(workbook, null);
    if (audited.ok) {
      set(workbook, audited.rubric);
      void metadata(workbook.context.model, audited.rubric);
      return audited.rubric;
    }
    throw new Error(audited.error);
  }
}
