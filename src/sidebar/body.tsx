import { Cell } from '@jupyterlab/cells';
import { IRenderMime } from '@jupyterlab/rendermime';
import { UseSignal } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React from 'react';
import { Correxit } from '../correxit';
import { Workbook } from '../correxit/rubric';

export const Body: React.FC<{
  commands: CommandRegistry;
  trans: IRenderMime.TranslationBundle;
  workbook: Correxit.Workbook;
}> = ({ trans, workbook }) => {
  return (
    <section className="correxit-body">
      <CellControls workbook={workbook} trans={trans} />
    </section>
  );
};

const CellControls: React.FC<{
  workbook: Workbook;
  trans: IRenderMime.TranslationBundle;
}> = ({ workbook, trans }) => {
  const { activeCell, activeCellChanged, id, model } = workbook.content;
  if (!model || !activeCell || !model.getMetadata('correxit')) {
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
      <h4>{trans.__('Active cell:')}</h4>
      <div className="correxit-cell-id" title={cell.model.id}>
        {cell.model.id}
      </div>
    </>
  );
};
