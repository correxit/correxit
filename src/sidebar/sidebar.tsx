import { ICodeCellModel } from '@jupyterlab/cells';
import { IRenderMime } from '@jupyterlab/rendermime';
import {
  CommandToolbarButtonComponent,
  UseSignal
} from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import { ISignal } from '@lumino/signaling';
import React from 'react';
import { Correxit, Rubric, Workbook } from '..';
import { SidebarWidget } from './widget';

export function Sidebar(props: Sidebar.Props) {
  const { commands, sender, signal, trans, workbook } = props;
  const key = workbook.context.model.sharedModel.cells[0].id;
  return (
    <UseSignal key={key} signal={signal} initialSender={sender}>
      {() => (
        <>
          <Header {...{ commands, trans, workbook }} />
          <Body {...{ commands, trans, workbook }} />
          <Footer {...{ commands }} />
        </>
      )}
    </UseSignal>
  );
}

export namespace Sidebar {
  export type Props = {
    commands: CommandRegistry;
    sender: any;
    signal: ISignal<unknown, void>;
    trans: IRenderMime.TranslationBundle;
    workbook: Workbook.Headed;
  };
  export type Widget = SidebarWidget;
  export const Widget = SidebarWidget;
}

export const Header: React.FC<{
  commands: CommandRegistry;
  trans: IRenderMime.TranslationBundle;
  workbook: Workbook;
}> = ({ commands, trans, workbook }) => {
  const { convert, correct, lock, unlock } = Correxit.CommandIDs;
  return (
    <section className="correxit-header">
      <div className="correxit-inner-header">
        <File trans={trans} workbook={workbook} />
        <CommandToolbarButtonComponent commands={commands} id={lock} />
        <CommandToolbarButtonComponent commands={commands} id={unlock} />
      </div>
      <CommandToolbarButtonComponent commands={commands} id={convert} />
      <CommandToolbarButtonComponent commands={commands} id={correct} />
    </section>
  );
};

const File: React.FC<{
  trans: IRenderMime.TranslationBundle;
  workbook: Workbook;
}> = ({ trans, workbook }) => {
  const quiet = true;
  const rubric = Workbook.open(workbook, quiet);
  const heading = rubric ? trans.__('Workbook') : trans.__('Notebook');
  return (
    <>
      <h4>{heading}</h4>
    </>
  );
};

export const Body: React.FC<{
  commands: CommandRegistry;
  trans: IRenderMime.TranslationBundle;
  workbook: Workbook.Headed;
}> = ({ commands, trans, workbook }) => {
  const quiet = true;
  const rubric = Workbook.open(workbook, quiet);
  const { activeCell, activeCellChanged } = workbook.content;
  const key = workbook.context.model.sharedModel.cells[0].id;
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
  const correctOptions: CommandToolbarButtonComponent.IProps[] = [
    { commands, id: add, args: { id, is: 'answerable' } },
    { commands, id: add, args: { id, is: 'correctable' } },
    { commands, id: add, args: { id, is: 'comparable' } }
  ];
  const additionalOperations: CommandToolbarButtonComponent.IProps[] = [
    { commands, id: correct, args: { id } },
    { commands, id: toggle, args: { id } },
    { commands, id: remove, args: { id } }
  ];

  const rubricCellType = Rubric.get(rubric, id)?.is;
  let hint: string = '';
  if (rubricCellType === 'answerable') {
    hint = 'Expected output has been set.';
  } else if (rubricCellType === 'correctable') {
    hint =
      'Reference cell has been selected, its contents will be used for correcting.';
  } else if (rubricCellType === 'comparable') {
    hint = 'Cell has been selected, its output will be  used for comparison.';
  } else if (Rubric.has(rubric, id, true)) {
    hint = 'Selected cell is a reference cell.';
  }

  return (
    <>
      {id && (
        <>
          <div className="correxit-sidebar-buttons">
            {correctOptions.map((props, index) => (
              <CommandToolbarButtonComponent key={index} {...props} />
            ))}
          </div>
          {hint && <p>{hint}</p>}
          <div className="correxit-sidebar-additional-operations">
            {additionalOperations.map((props, index) => (
              <CommandToolbarButtonComponent key={index} {...props} />
            ))}
          </div>
        </>
      )}
    </>
  );
};

export const Footer: React.FC<{
  commands: CommandRegistry;
}> = ({ commands }) => {
  const { reset } = Correxit.CommandIDs;
  return (
    <section className="correxit-footer">
      <CommandToolbarButtonComponent commands={commands} id={reset} />
    </section>
  );
};
