import { CodeEditor } from '@jupyterlab/codeeditor';
import { IRenderMime, IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { CommandRegistry } from '@lumino/commands';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { Rubric, Workbook } from '..';
import * as state from '../correxit/state';
import { Corrector } from '.';
import * as bridge from './bridge';
import { commands as COMMANDS, CommandIDs, Scanned } from './commands';
import { ReviewerWidget } from './widget';

type Collated = Corrector.Collated;
type Cursor = bridge.Cursor;
type Headless = Workbook.Headless;
type NavigateRef = React.MutableRefObject<(direction: string) => void>;
type ScoreRef = React.MutableRefObject<(action: 'pass' | 'fail') => void>;
type TranslationBundle = IRenderMime.TranslationBundle;

/** Open a workbook rubric quietly. */
const open = (workbook: Scanned | null) =>
  workbook && !workbook.hollow ? Workbook.open(workbook, true) : null;

/** A filter function that filters out hollow workbooks. */
const reified = (workbook: Scanned): workbook is Headless => !workbook.hollow;

const integer = (value: string): number | '' => {
  if (value === '') return '';
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return '';
  return Math.max(0, Math.floor(parsed));
};

export function Reviewer(props: Reviewer.Props) {
  const { commands, factory, rendermime, trans, cursor: initial } = props;
  const snapshot = bridge.useSnapshot();
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
      (cursor &&
        workbooks
          .filter(reified)
          .find(({ context: { path } }) => path === cursor.path)) ??
      null,
    [workbooks, cursor?.path]
  );
  const rubric = useMemo(() => open(workbook), [workbook]);
  const certified = !!(rubric && rubric.assignment.certification);
  const rows = useMemo(() => {
    if (!workbook || !rubric) return [];
    return workbook.context.model.sharedModel.cells
      .map(cell => cell.id)
      .filter(id => id in rubric.cells);
  }, [workbook, rubric]);

  useEffect(() => {
    props.on.workbook(workbook);
    if (workbook) void bridge.inject(commands, workbook);
    if (cursor) state.cursor(cursor.cell);
    bridge.navigate(cursor);
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
      switch (direction) {
        case 'up':
          if (row > 0) {
            next.row = row - 1;
          } else if (col > 0) {
            next.col = col - 1;
            next.row = rows.length - 1;
          }
          break;
        case 'down':
          if (row < rows.length - 1) {
            next.row = row + 1;
          } else if (col < columns.length - 1) {
            next.col = col + 1;
            next.row = 0;
          }
          break;
        case 'left':
          if (col > 0) {
            next.col = col - 1;
          } else if (row > 0) {
            next.row = row - 1;
            next.col = columns.length - 1;
          }
          break;
        case 'right':
          if (col < columns.length - 1) {
            next.col = col + 1;
          } else if (row < rows.length - 1) {
            next.row = row + 1;
            next.col = 0;
          }
          break;
      }
      setCursor({
        path: columns[next.col],
        cell: rows[next.row]
      });
    },
    [cursor, columns, rows]
  );

  const ref = useRef<(direction: string) => void>(navigate);
  ref.current = navigate;
  useEffect(() => props.on.navigate(ref), []);

  const cell = rubric && cursor ? rubric.cells[cursor.cell] : null;
  const model = useMemo(() => {
    if (!workbook || !cursor) return null;
    const cells = workbook.context.model.sharedModel.cells;
    return cells.find(cell => cell.id === cursor.cell) ?? null;
  }, [workbook, cursor?.cell]);
  const type = model?.cell_type ?? 'code';
  const source = model?.getSource() ?? '';
  const saved: any[] = type === 'code' ? ((model as any)?.outputs ?? []) : [];
  const [corrected, setCorrected] = useState<Rubric.Cell.Output[]>([]);
  useEffect(() => void setCorrected([]), [cursor?.path, cursor?.cell]);

  const outputs = corrected.length ? corrected : saved;
  const report = rubric
    ? (Rubric.Score.resolve(rubric.assignment.report, cursor?.cell ?? '') ??
      null)
    : null;
  const persisted = report && report.status !== 'unscored' ? report.points : '';
  const possible = cell ? cell.points : 0;
  const [score, setScore] = useState<number | ''>(persisted);
  const [comment, setComment] = useState(report?.comment ?? '');
  useEffect(() => {
    const resolved =
      rubric && cursor
        ? (Rubric.Score.resolve(rubric.assignment.report, cursor.cell) ?? null)
        : null;
    setScore(resolved && resolved.status !== 'unscored' ? resolved.points : '');
    setComment(resolved?.comment ?? '');
  }, [cursor?.path, cursor?.cell, rubric?.id]);

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
  useEffect(() => props.on.score(scored), []);

  const rerun = async () => {
    if (!cursor || !workbook || type !== 'code' || busy) return;
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
            type={type}
          />
          {type === 'code' && outputs.length > 0 && (
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
                    onChange={({ target: { value } }) =>
                      setScore(integer(value))
                    }
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
              {type === 'code' && (
                <button
                  className="correxit-reviewer-btn correxit-reviewer-btn-correct"
                  disabled={busy}
                  onClick={rerun}
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
    on: {
      navigate: (ref: NavigateRef) => void;
      score: (ref: ScoreRef) => void;
      workbook: (workbook: Headless | null) => void;
    };
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

    const cached = factory({
      host: host.current,
      model,
      config: { readOnly: true, lineNumbers: false }
    });
    editor.current = cached;
    return () => {
      editor.current = null;
      cached.dispose();
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
      trusted: false
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
      <div key="plain" className={className}>
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
      <div key="blank" className={className}>
        <pre>
          <span className="correxit-reviewer-source-blank">{empty}</span>
        </pre>
      </div>
    );
  }

  return <div key="rich" className={className} ref={host} />;
};

/**
 * Normalize an output to a renderable MIME bundle.
 */
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
    const model = rendermime.createModel({ data, trusted: false });
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
}> = ({
  columns,
  cursor,
  grades,
  revision,
  rows,
  setCursor,
  trans,
  workbooks
}) => {
  const grid = useMemo(() => {
    const rubrics = new Map(
      workbooks
        .filter(reified)
        .map(workbook => [workbook.context.path, open(workbook)] as const)
    );
    return rows.map(id =>
      columns.map(path => {
        const rubric = rubrics.get(path) ?? null;
        if (!rubric) return 'unscored';
        const cell = rubric.cells[id];
        if (!cell) return 'unscored';
        const score = Rubric.Score.resolve(rubric.assignment.report, id);
        const reviewable = cell.is === 'reviewable';
        if (!score || score.status === 'unscored')
          return reviewable ? 'review' : 'unscored';
        return score.status;
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
      {grid.map((line, row) =>
        line.map((status, col) => {
          const active =
            cursor.cell === rows[row] && cursor.path === columns[col];
          const className = [
            'correxit-reviewer-minimap-cell',
            `correxit-reviewer-minimap-${status}`,
            active && 'cxt-mod-active'
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div
              aria-label={`${columns[col]} cell ${row + 1}: ${status}`}
              className={className}
              key={`${row}-${col}`}
              onClick={() => setCursor({ path: columns[col], cell: rows[row] })}
              role="gridcell"
            />
          );
        })
      )}
    </div>
  );
};
