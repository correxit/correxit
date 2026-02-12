import { ICodeCellModel } from '@jupyterlab/cells';
import { IRenderMime } from '@jupyterlab/rendermime';
import {
  checkIcon,
  CommandToolbarButtonComponent
} from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React, { useEffect, useState } from 'react';
import { Correxit, Rubric, Workbook } from '..';
import * as state from '../correxit/state';
import { Annotate } from './annotate';
import { Assignment } from './assignment';
import { Toggle } from './toggle';
import { SidebarWidget } from './widget';

type TranslationBundle = IRenderMime.TranslationBundle;

const { get, has } = Rubric;
const {
  add,
  comment,
  convert,
  correct,
  draft,
  lock,
  remove,
  reset,
  submit,
  toggle,
  unlock
} = Correxit.CommandIDs;
const open = (workbook: Workbook | null) => Workbook.open(workbook, true);

export function Sidebar(props: Sidebar.Props) {
  const { annotate, commands, trans, workbook } = props;
  return (
    <>
      <Annotate {...{ workbook: annotate ? workbook : null }} />
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
    annotate: boolean;
    commands: CommandRegistry;
    trans: TranslationBundle;
    workbook: Workbook | null;
  };
  export type Widget = SidebarWidget;
  export const Widget = SidebarWidget;
}

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
  const score = rubric
    ? Rubric.Assignment.summary(rubric.assignment.report)
    : null;
  const heading = rubric ? trans.__('Workbook') : trans.__('Notebook');
  const idle = trans.__('Correxit: idle');
  const subheading =
    score === null
      ? ''
      : score.status === 'unscored'
        ? trans.__('Unscored')
        : trans.__('Workbook Grade %1 out of %2', score.points, score.possible);
  return (
    <section className="correxit-sidebar-header">
      <div className="correxit-sidebar-inner-header">
        <h4>{workbook ? heading : idle}</h4>
        <CommandToolbarButtonComponent commands={commands} id={lock} />
        <CommandToolbarButtonComponent commands={commands} id={unlock} />
      </div>
      {!!rubric && <Assignment {...{ commands, rubric, trans }} />}
      <CommandToolbarButtonComponent commands={commands} id={convert} />
      <CommandToolbarButtonComponent commands={commands} id={correct} />
      <CommandToolbarButtonComponent commands={commands} id={submit} />
      <CommandToolbarButtonComponent commands={commands} id={draft} />
      {!!rubric?.locked && !!rubric.assignment.submission && (
        <p>
          {trans.__(
            'Submitted %1',
            new Date(rubric.assignment.submission).toLocaleString()
          )}
        </p>
      )}
      <p>{subheading}</p>
    </section>
  );
};

const CellReport: React.FC<{
  commands: CommandRegistry;
  id: string;
  rubric: Rubric;
  trans: TranslationBundle;
  workbook: Workbook;
}> = ({ commands, rubric, trans, workbook, id }) => {
  const report = state.report(workbook, id);
  const [value, setValue] = useState(report?.comment || '');
  const [editable, setEditable] = useState(false);

  useEffect(() => {
    setValue(report?.comment ?? '');
    setEditable(false);
  }, [report]);

  if (!report) {
    return <></>;
  }

  const icon = editable ? checkIcon : Correxit.Icons.comment;
  const { points, possible } = report;
  const heading = trans.__('Cell Score %1 out of %2', points, possible);
  const title = trans.__('Cell Report');
  const placeholder = trans.__('Cell report...');
  const toggle = () => {
    if (editable) {
      void commands.execute(comment, { id, comment: value });
    }
    setEditable(prev => !prev);
  };
  return (
    <>
      <div className="correxit-sidebar-cell-report">
        <h5>{heading}</h5>
        <Toggle {...{ icon, title, toggle }} />
      </div>
      {editable && (
        <textarea
          data-lm-suppress-shortcuts="true"
          key={id}
          name="correxit-sidebar-cell-report-comment"
          onChange={({ target: { value } }) => setValue(value)}
          placeholder={placeholder}
          readOnly={rubric.locked}
          rows={8}
          value={value}
        />
      )}
    </>
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
    { commands, id: add, args: { id, is: 'comparable' } },
    { commands, id: add, args: { id, is: 'correctable' } }
  ];
  const operations: CommandToolbarButtonComponent.IProps[] = [
    { commands, id: correct, args: { id } },
    { commands, id: toggle, args: { id } },
    { commands, id: remove, args: { id } }
  ];
  const hints = {
    answerable: trans.__('Expected output has been set.'),
    comparable: trans.__('Cell output is compared against a reference.'),
    correctable: trans.__('Cell is corrected by a reference cell.'),
    reference: trans.__('Selected cell is a reference cell.')
  };
  const hint = get(rubric, id)?.is || (has(rubric, id, true) && 'reference');
  return (
    <section className="correxit-sidebar-body">
      <CellReport
        commands={commands}
        id={id}
        rubric={rubric}
        trans={trans}
        workbook={workbook}
      />
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
