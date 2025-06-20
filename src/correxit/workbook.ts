import { ICellModel } from '@jupyterlab/cells';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import {
  INotebookModel,
  Notebook,
  NotebookActions
} from '@jupyterlab/notebook';
import { find, findIndex } from '@lumino/algorithm';
import { UUID } from '@lumino/coreutils';
import { Correxit } from './correxit';
import * as security from './security';

export type Workbook = {
  readonly content: Notebook;
  readonly context: DocumentRegistry.IContext<INotebookModel>;
};

export namespace Workbook {
  export type Cell = {
    readonly id: ReturnType<typeof UUID.uuid4>;
    readonly is: 'answerable' | 'comparable' | 'correctable';
    readonly payload?: string[];
    readonly reference?: ReturnType<typeof UUID.uuid4>;
    readonly shared?: boolean;
  };

  export namespace Cell {
    export async function decrypt(workbook: Workbook, id: Cell['id']) {
      const rubric = Correxit.open(workbook);
      const notebook = workbook.content;
      if (!rubric || rubric.locked) {
        throw new Error('decrypt error');
      }
      const model = notebook.model!;
      const { widgets } = notebook;
      NotebookActions.clearAllOutputs(notebook);
      notebook.deselectAll();
      const index = findIndex(model.cells, cell => Cell.id(cell) === id);
      const cell = model.cells.get(index);
      const source = cell.sharedModel.getSource();
      const decrypted = await security.decrypt(source, rubric.key);
      const widget = find(widgets, ({ model }) => Cell.id(model) === id)!;
      notebook.select(widget);
      widget.model.sharedModel.setSource(decrypted);
      NotebookActions.changeCellType(workbook.content, 'code');
    }

    export async function encrypt(workbook: Workbook, id: Cell['id']) {
      const rubric = Correxit.open(workbook);
      const notebook = workbook.content;
      if (!rubric || rubric.locked) {
        throw new Error('encrypt error');
      }
      const model = notebook.model!;
      const { widgets } = notebook;
      NotebookActions.clearAllOutputs(notebook);
      notebook.deselectAll();
      const index = findIndex(model.cells, cell => Cell.id(cell) === id);
      const cell = model.cells.get(index);
      const source = cell.sharedModel.getSource();
      const encrypted = await security.encrypt(source, rubric.key);
      const widget = find(widgets, ({ model }) => Cell.id(model) === id)!;
      notebook.select(widget);
      widget.model.sharedModel.setSource(encrypted);
      NotebookActions.changeCellType(workbook.content, 'raw');
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
  }
}
