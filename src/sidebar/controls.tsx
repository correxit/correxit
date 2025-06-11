import { Cell } from '@jupyterlab/cells';
import { Notebook } from '@jupyterlab/notebook';
import { IRenderMime } from '@jupyterlab/rendermime';
import { UseSignal } from '@jupyterlab/ui-components';
import React from 'react';
import { Correxit } from '../correxit';

export const Controls: React.FC<{
  trans: IRenderMime.TranslationBundle;
  workbook: Correxit.Workbook;
}> = ({ trans, workbook }) => {
  return (
    <section className="correxit-controls">
      <NotebookControls notebook={workbook.content} trans={trans} />
      <CellControls notebook={workbook.content} trans={trans} />
    </section>
  );
};

const NotebookControls: React.FC<{
  notebook: Notebook;
  trans: IRenderMime.TranslationBundle;
}> = ({ notebook, trans }) => {
  return (
    <>
      <h4>{trans.__('Widget ID:')}</h4>
      <div className="correxit-notebook-id" title={notebook.id}>
        {notebook.id}
      </div>
    </>
  );
};

const CellControls: React.FC<{
  notebook: Notebook;
  trans: IRenderMime.TranslationBundle;
}> = ({ notebook, trans }) => {
  const { activeCell, activeCellChanged, id, model } = notebook;
  if (model === null || activeCell === null) {
    return <></>;
  }
  return (
    <UseSignal initialArgs={activeCell} key={id} signal={activeCellChanged}>
      {(_, cell) => (cell ? <ActiveCell cell={cell} trans={trans} /> : <></>)}
    </UseSignal>
  );
};

const ActiveCell: React.FC<{
  cell: Cell;
  trans: IRenderMime.TranslationBundle;
}> = ({ cell, trans }) => {
  return (
    <>
      <h4>{trans.__('Cell:')}</h4>
      <div className="correxit-cell-id" title={cell.model.id}>
        {cell.model.id}
      </div>
    </>
  );
};
