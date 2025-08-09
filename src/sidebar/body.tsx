import { ICodeCellModel } from '@jupyterlab/cells';
import { IRenderMime } from '@jupyterlab/rendermime';
import {
  UseSignal,
  CommandToolbarButtonComponent
} from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React from 'react';
import { Correxit, Rubric, Workbook } from '..';

export const Body: React.FC<{
  commands: CommandRegistry;
  trans: IRenderMime.TranslationBundle;
  workbook: Workbook.Headed;
}> = ({ commands, trans, workbook }) => {
  const quiet = true;
  const rubric = Workbook.open(workbook, quiet);
  const { activeCell, activeCellChanged } = workbook.content;
  const key = workbook.context.model.cells.get(0).id;
  if (!activeCell || !rubric) {
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
  rubric: Rubric;
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
  const reference = Rubric.get(rubric, id)?.reference;
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
