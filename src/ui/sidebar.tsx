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
const { get } = Rubric;
const { certify, configure, convert, correct, dereference } = CommandIDs;
const { draft, lock, refer, remove, reset } = CommandIDs;
const { share, submit, unlock } = CommandIDs;
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
  const scored =
    !!score &&
    score.status !== 'unscored' &&
    Number.isFinite(score.points) &&
    Number.isFinite(score.possible);
  const titled = scored
    ? trans.__('%1 (%2 of %3)', heading, score.points, score.possible)
    : heading;
  const submitted = !!rubric?.assignment.submission;
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
  const date = (timestamp: number | null) =>
    timestamp !== null ? new Date(timestamp).toLocaleString() : '';
  const lines: string[] = [];
  if (submission !== null)
    lines.push(trans.__('Submission %1', date(submission)));
  if (submitted !== null) lines.push(trans.__('Submitted: %1', submitted));
  if (certification !== null)
    lines.push(trans.__('Certification %1', date(certification)));
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

  const assigned = !!rubric.assignment.assignee;
  const derived = cell.is === 'comparable' || cell.is === 'correctable';
  const heading = rubric.locked
    ? trans.__('Cell score')
    : trans.__('Cell configuration');
  const computed = report && report.status !== 'unscored' ? report.points : '-';
  const subheading = trans.__('%1 of %2', computed, cell.points);
  const ids = {
    comment: `correxit-sidebar-cell-score-comment-${id}`,
    heading: `correxit-sidebar-cell-score-heading-${id}`,
    points: `correxit-sidebar-cell-score-points-${id}`,
    score: `correxit-sidebar-cell-score-value-${id}`
  };
  const intervene = async () => {
    if (rubric.locked || !assigned) return;
    if (typeof score === 'number' && !Number.isNaN(score)) {
      const possible = typeof points === 'number' ? points : cell.points;
      const update = { comment, points: score, possible };
      const intervention = Rubric.Score.intervene(id, update);
      await commands.execute(CommandIDs.intervene, { id, intervention });
      return;
    }
    if (intervened)
      await commands.execute(CommandIDs.intervene, { id, intervention: null });
  };

  const note = async () => {
    if (!assigned || comment === seed.comment) return;
    await commands.execute(CommandIDs.comment, { id, comment });
  };
  const reweight = async () => {
    const invalid = typeof points !== 'number' || Number.isNaN(points);
    if (rubric.locked || invalid || points === cell.points) return;
    await commands.execute(CommandIDs.reweight, { id, points });
    if (assigned && typeof score === 'number' && !Number.isNaN(score)) {
      const manual = { comment, points: score, possible: points };
      const intervention = Rubric.Score.intervene(id, manual);
      await commands.execute(CommandIDs.intervene, { id, intervention });
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
        {assigned && !rubric.locked && (
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
        {!rubric.locked && !derived && (
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
        <CellComment
          {...{
            comment,
            id: ids.comment,
            locked: rubric.locked,
            setComment,
            sync,
            trans,
            visible: assigned
          }}
        />
      </div>
    </>
  );
};

const CellComment: React.FC<{
  comment: string;
  id: string;
  locked: boolean;
  setComment: (value: string) => void;
  sync: () => Promise<void>;
  trans: TranslationBundle;
  visible: boolean;
}> = ({ comment, id, locked, setComment, sync, trans, visible }) => {
  if (!visible || (locked && !comment)) return <></>;
  return (
    <details className="correxit-sidebar-cell-score-comment">
      <summary>{trans.__('Comment')}</summary>
      {locked ? (
        <p className="correxit-sidebar-cell-score-guide">{comment}</p>
      ) : (
        <textarea
          className="correxit-sidebar-cell-score-textarea"
          id={id}
          data-lm-suppress-shortcuts="true"
          name="correxit-sidebar-cell-score-comment"
          onBlur={() => void sync()}
          onChange={({ target: { value } }) => setComment(value)}
          placeholder={trans.__('Cell comment...')}
          rows={4}
          value={comment}
        />
      )}
    </details>
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
    correctable: trans.__('Cell is corrected by reference cells.'),
    reference: trans.__('Selected cell is a reference cell.'),
    reviewable: trans.__('Cell is manually reviewed by an instructor.')
  };
  const hint = get(rubric, id)?.is ?? (id in rubric.references && 'reference');
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
      <div className="correxit-sidebar-cell-pair">
        <CommandToolbarButtonComponent
          {...{ commands, id: configure, args: { id, is: 'answerable' } }}
        />
        <CommandToolbarButtonComponent
          {...{ commands, id: configure, args: { id, is: 'reviewable' } }}
        />
        <CommandToolbarButtonComponent
          {...{ commands, id: configure, args: { id, is: 'comparable' } }}
        />
        <CommandToolbarButtonComponent
          {...{ commands, id: configure, args: { id, is: 'correctable' } }}
        />
        <CommandToolbarButtonComponent
          {...{ commands, id: remove, args: { id } }}
        />
      </div>
      <div className="correxit-sidebar-cell-actions">
        <CommandToolbarButtonComponent
          {...{ commands, id: share, args: { id } }}
        />
      </div>
      <References {...{ commands, id, rubric, trans, workbook }} />
      {hint && <p className="correxit-sidebar-cell-hint">{hints[hint]}</p>}
    </section>
  );
};

const References: React.FC<{
  commands: CommandRegistry;
  id: string;
  rubric: Rubric;
  trans: TranslationBundle;
  workbook: Workbook;
}> = ({ commands, id, rubric, trans, workbook }) => {
  const cell = get(rubric, id);
  if (!cell) return <></>;
  if (cell.is !== 'comparable' && cell.is !== 'correctable') return <></>;

  const refs = Object.values(rubric.references).filter(
    reference => reference.cell === id
  );
  if (!refs.length && rubric.locked) return <></>;

  const editable = !rubric.locked && !rubric.assignment.assignee;
  const correctable = cell.is === 'correctable';
  const notebook = workbook.content;
  const source = (referent: string) => {
    const cell = notebook?.widgets.find(({ model }) => model.id === referent);
    return cell?.model.sharedModel.getSource().split('\n')[0] ?? '';
  };
  const scroll = (referent: string) => {
    if (!notebook) return;
    const cell = notebook.widgets.find(({ model }) => model.id === referent);
    if (cell) void notebook.scrollToCell(cell);
  };

  return (
    <div className="correxit-sidebar-references">
      <h5>{trans.__('References (%1)', refs.length)}</h5>
      <ul className="correxit-sidebar-references-list">
        {refs.map(reference => (
          <li
            className="correxit-sidebar-reference-item"
            key={reference.referent}
          >
            <button
              className="correxit-sidebar-reference-locate"
              onClick={() => scroll(reference.referent)}
              title={reference.referent}
              type="button"
            >
              {reference.referent.slice(0, 4)}
            </button>
            <span
              className="correxit-sidebar-reference-source"
              title={source(reference.referent)}
            >
              {source(reference.referent)}
            </span>
            {correctable && (
              <span
                className="correxit-sidebar-reference-points"
                title={trans.__('Points')}
              >
                {reference.points}pt
              </span>
            )}
            {editable && (
              <CommandToolbarButtonComponent
                {...{
                  commands,
                  id: dereference,
                  label: '',
                  args: { referent: reference.referent }
                }}
              />
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <CommandToolbarButtonComponent
          {...{ commands, id: refer, args: { id } }}
        />
      )}
    </div>
  );
};
