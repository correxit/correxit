import { PathExt } from '@jupyterlab/coreutils';
import { IRenderMime } from '@jupyterlab/rendermime';
import {
  CommandToolbarButtonComponent,
  notebookIcon
} from '@jupyterlab/ui-components';
import { find } from '@lumino/algorithm';
import { CommandRegistry } from '@lumino/commands';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Correxit, Rubric, Workbook } from '..';
import { useCommand } from '../correxit/use-command';
import { clear, inject, publish } from './bridge';
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

/** @returns a multi-line lifecycle history for tooltips. */
const history = (workbook: Scanned, trans: TranslationBundle): string => {
  const rubric = open(workbook);
  if (!rubric) return '';

  const { certification, collected, submission, submitted } = rubric.assignment;
  const lines: string[] = [];
  if (submission !== null)
    lines.push(trans.__('Submission %1', Rubric.date(submission)));
  if (submitted !== null) lines.push(trans.__('Submitted: %1', submitted));
  if (certification !== null)
    lines.push(trans.__('Certification %1', Rubric.date(certification)));
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
  const [selection, setSelection] = useState('');
  const workbook = useMemo(() => match(memo, selection), [memo, selection]);
  const focus = workbook?.context.path || null;
  const total = memo.length;
  const progress = { graded, grading, loaded, resolved, scanned, total };
  useEffect(() => () => dispose(Object.values(cached.current)), []);
  useEffect(() => inject(commands, workbook), [workbook]);
  useEffect(() => notify({ graded, scanned, mode }), [graded, scanned, mode]);
  useEffect(() => reconcile(cached.current, memo, focus), [focus, memo]);
  useEffect(() => publish({ workbooks: memo, grades }), [memo, grades]);
  useEffect(() => () => clear(), []);
  return (
    <table className="correxit-corrector">
      <Columns />
      <tbody>
        <Progress {...{ ...progress, trans }} />
        {memo.map(workbook => {
          const { path } = workbook.context;
          const grade = resolve(workbook, grades, graded);
          const flags = { graded, selected: path === selection };
          const props = { commands, grade, select: setSelection, workbook };
          return <Row key={path} {...{ ...flags, ...props, trans }} />;
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
  const text = trans.__('%1 of %2', progress, total);
  const className = active
    ? 'correxit-corrector-progress cxt-mod-active'
    : 'correxit-corrector-progress';
  return (
    <tr className={className}>
      <td colSpan={7}>
        {active ? (
          <progress max={total} value={progress}>
            {text}
          </progress>
        ) : null}
      </td>
    </tr>
  );
};

const Columns: React.FC = () => (
  <colgroup>
    <col className="correxit-corrector-col-open" />
    <col className="correxit-corrector-col-lock" />
    <col className="correxit-corrector-col-assignment" />
    <col className="correxit-corrector-col-assignee" />
    <col className="correxit-corrector-col-breakdown" />
    <col className="correxit-corrector-col-kernel" />
    <col className="correxit-corrector-col-status" />
  </colgroup>
);

const HollowRow: React.FC<{
  className: string;
  path: string;
}> = ({ className, path }) => (
  <tr {...{ className }}>
    <td className="correxit-corrector-open" />
    <td className="correxit-corrector-lock" />
    <td className="correxit-corrector-assignment" />
    <td className="correxit-corrector-assignee">{basename(path)}</td>
    <td className="correxit-corrector-breakdown" />
    <td className="correxit-corrector-kernel" />
    <Pending />
  </tr>
);

const Row: React.FC<{
  commands: CommandRegistry;
  grade: Grade | 'pending';
  graded: boolean;
  select: (path: string) => void;
  selected: boolean;
  trans: TranslationBundle;
  workbook: Scanned;
}> = React.memo(props => {
  const { commands, grade, graded, select, selected, trans, workbook } = props;
  const { path } = workbook.context;
  const pending = grade === 'pending';
  const failed = !pending && !grade.resolved;
  const phase = lifecycle(workbook, grade);
  const className = [failed && FAILED, pending && PENDING, selected && SELECTED]
    .filter(Boolean)
    .join(' ');
  if (workbook.hollow) return <HollowRow {...{ className, path }} />;
  const spec = pending ? null : grade.spec;
  const title = history(workbook, trans);
  return (
    <tr className={className} onClick={() => select(selected ? '' : path)}>
      <Notebook {...{ commands, trans, workbook }} />
      <Lock {...{ trans, workbook }} />
      <Assignment {...{ trans, workbook }} />
      <Assignee {...{ workbook }} />
      <Breakdown {...{ commands, failed, trans, workbook }} />
      <Kernel {...{ spec }} />
      <Status {...{ grade, graded, phase, title, trans }} />
    </tr>
  );
});

const Breakdown: React.FC<{
  commands: CommandRegistry;
  failed: boolean;
  trans: TranslationBundle;
  workbook: Workbook.Headless;
}> = ({ commands, failed, trans, workbook }) => {
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
      <span
        aria-label={breakdown.map(label).join(', ')}
        className="correxit-corrector-breakdown-bar"
        role="img"
      >
        {breakdown.map(id => {
          const className = [
            'correxit-corrector-breakdown-segment',
            `correxit-corrector-breakdown-${status(id)}`
          ].join(' ');
          return (
            <span
              aria-hidden="true"
              className={className}
              key={id}
              onClick={event => {
                event.stopPropagation();
                void commands.execute(review, {
                  path: workbook.context.path,
                  cell: id
                });
              }}
              title={label(id)}
            />
          );
        })}
      </span>
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
  commands: CommandRegistry;
  trans: TranslationBundle;
  workbook: Workbook.Headless;
}> = ({ commands, trans, workbook }) => {
  const id = 'docmanager:open';
  const args = { path: workbook.context.path };
  const caption = trans.__('Open workbook');
  return (
    <td className="correxit-corrector-open">
      <div className="correxit-corrector-icon">
        <CommandToolbarButtonComponent
          {...{ args, caption, commands, icon: notebookIcon, id, label: '' }}
          noFocusOnClick
        />
      </div>
    </td>
  );
};

const Lock: React.FC<{
  trans: TranslationBundle;
  workbook: Workbook.Headless;
}> = ({ trans, workbook }) => {
  const locked = open(workbook)?.locked ?? true;
  const icon = locked ? Correxit.Icons.locked : Correxit.Icons.unlocked;
  const title = locked ? trans.__('Locked') : trans.__('Unlocked');
  return (
    <td className="correxit-corrector-lock">
      <div className="correxit-corrector-icon">
        <icon.react tag="span" title={title} />
      </div>
    </td>
  );
};

const Assignment: React.FC<{
  trans: TranslationBundle;
  workbook: Workbook.Headless;
}> = ({ trans, workbook }) => {
  const rubric = open(workbook);
  if (!rubric) return <td className="correxit-corrector-assignment" />;

  const { assignment, locked } = rubric;
  const { assignee, roster } = assignment;
  const icon = assignee
    ? Correxit.Icons.assignee
    : roster.length && !locked
      ? Correxit.Icons.assignment
      : Correxit.Icons.template;
  const title = assignee
    ? trans.__('Assigned to: %1', assignee)
    : roster.length && !locked
      ? trans.__('Template - unassigned (roster: %1)', roster.length)
      : trans.__('Template - unassigned (empty roster)');
  return (
    <td className="correxit-corrector-assignment">
      <div className="correxit-corrector-icon">
        <icon.react tag="span" title={title} />
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
