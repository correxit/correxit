import { ICodeCellModel } from '@jupyterlab/cells';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import { INotebookModel, Notebook } from '@jupyterlab/notebook';

export type Workbook = {
  readonly content: Notebook;
  readonly context: DocumentRegistry.IContext<INotebookModel>;
};

export namespace Workbook {
  export type Cell = {
    readonly id: ICodeCellModel['id'];
    readonly is: 'answerable' | 'comparable' | 'correctable';
    readonly payload: string[];
    readonly ref?: ICodeCellModel['id'];
  };
}
