import { ICodeCellModel } from '@jupyterlab/cells';
import { IRenderMime } from '@jupyterlab/rendermime';
import { CommandToolbarButtonComponent } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React, { useEffect, useRef, useState } from 'react';
import { Correxit, Rubric, Workbook } from '..';
import { Annotate } from './annotate';
import { Assignment } from './assignment';
import { Toggle } from './toggle';
import { SidebarWidget } from './widget';

type TranslationBundle = IRenderMime.TranslationBundle;

const { get, has } = Rubric;
const { add, convert, correct, lock, remove, reset, toggle, unlock } =
  Correxit.CommandIDs;
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
      <p>{subheading}</p>
    </section>
  );
};

const CellReport: React.FC<{
  rubric: Rubric;
  workbook: Workbook;
  id: string;
}> = ({ rubric, workbook, id }) => {
  const report = rubric ? Rubric.Cell.report(rubric, id) : null;
  const [comment, setComment] = useState<string>('');
  const [open, setOpen] = useState<boolean>(false);
  useEffect(() => {
    setComment(report?.comment ?? '');
    setOpen(false);
  }, [report]);
  const ref = useRef(`correxit-assignee-comment-${id}${Date.now()}`);

  return report && rubric.assignment.assignee ? (
    <>
      <div className="correxit-sidebar-cell-report">
        <h5>
          Cell Grade {report.points} out of {report.possible}
        </h5>
        <Toggle
          {...{
            icon: Correxit.Icons.comment,
            title: 'Cell Report',
            toggle: () => setOpen(!open)
          }}
        />
      </div>
      {open && (
        <textarea
          key={ref.current}
          data-lm-suppress-shortcuts="true"
          rows={8}
          name="correxit-assignment-report-comment"
          value={comment}
          readOnly={rubric.locked}
          placeholder="Cell report..."
          onChange={({ target: { value } }) => {
            setComment(value);
          }}
          onBlur={({ target: { value } }) => {
            Workbook.comment(workbook, id, value);
          }}
        />
      )}
    </>
  ) : null;
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
      <CellReport rubric={rubric} workbook={workbook} id={id} />
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
