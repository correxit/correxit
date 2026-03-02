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
import {
  addCommands as ADD_COMMANDS,
  CommandIDs as COMMAND_IDS,
  Scanned
} from './commands';
import { CorrectorStatus, CorrectorWidget } from './widget';

type Batched = [path: string, file: { grade: Grade; workbook: Headless }];
type Collated = Map<string, { grade: Grade; workbook: Headless }>;
type Grade = Workbook.Grade;
type Headless = Workbook.Headless;
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

/**
 * Injects a new workbook to be yielded by the Correxit monitor plugin.
 *
 * #### Notes
 * The `correxit:inject` command returns a single-emission function that accepts
 * a workbook or `null`. If the single-emission function is invoked more than
 * once, all except the initial invocation is a no-op.
 */
const inject = (commands: CommandRegistry, workbook: Workbook | null) =>
  void (async workbook =>
    (await commands.execute(Correxit.CommandIDs.inject))?.(workbook))(workbook);

/**
 * @returns the logo of a kernel in order of preference.
 */
const logo = (spec: Exclude<Workbook.Grade['spec'], null>) => {
  const { resources } = spec;
  const src =
    resources['logo-svg'] || resources['logo-64x64'] || resources['logo-32x32'];
  return src || '';
};

/**
 * @returns a workbook or `null` if path matches workbook context.
 */
const match = (workbooks: Scanned[], path = ''): Headless | null =>
  (find(workbooks, workbook => {
    return workbook.context.path === path && !workbook.hollow;
  }) || null) as Headless | null;

/**
 * @returns a merged list workbooks that prioritizes the graded collection.
 */
const merge = (scanned: Scanned[], grades: Collated) => {
  const latest = new Map<string, Scanned>();
  for (const workbook of scanned) latest.set(workbook.context.path, workbook);
  for (const [path, file] of grades) latest.set(path, file.workbook);
  return Array.from(latest.values());
};

/**
 * Open a workbook rubric quietly.
 */
const open = (workbook: Scanned | null) =>
  workbook && !workbook.hollow ? Workbook.open(workbook, true) : null;

/**
 * Collect workbook paths as a set.
 */
const paths = (workbooks: Scanned[]) =>
  new Set(workbooks.map(({ context }) => context.path));

/**
 * Dispose and remove cached workbooks not in the live path set.
 */
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
  const summary = rubric && Rubric.Assignment.summary(rubric.assignment.report);
  const score = summary || Rubric.Score.UNSCORED;
  return { path, resolved: true, score, spec: null };
};

/** @returns the number of resolved grades in a collation of workbooks. */
const resolutions = (collated: Collated) =>
  Array.from(collated.values()).filter(({ grade }) => grade.resolved).length;

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

export function Corrector(props: Corrector.Props) {
  const { commands, mode, notify, overwrite, path, trans } = props;
  const grading = mode !== 'scan';
  const [workbooks, scanned] = useCommand<Scanned>(commands, scan, { path });
  const command = mode === 'grade' ? batch : mode === 'collect' ? collect : '';
  const config = { overwrite, path, unlock: true };
  const [grades, graded] = useCommand<Batched>(commands, command, config);
  const loaded = useMemo(() => workbooks.filter(reified).length, [workbooks]);
  const collated = useMemo(() => new Map(grades) as Collated, [grades]);
  const resolved = useMemo(() => resolutions(collated), [collated]);
  const memo = useMemo(() => merge(workbooks, collated), [workbooks, collated]);
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
  return (
    <table className="correxit-corrector">
      <Columns />
      <Progress {...{ ...progress, trans }} />
      {memo.map(workbook => {
        const { path } = workbook.context;
        const grade = resolve(workbook, collated, graded);
        const flags = { graded, selected: path === selection };
        const props = { commands, grade, mode, select: setSelection, workbook };
        return <Row key={path} {...flags} {...props} trans={trans} />;
      })}
    </table>
  );
}

export namespace Corrector {
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

  export const addCommands = ADD_COMMANDS;

  export const CommandIDs = COMMAND_IDS;

  export const Modes: Readonly<Mode[]> = ['scan', 'grade', 'collect'];

  export const Status = CorrectorStatus;

  export const Widget = CorrectorWidget;
}

const Columns: React.FC = () => (
  <colgroup>
    <col className="correxit-corrector-col-open" />
    <col className="correxit-corrector-col-lock" />
    <col className="correxit-corrector-col-assignment" />
    <col className="correxit-corrector-col-assignee" />
    <col className="correxit-corrector-col-breakdown" />
    <col className="correxit-corrector-col-kernel" />
    <col className="correxit-corrector-col-score" />
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
  mode: Corrector.Mode;
  select: (path: string) => void;
  selected: boolean;
  trans: TranslationBundle;
  workbook: Scanned;
}> = React.memo(props => {
  const { commands, grade, graded, mode, select, selected, trans, workbook } =
    props;
  const { path } = workbook.context;
  const pending = grade === 'pending';
  const failed = !pending && !grade.resolved;
  const rubric = workbook.hollow ? null : open(workbook);
  const review =
    mode === 'grade' &&
    !pending &&
    grade.resolved &&
    !!rubric &&
    !rubric.locked;
  const className = [failed && FAILED, pending && PENDING, selected && SELECTED]
    .filter(Boolean)
    .join(' ');
  if (workbook.hollow) return <HollowRow {...{ className, path }} />;
  return (
    <tr className={className} onClick={() => select(selected ? '' : path)}>
      <Notebook {...{ commands, trans, workbook }} />
      <Lock {...{ trans, workbook }} />
      <Assignment {...{ trans, workbook }} />
      <Assignee {...{ workbook }} />
      <Breakdown {...{ failed, workbook }} />
      <Score {...{ grade, graded, review, trans }} />
    </tr>
  );
});

const Breakdown: React.FC<{
  failed: boolean;
  workbook: Workbook.Headless;
}> = ({ failed, workbook }) => {
  if (failed) return <td className="correxit-corrector-breakdown" />;
  const rubric = open(workbook);
  const notebook = workbook.context.model.sharedModel;
  if (!rubric) return <td className="correxit-corrector-breakdown" />;
  const { cells } = rubric;
  const { scores } = rubric.assignment.report;
  const breakdown = Array.from(notebook.cells)
    .map(cell => cell.id)
    .filter(id => id in cells);
  return (
    <td className="correxit-corrector-breakdown">
      <span className="correxit-corrector-breakdown-bar">
        {breakdown.map(id => {
          const status = scores[id]?.status || 'unscored';
          const className = [
            'correxit-corrector-breakdown-segment',
            `correxit-corrector-breakdown-${status}`
          ].join(' ');
          return <span key={id} className={className} />;
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

const Score: React.FC<{
  grade: Grade | 'pending';
  graded: boolean;
  review: boolean;
  trans: TranslationBundle;
}> = ({ grade, graded, review, trans }) => {
  const irrecoverable = trans.__('Grade manually');
  const recoverable = trans.__('(Retrying...)');
  if (grade === 'pending') {
    return (
      <>
        <td className="correxit-corrector-kernel" />
        <Pending />
      </>
    );
  }
  if (!grade.resolved) {
    return (
      <td className="correxit-corrector-failed" colSpan={2}>
        <span>{graded ? irrecoverable : recoverable}</span>
      </td>
    );
  }
  if (review) {
    return (
      <td className="correxit-corrector-review" colSpan={2}>
        <span>{trans.__('Review required')}</span>
      </td>
    );
  }
  return (
    <>
      <Kernel spec={grade.spec} />
      <Report score={grade.score} trans={trans} />
    </>
  );
};

const Pending: React.FC = () => (
  <td className="correxit-corrector-pending correxit-corrector-score-report">
    <span>
      <span className="correxit-corrector-pending-dot"></span>
      <span className="correxit-corrector-pending-dot"></span>
      <span className="correxit-corrector-pending-dot"></span>
    </span>
  </td>
);

const Kernel: React.FC<{ spec: Workbook.Grade['spec'] }> = ({ spec }) => {
  if (!spec) return <td className="correxit-corrector-kernel"></td>;

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

const Report: React.FC<{
  score: Rubric.Score;
  trans: TranslationBundle;
}> = ({ score, trans }) => {
  const report =
    score.status === 'unscored'
      ? trans.__('unscored')
      : trans.__('%1 of %2', score.points, score.possible);
  return <td className="correxit-corrector-score-report">{report}</td>;
};
