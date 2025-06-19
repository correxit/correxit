import { ICodeCellModel } from '@jupyterlab/cells';
import { IRenderMime } from '@jupyterlab/rendermime';
import {
  UseSignal,
  CommandToolbarButtonComponent
} from '@jupyterlab/ui-components';
import { find } from '@lumino/algorithm';
import { CommandRegistry } from '@lumino/commands';
import React from 'react';
import { Correxit } from '../correxit';
import { Sidebar } from './sidebar';

export const Body: React.FC<{
  commands: CommandRegistry;
  trans: IRenderMime.TranslationBundle;
  waiting: ICodeCellModel['id'] | null;
  workbook: Correxit.Workbook;
}> = ({ commands, trans, waiting, workbook }) => {
  const { activeCell, activeCellChanged, id, model } = workbook.content;
  if (!model || !activeCell || !model.getMetadata('correxit')) {
    return <section className="correxit-body"></section>;
  }
  return (
    <section className="correxit-body">
      <UseSignal initialArgs={activeCell} key={id} signal={activeCellChanged}>
        {(_, reference) => {
          if (
            !reference?.model ||
            reference.model.type !== 'code' ||
            (reference.model as ICodeCellModel).id === waiting
          ) {
            return <></>;
          }
          const cell = find(model.cells, cell => cell.id === waiting);
          return (
            <WorkbookCell
              cell={(cell || reference.model) as ICodeCellModel}
              reference={cell ? (reference.model as ICodeCellModel) : undefined}
              commands={commands}
              trans={trans}
            />
          );
        }}
      </UseSignal>
    </section>
  );
};

const WorkbookCell: React.FC<{
  cell: ICodeCellModel;
  commands: CommandRegistry;
  reference?: ICodeCellModel;
  trans: IRenderMime.TranslationBundle;
}> = ({ cell, commands, reference, trans }) => {
  const { add, correct, remove } = Sidebar.CommandIDs;
  const args = { id: cell.id, reference: reference?.id || '' };
  const buttons: CommandToolbarButtonComponent.IProps[] = [
    { commands, id: add, args: { ...args, is: 'answerable' } },
    { commands, id: add, args: { ...args, is: 'comparable' } },
    { commands, id: add, args: { ...args, is: 'correctable' } },
    { commands, id: correct, args },
    { commands, id: remove, args }
  ];
  return (
    <>
      <h4>{trans.__('Workbook cell:')}</h4>
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
