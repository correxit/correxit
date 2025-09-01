import { ICodeCellModel } from '@jupyterlab/cells';
import { PathExt } from '@jupyterlab/coreutils';
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
      <File trans={trans} workbook={workbook} />
      <CommandToolbarButtonComponent commands={commands} id={convert} />
      <CommandToolbarButtonComponent commands={commands} id={lock} />
      <CommandToolbarButtonComponent commands={commands} id={unlock} />
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
  const { context } = workbook;
  const heading = rubric
    ? trans.__('Workbook file:')
    : trans.__('Notebook file:');
  return (
    <UseSignal signal={context.pathChanged} initialSender={context}>
      {() => (
        <>
          <h4>{heading}</h4>
          <div className="correxit-monospace">
            {PathExt.basename(context.path)}
          </div>
        </>
      )}
    </UseSignal>
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
  const buttons: CommandToolbarButtonComponent.IProps[] = [
    { commands, id: add, args: { id, is: 'answerable' } },
    { commands, id: add, args: { id, is: 'comparable' } },
    { commands, id: add, args: { id, is: 'correctable' } },
    { commands, id: correct, args: { id } },
    { commands, id: toggle, args: { id } },
    { commands, id: remove, args: { id } }
  ];
  const reference = Rubric.get(rubric, id)?.reference?.[0];
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
