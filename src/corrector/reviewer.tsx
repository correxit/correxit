import { CodeEditor } from '@jupyterlab/codeeditor';
import { IRenderMime } from '@jupyterlab/rendermime';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
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
import { commands as COMMANDS, CommandIDs, Scanned } from './commands';
import { ReviewerWidget } from './widget';

type Collated = Map<string, { grade: Workbook.Grade; workbook: Headless }>;
type Cursor = { path: string; cell: string };
type Headless = Workbook.Headless;
type NavigateRef = React.MutableRefObject<(direction: string) => void>;
type ScoreRef = React.MutableRefObject<(action: 'pass' | 'fail') => void>;
type TranslationBundle = IRenderMime.TranslationBundle;

/** Open a workbook rubric quietly. */
const open = (workbook: Scanned | null) =>
  workbook && !workbook.hollow ? Workbook.open(workbook, true) : null;

/** A filter function that filters out hollow workbooks. */
const reified = (workbook: Scanned): workbook is Headless => !workbook.hollow;

/**
 * Injects a new workbook to be yielded by the Correxit monitor plugin.
 *
 * @returns a promise that resolves once the injection is complete.
 */
const inject = (commands: CommandRegistry, workbook: Workbook | null) =>
  (async (workbook: Workbook | null) =>
    void (await commands.execute(Correxit.CommandIDs.inject))?.(workbook))(
    workbook
  );

const whole = (value: string): number | '' => {
  if (value === '') return '';
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return '';
  return Math.max(0, Math.floor(parsed));
};

export function Reviewer(props: Reviewer.Props) {
  const {
    commands,
    factory,
    rendermime,
    trans,
    cursor: initial,
    onWorkbook
  } = props;
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
  const certified = !!(rubric && rubric.assignment.certification);
  const rows = useMemo(() => {
    if (!workbook || !rubric) return [];
    return workbook.context.model.sharedModel.cells
      .map(c => c.id)
      .filter(id => id in rubric.cells);
  }, [workbook, rubric]);

  useEffect(() => {
    onWorkbook?.(workbook);
    if (workbook) void inject(commands, workbook);
    if (cursor) state.cursor(cursor.cell);
    bridgeNavigate(cursor);
    return () => void state.cursor(null);
  }, [workbook, cursor?.path, cursor?.cell]);

  // Navigation helpers.
  const navigate = useCallback(
    (direction: string) => {
      if (!cursor) return;
      const col = columns.indexOf(cursor.path);
      const row = rows.indexOf(cursor.cell);
      if (col < 0 || row < 0) return;

      const next = { col, row };
      if (direction === 'up') {
        if (row > 0) {
          next.row = row - 1;
        } else if (col > 0) {
          next.col = col - 1;
          next.row = rows.length - 1;
        }
      }
      if (direction === 'down') {
        if (row < rows.length - 1) {
          next.row = row + 1;
        } else if (col < columns.length - 1) {
          next.col = col + 1;
          next.row = 0;
        }
      }
      if (direction === 'left') {
        if (col > 0) {
          next.col = col - 1;
        } else if (row > 0) {
          next.row = row - 1;
          next.col = columns.length - 1;
        }
      }
      if (direction === 'right') {
        if (col < columns.length - 1) {
          next.col = col + 1;
        } else if (row < rows.length - 1) {
          next.row = row + 1;
          next.col = 0;
        }
      }
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
  const saved: any[] =
    cellType === 'code' ? ((sharedCell as any)?.outputs ?? []) : [];

  // Correction outputs from verbose execution.
  const [corrected, setCorrected] = useState<Rubric.Cell.Output[]>([]);
  useEffect(() => void setCorrected([]), [cursor?.path, cursor?.cell]);

  const outputs = corrected.length ? corrected : saved;

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
    const resolved =
      rubric && cursor
        ? (Rubric.Score.resolve(rubric.assignment.report, cursor.cell) ?? null)
        : null;
    setScore(resolved && resolved.status !== 'unscored' ? resolved.points : '');
    setComment(resolved?.comment ?? '');
  }, [cursor?.path, cursor?.cell, rubric?.id]);

  // Commit score and comment.
  const [revision, setRevision] = useState(0);
  const commit = useCallback(
    async (points: number) => {
      if (!cursor || !cell || !workbook || certified) return;
      const intervention = Rubric.Score.intervene(cursor.cell, {
        comment,
        points,
        possible: cell.points
      });
      await commands.execute(CommandIDs.intervene, {
        id: cursor.cell,
        intervention,
        ...(comment ? { comment } : {})
      });
      setRevision(n => n + 1);
    },
    [cursor, cell, comment, commands, workbook]
  );
  const scoring = useRef(false);
  const [busy, setBusy] = useState(false);
  const directional = useCallback(
    async (points: number, direction: 'down' | 'right') => {
      if (scoring.current) return;
      scoring.current = true;
      setBusy(true);
      try {
        await commit(points);
        navigate(direction);
      } finally {
        scoring.current = false;
        setBusy(false);
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

  const judge = useCallback(
    async (action: 'pass' | 'fail') => {
      if (scoring.current || certified) return;
      scoring.current = true;
      setBusy(true);
      try {
        const points =
          action === 'fail'
            ? 0
            : typeof score === 'number' && score !== possible
              ? score
              : possible;
        await commit(points);
      } finally {
        scoring.current = false;
        setBusy(false);
      }
    },
    [commit, score, possible]
  );
  const scored = useRef<(action: 'pass' | 'fail') => void>(a => judge(a));
  scored.current = a => judge(a);
  useEffect(() => props.onScore?.(scored), []);

  const doCorrect = async () => {
    if (!cursor || !workbook || cellType !== 'code' || busy) return;
    setBusy(true);
    try {
      const result = await Workbook.correct(workbook, cursor.cell, true);
      setCorrected(result.outputs.get(cursor.cell) ?? []);
    } finally {
      setBusy(false);
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
          revision={revision}
          rows={rows}
          setCursor={setCursor}
          trans={trans}
          workbooks={workbooks}
        />
        <div className="correxit-reviewer-content">
          <CellSource
            factory={factory}
            placeholder={trans.__('(blank)')}
            rendermime={rendermime}
            source={source}
            type={cellType}
          />
          {cellType === 'code' && outputs.length > 0 && (
            <div className="correxit-reviewer-outputs">
              {outputs.map((output: any, i: number) => (
                <CellOutput key={i} output={output} rendermime={rendermime} />
              ))}
            </div>
          )}
          {certified ? (
            <div className="correxit-reviewer-certified">
              <p>{trans.__('Certified')}</p>
            </div>
          ) : (
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
                  disabled={busy}
                  onClick={() => fail('down')}
                  title={trans.__('Fail and advance to next cell')}
                >
                  <span>{trans.__('Fail')}</span> <span>↓</span>
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
                  disabled={busy}
                  onClick={() => pass('down')}
                  title={trans.__('Pass and advance to next cell')}
                >
                  <span>
                    {partial ? trans.__('Partial') : trans.__('Pass')}
                  </span>{' '}
                  <span>↓</span>
                </button>
                <button
                  className="correxit-reviewer-btn correxit-reviewer-btn-fail"
                  disabled={busy}
                  onClick={() => fail('right')}
                  title={trans.__('Fail and advance to next workbook')}
                >
                  <span>{trans.__('Fail')}</span> <span>→</span>
                </button>
                <span />
                <button
                  className={[
                    'correxit-reviewer-btn correxit-reviewer-btn-pass',
                    partial && 'cxt-mod-partial'
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  disabled={busy}
                  onClick={() => pass('right')}
                  title={trans.__('Pass and advance to next workbook')}
                >
                  <span>
                    {partial ? trans.__('Partial') : trans.__('Pass')}
                  </span>{' '}
                  <span>→</span>
                </button>
              </div>
              {cellType === 'code' && (
                <button
                  className="correxit-reviewer-btn correxit-reviewer-btn-correct"
                  disabled={busy}
                  onClick={doCorrect}
                  title={trans.__('Execute and correct cell')}
                >
                  {busy ? trans.__('Correcting…') : trans.__('Correct')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export namespace Reviewer {
  export type Props = {
    commands: CommandRegistry;
    cursor: Cursor | null;
    factory: ((options: CodeEditor.IOptions) => CodeEditor.IEditor) | null;
    onNavigate: ((ref: NavigateRef) => void) | null;
    onScore: ((ref: ScoreRef) => void) | null;
    onWorkbook: ((workbook: Headless | null) => void) | null;
    rendermime: IRenderMimeRegistry | null;
    trans: TranslationBundle;
  };

  export type Widget = ReviewerWidget;
  export const commands = COMMANDS;
  export const Widget = ReviewerWidget;
}

const CellSource: React.FC<{
  factory: ((options: CodeEditor.IOptions) => CodeEditor.IEditor) | null;
  placeholder: string;
  rendermime: IRenderMimeRegistry | null;
  source: string;
  type: string;
}> = ({ factory, placeholder, rendermime, source, type }) => {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<CodeEditor.IEditor | null>(null);
  const className = `correxit-reviewer-source cxt-cell-${type}`;

  // Code cells: use a read-only CodeMirror editor for syntax highlighting.
  useEffect(() => {
    if (type !== 'code' || !factory || !host.current) return;
    host.current.textContent = '';
    const model = new CodeEditor.Model({ mimeType: 'text/x-python' });
    model.sharedModel.setSource(source);
    const ed = factory({
      host: host.current,
      model,
      config: { readOnly: true, lineNumbers: false }
    });
    editor.current = ed;
    return () => {
      editor.current = null;
      ed.dispose();
      model.dispose();
    };
  }, [source, type, factory]);

  // Markdown cells: use rendermime for rich rendering.
  useEffect(() => {
    if (type !== 'markdown' || !rendermime || !host.current) return;
    host.current.textContent = '';

    const renderer = rendermime.createRenderer('text/markdown');
    const model = rendermime.createModel({
      data: { 'text/markdown': source },
      trusted: true
    });
    void renderer.renderModel(model).then(() => {
      if (host.current) {
        host.current.textContent = '';
        host.current.appendChild(renderer.node);
      }
    });
    return () => renderer.dispose();
  }, [source, type, rendermime]);

  const empty = placeholder;
  const unavailable =
    (type === 'code' && !factory) ||
    (type === 'markdown' && !rendermime) ||
    type === 'raw';
  if (unavailable) {
    return (
      <div className={className}>
        <pre>
          {source || (
            <span className="correxit-reviewer-source-blank">{empty}</span>
          )}
        </pre>
      </div>
    );
  }
  if (!source) {
    return (
      <div className={className}>
        <pre>
          <span className="correxit-reviewer-source-blank">{empty}</span>
        </pre>
      </div>
    );
  }

  return <div className={className} ref={host} />;
};

/** Normalize an output (nbformat IOutput or kernel IIOPubMessage) to a bundle. */
const bundle = (output: any): Record<string, string> => {
  // Kernel message: content lives under output.content.
  const content = output.content ?? output;
  const data: Record<string, string> | undefined = content.data;
  if (data) return data;
  // Stream: text may be string or string[].
  const text = content.text;
  if (text !== null && text !== undefined) {
    const joined = Array.isArray(text) ? text.join('') : String(text);
    return { 'text/plain': joined };
  }
  return {};
};

const CellOutput: React.FC<{
  output: any;
  rendermime: IRenderMimeRegistry | null;
}> = ({ output, rendermime }) => {
  const host = useRef<HTMLDivElement>(null);

  const data = bundle(output);
  const fallback = data['text/plain'] ?? JSON.stringify(output);

  useEffect(() => {
    if (!rendermime || !host.current) return;
    const mimeType = rendermime.preferredMimeType(data, 'prefer');
    if (!mimeType) return;
    host.current.textContent = '';
    const renderer = rendermime.createRenderer(mimeType);
    const model = rendermime.createModel({ data, trusted: true });
    void renderer.renderModel(model).then(() => {
      if (host.current) {
        host.current.textContent = '';
        host.current.appendChild(renderer.node);
      }
    });
    return () => renderer.dispose();
  }, [output, rendermime]);

  if (!rendermime)
    return <pre className="correxit-reviewer-output">{fallback}</pre>;

  return <div className="correxit-reviewer-output" ref={host} />;
};

const Minimap: React.FC<{
  columns: string[];
  cursor: Cursor;
  grades: Collated;
  revision: number;
  rows: string[];
  setCursor: (cursor: Cursor) => void;
  trans: TranslationBundle;
  workbooks: Scanned[];
}> = ({ columns, cursor, grades, revision, rows, setCursor, trans, workbooks }) => {
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
  }, [columns, rows, workbooks, grades, revision]);

  return (
    <div
      className="correxit-reviewer-minimap"
      role="grid"
      aria-label={trans.__('Score minimap')}
      style={{
        gridTemplateColumns: `repeat(${columns.length}, 1fr)`,
        gridTemplateRows: `repeat(${rows.length}, 1fr)`
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
