import { IRenderMime } from '@jupyterlab/rendermime';
import { CommandRegistry } from '@lumino/commands';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { Correxit, Rubric, Workbook } from '..';
import * as state from '../correxit/state';
import { navigate as bridgeNavigate, useSnapshot } from './bridge';
import { commands as COMMANDS, Scanned } from './commands';
import { ReviewerWidget } from './widget';

type Collated = Map<string, { grade: Workbook.Grade; workbook: Headless }>;
type Cursor = { path: string; cell: string };
type Headless = Workbook.Headless;
type NavigateRef = React.MutableRefObject<(direction: string) => void>;
type TranslationBundle = IRenderMime.TranslationBundle;

/** Open a workbook rubric quietly. */
const open = (workbook: Scanned | null) =>
  workbook && !workbook.hollow ? Workbook.open(workbook, true) : null;

/** A filter function that filters out hollow workbooks. */
const reified = (workbook: Scanned): workbook is Headless => !workbook.hollow;

/**
 * Injects a new workbook to be yielded by the Correxit monitor plugin.
 */
const inject = (commands: CommandRegistry, workbook: Workbook | null) =>
  void (async workbook =>
    (await commands.execute(Correxit.CommandIDs.inject))?.(workbook))(workbook);

const whole = (value: string): number | '' => {
  if (value === '') return '';
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return '';
  return Math.max(0, Math.floor(parsed));
};

export function Reviewer(props: Reviewer.Props) {
  const { commands, trans, cursor: initial } = props;
  const snapshot = useSnapshot();
  const { workbooks, grades } = snapshot;
  const empty = workbooks.length === 0;

  const [cursor, setCursor] = useState<Cursor | null>(initial ?? null);

  useEffect(() => {
    if (initial) setCursor(initial);
  }, [initial?.path, initial?.cell]);

  const columns = useMemo(
    () => workbooks.filter(reified).map(w => w.context.path),
    [workbooks]
  );
  const workbook = useMemo(
    () =>
      cursor
        ? ((workbooks.find(w => !w.hollow && w.context.path === cursor.path) as
            | Headless
            | undefined) ?? null)
        : null,
    [workbooks, cursor?.path]
  );
  const rubric = useMemo(() => open(workbook), [workbook]);
  const rows = useMemo(() => {
    if (!workbook || !rubric) return [];
    return workbook.context.model.sharedModel.cells
      .map(c => c.id)
      .filter(id => id in rubric.cells);
  }, [workbook, rubric]);

  useEffect(() => {
    if (workbook) inject(commands, workbook);
    if (cursor) state.cursor(cursor.cell);
    bridgeNavigate(cursor);
    return () => void state.cursor(null);
  }, [cursor?.path, cursor?.cell]);

  // Navigation helpers.
  const navigate = useCallback(
    (direction: string) => {
      if (!cursor) return;
      const col = columns.indexOf(cursor.path);
      const row = rows.indexOf(cursor.cell);
      if (col < 0 || row < 0) return;

      const next = { col, row };
      if (direction === 'up') next.row = Math.max(0, row - 1);
      if (direction === 'down') next.row = Math.min(rows.length - 1, row + 1);
      if (direction === 'left') next.col = Math.max(0, col - 1);
      if (direction === 'right')
        next.col = Math.min(columns.length - 1, col + 1);
      setCursor({ path: columns[next.col], cell: rows[next.row] });
    },
    [cursor, columns, rows]
  );

  const ref = useRef<(direction: string) => void>(navigate);
  ref.current = navigate;
  useEffect(() => props.onNavigate?.(ref), []);

  const cell = rubric && cursor ? rubric.cells[cursor.cell] : null;

  // Cell source and type.
  const sharedCell = useMemo(() => {
    if (!workbook || !cursor) return null;
    const cells = workbook.context.model.sharedModel.cells;
    return cells.find(c => c.id === cursor.cell) ?? null;
  }, [workbook, cursor?.cell]);

  const cellType = sharedCell?.cell_type ?? 'code';
  const source = sharedCell?.getSource() ?? '';
  const outputs =
    cellType === 'code' ? ((sharedCell as any)?.outputs ?? []) : [];

  // Score state.
  const report = rubric
    ? (Rubric.Score.resolve(rubric.assignment.report, cursor?.cell ?? '') ??
      null)
    : null;
  const persisted = report && report.status !== 'unscored' ? report.points : '';
  const possible = cell ? cell.points : 0;

  const [score, setScore] = useState<number | ''>(persisted);
  const [comment, setComment] = useState(report?.comment ?? '');

  // Reset score/comment on cursor navigation.
  useEffect(() => {
    const r =
      rubric && cursor
        ? (Rubric.Score.resolve(rubric.assignment.report, cursor.cell) ?? null)
        : null;
    setScore(r && r.status !== 'unscored' ? r.points : '');
    setComment(r?.comment ?? '');
  }, [cursor?.path, cursor?.cell, rubric?.id]);

  // Commit score and comment.
  const commit = useCallback(
    async (points: number) => {
      if (!cursor || !cell) return;
      const intervention = Rubric.Score.intervene(cursor.cell, {
        comment,
        points,
        possible: cell.points
      });
      await commands.execute(Correxit.CommandIDs.intervene, {
        id: cursor.cell,
        intervention
      });
      if (comment) {
        await commands.execute(Correxit.CommandIDs.comment, {
          id: cursor.cell,
          comment
        });
      }
    },
    [cursor, cell, comment, commands]
  );
  const scoring = useRef(false);
  const directional = useCallback(
    async (points: number, direction: 'down' | 'right') => {
      if (scoring.current) return;
      scoring.current = true;
      try {
        await commit(points);
        navigate(direction);
      } finally {
        scoring.current = false;
      }
    },
    [commit, navigate]
  );
  const fail = (direction: 'down' | 'right') => void directional(0, direction);
  const pass = (direction: 'down' | 'right') => {
    const value =
      typeof score === 'number' && score !== possible ? score : possible;
    void directional(value, direction);
  };

  const doCorrect = () => {
    if (cursor && cellType === 'code') {
      void commands.execute(Correxit.CommandIDs.correct, {
        id: cursor.cell
      });
    }
  };

  const partial =
    typeof score === 'number' && score !== possible && score !== persisted;

  // Idle state.
  if (empty) {
    return (
      <div className="correxit-reviewer correxit-reviewer-idle">
        <p>{trans.__('Open the Corrector to begin reviewing.')}</p>
      </div>
    );
  }

  if (!cursor || !workbook || !rubric) {
    return (
      <div className="correxit-reviewer correxit-reviewer-idle">
        <p>{trans.__('Select a cell to begin reviewing.')}</p>
      </div>
    );
  }

  return (
    <div className="correxit-reviewer">
      <div className="correxit-reviewer-body">
        <Minimap
          columns={columns}
          cursor={cursor}
          grades={grades}
          rows={rows}
          setCursor={setCursor}
          trans={trans}
          workbooks={workbooks}
        />
        <div className="correxit-reviewer-content">
          <CellSource source={source} type={cellType} />
          {cellType === 'code' && outputs.length > 0 && (
            <div className="correxit-reviewer-outputs">
              {outputs.map((output: any, i: number) => (
                <pre key={i} className="correxit-reviewer-output">
                  {output.text?.join?.('') ??
                    output.data?.['text/plain']?.join?.('') ??
                    JSON.stringify(output)}
                </pre>
              ))}
            </div>
          )}
          <div className="correxit-reviewer-scoring">
            <textarea
              className="correxit-reviewer-comment"
              data-lm-suppress-shortcuts="true"
              onChange={({ target: { value } }) => setComment(value)}
              placeholder={trans.__('Comment...')}
              rows={3}
              value={comment}
            />
            <div className="correxit-reviewer-scoring-grid">
              <button
                className="correxit-reviewer-btn correxit-reviewer-btn-fail"
                onClick={() => fail('down')}
                title={trans.__('Fail and advance to next cell')}
              >
                ↓ {trans.__('Fail')}
              </button>
              <span className="correxit-reviewer-score-display">
                <input
                  className="correxit-reviewer-score-input"
                  inputMode="numeric"
                  min="0"
                  onChange={({ target: { value } }) => setScore(whole(value))}
                  step="1"
                  type="number"
                  value={score}
                />
                <span className="correxit-reviewer-score-sep">/</span>
                <span className="correxit-reviewer-score-possible">
                  {possible}
                </span>
              </span>
              <button
                className={[
                  'correxit-reviewer-btn correxit-reviewer-btn-pass',
                  partial && 'cxt-mod-partial'
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => pass('down')}
                title={trans.__('Pass and advance to next cell')}
              >
                ↓ {partial ? trans.__('Partial') : trans.__('Pass')}
              </button>
              <button
                className="correxit-reviewer-btn correxit-reviewer-btn-fail"
                onClick={() => fail('right')}
                title={trans.__('Fail and advance to next workbook')}
              >
                → {trans.__('Fail')}
              </button>
              <span />
              <button
                className={[
                  'correxit-reviewer-btn correxit-reviewer-btn-pass',
                  partial && 'cxt-mod-partial'
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => pass('right')}
                title={trans.__('Pass and advance to next workbook')}
              >
                → {partial ? trans.__('Partial') : trans.__('Pass')}
              </button>
            </div>
            {cellType === 'code' && (
              <button
                className="correxit-reviewer-btn correxit-reviewer-btn-correct"
                onClick={doCorrect}
                title={trans.__('Execute and correct cell')}
              >
                {trans.__('Correct')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export namespace Reviewer {
  export type Props = {
    commands: CommandRegistry;
    cursor: Cursor | null;
    onNavigate: ((ref: NavigateRef) => void) | null;
    trans: TranslationBundle;
  };

  export type Widget = ReviewerWidget;
  export const commands = COMMANDS;
  export const Widget = ReviewerWidget;
}

const CellSource: React.FC<{
  source: string;
  type: string;
}> = ({ source, type }) => {
  if (type === 'raw') {
    return (
      <div className="correxit-reviewer-source">
        <pre className="correxit-reviewer-raw">{source}</pre>
      </div>
    );
  }
  // For code and markdown cells, render as preformatted text.
  // CodeMirror / rendermime integration can be added later.
  return (
    <div className="correxit-reviewer-source">
      <pre className="correxit-reviewer-code">{source}</pre>
    </div>
  );
};

const Minimap: React.FC<{
  columns: string[];
  cursor: Cursor;
  grades: Collated;
  rows: string[];
  setCursor: (cursor: Cursor) => void;
  trans: TranslationBundle;
  workbooks: Scanned[];
}> = ({ columns, cursor, grades, rows, setCursor, trans, workbooks }) => {
  const grid = useMemo(() => {
    return rows.map(cellId =>
      columns.map(path => {
        const workbook = workbooks.find(
          w => !w.hollow && w.context.path === path
        ) as Headless | undefined;
        if (!workbook) return 'unscored';
        const rubric = open(workbook);
        if (!rubric) return 'unscored';
        const cell = rubric.cells[cellId];
        if (!cell) return 'unscored';
        const score = Rubric.Score.resolve(rubric.assignment.report, cellId);
        if (!score) return cell.is === 'reviewable' ? 'review' : 'unscored';

        return score.status === 'unscored'
          ? cell.is === 'reviewable'
            ? 'review'
            : 'unscored'
          : score.status;
      })
    );
  }, [columns, rows, workbooks, grades]);

  return (
    <div
      className="correxit-reviewer-minimap"
      role="grid"
      aria-label={trans.__('Score minimap')}
      style={{
        gridTemplateColumns: `repeat(${columns.length}, 4px)`,
        gridTemplateRows: `repeat(${rows.length}, 4px)`
      }}
    >
      {grid.map((row, ri) =>
        row.map((status, ci) => {
          const active =
            cursor.cell === rows[ri] && cursor.path === columns[ci];
          const className = [
            'correxit-reviewer-minimap-cell',
            `correxit-reviewer-minimap-${status}`,
            active && 'cxt-mod-active'
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div
              aria-label={`${columns[ci]} cell ${ri + 1}: ${status}`}
              className={className}
              key={`${ri}-${ci}`}
              onClick={() => setCursor({ path: columns[ci], cell: rows[ri] })}
              role="gridcell"
            />
          );
        })
      )}
    </div>
  );
};
