import { ICodeCellModel } from '@jupyterlab/cells';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import {
  INotebookModel,
  Notebook,
  NotebookActions
} from '@jupyterlab/notebook';
import { Kernel, KernelMessage } from '@jupyterlab/services';
import { find, findIndex, range, reduce } from '@lumino/algorithm';
import { AttachedProperty } from '@lumino/properties';
import { Correxit } from './correxit';
import { Rubric } from './rubric';
import * as security from './security';

/**
 * `Workbook` as a type is equal to `NotebookPanel`. Conceptually, a notebook
 * panel is only a Correxit workbook if it has Correxit metadata.
 */
export type Workbook = {
  readonly content: Notebook;
  readonly context: DocumentRegistry.IContext<INotebookModel>;
};

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
  /**
   * The collection of outputs for every scorable workbook cell.
   */
  export type Outputs = { [id: Cell['id']]: Cell.Output[]; }

  /**
   * A workbook cell definition defines how to score a notebook cell.
   */
  export type Cell =  {
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
    export async function add(
      workbook: Workbook,
      cell: Cell
    ): Promise<Rubric.Unlocked> {
      const rubric = open(workbook, quiet);
      if (!rubric || rubric.locked || Rubric.has(rubric, cell.id)) {
        throw new Error('add error');
      }
      (cell.shared ? rubric.shared : rubric.secret).cells[cell.id] = cell;
      return update(workbook, { ...rubric, accessed: Date.now() });
    }

    /**
     * Decrypts a workbook cell, modifying its source and changing its cell type
     * from `raw` to `code`. This changes the cell `id`.
     * @returns a promise that resolves with the resulting cell `id`.
     */
    export async function decrypt(
      workbook: Workbook,
      reference: string,
      key: string
    ): Promise<string> {
      if (!key || !workbook.content.model) {
        throw new Error('decrypt error');
      }

      const { model, widgets } = workbook.content;
      const index = findIndex(model.cells, cell => cell.id === reference);
      if (index === -1) {
        throw new Error('decrypt error');
      }

      const source = model.cells.get(index).sharedModel.getSource();
      const decrypted = await security.decrypt(source, key);
      const widget = find(widgets, ({ model }) => model.id === reference);
      if (!widget) {
        throw new Error('decrypt error');
      }

      const notebook = workbook.content;
      const initial = notebook.activeCellIndex;
      NotebookActions.clearAllOutputs(notebook);
      NotebookActions.deselectAll(notebook);
      notebook.select(widget);
      notebook.activeCellIndex = index;
      widget.inputHidden = false;
      model.cells.get(index).sharedModel.deleteMetadata('editable');
      model.cells.get(index).sharedModel.setSource(decrypted);
      NotebookActions.changeCellType(notebook, 'code');
      notebook.activeCellIndex = initial;
      return model.cells.get(index).id;
    }

    /**
     * Encrypts a workbook cell, modifying its source and changing its cell type
     * from `code` to `raw`. This changes the cell `id`.
     * @returns a promise that resolves with the resulting cell `id`.
     */
    export async function encrypt(
      workbook: Workbook,
      reference: string,
      key: string
    ): Promise<string> {
      if (!key || !workbook.content.model) {
        throw new Error('encrypt error');
      }

      const { model, widgets } = workbook.content;
      const index = findIndex(model.cells, ({ id }) => id === reference);
      if (index === -1) {
        throw new Error('encrypt error');
      }

      const source = model.cells.get(index).sharedModel.getSource();
      const encrypted = await security.encrypt(source, key);
      const widget = find(widgets, ({ model }) => model.id === reference);
      if (!widget) {
        throw new Error('encrypt error');
      }

      const notebook = workbook.content;
      const initial = notebook.activeCellIndex;
      NotebookActions.clearAllOutputs(notebook);
      NotebookActions.deselectAll(notebook);
      notebook.select(widget);
      notebook.activeCellIndex = index;
      widget.inputHidden = true;
      model.cells.get(index).sharedModel.setSource(encrypted);
      NotebookActions.changeCellType(notebook, 'raw');
      notebook.activeCellIndex = initial;
      model.cells.get(index).sharedModel.setMetadata('editable', false);
      return model.cells.get(index).id;
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
    export async function remove(
      workbook: Workbook,
      id: string
    ): Promise<void> {
      const rubric = open(workbook, quiet);
      const cell = rubric && Rubric.get(rubric, id);
      if (cell && !rubric.locked) {
        delete (cell.shared ? rubric.shared : rubric.secret).cells[id];
        await update(workbook, { ...rubric, accessed: Date.now() });
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
      id: Cell['id'],
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
    export async function toggle(
      workbook: Workbook,
      id: Workbook.Cell['id']
    ): Promise<Rubric.Unlocked> {
      const rubric = open(workbook, quiet);
      if (!rubric || rubric.locked || !Rubric.has(rubric, id)) {
        throw new Error('toggle error');
      }
      return update(workbook, Rubric.toggle(rubric, id));
    }
  }

  const quiet = true;

  const pool = new AttachedProperty<
    Correxit.Workbook,
    Correxit.Rubric | null
  >({ name: 'pool', create: _ => null });

  const get: typeof pool.get = (workbook) => pool.get(workbook);

  const set: typeof pool.set = (workbook, rubric) => pool.set(workbook, rubric);

  /**
   * Audits a rubric, prunes unknown or invalid cells. Never throws.
   */
  export function audit(workbook: Workbook, rubric: Rubric): Audit {
    const pruned: { cell: Cell; reason: string; }[] = [];
    const known = reduce(workbook.content.model!.cells,
      (known, { id, type }) => ({ ...known, [id]: type === 'code'}),
      Object.create(null) as { [id: string]: boolean; }
    );
    const { locked, secret, shared } = rubric;
    for (const { cells } of locked ? [shared] : [secret, shared]) {
      for (const id in cells) {
        const { is, payload, reference } = cells[id];
        const unknown = !known[id];
        const invalid = is === 'answerable' ?
          !payload.length : !known[reference];
        if (unknown || invalid) {
          const reason = unknown ? 'unknown cell' : 'invalid cell';
          pruned.push({ cell: { ...cells[id] }, reason });
          delete cells[id];
        }
      }
    };
    return { ok: true, pruned, rubric: { ...rubric, accessed: Date.now() } };
  }

  /**
   * Convert a plain notebook into a workbook and return its rubric.
   */
  export async function convert(workbook: Workbook, passphrase: string) {
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
    id?: Cell['id']
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
      const { is, shared, payload, reference } = cells[id];
      if (is === 'comparable' || is === 'correctable') {
        cells[id] = {
          id, is, payload, shared,
          reference: await Cell.decrypt(workbook, reference, key)
        };
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
    id?: Cell['id']
  ): Promise<Outputs | null> {
    if (!rubric || !workbook.content.model) {
      throw new Error('execute error');
    }

    const { content: { model: { cells } }, context } = workbook;
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
      const cell = rubric.secret.cells[id];
      if (cell.is === 'comparable' || cell.is === 'correctable') {
        const { key } = rubric;
        const reference = await Cell.encrypt(workbook, cell.reference, key);
        rubric.secret.cells[id] = { ...cell, reference };
      }
    };
    await update(workbook, await Rubric.lock(rubric));
  }

  /**
   * Synchronously returns a workbook's rubric or `null` from notebook metadata.
   *
   * @param workbook - The current workbook. May be `null`.
   * @param quiet - Whether to return `null` or throw errors.
   *
   * #### Notes
   * If `quiet` is set to true, the function returns `null` instead of throwing.
   */
  export function open(
    workbook: Workbook | null,
    quiet = false
  ): Rubric | null {
    if (!workbook || !workbook.content.model) {
      if (quiet) {
        return null;
      }
      throw new TypeError('open error');
    }
    if (get(workbook)) {
      return get(workbook);
    }

    const metadata = workbook.content.model.sharedModel.getMetadata('correxit');
    try {
      if (!metadata) {
        throw Correxit.NO_CORREXIT_METADATA;
      }
      const normalized = Rubric.normalize(metadata as Partial<Rubric.Locked>);
      return update(workbook, normalized);
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
    if (!rubric || rubric.locked || !workbook.content.model) {
      throw new Error('reset error');
    }
    set(workbook, null);
    workbook.content.model.sharedModel.deleteMetadata('correxit');
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

  export function update(workbook: Workbook,
    rubric: Rubric.Locked
  ): Rubric.Locked
  export function update(
    workbook: Workbook,
    rubric: Rubric.Unlocked
  ): Rubric.Unlocked
  export function update(workbook: Workbook, rubric: Rubric): Rubric {
    set(workbook, null);
    if (!workbook.content.model) {
      throw new Error('update error');
    }

    const audited = audit(workbook, rubric);
    const metadata = async ({ sharedModel }: INotebookModel, rubric: Rubric) =>
      sharedModel.setMetadata('correxit', await Rubric.lock(rubric));
    if (audited.ok) {
      set(workbook, audited.rubric);
      void metadata(workbook.content.model, audited.rubric);
      return audited.rubric;
    }
    throw new Error(audited.error);
  }
}
