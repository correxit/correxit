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

const { CommandIDs, Icons } = Correxit;
const { get, has } = Rubric;
const { certify, configure, comment, convert, correct, draft } = CommandIDs;
const { lock, remove, reset, submit, share, unlock } = CommandIDs;
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
  const date = (timestamp: number) => new Date(timestamp).toLocaleString();
  const subheading =
    score === null || score.status === 'unscored'
      ? trans.__('Unscored')
      : trans.__('%1 of %2', score.points, score.possible);
  const submission = rubric?.assignment.submission
    ? trans.__('Submitted %1', date(rubric.assignment.submission))
    : trans.__('Unsubmitted');
  return (
    <section className="correxit-sidebar-header">
      <div className="correxit-sidebar-inner-header">
        <h4>{workbook ? heading : idle}</h4>
        <div className="correxit-sidebar-lock-controls">
          <CommandToolbarButtonComponent commands={commands} id={lock} />
          <CommandToolbarButtonComponent commands={commands} id={unlock} />
        </div>
      </div>
      {!!rubric && <Assignment {...{ commands, rubric, trans }} />}
      <CommandToolbarButtonComponent commands={commands} id={convert} />
      <p className="correxit-sidebar-score">{subheading}</p>
      <div className="correxit-sidebar-workbook-actions">
        <CommandToolbarButtonComponent commands={commands} id={correct} />
        <CommandToolbarButtonComponent commands={commands} id={certify} />
      </div>
      <p className="correxit-sidebar-submission">{submission}</p>
      <div className="correxit-sidebar-submission-actions">
        <CommandToolbarButtonComponent commands={commands} id={submit} />
        <CommandToolbarButtonComponent commands={commands} id={draft} />
      </div>
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
    setValue(report?.comment || '');
    setEditable(false);
  }, [report]);
  if (!report) {
    return <></>;
  }

  const icon = editable ? checkIcon : Icons.comment;
  const { points, possible } = report;
  const heading = trans.__('%1 of %2', points, possible);
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
  const hints = {
    answerable: trans.__('Expected output has been set.'),
    comparable: trans.__('Cell output is compared against a reference.'),
    correctable: trans.__('Cell is corrected by a reference cell.'),
    reference: trans.__('Selected cell is a reference cell.'),
    reviewable: trans.__('Cell is manually reviewed by an instructor.')
  };
  const hint = get(rubric, id)?.is ?? (has(rubric, id, true) && 'reference');
  return (
    <section className="correxit-sidebar-body">
      <CellReport {...{ commands, id, rubric, trans, workbook }} />
      <div className="correxit-sidebar-cell-config">
        <CommandToolbarButtonComponent
          {...{ commands, id: configure, args: { id, is: 'answerable' } }}
        />
        <CommandToolbarButtonComponent
          {...{ commands, id: configure, args: { id, is: 'reviewable' } }}
        />
      </div>
      <div className="correxit-sidebar-cell-config">
        <CommandToolbarButtonComponent
          {...{ commands, id: configure, args: { id, is: 'comparable' } }}
        />
        <CommandToolbarButtonComponent
          {...{ commands, id: configure, args: { id, is: 'correctable' } }}
        />
      </div>
      <div className="correxit-sidebar-cell-config">
        <CommandToolbarButtonComponent
          {...{ commands, id: remove, args: { id } }}
        />
      </div>
      {hint && <p className="correxit-sidebar-cell-hint">{hints[hint]}</p>}
      <div className="correxit-sidebar-cell-operations">
        <CommandToolbarButtonComponent
          {...{ commands, id: correct, args: { id } }}
        />
        <CommandToolbarButtonComponent
          {...{ commands, id: share, args: { id } }}
        />
      </div>
    </section>
  );
};
