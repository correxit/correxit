import { CodeEditor, IEditorMimeTypeService } from '@jupyterlab/codeeditor';
import {
  ILanguageInfoMetadata,
  IMimeBundle,
  IOutput,
  isDisplayData,
  isError,
  isExecuteResult,
  isStream
} from '@jupyterlab/nbformat';
import { IRenderMime, IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { KernelMessage } from '@jupyterlab/services';
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
type Output = Rubric.Cell.Output | IOutput;
type ScoreRef = React.MutableRefObject<(action: 'pass' | 'fail') => void>;
type Shared = Headless['context']['model']['sharedModel']['cells'][number];
type TranslationBundle = IRenderMime.TranslationBundle;

const open = (workbook: Scanned | null) =>
  workbook && !workbook.hollow ? Workbook.open(workbook, true) : null;

const reified = (workbook: Scanned): workbook is Headless => !workbook.hollow;

const record = (value: unknown): value is { [key: string]: unknown } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const code = (
  cell: Shared | null
): cell is Extract<Shared, { cell_type: 'code' }> =>
  !!cell && cell.cell_type === 'code';

const language = (workbook: Headless | null): ILanguageInfoMetadata | null => {
  if (!workbook) return null;

  const notebook = workbook.context.model.sharedModel;
  const info = notebook.getMetadata('language_info');
  if (record(info)) return info as ILanguageInfoMetadata;

  const spec = notebook.getMetadata('kernelspec');
  const name =
    record(spec) && typeof spec.language === 'string' ? spec.language : null;
  return name ? { name } : null;
};

const mime = (
  workbook: Headless | null,
  mimeTypeService: IEditorMimeTypeService | null
) => {
  if (!mimeTypeService) return IEditorMimeTypeService.defaultMimeType;
  const info = language(workbook);
  return info
    ? mimeTypeService.getMimeTypeByLanguage(info)
    : IEditorMimeTypeService.defaultMimeType;
};

const integer = (value: string): number | '' => {
  if (value === '') return '';
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return '';
  return Math.max(0, Math.floor(parsed));
};

const instructions = (
  workbook: Headless | null,
  cursor: Cursor | null,
  rubric: Rubric | null
) => {
  if (!workbook || !cursor || !rubric) return null;

  const cells = workbook.context.model.sharedModel.cells;
  const index = cells.findIndex(cell => cell.id === cursor.cell);
  if (index <= 0) return null;

  const span = 3;
  const block: string[] = [];
  for (let i = index - 1; i >= 0 && block.length < span; i--) {
    const preceding = cells[i];
    if (preceding.cell_type !== 'markdown') break;
    if (preceding.id in rubric.cells) break;
    if (preceding.id in rubric.references) break;

    const source = preceding.getSource();
    if (!source.trim()) break;
    block.unshift(source);
  }

  return block.length ? block.join('\n\n') : null;
};

export function Reviewer(props: Reviewer.Props) {
  const {
    commands,
    factory,
    mimeTypeService,
    rendermime,
    trans,
    cursor: initial
  } = props;
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
    (direction: Reviewer.Direction) => {
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

  const ref = useRef<(direction: Reviewer.Direction) => void>(navigate);
  ref.current = navigate;
  useEffect(() => props.on.navigate(ref), []);

  const cell = rubric && cursor ? rubric.cells[cursor.cell] : null;
  const model = useMemo<Shared | null>(() => {
    if (!workbook || !cursor) return null;
    const cells = workbook.context.model.sharedModel.cells;
    return cells.find(cell => cell.id === cursor.cell) ?? null;
  }, [workbook, cursor?.cell]);
  const type = model?.cell_type ?? 'code';
  const source = model?.getSource() ?? '';
  const mimetype = useMemo(
    () => mime(workbook, mimeTypeService),
    [workbook, mimeTypeService]
  );
  const question = useMemo(
    () => instructions(workbook, cursor, rubric),
    [workbook, cursor?.cell, rubric]
  );
  const stored: Output[] = code(model) ? model.outputs : [];
  const [corrected, setCorrected] = useState<Rubric.Cell.Output[] | null>(null);
  useEffect(() => void setCorrected(null), [cursor?.path, cursor?.cell]);

  const outputs: Output[] = corrected ?? stored;
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
  const scored = useRef<(action: 'pass' | 'fail') => void>(judge);
  scored.current = judge;
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
          {question && (
            <CellSource
              factory={null}
              label={trans.__('Question context')}
              mimetype={mimetype}
              placeholder=""
              rendermime={rendermime}
              source={question}
              type="markdown"
              muted
            />
          )}
          <CellSource
            factory={factory}
            label={trans.__('Current cell')}
            mimetype={mimetype}
            placeholder={trans.__('(blank)')}
            rendermime={rendermime}
            source={source}
            type={type}
          />
          {type === 'code' && outputs.length > 0 && (
            <div
              aria-label={trans.__('Cell outputs')}
              className="correxit-reviewer-outputs"
            >
              {outputs.map((output, i: number) => (
                <CellOutput key={i} output={output} rendermime={rendermime} />
              ))}
            </div>
          )}
          {certified ? (
            <div className="correxit-reviewer-certified">
              <p>{trans.__('Certified (read-only)')}</p>
            </div>
          ) : (
            <div className="correxit-reviewer-scoring">
              <textarea
                aria-label={trans.__('Reviewer comment')}
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
                    aria-label={trans.__('Score')}
                    className="correxit-reviewer-score-input"
                    data-lm-suppress-shortcuts="true"
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
  export type Direction = 'down' | 'left' | 'right' | 'up';
  export type Navigate = React.MutableRefObject<(direction: Direction) => void>;
  export type Props = {
    commands: CommandRegistry;
    cursor: Cursor | null;
    factory: ((options: CodeEditor.IOptions) => CodeEditor.IEditor) | null;
    mimeTypeService: IEditorMimeTypeService | null;
    on: {
      navigate: (ref: Navigate) => void;
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
  label?: string;
  mimetype: string;
  muted?: boolean;
  placeholder: string;
  rendermime: IRenderMimeRegistry | null;
  source: string;
  type: string;
}> = ({
  factory,
  label,
  mimetype,
  muted,
  placeholder,
  rendermime,
  source,
  type
}) => {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<CodeEditor.IEditor | null>(null);
  const mime = type === 'code' ? mimetype : undefined;
  const className = [
    'correxit-reviewer-source',
    `cxt-cell-${type}`,
    muted && 'cxt-mod-question'
  ]
    .filter(Boolean)
    .join(' ');

  // Code cells: use a read-only CodeMirror editor for syntax highlighting.
  useEffect(() => {
    if (type !== 'code' || !factory || !host.current) return;
    host.current.textContent = '';
    const model = new CodeEditor.Model({ mimeType: mimetype });
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
  }, [factory, mimetype, source, type]);

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
      <div
        aria-label={label}
        className={className}
        data-mimetype={mime}
        key="plain"
      >
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
      <div
        aria-label={label}
        className={className}
        data-mimetype={mime}
        key="blank"
      >
        <pre>
          <span className="correxit-reviewer-source-blank">{empty}</span>
        </pre>
      </div>
    );
  }

  return (
    <div
      aria-label={label}
      className={className}
      data-mimetype={mime}
      key="rich"
      ref={host}
    />
  );
};

const kernel = (output: Output): output is Rubric.Cell.Output =>
  'header' in output && 'content' in output;

const text = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(text).join('');
  return JSON.stringify(value);
};

const bundle = (output: Output): IMimeBundle => {
  if (kernel(output)) {
    if (
      KernelMessage.isDisplayDataMsg(output) ||
      KernelMessage.isExecuteResultMsg(output)
    )
      return output.content.data;

    if (KernelMessage.isStreamMsg(output))
      return { 'text/plain': text(output.content.text) };

    if (!KernelMessage.isErrorMsg(output)) return {};

    const { ename, evalue, traceback } = output.content;
    const error = traceback.length
      ? traceback.join('\n')
      : `${ename}: ${evalue}`;
    return { 'text/plain': error };
  }

  if (isDisplayData(output) || isExecuteResult(output)) return output.data;
  if (isStream(output)) return { 'text/plain': text(output.text) };
  if (!isError(output)) return {};

  const error = output.traceback.length
    ? output.traceback.join('\n')
    : `${output.ename}: ${output.evalue}`;
  return { 'text/plain': error };
};

const plain = (mime: IMimeBundle, output: Output): string => {
  const value = mime['text/plain'];
  return value === undefined ? JSON.stringify(output) : text(value);
};

const CellOutput: React.FC<{
  output: Output;
  rendermime: IRenderMimeRegistry | null;
}> = ({ output, rendermime }) => {
  const host = useRef<HTMLDivElement>(null);
  const mime = bundle(output);
  const mimetype = rendermime?.preferredMimeType(mime, 'prefer') ?? null;
  const fallback = plain(mime, output);
  useEffect(() => {
    if (!rendermime || !mimetype || !host.current) return;
    host.current.textContent = '';

    const renderer = rendermime.createRenderer(mimetype);
    const model = rendermime.createModel({ data: mime, trusted: false });
    void renderer.renderModel(model).then(() => {
      if (host.current) {
        host.current.textContent = '';
        host.current.appendChild(renderer.node);
      }
    });
    return () => renderer.dispose();
  }, [mime, mimetype, rendermime]);
  if (!rendermime || !mimetype)
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
  const host = useRef<HTMLDivElement>(null);
  const focus = useRef<HTMLButtonElement | null>(null);
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
  useEffect(() => {
    const current = focus.current;
    if (!current) return;
    current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (host.current?.contains(document.activeElement)) current.focus();
  }, [cursor.cell, cursor.path]);

  const keyed = (row: number, col: number) => ({
    cell: rows[row],
    path: columns[col]
  });
  const identity = (row: number, col: number) =>
    `correxit-reviewer-minimap-${col}-${row}`;
  const active = {
    column: columns.indexOf(cursor.path),
    row: rows.indexOf(cursor.cell),
    id: undefined as string | undefined
  };
  active.id =
    active.row < 0 || active.column < 0
      ? undefined
      : identity(active.row, active.column);

  const label = (row: number, col: number, status: string, active: boolean) =>
    active
      ? trans.__('%1, cell %2, %3, active', columns[col], row + 1, status)
      : trans.__('%1, cell %2, %3', columns[col], row + 1, status);
  return (
    <div
      aria-activedescendant={active.id}
      className="correxit-reviewer-minimap"
      ref={host}
      role="grid"
      aria-label={trans.__('Score minimap')}
      style={{
        gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows.length}, minmax(0, 1fr))`
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
          const target = keyed(row, col);
          return (
            <button
              aria-label={label(row, col, status, active)}
              aria-selected={active}
              className={className}
              id={identity(row, col)}
              key={`${row}-${col}`}
              onClick={() => setCursor(target)}
              ref={active ? focus : undefined}
              role="gridcell"
              tabIndex={active ? 0 : -1}
              title={label(row, col, status, active)}
              type="button"
            />
          );
        })
      )}
    </div>
  );
};
