import { ICellModel } from '@jupyterlab/cells';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import { INotebookModel, Notebook } from '@jupyterlab/notebook';
import { UUID } from '@lumino/coreutils';

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
