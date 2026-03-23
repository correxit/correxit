import { IRenderMime } from '@jupyterlab/rendermime';
import { CommandToolbarButtonComponent } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React from 'react';
import { Correxit, Rubric, Workbook } from '..';
import { Assignment } from './assignment';

type TranslationBundle = IRenderMime.TranslationBundle;

const { certify, collect, convert, draft, lock, revise, submit, unlock } =
  Correxit.CommandIDs;

export const Header: React.FC<{
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

  const rubric = Workbook.open(workbook, true);
  const score = rubric
    ? Rubric.Assignment.summary(rubric.assignment.report)
    : null;
  const heading = rubric ? trans.__('Workbook') : trans.__('Notebook');
  const scored =
    !!score &&
    score.status !== 'unscored' &&
    Number.isFinite(score.points) &&
    Number.isFinite(score.possible);
  const titled = scored
    ? trans.__('%1 (%2 of %3)', heading, score.points, score.possible)
    : heading;
  const submitted = !!rubric?.assignment.submission;
  const sealed = !!rubric?.assignment.seal;
  const unlocked = !!rubric && !rubric.locked;
  const certified = !!rubric?.assignment.certification;
  const collected = !!rubric?.assignment.collected;
  const action = unlocked
    ? certified && !collected
      ? collect
      : certify
    : submitted && sealed
      ? revise
      : submitted
        ? draft
        : submit;
  return (
    <section className="correxit-sidebar-header">
      <div className="correxit-sidebar-inner-header">
        <h4>{titled}</h4>
        <div className="correxit-sidebar-lock-controls">
          <CommandToolbarButtonComponent commands={commands} id={lock} />
          <CommandToolbarButtonComponent commands={commands} id={unlock} />
        </div>
      </div>
      {!!rubric && <Assignment {...{ commands, trans, workbook }} />}
      <CommandToolbarButtonComponent commands={commands} id={convert} />
      <div className="correxit-sidebar-submission-actions">
        <Lifecycle {...{ rubric, trans }} />
        <CommandToolbarButtonComponent commands={commands} id={action} />
      </div>
    </section>
  );
};

const Lifecycle: React.FC<{
  rubric: Rubric | null;
  trans: TranslationBundle;
}> = ({ rubric, trans }) => {
  if (!rubric) return <></>;

  const {
    assignment: { certification, collected, submission, submitted }
  } = rubric;
  const lines: string[] = [];
  if (submission !== null)
    lines.push(trans.__('Submission %1', Rubric.timestamp(submission)));
  if (submitted !== null) lines.push(trans.__('Submitted: %1', submitted));
  if (certification !== null)
    lines.push(trans.__('Certification %1', Rubric.timestamp(certification)));
  if (collected !== null) lines.push(trans.__('Collected: %1', collected));

  const label = lines.length
    ? lines[lines.length - 1]
    : trans.__('Unsubmitted');
  const title = lines.length ? lines.join('\n') : trans.__('Unsubmitted');
  return (
    <div
      aria-label={title}
      className="correxit-sidebar-submission-chip"
      role="status"
      title={title}
    >
      {label}
    </div>
  );
};
