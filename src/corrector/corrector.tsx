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
import { useCommand } from '../correxit/use-command';
import { trail } from '../ui/trail';
import * as bridge from './bridge';
import {
  commands as COMMANDS,
  CommandIDs as COMMAND_IDS,
  Scanned
} from './commands';
import type { Event, Mode } from './run';
import { CorrectorStatus, CorrectorWidget } from './widget';

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
  /** The row in the roving tab stop. */
  active: string;
  /** The workbook currently open for review. */
  selected: string;
  clear: () => void;
  move: (path: string, step: -1 | 1) => void;
  node: (path: string, row: HTMLTableRowElement | null) => void;
  select: (path: string) => void;
};

const FAILED = 'cxt-mod-failed';
const PENDING = 'cxt-mod-pending';
const SELECTED = 'cxt-mod-selected';
const { basename } = PathExt;

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
  const nodes = useRef({} as { [path: string]: HTMLTableRowElement | null });
  const pending = useRef('');
  const [focused, setFocused] = useState('');
  const [selected, setSelected] = useState('');
  const active = useMemo(() => {
    if (workbooks.some(({ context }) => context.path === focused))
      return focused;
    if (workbooks.some(({ context }) => context.path === selected))
      return selected;
    return workbooks[0]?.context.path || '';
  }, [focused, selected, workbooks]);
  const select = useCallback((path: string) => {
    setFocused(path);
    setSelected(path);
  }, []);
  const clear = useCallback(() => setSelected(''), []);
  const move = useCallback(
    (path: string, step: -1 | 1) => {
      const next = advance(workbooks, path, step);
      if (!next) return;
      pending.current = next;
      select(next);
    },
    [select, workbooks]
  );
  const node = useCallback((path: string, row: HTMLTableRowElement | null) => {
    nodes.current[path] = row;
  }, []);
  useEffect(() => {
    const row = nodes.current[pending.current];
    if (!row) return;
    row.focus();
    pending.current = '';
  }, [selected, workbooks]);
  return { active, clear, move, node, select, selected };
};

/** @returns a multi-line lifecycle history for tooltips. */
const history = (workbook: Scanned, trans: TranslationBundle): string => {
  const rubric = open(workbook);
  return rubric ? trail(rubric.assignment, trans).join('\n') : '';
};

/** @returns the lifecycle phase of a workbook. */
const lifecycle = (workbook: Scanned, grade: Grade | 'pending'): Phase => {
  if (grade === 'pending') return 'pending';
  if (!grade.resolved) return 'failed';
  if (workbook.hollow || !grade.verified) return 'scanned';

  const rubric = open(workbook);
  if (!rubric) return 'scanned';

  const { assignment } = rubric;
  if (assignment.collected) return 'collected';
  if (assignment.certification) return 'certified';

  return Rubric.pending(rubric) ? 'review' : 'scanned';
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

/** Open a workbook rubric quietly. */
const open = (workbook: Scanned | null) =>
  workbook && !workbook.hollow ? Workbook.open(workbook, true) : null;

/** @returns the at-a-glance status of a workbook in the corrector. */
const status = (
  grade: Grade,
  graded: boolean,
  phase: Exclude<Phase, 'pending'>,
  trans: TranslationBundle
) => {
  if (phase === 'failed') return trans.__('failed');
  if (!grade.verified) return trans.__('unverified');

  const { points, possible, status } = grade.score;
  const unscored = status === 'unscored';
  if (phase === 'collected') {
    return unscored
      ? trans.__('unscored \u00b7 synced')
      : trans.__('%1 of %2 \u00b7 synced', points, possible);
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

/** Fold command events into a view; command ownership outlives React cleanup. */
const collate = (events: Event[]) => {
  const workbooks = new Map<string, Scanned>();
  const grades: Corrector.Collated = new Map();
  const phases = new Map<
    string,
    'queued' | 'processing' | 'scanned' | 'failed'
  >();
  const errors = new Map<string, string>();
  let total = 0,
    checked = 0,
    completed = 0,
    finished = 0,
    skipped = 0,
    failed = 0;
  let listed = false,
    done = false,
    stopped = false,
    error = false;
  for (const event of events) {
    if (event.type === 'listed') {
      listed = true;
      total = event.paths.length;
      for (const path of event.paths) {
        workbooks.set(path, { hollow: true, context: { path } });
        phases.set(path, 'queued');
      }
    } else if (event.type === 'read') {
      checked++;
      if (event.workbook) {
        workbooks.set(event.path, event.workbook);
        phases.set(event.path, 'scanned');
      } else if (event.error) {
        finished++;
        phases.set(event.path, 'failed');
        errors.set(event.path, event.error);
        failed++;
      } else {
        workbooks.delete(event.path);
        phases.delete(event.path);
        skipped++;
        finished++;
      }
    } else if (event.type === 'started') {
      phases.set(event.path, 'processing');
    } else if (event.type === 'result') {
      grades.set(event.path, event.file);
      finished++;
      if (event.changed) completed++;
      else skipped++;
      phases.set(event.path, event.file.grade.resolved ? 'scanned' : 'failed');
      if (!event.file.grade.resolved) failed++;
    } else if (event.type === 'error') {
      failed++;
      if (event.path) {
        finished++;
        phases.set(event.path, 'failed');
        errors.set(event.path, event.message);
      } else {
        error = true;
      }
    } else if (event.type === 'done') {
      done = true;
      stopped = event.stopped;
    }
  }
  return {
    workbooks: Array.from(workbooks.values()),
    grades,
    phases,
    errors,
    total,
    checked,
    completed,
    finished,
    skipped,
    failed,
    listed,
    done,
    stopped,
    error
  };
};

export function Corrector(props: Corrector.Props) {
  const {
    commands,
    mode,
    notify,
    overwrite,
    path,
    run,
    stopping,
    submitted,
    trans
  } = props;
  const [events, settled] = useCommand<Event>(commands, COMMAND_IDS.process, {
    run,
    path,
    mode,
    overwrite,
    submitted
  });
  const summary = useMemo(() => collate(events), [events]);
  const { workbooks, grades, phases, errors } = summary;
  const idle = summary.done && settled;
  const walk = useWalk(workbooks);
  const available = useMemo(
    () =>
      workbooks.filter(
        ({ context }) =>
          mode === 'scan' || summary.done || grades.has(context.path)
      ),
    [grades, mode, summary.done, workbooks]
  );
  const workbook = useMemo(
    () => match(available, walk.selected),
    [available, walk.selected]
  );
  const message = describe(summary, mode, stopping, trans);
  useEffect(
    () => () => {
      void commands.execute(COMMAND_IDS.stop, { run, release: true });
    },
    [commands, run]
  );
  useEffect(() => bridge.clear, []);
  useEffect(() => bridge.inject(commands, workbook), [commands, workbook]);
  useEffect(
    () => notify({ graded: idle, scanned: idle, mode, message }),
    [idle, message, mode, notify]
  );
  useEffect(
    () => bridge.publish({ workbooks: available, grades }),
    [available, grades]
  );
  const empty = idle && !workbooks.length && !summary.error;
  return (
    <table
      aria-label={trans.__('Corrector workbooks')}
      className="correxit-corrector"
    >
      <Columns />
      <tbody>
        <tr className="correxit-corrector-progress">
          <td colSpan={5}>
            <div className="correxit-corrector-progress-bar">
              {!idle && (
                <progress
                  aria-label={trans.__('Corrector progress')}
                  max={Math.max(1, summary.total)}
                  value={
                    summary.checked === summary.total && summary.listed
                      ? Math.min(summary.total, summary.finished)
                      : undefined
                  }
                />
              )}
              <span role="status" aria-live="polite" aria-atomic="true">
                {message}
              </span>
            </div>
          </td>
        </tr>
        {empty && (
          <tr>
            <td colSpan={5} className="correxit-corrector-empty">
              {summary.total
                ? trans.__('No matching Correxit workbooks.')
                : trans.__('This folder contains no notebooks.')}
            </td>
          </tr>
        )}
        {workbooks.map(workbook => {
          const { path } = workbook.context;
          const phase = phases.get(path) || 'queued';
          const grade: Grade | 'pending' =
            grades.get(path)?.grade ??
            (phase === 'processing' || phase === 'queued'
              ? 'pending'
              : {
                  path,
                  resolved: phase !== 'failed',
                  verified: false,
                  score: Rubric.Score.UNSCORED,
                  spec: null
                });
          const label =
            phase === 'failed'
              ? diagnostic(errors.get(path) || 'grade', trans)
              : phase === 'processing' && !idle
                ? trans.__('Processing…')
                : summary.stopped
                  ? trans.__('Not processed')
                  : trans.__('Queued');
          return (
            <Row
              {...{ commands, grade, trans, walk, workbook }}
              graded={idle}
              pending={label}
              busy={phase === 'processing' && !idle}
              key={path}
            />
          );
        })}
      </tbody>
    </table>
  );
}

const diagnostic = (code: string, trans: TranslationBundle) =>
  code === 'read'
    ? trans.__('Could not read workbook')
    : code === 'sync'
      ? trans.__('Could not authenticate or sync workbook')
      : trans.__('Could not authenticate or grade workbook');

const describe = (
  summary: ReturnType<typeof collate>,
  mode: Mode,
  stopping: boolean,
  trans: TranslationBundle
) => {
  if (summary.error) {
    return trans.__(
      'Could not read this folder. Choose another folder or try Scan again.'
    );
  }
  const state =
    stopping && !summary.done
      ? trans.__('Stopping…')
      : summary.stopped
        ? trans.__('Stopped')
        : summary.done
          ? trans.__('Complete')
          : !summary.listed
            ? trans.__('Reading folder…')
            : mode === 'scan'
              ? trans.__('Scanning…')
              : mode === 'grade'
                ? trans.__('Grading…')
                : trans.__('Syncing…');
  const read = trans.__('%1/%2 checked', summary.checked, summary.total);
  const processed =
    mode === 'scan' ? '' : trans.__(' · %1 processed', summary.completed);
  const failures = summary.failed
    ? trans.__(' · %1 failed', summary.failed)
    : '';
  const skipped = summary.skipped
    ? trans.__(' · %1 skipped', summary.skipped)
    : '';
  return `${state} · ${read}${processed}${failures}${skipped}`;
};

export namespace Corrector {
  export type Event = import('./run').Event;

  export type Collated = Map<string, { grade: Grade; workbook: Headless }>;

  export type Mode = import('./run').Mode;

  export type Notification = {
    graded: boolean;
    scanned: boolean;
    mode: Mode;
    message: string;
  };

  export type Props = {
    commands: CommandRegistry;
    mode: Mode;
    notify: (updates: Notification) => void;
    overwrite: boolean;
    path: string;
    run: string;
    stopping: boolean;
    submitted: boolean;
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
  label: string;
}> = ({ className, path, walk, label }) => (
  <Line {...{ className, path, walk }}>
    <td className="correxit-corrector-open" />
    <td className="correxit-corrector-assignee">{basename(path)}</td>
    <td className="correxit-corrector-breakdown" />
    <td className="correxit-corrector-kernel" />
    <Pending label={label} />
  </Line>
);

const Row: React.FC<{
  commands: CommandRegistry;
  grade: Grade | 'pending';
  graded: boolean;
  trans: TranslationBundle;
  walk: Walk;
  workbook: Scanned;
  pending: string;
  busy: boolean;
}> = React.memo(props => {
  const {
    commands,
    grade,
    graded,
    trans,
    walk,
    workbook,
    pending: label,
    busy
  } = props;
  const { path } = workbook.context;
  const active = path === walk.active;
  const selected = path === walk.selected;
  const pending = grade === 'pending';
  const failed = !pending && !grade.resolved;
  const phase = lifecycle(workbook, grade);
  const className = [failed && FAILED, busy && PENDING, selected && SELECTED]
    .filter(Boolean)
    .join(' ');
  if (workbook.hollow)
    return <HollowRow {...{ className, path, walk, label }} />;

  const spec = pending ? null : grade.spec;
  const title = history(workbook, trans);
  return (
    <Line {...{ className, path, walk }}>
      <Notebook {...{ active, commands, trans, workbook }} />
      <Assignee {...{ workbook }} />
      <Breakdown
        {...{ active, commands, failed, trans, workbook }}
        verified={!pending && grade.verified}
        busy={busy}
      />
      <Kernel {...{ spec }} />
      <Status
        {...{ grade, graded, phase, trans }}
        title={failed ? label : title}
        pending={label}
      />
    </Line>
  );
});

const Breakdown: React.FC<{
  active: boolean;
  commands: CommandRegistry;
  failed: boolean;
  trans: TranslationBundle;
  workbook: Workbook.Headless;
  verified: boolean;
  busy: boolean;
}> = ({ active, commands, failed, trans, workbook, verified, busy }) => {
  if (failed) return <td className="correxit-corrector-breakdown" />;

  const rubric = open(workbook);
  if (!rubric) return <td className="correxit-corrector-breakdown" />;

  const { cells } = rubric;
  const report = verified
    ? rubric.assignment.report
    : Rubric.Assignment.Report.empty();
  const breakdown = workbook.context.model.sharedModel.cells
    .map(cell => cell.id)
    .filter(id => Rubric.has(rubric, id));
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
              disabled={busy}
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
  pending: string;
}> = ({ grade, graded, phase, title, trans, pending }) => {
  if (phase === 'pending' || grade === 'pending')
    return <Pending label={pending} />;
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

const Pending: React.FC<{ label: string }> = ({ label }) => (
  <td className="correxit-corrector-status">
    <span className="correxit-corrector-chip cxt-mod-pending">{label}</span>
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
