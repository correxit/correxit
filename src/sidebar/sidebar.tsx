import { ICodeCellModel } from '@jupyterlab/cells';
import { IRenderMime } from '@jupyterlab/rendermime';
import { CommandToolbarButtonComponent } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React, { useEffect } from 'react';
import { Correxit, Rubric, Workbook } from '..';
import { Assignment } from './assignment';
import { SidebarWidget } from './widget';

type TranslationBundle = IRenderMime.TranslationBundle;

const { get, has } = Rubric;
const { add, convert, correct, lock, remove, reset, toggle, unlock } =
  Correxit.CommandIDs;
const open = (workbook: Workbook | null) => Workbook.open(workbook, true);

export function Sidebar({ commands, trans, workbook }: Sidebar.Props) {
  return (
    <>
      <Annotate {...{ workbook }} />
      <Header {...{ commands, trans, workbook }} />
      {workbook && (
        <>
          <Body {...{ commands, trans, workbook }} />
          <section className="correxit-sidebar-footer">
            <CommandToolbarButtonComponent commands={commands} id={reset} />
          </section>
        </>
      )}
    </>
  );
}

export namespace Sidebar {
  export type Props = {
    commands: CommandRegistry;
    trans: TranslationBundle;
    workbook: Workbook | null;
  };
  export type Widget = SidebarWidget;
  export const Widget = SidebarWidget;
}

const Annotate: React.FC<{ workbook: Workbook | null }> = ({ workbook }) => {
  const notebook = workbook?.content;
  const rubric = open(workbook);
  const classes = Rubric.Cell.types.map(type => `cxt-mod-${type}`);
  const selector = Rubric.Cell.types.map(type => `.cxt-mod-${type}`).join(', ');
  const reset = (node: Element) => node.classList.remove(...classes);
  if (!rubric || !notebook || notebook.isDisposed) {
    return null;
  }
  useEffect(() => {
    let remaining = Rubric.size(rubric);
    for (const { node, model } of notebook.widgets) {
      const type = Rubric.get(rubric, model.id)?.is;
      if (type) {
        node.classList.add(`cxt-mod-${type}`);
        if (--remaining === 0) {
          break;
        }
      }
    }
    return () => notebook.node.querySelectorAll(selector).forEach(reset);
  }, [notebook, rubric]);
  return null;
};

const Header: React.FC<{
  commands: CommandRegistry;
  trans: TranslationBundle;
  workbook: Workbook | null;
}> = ({ commands, trans, workbook }) => {
  if (!workbook) {
    return (
      <section className="correxit-sidebar-header">
        <div className="correxit-sidebar-inner-header">
          <h4>{trans.__('Correxit: idle')}</h4>
        </div>
      </section>
    );
  }

  const rubric = open(workbook);
  const accessed = rubric?.accessed ?? Date.now();
  const assignment = rubric?.assignment ?? null;
  const locked = rubric?.locked ?? true;
  const heading = rubric ? trans.__('Workbook') : trans.__('Notebook');
  return (
    <section className="correxit-sidebar-header">
      <div className="correxit-sidebar-inner-header">
        <h4>{workbook ? heading : trans.__('Correxit: idle')}</h4>
        <CommandToolbarButtonComponent commands={commands} id={lock} />
        <CommandToolbarButtonComponent commands={commands} id={unlock} />
      </div>
      <Assignment {...{ accessed, assignment, commands, locked, trans }} />
      <CommandToolbarButtonComponent commands={commands} id={convert} />
      <CommandToolbarButtonComponent commands={commands} id={correct} />
    </section>
  );
};

const Body: React.FC<{
  commands: CommandRegistry;
  trans: TranslationBundle;
  workbook: Workbook;
}> = ({ commands, trans, workbook }) => {
  const rubric = open(workbook);
  const headed = !!workbook?.content;
  if (!rubric || !headed || !workbook.content.activeCell) {
    return <section className="correxit-sidebar-body"></section>;
  }
  const cell = (workbook.content.activeCell.model as ICodeCellModel) || null;
  if (!cell || cell.type !== 'code') {
    return <></>;
  }

  const { id } = cell;
  const configuration: CommandToolbarButtonComponent.IProps[] = [
    { commands, id: add, args: { id, is: 'answerable' } },
    { commands, id: add, args: { id, is: 'correctable' } },
    { commands, id: add, args: { id, is: 'comparable' } }
  ];
  const operations: CommandToolbarButtonComponent.IProps[] = [
    { commands, id: correct, args: { id } },
    { commands, id: toggle, args: { id } },
    { commands, id: remove, args: { id } }
  ];
  const hints = {
    answerable: trans.__('Expected output has been set.'),
    comparable: trans.__(
      'Cell has been selected, its output will be used for comparison.'
    ),
    correctable: trans.__(
      'Reference cell has been selected, its code will be used for correcting.'
    ),
    reference: trans.__('Selected cell is a reference cell.')
  };
  const hint = get(rubric, id)?.is || (has(rubric, id, true) && 'reference');
  return (
    <section className="correxit-sidebar-body">
      <div className="correxit-sidebar-cell-config">
        {configuration.map((props, index) => (
          <CommandToolbarButtonComponent key={index} {...props} />
        ))}
      </div>
      {hint && <p>{hints[hint]}</p>}
      <div className="correxit-sidebar-cell-operations">
        {operations.map((props, index) => (
          <CommandToolbarButtonComponent key={index} {...props} />
        ))}
      </div>
    </section>
  );
};
