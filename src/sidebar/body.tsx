import { Cell } from '@jupyterlab/cells';
import { IRenderMime } from '@jupyterlab/rendermime';
import {
  UseSignal,
  CommandToolbarButtonComponent
} from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React from 'react';
import { Correxit } from '../correxit';
import { Sidebar } from './sidebar';

export const Body: React.FC<{
  commands: CommandRegistry;
  trans: IRenderMime.TranslationBundle;
  workbook: Correxit.Workbook;
}> = ({ commands, trans, workbook }) => {
  const { activeCell, activeCellChanged, id, model } = workbook.content;
  if (!model || !activeCell || !model.getMetadata('correxit')) {
    return <section className="correxit-body"></section>;
  }
  return (
    <section className="correxit-body">
      <UseSignal initialArgs={activeCell} key={id} signal={activeCellChanged}>
        {(_, cell) => {
          if (cell) {
            return <ActiveCell cell={cell} commands={commands} trans={trans} />;
          }
          return <></>;
        }}
      </UseSignal>
    </section>
  );
};

const ActiveCell: React.FC<{
  cell: Cell;
  commands: CommandRegistry;
  trans: IRenderMime.TranslationBundle;
}> = ({ cell, commands, trans }) => {
  return (
    <>
      <h4>{trans.__('Active cell:')}</h4>
      <div className="correxit-cell-id" title={cell.model.id}>
        {cell.model.id}
      </div>
      {[Sidebar.CommandIDs.add, Sidebar.CommandIDs.correct].map(command => (
        <CommandToolbarButtonComponent
          args={{ cell: cell.model.id }}
          commands={commands}
          id={command}
          key={command}
        />
      ))}
    </>
  );
};
