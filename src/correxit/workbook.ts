import { ICellModel, ICodeCellModel } from '@jupyterlab/cells';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import {
  INotebookModel,
  Notebook,
  NotebookActions
} from '@jupyterlab/notebook';
import { Kernel, KernelMessage } from '@jupyterlab/services';
import { find, findIndex } from '@lumino/algorithm';
import { UUID } from '@lumino/coreutils';
import { Correxit } from './correxit';
import { Rubric } from './rubric';
import * as security from './security';

export type Workbook = {
  readonly content: Notebook;
  readonly context: DocumentRegistry.IContext<INotebookModel>;
};

export namespace Workbook {
  export type Outputs = { [id: Cell['id']]: Cell.Output[]; }

  export type Cell = {
    readonly id: ReturnType<typeof UUID.uuid4>;
    readonly is: 'answerable' | 'comparable' | 'correctable';
    readonly payload?: string[];
    readonly reference?: ReturnType<typeof UUID.uuid4>;
    readonly shared?: boolean;
  };

  export namespace Cell {
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

    export async function decrypt(
      workbook: Workbook,
      id: Cell['id'],
      key: string
    ) {
      const notebook = workbook.content;
      if (!key || !notebook.model) {
        throw new Error('decrypt error');
      }
      const model = notebook.model;
      const { widgets } = notebook;
      NotebookActions.clearAllOutputs(notebook);
      NotebookActions.deselectAll(notebook);
      const index = findIndex(model.cells, cell => Cell.id(cell) === id);
      const { sharedModel } = model.cells.get(index);
      const decrypted = await security.decrypt(sharedModel.getSource(), key);
      const widget = find(widgets, ({ model }) => Cell.id(model) === id)!;
      const initial = notebook.activeCellIndex;
      notebook.select(widget);
      notebook.activeCellIndex = index;
      widget.inputHidden = false;
      widget.model.sharedModel.setSource(decrypted);
      NotebookActions.changeCellType(notebook, 'code');
      notebook.activeCellIndex = initial;
    }

    export async function encrypt(
      workbook: Workbook,
      id: Cell['id'],
      key: string
    ) {
      const notebook = workbook.content;
      if (!key) {
        throw new Error('encrypt error');
      }
      const model = notebook.model!;
      NotebookActions.clearAllOutputs(notebook);
      NotebookActions.deselectAll(notebook);
      const index = findIndex(model.cells, cell => Cell.id(cell) === id);
      const cell = model.cells.get(index);
      const source = cell.sharedModel.getSource();
      const encrypted = await security.encrypt(source, key);
      const { widgets } = notebook;
      const widget = find(widgets, ({ model }) => Cell.id(model) === id)!;
      const initial = notebook.activeCellIndex;
      notebook.select(widget);
      notebook.activeCellIndex = index;
      widget.model.sharedModel.setSource(encrypted);
      widget.inputHidden = true;
      NotebookActions.changeCellType(notebook, 'raw');
      notebook.activeCellIndex = initial;
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

    export function id(cell?: ICellModel, initialize = false): string {
      if (!cell){
        return '';
      }
      const id = cell.sharedModel.getMetadata('correxit') as string || '';
      if (id || !initialize) {
        return id;
      }
      cell.sharedModel.setMetadata('correxit', UUID.uuid4());
      return cell.sharedModel.getMetadata('correxit') as string;
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
   * If `id` is provided, and the target cell is 'answerable', the workbook is
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
    const outputs: Outputs = {};

    let last = cells.length - 1;
    if (id) {
      const cell = Correxit.Rubric.get(rubric, id);
      if (!cell) {
        return null;
      }
      if (cell.is === 'answerable') {
        last = findIndex(cells, cell => Cell.id(cell) === id);
      } else {
        const reference = cell.reference!;
        last = Math.max(
          findIndex(cells, cell => Cell.id(cell) === id),
          findIndex(cells, cell => Cell.id(cell) === reference)
        );
      }
    }

    const { kernelManager, kernelPreference } = context.sessionContext;
    const { name } = kernelPreference;
    const kernel = await (kernelManager?.startNew({ name }).catch(_ => {}));
    if (!kernel) {
      console.warn('execute error, could not start kernel');
      return null;
    }

    for (let i = 0; i <= last; i++) {
      const model = cells.get(i) as ICodeCellModel;
      if (model.type === 'code') {
        outputs[Cell.id(model)] = await Cell.execute(model, kernel);
      }
    }
    void kernel.shutdown().catch(_ => undefined);
    return outputs;
  }
}
