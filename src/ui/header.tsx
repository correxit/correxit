import { IRenderMime } from '@jupyterlab/rendermime';
import { CommandToolbarButtonComponent } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React, { useEffect, useState } from 'react';
import { Correxit, Rubric, Workbook } from '..';
import { Assignment } from './assignment';

type TranslationBundle = IRenderMime.TranslationBundle;

const {
  certify,
  collect,
  convert,
  distribute,
  draft,
  lock,
  revise,
  submit,
  unlock
} = Correxit.CommandIDs;

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
  const unstarted = useUnstarted(workbook, rubric);
  const distributable =
    !!rubric?.assignment.assignee &&
    !!rubric.assignment.issue &&
    !!rubric.assignment.issuer &&
    rubric.assignment.distribution === null;
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
        <Lifecycle {...{ rubric, trans, unstarted }} />
        {distributable && (
          <CommandToolbarButtonComponent commands={commands} id={distribute} />
        )}
        <CommandToolbarButtonComponent commands={commands} id={action} />
      </div>
    </section>
  );
};

function useUnstarted(workbook: Workbook, rubric: Rubric | null): boolean {
  const [unstarted, setUnstarted] = useState(false);
  const assignment = rubric?.assignment;
  const needed = !!(
    assignment?.issue &&
    assignment?.issuer &&
    assignment?.certification === null &&
    assignment?.collected === null &&
    assignment?.distribution === null &&
    assignment?.submission === null &&
    assignment?.submitted === null
  );

  useEffect(() => {
    if (!needed) {
      setUnstarted(false);
      return;
    }
    let cancelled = false;
    void Workbook.unstarted(workbook)
      .then(current => {
        if (!cancelled) setUnstarted(current);
      })
      .catch(() => {
        if (!cancelled) setUnstarted(false);
      });
    return () => {
      cancelled = true;
    };
  }, [needed, workbook]);

  return unstarted;
}

const Lifecycle: React.FC<{
  rubric: Rubric | null;
  trans: TranslationBundle;
  unstarted: boolean;
}> = ({ rubric, trans, unstarted }) => {
  if (!rubric) return <></>;

  const {
    assignment: {
      assignee,
      certification,
      collected,
      distribution,
      submission,
      submitted
    }
  } = rubric;
  const blank_slate =
    unstarted &&
    certification === null &&
    collected === null &&
    distribution === null &&
    submission === null &&
    submitted === null;
  const lines: string[] = [];
  if (distribution !== null)
    lines.push(trans.__('Distribution %1', Rubric.timestamp(distribution)));
  if (submission !== null)
    lines.push(trans.__('Submission %1', Rubric.timestamp(submission)));
  if (submitted !== null) lines.push(trans.__('Submitted: %1', submitted));
  if (certification !== null)
    lines.push(trans.__('Certification %1', Rubric.timestamp(certification)));
  if (collected !== null) lines.push(trans.__('Collected: %1', collected));
  if (blank_slate) lines.push(trans.__('Unstarted'));

  const label = lines.length
    ? lines[lines.length - 1]
    : assignee
      ? trans.__('Started')
      : trans.__('Unsubmitted');
  const title = lines.length
    ? lines.join('\n')
    : assignee
      ? trans.__('Started')
      : trans.__('Unsubmitted');
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
