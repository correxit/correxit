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

    export async function decrypt(
      workbook: Workbook,
      id: Cell['id'],
      key: string
    ) {
      const notebook = workbook.content;
      if (!key) {
        throw new Error('decrypt error');
      }
      const model = notebook.model!;
      const { widgets } = notebook;
      NotebookActions.clearAllOutputs(notebook);
      NotebookActions.deselectAll(notebook);
      const index = findIndex(model.cells, cell => Cell.id(cell) === id);
      const cell = model.cells.get(index);
      const source = cell.sharedModel.getSource();
      const decrypted = await security.decrypt(source, key);
      const widget = find(widgets, ({ model }) => Cell.id(model) === id)!;
      const initial = notebook.activeCellIndex;
      notebook.select(widget);
      notebook.activeCellIndex = index;
      widget.model.sharedModel.setSource(decrypted);
      NotebookActions.changeCellType(workbook.content, 'code');
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
      { sharedModel: { source} }: ICodeCellModel,
      kernel: Kernel.IKernelConnection
    ): Promise<Output[]> {
      const outputs: Output[] = [];
      const future = kernel.requestExecute({ code: source });
      future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
        if (msg.header.msg_type === 'execute_result' ||
            msg.header.msg_type === 'display_data' ||
            msg.header.msg_type === 'stream' ||
            msg.header.msg_type === 'error') {
          outputs.push(msg as Output);
        }
      };
      await future.done;
      return outputs;
    }

    export function id(cell?: ICellModel, initialize = false): string {
      if (!cell){
        return '';
      }
      const id = cell.getMetadata('correxit') || '';
      if (id || !initialize) {
        return id;
      }
      cell.setMetadata('correxit', UUID.uuid4());
      return cell.getMetadata('correxit');
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
      if (!rubric || !Object.keys(outputs).length) {
        return Rubric.UNSCORED;
      }

      const answer = outputs[id][outputs[id].length - 1];
      const cell = Rubric.get(rubric, id);
      if (!cell) {
        return Rubric.UNSCORED;
      }
      if (cell.is === 'answerable') {
        // TODO: handle the case when the execution failed.
        if (answer.header.msg_type === 'error') {
          return [0, 1];
        }
        if (answer.header.msg_type === 'stream') {
          const content = answer.content as KernelMessage.IStreamMsg['content'];
          if (content.name === 'stdout') {
            const value = await security.digest(content.text.trim());
            return value === cell.payload?.[0] ? [1, 1] : [0, 1];
          }
          return [0, 1];
        }
      }

      // TODO: We should probably handle this case where the reference cell
      // has not been executed.
      const referents = outputs[cell.reference!];
      if (!referents) {
        return Rubric.UNSCORED;
      }

      if (cell.is === 'comparable') {
        // TODO: Handle the case where the reference cell has no output.
        if (!referents.length) {
          return Rubric.UNSCORED;
        }
        const referent = referents[referents.length - 1];
        const comparable = JSON.stringify(referent.content);
        const serialized = JSON.stringify(answer.content);
        return comparable === serialized ? [1, 1] : [0, 1];
      }
      if (cell.is === 'correctable') {
        const wrong = referents.some(msg => msg.header.msg_type === 'error');
        return wrong ? [0, 1] : [1, 1];
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

    const { kernelManager } = context.sessionContext;
    const kernel = await (kernelManager?.startNew().catch(_ => undefined));
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
