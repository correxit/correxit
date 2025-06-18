import { ICodeCellModel } from '@jupyterlab/cells';
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
          if (cell?.model && cell.model.type === 'code') {
            return (
              <ActiveCell
                cell={cell.model as ICodeCellModel}
                commands={commands}
                trans={trans}
              />
            );
          }
          return <></>;
        }}
      </UseSignal>
    </section>
  );
};

const ActiveCell: React.FC<{
  cell: ICodeCellModel;
  commands: CommandRegistry;
  reference?: ICodeCellModel;
  trans: IRenderMime.TranslationBundle;
}> = ({ cell, commands, reference, trans }) => {
  const { add, correct, remove } = Sidebar.CommandIDs;
  const ref = { ref: reference?.id || '' };
  const buttons: CommandToolbarButtonComponent.IProps[] = [
    { commands, id: add, args: { id: cell.id, is: 'answerable' } },
    { commands, id: add, args: { id: cell.id, is: 'comparable', ...ref } },
    { commands, id: add, args: { id: cell.id, is: 'correctable', ...ref } },
    { commands, id: correct, args: { id: cell.id } },
    { commands, id: remove, args: { id: cell.id } }
  ];
  return (
    <>
      <h4>{trans.__('Current cell:')}</h4>
      <div className="correxit-cell-id" title={cell.id}>
        {cell.id}
      </div>
      {reference && (
        <>
          <h4>{trans.__('Reference cell:')}</h4>
          <div className="correxit-cell-id" title={reference.id}>
            {reference.id}
          </div>
        </>
      )}
      {buttons.map((props, index) => (
        <CommandToolbarButtonComponent key={index} {...props} />
      ))}
    </>
  );
};
