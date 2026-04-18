import { PathExt } from '@jupyterlab/coreutils';
import { IRenderMime } from '@jupyterlab/rendermime';
import { Button, notebookIcon } from '@jupyterlab/ui-components';
import { find } from '@lumino/algorithm';
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
import { useCommand } from '../correxit/use-command';
import * as bridge from './bridge';
import {
  commands as COMMANDS,
  CommandIDs as COMMAND_IDS,
  Scanned
} from './commands';
import { CorrectorStatus, CorrectorWidget } from './widget';

type Batched = [path: string, file: { grade: Grade; workbook: Headless }];
type Collated = Corrector.Collated;
type Grade = Workbook.Grade;
type Headless = Workbook.Headless;
type Phase =
  | 'certified'
  | 'collected'
  | 'failed'
  | 'pending'
  | 'review'
  | 'scanned';
type TranslationBundle = IRenderMime.TranslationBundle;
type Walk = {
  active: string;
  selected: string;
  clear: () => void;
  move: (path: string, step: -1 | 1) => void;
  node: (path: string, row: HTMLTableRowElement | null) => void;
  select: (path: string) => void;
};

const FAILED = 'cxt-mod-failed';
const PENDING = 'cxt-mod-pending';
const SELECTED = 'cxt-mod-selected';
const { batch, collect, scan } = COMMAND_IDS;
const { basename } = PathExt;

/**
 * Cache workbook contexts by path.
 */
const cache = (cached: { [path: string]: Headless }, workbooks: Headless[]) => {
  for (const workbook of workbooks) {
    const path = workbook.context.path;
    const kept = cached[path];
    if (kept && kept !== workbook) kept.context.dispose();
    cached[path] = workbook;
  }
};

/**
 * Dispose workbook contexts.
 */
const dispose = (workbooks: Headless[]) =>
  workbooks.forEach(({ context }) => context.dispose());

const release = (cached: { [path: string]: Headless }) => {
  dispose(Object.values(cached));

  const workbook = state.workbook();
  if (Workbook.headless(workbook)) state.workbook(null);
  bridge.clear();
};

const advance = (workbooks: Scanned[], path: string, step: -1 | 1) => {
  const order = workbooks.map(({ context }) => context.path);
  const index = order.indexOf(path);
  if (index === -1) return null;
  return order[index + step] || null;
};

const retreat = (event: React.KeyboardEvent<HTMLElement>) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();

  const row = event.currentTarget.closest('tr');
  if (row instanceof HTMLTableRowElement) row.focus();
};

const keydown =
  (path: string, walk: Walk) =>
  (event: React.KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      walk.move(path, -1);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      walk.move(path, 1);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      walk.clear();
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    walk.select(path);
  };

const useWalk = (workbooks: Scanned[]): Walk => {
  const rows = useRef({} as { [path: string]: HTMLTableRowElement | null });
  const target = useRef('');
  const [cursor, setCursor] = useState('');
  const [selected, setSelected] = useState('');
  const active = useMemo(() => {
    if (workbooks.some(({ context }) => context.path === cursor)) return cursor;
    if (workbooks.some(({ context }) => context.path === selected))
      return selected;
    return workbooks[0]?.context.path || '';
  }, [cursor, selected, workbooks]);
  const select = useCallback((path: string) => {
    setCursor(path);
    setSelected(path);
  }, []);
  const clear = useCallback(() => setSelected(''), []);
  const move = useCallback(
    (path: string, step: -1 | 1) => {
      const next = advance(workbooks, path, step);
      if (!next) return;
      target.current = next;
      select(next);
    },
    [select, workbooks]
  );
  const node = useCallback((path: string, row: HTMLTableRowElement | null) => {
    rows.current[path] = row;
  }, []);
  useEffect(() => {
    if (!cursor) return;
    if (workbooks.some(({ context }) => context.path === cursor)) return;
    setCursor('');
  }, [cursor, workbooks]);
  useEffect(() => {
    if (!selected) return;
    if (workbooks.some(({ context }) => context.path === selected)) return;
    setSelected('');
  }, [selected, workbooks]);
  useEffect(() => {
    const row = rows.current[target.current];
    if (!row) return;
    row.focus();
    target.current = '';
  }, [selected, workbooks]);
  return { active, clear, move, node, select, selected };
};

/** @returns a multi-line lifecycle history for tooltips. */
const history = (workbook: Scanned, trans: TranslationBundle): string => {
  const rubric = open(workbook);
  if (!rubric) return '';

  const { certification, collected, distribution, submission, submitted } =
    rubric.assignment;
  const lines: string[] = [];
  if (distribution !== null)
    lines.push(trans.__('Distribution %1', Rubric.timestamp(distribution)));
  if (submission !== null)
    lines.push(trans.__('Submission %1', Rubric.timestamp(submission)));
  if (submitted !== null) lines.push(trans.__('Submitted: %1', submitted));
  if (certification !== null)
    lines.push(trans.__('Certification %1', Rubric.timestamp(certification)));
  if (collected !== null) lines.push(trans.__('Collected: %1', collected));
  return lines.join('\n');
};

/** @returns the lifecycle phase of a workbook. */
const lifecycle = (workbook: Scanned, grade: Grade | 'pending'): Phase => {
  if (grade === 'pending') return 'pending';
  if (!grade.resolved) return 'failed';
  if (workbook.hollow) return 'scanned';

  const rubric = open(workbook);
  if (!rubric) return 'scanned';

  const { assignment } = rubric;
  if (assignment.collected) return 'collected';
  if (assignment.certification) return 'certified';

  const pending = Object.values(rubric.cells)
    .filter(cell => cell.is === 'reviewable')
    .some(cell => !assignment.report.interventions[cell.id]);
  return pending ? 'review' : 'scanned';
};

/** @returns the logo of a kernel in order of preference. */
const logo = (spec: Exclude<Workbook.Grade['spec'], null>) => {
  const { resources } = spec;
  const src =
    resources['logo-svg'] || resources['logo-64x64'] || resources['logo-32x32'];
  return src || '';
};

/** @returns a workbook or `null` if path matches workbook context. */
const match = (workbooks: Scanned[], path = ''): Headless | null =>
  (find(workbooks, workbook => {
    return workbook.context.path === path && !workbook.hollow;
  }) || null) as Headless | null;

/** @returns a merged list workbooks that prioritizes the graded collection. */
const merge = (scanned: Scanned[], grades: Collated) => {
  const latest = new Map<string, Scanned>();
  for (const workbook of scanned) latest.set(workbook.context.path, workbook);
  for (const [path, file] of grades) latest.set(path, file.workbook);
  return Array.from(latest.values());
};

/** Open a workbook rubric quietly. */
const open = (workbook: Scanned | null) =>
  workbook && !workbook.hollow ? Workbook.open(workbook, true) : null;

/** Collect workbook paths as a set. */
const paths = (workbooks: Scanned[]) =>
  new Set(workbooks.map(({ context }) => context.path));

/** Dispose and remove cached workbooks not in the live path set. */
const prune = (
  cached: { [path: string]: Headless },
  live: Set<string>,
  active: string | null
) => {
  for (const [path, workbook] of Object.entries(cached)) {
    if (live.has(path) || path === active) continue;
    workbook.context.dispose();
    delete cached[path];
  }
};

/** Reconcile cached workbooks with the current merged list. */
const reconcile = (
  cached: { [path: string]: Headless },
  workbooks: Scanned[],
  focus: string | null
) => {
  prune(cached, paths(workbooks), focus);
  cache(cached, workbooks.filter(reified));
};

/** A filter function that filters out hollow workbooks. */
const reified = (workbook: Scanned): workbook is Headless => !workbook.hollow;

/** @returns the number of resolved grades in a collation of workbooks. */
const resolutions = (collated: Collated) =>
  Array.from(collated.values()).filter(({ grade }) => grade.resolved).length;

/** @returns the grade for a workbook given current batch and scan state. */
const resolve = (
  workbook: Scanned,
  collated: Collated,
  graded: boolean
): Grade | 'pending' => {
  const { path } = workbook.context;
  if (collated.has(path)) return collated.get(path)!.grade;
  if (workbook.hollow || !graded) return 'pending';

  const rubric = open(workbook);
  const report = rubric?.assignment.report;
  const summary = report && Rubric.Assignment.summary(report);
  const score = summary || Rubric.Score.UNSCORED;
  return { path, resolved: true, score, spec: report?.kernel ?? null };
};

/** @returns the at-a-glance status of a workbook in the corrector. */
const status = (
  grade: Grade,
  graded: boolean,
  phase: Exclude<Phase, 'pending'>,
  trans: TranslationBundle
) => {
  if (phase === 'failed')
    return graded ? trans.__('failed') : trans.__('retrying');

  const { points, possible, status } = grade.score;
  const unscored = status === 'unscored';
  if (phase === 'collected') {
    return unscored
      ? trans.__('unscored \u00b7 collected')
      : trans.__('%1 of %2 \u00b7 collected', points, possible);
  }
  if (phase === 'certified') {
    return unscored
      ? trans.__('unscored \u00b7 certified')
      : trans.__('%1 of %2 \u00b7 certified', points, possible);
  }
  if (phase === 'review') {
    return unscored
      ? trans.__('unscored \u00b7 review')
      : trans.__('%1 of %2 \u00b7 review', points, possible);
  }
  return unscored
    ? trans.__('unscored')
    : trans.__('%1 of %2', points, possible);
};

export function Corrector(props: Corrector.Props) {
  const { commands, mode, notify, overwrite, path, trans } = props;
  const grading = mode !== 'scan';
  const [workbooks, scanned] = useCommand<Scanned>(commands, scan, { path });
  const command = mode === 'grade' ? batch : mode === 'collect' ? collect : '';
  const auth = mode === 'grade';
  const config = { overwrite, path, ...(auth ? { unlock: true } : {}) };
  const [batched, graded] = useCommand<Batched>(commands, command, config);
  const loaded = useMemo(() => workbooks.filter(reified).length, [workbooks]);
  const grades = useMemo(() => new Map(batched) as Collated, [batched]);
  const resolved = useMemo(() => resolutions(grades), [grades]);
  const memo = useMemo(() => merge(workbooks, grades), [workbooks, grades]);
  const cached = useRef({} as { [path: string]: Headless });
  const walk = useWalk(memo);
  const workbook = useMemo(
    () => match(memo, walk.selected),
    [memo, walk.selected]
  );
  const focus = workbook?.context.path || null;
  const total = memo.length;
  const progress = { graded, grading, loaded, resolved, scanned, total };
  useEffect(() => () => release(cached.current), []);
  useEffect(() => bridge.inject(commands, workbook), [workbook]);
  useEffect(() => notify({ graded, scanned, mode }), [graded, scanned, mode]);
  useEffect(() => reconcile(cached.current, memo, focus), [focus, memo]);
  useEffect(() => bridge.publish({ workbooks: memo, grades }), [memo, grades]);
  return (
    <table
      aria-label={trans.__('Corrector workbooks')}
      className="correxit-corrector"
    >
      <Columns />
      <tbody>
        <Progress {...{ ...progress, trans }} />
        {memo.map(workbook => {
          const grade = resolve(workbook, grades, graded);
          const { path } = workbook.context;
          const props = { commands, grade, graded, trans, walk, workbook };
          return <Row {...props} key={path} />;
        })}
      </tbody>
    </table>
  );
}

export namespace Corrector {
  export type Collated = Map<string, { grade: Grade; workbook: Headless }>;

  export type Mode = 'collect' | 'grade' | 'scan';

  export type Notification = { graded: boolean; scanned: boolean; mode: Mode };

  export type Props = {
    commands: CommandRegistry;
    mode: Mode;
    notify: (updates: Notification) => void;
    overwrite: boolean;
    path: string;
    trans: TranslationBundle;
  };

  export type Status = CorrectorStatus;

  export type Widget = CorrectorWidget;

  export const commands = COMMANDS;

  export const CommandIDs = COMMAND_IDS;

  export const Modes: Readonly<Mode[]> = ['scan', 'grade', 'collect'];

  export const Status = CorrectorStatus;

  export const Widget = CorrectorWidget;
}

const Progress: React.FC<{
  graded: boolean;
  grading: boolean;
  loaded: number;
  resolved: number;
  scanned: boolean;
  total: number;
  trans: TranslationBundle;
}> = ({ graded, grading, loaded, resolved, scanned, total, trans }) => {
  const active = !!total && (!scanned || (grading && !graded));
  const peak = useRef(0);
  peak.current = Math.max(peak.current, grading ? resolved : loaded);

  const progress = active ? peak.current : 0;
  const percent = total > 0 ? Math.round((progress / total) * 100) : 0;
  const className = active
    ? 'correxit-corrector-progress cxt-mod-active'
    : 'correxit-corrector-progress';
  return (
    <tr className={className}>
      <td colSpan={5}>
        {active ? (
          <div className="correxit-corrector-progress-bar">
            <progress
              aria-label={trans.__('Corrector progress')}
              max={total}
              value={progress}
            />
            <span>{trans.__('%1%', percent)}</span>
          </div>
        ) : null}
      </td>
    </tr>
  );
};

const Columns: React.FC = () => (
  <colgroup>
    <col className="correxit-corrector-col-open" />
    <col className="correxit-corrector-col-assignee" />
    <col className="correxit-corrector-col-breakdown" />
    <col className="correxit-corrector-col-kernel" />
    <col className="correxit-corrector-col-status" />
  </colgroup>
);

const Line: React.FC<{
  className: string;
  children: React.ReactNode;
  path: string;
  walk: Walk;
}> = ({ children, className, path, walk }) => {
  const active = path === walk.active;
  const selected = path === walk.selected;
  return (
    <tr
      aria-selected={selected}
      className={className}
      data-path={path}
      onClick={event => {
        walk.select(path);
        event.currentTarget.focus();
      }}
      onFocus={() => walk.select(path)}
      onKeyDown={keydown(path, walk)}
      ref={row => walk.node(path, row)}
      tabIndex={active ? 0 : -1}
    >
      {children}
    </tr>
  );
};

const HollowRow: React.FC<{
  className: string;
  path: string;
  walk: Walk;
}> = ({ className, path, walk }) => (
  <Line {...{ className, path, walk }}>
    <td className="correxit-corrector-open" />
    <td className="correxit-corrector-assignee">{basename(path)}</td>
    <td className="correxit-corrector-breakdown" />
    <td className="correxit-corrector-kernel" />
    <Pending />
  </Line>
);

const Row: React.FC<{
  commands: CommandRegistry;
  grade: Grade | 'pending';
  graded: boolean;
  trans: TranslationBundle;
  walk: Walk;
  workbook: Scanned;
}> = React.memo(props => {
  const { commands, grade, graded, trans, walk, workbook } = props;
  const { path } = workbook.context;
  const active = path === walk.active;
  const selected = path === walk.selected;
  const pending = grade === 'pending';
  const failed = !pending && !grade.resolved;
  const phase = lifecycle(workbook, grade);
  const className = [failed && FAILED, pending && PENDING, selected && SELECTED]
    .filter(Boolean)
    .join(' ');
  if (workbook.hollow) return <HollowRow {...{ className, path, walk }} />;

  const spec = pending ? null : grade.spec;
  const title = history(workbook, trans);
  return (
    <Line {...{ className, path, walk }}>
      <Notebook {...{ active, commands, trans, workbook }} />
      <Assignee {...{ workbook }} />
      <Breakdown {...{ active, commands, failed, trans, workbook }} />
      <Kernel {...{ spec }} />
      <Status {...{ grade, graded, phase, title, trans }} />
    </Line>
  );
});

const Breakdown: React.FC<{
  active: boolean;
  commands: CommandRegistry;
  failed: boolean;
  trans: TranslationBundle;
  workbook: Workbook.Headless;
}> = ({ active, commands, failed, trans, workbook }) => {
  if (failed) return <td className="correxit-corrector-breakdown" />;

  const rubric = open(workbook);
  if (!rubric) return <td className="correxit-corrector-breakdown" />;

  const { cells } = rubric;
  const { report } = rubric.assignment;
  const breakdown = workbook.context.model.sharedModel.cells
    .map(cell => cell.id)
    .filter(id => id in cells);
  const computed = (id: string) =>
    Rubric.Score.resolve(report, id) ?? Rubric.Score.UNSCORED;
  const status = (id: string) => {
    const { status } = computed(id);
    const reviewable = cells[id].is === 'reviewable';
    return reviewable && status === 'unscored' ? 'review' : status;
  };
  const label = (id: string) => {
    const resolution = status(id);
    const { points, possible } = computed(id);
    const { is: type } = cells[id];
    if (resolution === 'review') return trans.__('%1: needs review', type);
    if (resolution === 'unscored') return trans.__('%1: unscored', type);
    return trans.__('%1: %2 of %3', type, points, possible);
  };
  const { review } = COMMAND_IDS;
  return (
    <td className="correxit-corrector-breakdown">
      <div
        aria-label={trans.__('Workbook cell breakdown')}
        className="correxit-corrector-breakdown-bar"
        role="group"
      >
        {breakdown.map(id => {
          const className = [
            'correxit-corrector-breakdown-segment',
            `correxit-corrector-breakdown-${status(id)}`
          ].join(' ');
          return (
            <button
              aria-label={trans.__('Review %1', label(id))}
              className={className}
              key={id}
              onKeyDown={retreat}
              onClick={event => {
                event.stopPropagation();
                void commands.execute(review, {
                  path: workbook.context.path,
                  cell: id
                });
              }}
              tabIndex={active ? 0 : -1}
              title={label(id)}
              type="button"
            />
          );
        })}
      </div>
    </td>
  );
};

const Assignee: React.FC<{ workbook: Workbook.Headless }> = ({ workbook }) => {
  const path = basename(workbook.context.path);
  const rubric = open(workbook);
  return (
    <td className="correxit-corrector-assignee">
      {rubric?.assignment.assignee || path}
    </td>
  );
};

const Notebook: React.FC<{
  active: boolean;
  commands: CommandRegistry;
  trans: TranslationBundle;
  workbook: Workbook.Headless;
}> = ({ active, commands, trans, workbook }) => {
  const open = 'docmanager:open';
  const file = { path: workbook.context.path };
  const caption = trans.__('Open workbook');
  return (
    <td
      className="correxit-corrector-open"
      onClick={event => event.stopPropagation()}
      onKeyDown={retreat}
    >
      <div className="correxit-corrector-icon">
        <Button
          aria-label={caption}
          className="jp-ToolbarButtonComponent"
          data-command={open}
          minimal
          onClick={() => void commands.execute(open, file)}
          tabIndex={active ? 0 : -1}
          title={caption}
          type="button"
        >
          <notebookIcon.react tag={null} />
        </Button>
      </div>
    </td>
  );
};

const Status: React.FC<{
  grade: Grade | 'pending';
  graded: boolean;
  phase: Phase;
  title: string;
  trans: TranslationBundle;
}> = ({ grade, graded, phase, title, trans }) => {
  if (phase === 'pending' || grade === 'pending') return <Pending />;
  return (
    <td className="correxit-corrector-status">
      <span
        aria-label={title || undefined}
        className={`correxit-corrector-chip cxt-mod-${phase}`}
        role={title ? 'status' : undefined}
        title={title || undefined}
      >
        {status(grade, graded, phase, trans)}
      </span>
    </td>
  );
};

const Pending: React.FC = () => (
  <td className="correxit-corrector-status">
    <span className={'correxit-corrector-chip cxt-mod-pending'}>
      <span className="correxit-corrector-pending-dot" />
      <span className="correxit-corrector-pending-dot" />
      <span className="correxit-corrector-pending-dot" />
    </span>
  </td>
);

const Kernel: React.FC<{
  spec: Workbook.Grade['spec'];
}> = ({ spec }) => {
  if (!spec) return <td className="correxit-corrector-kernel" />;

  const src = logo(spec);
  return (
    <td className="correxit-corrector-kernel">
      <div className="correxit-corrector-icon">
        {src ? (
          <img src={src} title={spec.display_name} alt={spec.name} />
        ) : (
          <Correxit.Icons.kernel.react tag="span" title={spec.name} />
        )}
      </div>
    </td>
  );
};
