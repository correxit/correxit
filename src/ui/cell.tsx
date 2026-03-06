import { IRenderMime } from '@jupyterlab/rendermime';
import { CommandRegistry } from '@lumino/commands';
import React, { useEffect, useState } from 'react';
import { Correxit, Rubric, Workbook } from '..';
import * as state from '../correxit/state';

type TranslationBundle = IRenderMime.TranslationBundle;

const { CommandIDs } = Correxit;
const { get } = Rubric;

const whole = (value: string): number | '' => {
  if (value === '') return '';
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return '';
  return Math.max(0, Math.floor(parsed));
};

export const Score: React.FC<{
  commands: CommandRegistry;
  id: string;
  rubric: Rubric;
  trans: TranslationBundle;
  workbook: Workbook;
}> = ({ commands, id, rubric, trans, workbook }) => {
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
  const commentate = async () => {
    if (!assigned || comment === seed.comment) return;
    await commands.execute(CommandIDs.comment, { id, comment });
  };
  const reweight = async () => {
    const invalid = typeof points !== 'number' || Number.isNaN(points);
    if (rubric.locked || invalid || points === cell.points) return;
    await commands.execute(CommandIDs.reweight, { id, points });
    if (assigned && typeof score === 'number' && !Number.isNaN(score)) {
      const manual = {
        comment,
        points: score,
        possible: points
      };
      const intervention = Rubric.Score.intervene(id, manual);
      await commands.execute(CommandIDs.intervene, { id, intervention });
    }
  };
  const sync = async () => {
    await commentate();
    await intervene();
  };
  return (
    <>
      <div
        aria-live="polite"
        className="correxit-sidebar-cell-report"
        id={ids.heading}
      >
        <h5>{heading}</h5>
        <h5>{subheading}</h5>
      </div>
      {(!rubric.locked || (assigned && !!comment)) && (
        <div
          aria-labelledby={ids.heading}
          className="correxit-sidebar-cell-score-edit"
          role="group"
        >
          {!rubric.locked && assigned && (
            <label
              className="correxit-sidebar-cell-score-field"
              htmlFor={ids.score}
            >
              {trans.__('Points scored')}
              <input
                className="correxit-sidebar-cell-score-input"
                id={ids.score}
                inputMode="numeric"
                min="0"
                onBlur={() => void intervene()}
                onChange={({ target: { value } }) => setScore(whole(value))}
                placeholder={trans.__('Auto')}
                step="1"
                type="number"
                value={score}
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
                min="0"
                onBlur={() => void reweight()}
                onChange={({ target: { value } }) => setPoints(whole(value))}
                step="1"
                type="number"
                value={points}
              />
            </label>
          )}
          <Comment
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
      )}
    </>
  );
};

const Comment: React.FC<{
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
          data-lm-suppress-shortcuts="true"
          id={id}
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
