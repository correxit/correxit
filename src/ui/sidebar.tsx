import { IRenderMime } from '@jupyterlab/rendermime';
import { CommandToolbarButtonComponent } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React, { useEffect, useState } from 'react';
import { Correxit, Rubric, Workbook } from '..';
import * as state from '../correxit/state';
import { Annotate } from './annotate';
import { Assignment } from './assignment';
import { SidebarWidget } from './widget';

type TranslationBundle = IRenderMime.TranslationBundle;

const { CommandIDs } = Correxit;
const { get, has } = Rubric;
const { certify, configure, convert, correct, draft } = CommandIDs;
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
  const date = (timestamp: number | null) =>
    timestamp ? new Date(timestamp).toLocaleString() : '';
  const lifecycle = (rubric: Rubric | null) => {
    if (!rubric) return '-';

    const {
      assignment: { certification, collected, submission, submitted }
    } = rubric;
    if (collected) return trans.__('Collected: %1', collected);
    if (certification) return trans.__('Certification %1', date(certification));
    if (submitted) return trans.__('Submitted: %1', submitted);
    if (submission) return trans.__('Submission %1', date(submission));
    return trans.__('Unsubmitted');
  };
  const scored = !!score && score.status !== 'unscored';
  const titled = scored
    ? trans.__('%1 (%2 of %3)', heading, score!.points, score!.possible)
    : heading;
  const submitted = !!rubric?.assignment.submission;
  const chip = lifecycle(rubric);
  const unlocked = !!rubric && !rubric.locked;
  const action = unlocked ? certify : submitted ? draft : submit;
  return (
    <section className="correxit-sidebar-header">
      <div className="correxit-sidebar-inner-header">
        <h4>{workbook ? titled : idle}</h4>
        <div className="correxit-sidebar-lock-controls">
          <CommandToolbarButtonComponent commands={commands} id={lock} />
          <CommandToolbarButtonComponent commands={commands} id={unlock} />
        </div>
      </div>
      {!!rubric && <Assignment {...{ commands, rubric, trans }} />}
      <CommandToolbarButtonComponent commands={commands} id={convert} />
      <div className="correxit-sidebar-submission-actions">
        <div className="correxit-sidebar-submission-chip" title={chip}>
          {chip}
        </div>
        <CommandToolbarButtonComponent commands={commands} id={action} />
      </div>
    </section>
  );
};

const CellScore: React.FC<{
  commands: CommandRegistry;
  id: string;
  rubric: Rubric;
  trans: TranslationBundle;
  workbook: Workbook;
}> = ({ commands, rubric, trans, workbook, id }) => {
  const cell = get(rubric, id);
  const cached = state.report(workbook, id);
  const persisted = Rubric.Score.resolve(rubric.assignment.report, id);
  const report = rubric.locked ? (cached ?? persisted) : (persisted ?? cached);
  const intervened = !!rubric.assignment.report.interventions[id];
  const scored: number | '' =
    report && report.status !== 'unscored' ? report.points : '';
  const seed = {
    comment: report ? report.comment : '',
    points: cell ? cell.points : 1,
    possible: report ? report.possible : '',
    score: scored,
    status: report ? report.status : 'unscored',
    value: report ? report.points : ''
  };
  const whole = (value: string): number | '' => {
    if (value === '') return '';

    const parsed = Number(value);
    if (Number.isNaN(parsed)) return '';
    return Math.max(0, Math.floor(parsed));
  };

  const [comment, setComment] = useState(seed.comment);
  const [points, setPoints] = useState<number | ''>(seed.points);
  const [score, setScore] = useState<number | ''>(seed.score);
  useEffect(() => {
    setComment(seed.comment);
    setPoints(seed.points);
    setScore(seed.score);
  }, [
    id,
    rubric.id,
    rubric.assignment.assignee,
    rubric.locked,
    seed.comment,
    seed.points,
    seed.possible,
    seed.status,
    seed.value
  ]);
  if (!cell) return <></>;

  const actual = report && report.status !== 'unscored' ? report.points : '-';
  const heading = rubric.locked
    ? trans.__('Cell score')
    : trans.__('Cell configuration');
  const subheading = trans.__('%1 of %2', actual, cell.points);
  const ids = {
    comment: `correxit-sidebar-cell-score-comment-${id}`,
    heading: `correxit-sidebar-cell-score-heading-${id}`,
    points: `correxit-sidebar-cell-score-points-${id}`,
    score: `correxit-sidebar-cell-score-value-${id}`
  };
  const placeholder = trans.__('Cell comment...');
  const note = async () => {
    if (comment !== seed.comment)
      await commands.execute(CommandIDs.comment, { id, comment });
  };
  const reweight = async () => {
    const scored = score;
    const invalid = typeof points !== 'number' || Number.isNaN(points);
    if (rubric.locked || invalid || points === cell.points) return;
    await commands.execute(CommandIDs.reweight, { id, points });
    if (typeof scored === 'number' && !Number.isNaN(scored)) {
      const manual = { comment, points: scored, possible: points };
      const intervention = Rubric.Score.intervene(id, manual);
      await commands.execute(CommandIDs.intervene, { id, intervention });
    }
  };

  const intervene = async () => {
    const scored = score;
    const possible = points;
    if (rubric.locked) return;

    if (typeof scored === 'number' && !Number.isNaN(scored)) {
      const max = typeof possible === 'number' ? possible : cell.points;
      const update = { comment, points: scored, possible: max };
      const intervention = Rubric.Score.intervene(id, update);
      await commands.execute(CommandIDs.intervene, { id, intervention });
      return;
    }
    if (intervened) {
      await commands.execute(CommandIDs.intervene, {
        id,
        intervention: null
      });
    }
  };

  const sync = async () => {
    await note();
    await intervene();
  };

  return (
    <>
      <div
        className="correxit-sidebar-cell-report"
        id={ids.heading}
        aria-live="polite"
      >
        <h5>{heading}</h5>
        <h5>{subheading}</h5>
      </div>
      <div
        className="correxit-sidebar-cell-score-edit"
        role="group"
        aria-labelledby={ids.heading}
      >
        {!rubric.locked && (
          <label
            className="correxit-sidebar-cell-score-field"
            htmlFor={ids.score}
          >
            {trans.__('Points scored')}
            <input
              className="correxit-sidebar-cell-score-input"
              id={ids.score}
              inputMode="numeric"
              step="1"
              type="number"
              min="0"
              placeholder={trans.__('Auto')}
              value={score}
              onBlur={() => void intervene()}
              onChange={({ target: { value } }) => setScore(whole(value))}
            />
          </label>
        )}
        {!rubric.locked && (
          <label
            className="correxit-sidebar-cell-score-field"
            htmlFor={ids.points}
          >
            {trans.__('Points possible')}
            <input
              className="correxit-sidebar-cell-score-input"
              id={ids.points}
              inputMode="numeric"
              step="1"
              type="number"
              min="0"
              value={points}
              onBlur={() => void reweight()}
              onChange={({ target: { value } }) => setPoints(whole(value))}
            />
          </label>
        )}
        <label
          className="correxit-sidebar-cell-score-label"
          htmlFor={ids.comment}
        >
          {trans.__('Comment')}
        </label>
        <textarea
          className="correxit-sidebar-cell-score-textarea"
          id={ids.comment}
          data-lm-suppress-shortcuts="true"
          name="correxit-sidebar-cell-score-comment"
          onBlur={() => void sync()}
          onChange={({ target: { value } }) => setComment(value)}
          placeholder={placeholder}
          readOnly={rubric.locked}
          rows={4}
          value={comment}
        />
      </div>
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
  if (!rubric || !headed || !workbook.content.activeCell)
    return <section className="correxit-sidebar-body"></section>;

  const { id } = workbook.content.activeCell.model || {};
  if (!id) return <></>;

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
      <div
        className={[
          'correxit-sidebar-cell-config',
          'correxit-sidebar-cell-actions'
        ].join(' ')}
      >
        <CommandToolbarButtonComponent {...{ commands, id: correct }} />
        <CommandToolbarButtonComponent
          {...{ commands, id: correct, args: { id } }}
        />
      </div>
      <CellScore {...{ commands, id, rubric, trans, workbook }} />
      <div
        className={[
          'correxit-sidebar-cell-config',
          'correxit-sidebar-cell-pair'
        ].join(' ')}
      >
        <CommandToolbarButtonComponent
          {...{ commands, id: configure, args: { id, is: 'answerable' } }}
        />
        <CommandToolbarButtonComponent
          {...{ commands, id: configure, args: { id, is: 'reviewable' } }}
        />
      </div>
      <div
        className={[
          'correxit-sidebar-cell-config',
          'correxit-sidebar-cell-pair'
        ].join(' ')}
      >
        <CommandToolbarButtonComponent
          {...{ commands, id: configure, args: { id, is: 'comparable' } }}
        />
        <CommandToolbarButtonComponent
          {...{ commands, id: configure, args: { id, is: 'correctable' } }}
        />
      </div>
      <div
        className={[
          'correxit-sidebar-cell-config',
          'correxit-sidebar-cell-actions'
        ].join(' ')}
      >
        <CommandToolbarButtonComponent
          {...{ commands, id: share, args: { id } }}
        />
        <CommandToolbarButtonComponent
          {...{ commands, id: remove, args: { id } }}
        />
      </div>
      {hint && <p className="correxit-sidebar-cell-hint">{hints[hint]}</p>}
    </section>
  );
};
