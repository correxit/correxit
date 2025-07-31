import { ICodeCellModel } from '@jupyterlab/cells';
import { IRenderMime } from '@jupyterlab/rendermime';
import {
  UseSignal,
  CommandToolbarButtonComponent
} from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React from 'react';
import { Correxit } from '../correxit';

export const Body: React.FC<{
  commands: CommandRegistry;
  trans: IRenderMime.TranslationBundle;
  workbook: Correxit.Workbook;
}> = ({ commands, trans, workbook }) => {
  const rubric = Correxit.open(workbook, { quiet: true });
  const { activeCell, activeCellChanged, model } = workbook.content;
  const key = workbook.content.id;
  if (!model || !activeCell || !rubric) {
    return <section className="correxit-body"></section>;
  }
  return (
    <section className="correxit-body">
      <UseSignal initialArgs={activeCell} key={key} signal={activeCellChanged}>
        {(_, cell) => {
          if (!cell?.model || cell.model.type !== 'code') {
            return <></>;
          }
          return (
            <WorkbookCell
              cell={cell.model as ICodeCellModel}
              commands={commands}
              rubric={rubric}
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
  rubric: Correxit.Rubric;
  trans: IRenderMime.TranslationBundle;
}> = ({ cell: { id }, commands, rubric, trans }) => {
  const { add, correct, remove, toggle } = Correxit.CommandIDs;
  const buttons: CommandToolbarButtonComponent.IProps[] = [
    { commands, id: add, args: { id, is: 'answerable' } },
    { commands, id: add, args: { id, is: 'comparable' } },
    { commands, id: add, args: { id, is: 'correctable' } },
    { commands, id: correct, args: { id } },
    { commands, id: toggle, args: { id } },
    { commands, id: remove, args: { id } }
  ];
  const cell = Correxit.Rubric.get(rubric, id);
  const referenceable = cell?.is === 'comparable' || cell?.is === 'correctable';
  const reference = referenceable && cell.reference;
  return (
    <>
      <h4>{trans.__('Workbook cell:')}</h4>
      <div className="correxit-monospace" title={id}>
        {id}
      </div>
      {reference && (
        <>
          <h4>{trans.__('Reference cell:')}</h4>
          <div className="correxit-monospace" title={reference}>
            {reference}
          </div>
        </>
      )}
      {buttons.map((props, index) => (
        <CommandToolbarButtonComponent key={index} {...props} />
      ))}
    </>
  );
};
