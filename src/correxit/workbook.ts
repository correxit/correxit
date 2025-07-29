import { ICellModel, ICodeCellModel } from '@jupyterlab/cells';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import {
  INotebookModel,
  Notebook,
  NotebookActions
} from '@jupyterlab/notebook';
import { Kernel, KernelMessage } from '@jupyterlab/services';
import { find, findIndex } from '@lumino/algorithm';
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
   * The collection of outputs for every scorable workbook cell.
   */
  export type Outputs = { [id: Cell['id']]: Cell.Output[]; }

  /**
   * A workbook cell definition defines how to score a notebook cell.
   */
  export type Cell = {
    readonly id: string;
    readonly is: 'answerable' | 'comparable' | 'correctable';
    readonly payload?: string[];
    readonly reference?: string;
    readonly shared?: boolean;
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

    const answer = async (expected: Cell['payload'], given: Output[]) => {
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
     * Decrypts a workbook cell, modifying its source and changing its cell type
     * from `raw` to `code`. This changes the cell `id`.
     * @returns a promise that resolves with the resulting cell `id`.
     */
    export async function decrypt(
      workbook: Workbook,
      reference: string,
      key: string
    ): Promise<string> {
      const notebook = workbook.content;
      const model = notebook.model;
      if (!key || !model) {
        throw new Error('decrypt error');
      }

      const { widgets } = notebook;
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

      const initial = notebook.activeCellIndex;
      NotebookActions.clearAllOutputs(notebook);
      NotebookActions.deselectAll(notebook);
      notebook.select(widget);
      notebook.activeCellIndex = index;
      widget.inputHidden = false;
      widget.model.sharedModel.deleteMetadata('editable');
      widget.model.sharedModel.setSource(decrypted);
      NotebookActions.changeCellType(notebook, 'code');
      notebook.activeCellIndex = initial;

      const result = model.cells.get(index);
      return result.id;
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
      const notebook = workbook.content;
      const model = notebook.model;
      if (!key || !model) {
        throw new Error('encrypt error');
      }

      const { widgets } = notebook;
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

      const initial = notebook.activeCellIndex;
      NotebookActions.clearAllOutputs(notebook);
      NotebookActions.deselectAll(notebook);
      notebook.select(widget);
      notebook.activeCellIndex = index;
      widget.inputHidden = true;
      widget.model.sharedModel.setSource(encrypted);
      NotebookActions.changeCellType(notebook, 'raw');
      notebook.activeCellIndex = initial;

      const result = model.cells.get(index);
      result.sharedModel.setMetadata('editable', false);
      return result.id;
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
      outputs: Workbook.Outputs,
    ): Promise<Rubric.Score> {
      const rubric = Correxit.open(workbook, { quiet: true });
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

      const expected = cell.reference ? outputs[cell.reference] : null;
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
  }

  export type Integrity = {
    ok: boolean;
    removed: Cell[];
  };

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
   * If `id` is provided and the target cell is 'comparable' or 'correctable',
   * the workbook is executed up to both target and reference cells.
   */
  export async function execute(
    workbook: Workbook,
    id?: Cell['id']
  ): Promise<Outputs | null> {
    const rubric = Correxit.open(workbook)!;
    const { content, context } = workbook;
    const { cells } = content.model!;
    let last = cells.length - 1;
    if (id) {
      const cell = Correxit.Rubric.get(rubric, id);
      if (!cell) {
        return null;
      }
      last = Math.max(
        findIndex(cells, ({ id }) => id === cell.id),
        cell.is === 'answerable' ?
          Number.NEGATIVE_INFINITY :
          findIndex(cells, ({ id }) => id === cell.reference!)
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
    for (let index = 0; index <= last; index++) {
      const model = cells.get(index);
      if (model.type === 'code') {
        outputs[model.id] = await Cell.execute(model as ICodeCellModel, kernel);
      }
    }
    void kernel.shutdown().catch(_ => {});
    return outputs;
  }

  /**
   * Returns an integrity report for the rubric of workbook.
   */
  export async function integrity(workbook: Workbook): Promise<Integrity> {
    const rubric = Correxit.open(workbook, { quiet: true });
    if (!rubric || rubric.locked || !workbook.content.model) {
      return { ok: false, removed: [] };
    }

    const integrity: Integrity = { ok: true, removed: [] };
    const promises: Promise<unknown>[] = [] ;
    const check = async (section: 'secret' | 'shared') => {
      for (const id in rubric[section].cells) {
        const cell = rubric[section].cells[id] as Cell;
        const { is, payload, reference } = cell;
        switch (is) {
          case 'answerable':
            if (!(id in known) || !payload || !payload.length) {
              promises.push(Correxit.remove(workbook, id));
              integrity.removed.push(cell);
            }
            continue;
          default:
            if (!(id in known) || !reference || !(reference in known)) {
              promises.push(Correxit.remove(workbook, id));
              integrity.removed.push(cell);
            }
            continue;
        }
      }
      return Promise.all(promises);
    };
    const known: { [id: string]: ICellModel['type'] } = Object.create(null);
    for (const cell of workbook.content.model.cells) {
      known[cell.id] = cell.type;
    }
    await Promise.all([check('secret'), check('shared')])
    return integrity;
  }
}
