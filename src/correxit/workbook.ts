import { DocumentRegistry } from '@jupyterlab/docregistry';
import { INotebookModel, Notebook } from '@jupyterlab/notebook';

export type Workbook = {
  readonly content: Notebook;
  readonly context: DocumentRegistry.IContext<INotebookModel>;
};

export namespace Workbook {
  export type Cell<Format = 'digest' | 'reference'> = {
    readonly id: string;
    readonly format: Format;
    readonly payload: string[];
    readonly section: 'secret' | 'shared';
  };

  export function normalize(
    cell: Workbook.Cell
  ): Workbook.Cell {
    // const { answer, id, type } = cell;

    // return { answer, id, type };
    throw new Error('normalize not implemented');
  }
}
