import { DocumentRegistry } from '@jupyterlab/docregistry';
import { CellType } from '@jupyterlab/nbformat';
import { INotebookModel, Notebook } from '@jupyterlab/notebook';

export type Workbook = {
  readonly content: Notebook;
  readonly context: DocumentRegistry.IContext<INotebookModel>;
};

export namespace Workbook {
  export type Cell = {
    readonly answer: {
      readonly format: 'digest' | 'reference';
      readonly values: string[];
    };
    readonly type: CellType;
  };
}
