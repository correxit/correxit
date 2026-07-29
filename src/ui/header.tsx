import { IRenderMime } from '@jupyterlab/rendermime';
import { CommandToolbarButtonComponent } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React, { useEffect, useState } from 'react';
import { Correxit, Rubric, Workbook } from '..';
import { Assignment } from './assignment';
import { trail } from './trail';

type Tone =
  | 'active'
  | 'certified'
  | 'collected'
  | 'issued'
  | 'locked'
  | 'plain'
  | 'submitted'
  | 'template';
type TranslationBundle = IRenderMime.TranslationBundle;
type Phase = { kind: string; note: string; tone: Tone };

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

const phase = (
  rubric: Rubric | null,
  trans: TranslationBundle,
  unstarted: boolean
): Phase => {
  if (!rubric) {
    return {
      kind: trans.__('Notebook'),
      note: trans.__('Convert this notebook to begin authoring.'),
      tone: 'plain'
    };
  }

  const { assignment, locked } = rubric;
  if (!assignment.assignee) {
    return locked
      ? {
          kind: trans.__('Locked template'),
          note: trans.__('Unlock to continue authoring.'),
          tone: 'locked'
        }
      : {
          kind: trans.__('Template'),
          note: trans.__('Configure cells, roster, and deadline below.'),
          tone: 'template'
        };
  }
  if (assignment.collected !== null) {
    return {
      kind: trans.__('Collected'),
      note: trans.__('Grade receipt recorded.'),
      tone: 'collected'
    };
  }
  if (assignment.certification !== null) {
    return locked
      ? {
          kind: trans.__('Certified'),
          note: trans.__('Unlock to inspect or collect.'),
          tone: 'certified'
        }
      : {
          kind: trans.__('Ready to collect'),
          note: trans.__('Record the collection receipt.'),
          tone: 'certified'
        };
  }
  if (assignment.submission !== null) {
    if (assignment.seal !== null) {
      return {
        kind: trans.__('Sealed submission'),
        note: trans.__('Revision needs the submission passphrase.'),
        tone: 'submitted'
      };
    }
    return locked
      ? {
          kind: trans.__('Submitted'),
          note: trans.__('Keep it locked unless revision is needed.'),
          tone: 'submitted'
        }
      : {
          kind: trans.__('Open submission'),
          note: trans.__('Revert to draft or continue grading.'),
          tone: 'active'
        };
  }
  if (unstarted) {
    return assignment.distribution === null
      ? {
          kind: trans.__('Issued'),
          note: trans.__('Deliver this workbook next.'),
          tone: 'issued'
        }
      : {
          kind: trans.__('Distributed'),
          note: trans.__('The assignee can begin work.'),
          tone: 'issued'
        };
  }
  if (assignment.distribution !== null) {
    return {
      kind: trans.__('Distributed'),
      note: trans.__('Await submission.'),
      tone: 'issued'
    };
  }
  return locked
    ? {
        kind: trans.__('Locked'),
        note: trans.__('Unlock to inspect or continue.'),
        tone: 'locked'
      }
    : {
        kind: trans.__('Open workbook'),
        note: trans.__('Certify when grading is complete.'),
        tone: 'active'
      };
};

const step = (
  rubric: Rubric | null,
  trans: TranslationBundle,
  distributable: boolean
) => {
  if (!rubric) {
    return {
      body: trans.__('Convert this notebook to create a workbook.'),
      command: convert
    };
  }

  const { assignment, locked } = rubric;
  if (!assignment.assignee) {
    return locked
      ? {
          body: trans.__('Unlock to continue authoring.'),
          command: null
        }
      : {
          body: trans.__('Finish cell setup, roster, and deadline first.'),
          command: null
        };
  }
  if (distributable) {
    return {
      body: trans.__('Record delivery before treating this as student work.'),
      command: distribute
    };
  }
  if (!locked && assignment.certification !== null && !assignment.collected) {
    return {
      body: trans.__('Record the certified grade.'),
      command: collect
    };
  }
  if (!locked && assignment.certification === null) {
    return {
      body: trans.__('Certify when every graded cell is resolved.'),
      command: certify
    };
  }
  if (assignment.submission !== null && assignment.seal !== null) {
    return {
      body: trans.__('Use the submission passphrase to revise.'),
      command: revise
    };
  }
  if (assignment.submission !== null) {
    return {
      body: trans.__('Revert to draft only if editing must resume.'),
      command: draft
    };
  }
  if (
    locked &&
    assignment.assignee &&
    assignment.distribution !== null &&
    assignment.certification === null
  ) {
    return {
      body: trans.__('Submit when the assignee is finished.'),
      command: submit
    };
  }
  if (assignment.certification !== null) {
    return {
      body: trans.__('Unlock to inspect or collect.'),
      command: null
    };
  }
  return {
    body: trans.__('Continue working.'),
    command: null
  };
};

export const Header: React.FC<{
  commands: CommandRegistry;
  trans: TranslationBundle;
  workbook: Workbook | null;
}> = ({ commands, trans, workbook }) => {
  const rubric = workbook ? Workbook.open(workbook, true) : null;
  const unstarted = useUnstarted(workbook, rubric);
  if (!workbook) {
    return (
      <section
        aria-label={trans.__('Workbook summary')}
        className="correxit-sidebar-header"
      >
        <div className="correxit-sidebar-inner-header">
          <h4>{trans.__('Correxit: idle')}</h4>
        </div>
        <p>{trans.__('Open a notebook to inspect its state.')}</p>
      </section>
    );
  }

  const score = rubric
    ? Rubric.Assignment.summary(rubric.assignment.report, rubric.assignment)
    : null;
  const assignment = rubric?.assignment || null;
  const heading = rubric ? trans.__('Workbook') : trans.__('Notebook');
  const scored =
    !!score &&
    score.status !== 'unscored' &&
    Number.isFinite(score.points) &&
    Number.isFinite(score.possible);
  const titled = scored
    ? trans.__('%1 (%2 of %3)', heading, score.points, score.possible)
    : heading;
  const distributable =
    assignment !== null &&
    Rubric.Assignment.issued(assignment) &&
    assignment.distribution === null;
  const view = phase(rubric, trans, unstarted);
  const next = step(rubric, trans, distributable);
  const lines = assignment ? trail(assignment, trans) : [];
  if (unstarted) lines.push(trans.__('Unstarted'));
  const line = lines.at(-1) || '';
  const title = lines.join('\n');
  return (
    <section
      aria-label={trans.__('Workbook summary')}
      className="correxit-sidebar-header"
    >
      <div className="correxit-sidebar-inner-header">
        <h4>{titled}</h4>
        <div className="correxit-sidebar-lock-controls">
          <CommandToolbarButtonComponent commands={commands} id={lock} />
          <CommandToolbarButtonComponent commands={commands} id={unlock} />
        </div>
      </div>
      <div className={`correxit-sidebar-phase cxt-mod-${view.tone}`}>
        <div className="correxit-sidebar-phase-bar">
          <span className="correxit-sidebar-phase-label">
            {trans.__('Phase')}
          </span>
          <span className="correxit-sidebar-phase-chip">{view.kind}</span>
        </div>
        <div className="correxit-sidebar-phase-copy">{view.note}</div>
        {!!line && (
          <div
            className="correxit-sidebar-phase-tail"
            title={title || undefined}
          >
            {line}
          </div>
        )}
      </div>
      {!!rubric && <Assignment {...{ commands, trans, workbook }} />}
      <div className="correxit-sidebar-next">
        <div className="correxit-sidebar-next-copy">
          <span className="correxit-sidebar-next-label">
            {trans.__('Next')}
          </span>
          <span className="correxit-sidebar-next-body">{next.body}</span>
        </div>
        {next.command && (
          <div className="correxit-sidebar-next-actions">
            <CommandToolbarButtonComponent
              commands={commands}
              id={next.command}
            />
          </div>
        )}
      </div>
    </section>
  );
};

function useUnstarted(
  workbook: Workbook | null,
  rubric: Rubric | null
): boolean {
  const [unstarted, setUnstarted] = useState(false);
  const assignment = rubric?.assignment;
  const needed = !!(
    assignment &&
    Rubric.Assignment.issued(assignment) &&
    assignment.certification === null &&
    assignment.collected === null &&
    assignment.distribution === null &&
    assignment.submission === null &&
    assignment.submitted === null
  );
  useEffect(() => {
    if (!workbook || !needed) {
      setUnstarted(false);
      return;
    }

    let canceled = false;
    void Workbook.unstarted(workbook)
      .then(unstarted => !canceled && setUnstarted(unstarted))
      .catch(() => !canceled && setUnstarted(false));
    return () => void (canceled = true);
  }, [needed, workbook]);

  return unstarted;
}
