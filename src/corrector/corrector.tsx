import { PathExt } from '@jupyterlab/coreutils';
import { IRenderMime } from '@jupyterlab/rendermime';
import {
  CommandToolbarButtonComponent,
  notebookIcon
} from '@jupyterlab/ui-components';
import { find } from '@lumino/algorithm';
import { CommandRegistry } from '@lumino/commands';
import React, { useEffect, useState } from 'react';
import { Correxit, Rubric, Workbook } from '..';
import { useCommand } from '../correxit/use-command';
import {
  addCommands as ADD_COMMANDS,
  CommandIDs as COMMAND_IDS
} from './commands';
import { CorrectorWidget } from './widget';

type Batched = [path: string, file: { grade: Grade; workbook: Headless }];
type Collated = { [path: string]: { grade: Grade; workbook: Headless } };
type Grade = Workbook.Grade;
type Headless = Workbook.Headless;
type TranslationBundle = IRenderMime.TranslationBundle;

const PENDING = 'cxt-mod-pending';
const SELECTED = 'cxt-mod-selected';
const { batch, scan } = COMMAND_IDS;
const { basename } = PathExt;

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
 * @returns The logo of a kernel in order of preference.
 */
const logo = (spec: Exclude<Workbook.Grade['spec'], null>) => {
  const { resources } = spec;
  const src =
    resources['logo-svg'] || resources['logo-64x64'] || resources['logo-32x32'];
  return src || '';
};

/**
 * @returns A workbook or `null` if path matches workbook context.
 */
const match = (workbooks: Headless[], path = '') =>
  find(workbooks, ({ context }) => context.path === path) || null;

/**
 * @returns A merged list workbooks that prioritizes the graded collection.
 */
const merge = (workbooks: Headless[], grades: Collated) =>
  workbooks.map(workbook => {
    const { path } = workbook.context;
    return path in grades ? grades[path].workbook : workbook;
  });

/**
 * Open a workbook rubric quietly.
 */
const open = (workbook: Workbook | null) => Workbook.open(workbook, true);

/**
 * @returns the grade for a workbook given current batch and scan state.
 */
const resolve = (
  workbook: Headless,
  collated: Collated,
  graded: boolean
): Grade | 'pending' => {
  const { path } = workbook.context;
  if (path in collated) {
    return collated[path].grade;
  }
  if (!graded) {
    return 'pending';
  }
  const rubric = open(workbook);
  const score = rubric && Rubric.Assignment.summary(rubric.assignment.report);
  return { path, score: score || Rubric.Score.UNSCORED, spec: null };
};

export function Corrector(props: Corrector.Props) {
  const { certify, commands, correct, notify, path, trans, unlock } = props;
  const grade = correct ? batch : '';
  const handle = { path, unlock };
  const auth = { path, unlock, certify };
  const [workbooks, scanned] = useCommand<Headless>(commands, scan, handle);
  const [grades, graded] = useCommand<Batched>(commands, grade, auth);
  const collated: Collated = Object.fromEntries(grades);
  const merged = merge(workbooks, collated);
  const [selection, setSelection] = useState('');
  const [workbook, setWorkbook] = useState(() => match(merged, selection));
  useEffect(() => inject(commands, workbook), [workbook]);
  useEffect(() => notify({ graded, scanned }), [graded, scanned]);
  useEffect(() => () => dispose(workbooks), [scanned]);
  useEffect(() => () => dispose(grades.map(([, _]) => _.workbook)), [graded]);
  useEffect(() => setWorkbook(match(merged, selection)), [merged, selection]);
  return (
    <table className="correxit-corrector">
      {merged.map(workbook => {
        const { path } = workbook.context;
        const grade = resolve(workbook, collated, graded);
        const key = `${path}:${JSON.stringify(grade)}`;
        const select = (selection: string) => setSelection(selection);
        const props = { commands, grade, select, trans, workbook };
        return <Row key={key} selected={path === selection} {...props} />;
      })}
    </table>
  );
}

export namespace Corrector {
  export type Props = {
    certify: boolean;
    commands: CommandRegistry;
    correct: boolean;
    notify: (updates: { graded: boolean; scanned: boolean }) => void;
    unlock: boolean;
    path: string;
    trans: TranslationBundle;
  };
  export type Widget = CorrectorWidget;
  export const addCommands = ADD_COMMANDS;
  export const CommandIDs = COMMAND_IDS;
  export const Widget = CorrectorWidget;
}

const Row: React.FC<{
  commands: CommandRegistry;
  grade: Grade | 'pending';
  select: (path: string) => void;
  selected: boolean;
  trans: TranslationBundle;
  workbook: Workbook.Headless;
}> = React.memo(({ commands, grade, select, selected, trans, workbook }) => {
  const { path } = workbook.context;
  const className = [grade === 'pending' && PENDING, selected && SELECTED]
    .filter(Boolean)
    .join(' ');
  return (
    <tr {...{ className, onClick: () => select(selected ? '' : path) }}>
      <Notebook {...{ commands, trans, workbook }} />
      <Lock {...{ trans, workbook }} />
      <Assignment {...{ trans, workbook }} />
      <td width="*">{basename(path)}</td>
      <Score {...{ grade, trans }} />
    </tr>
  );
});

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
  if (!rubric) {
    return <></>;
  }

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
  trans: TranslationBundle;
}> = ({ grade, trans }) => {
  if (grade === 'pending') {
    return <Pending columns={3} />;
  }
  return (
    <>
      <Kernel spec={grade.spec} />
      <Spec spec={grade.spec} />
      <Report score={grade.score} trans={trans} />
    </>
  );
};

const Pending: React.FC<{ columns: number }> = ({ columns }) => (
  <td className="correxit-corrector-pending" colSpan={columns}>
    <span>
      <span className="correxit-corrector-pending-dot"></span>
      <span className="correxit-corrector-pending-dot"></span>
      <span className="correxit-corrector-pending-dot"></span>
    </span>
  </td>
);

const Kernel: React.FC<{ spec: Workbook.Grade['spec'] }> = ({ spec }) => {
  if (!spec) {
    return <td className="correxit-corrector-kernel"></td>;
  }

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

const Spec: React.FC<{ spec: Workbook.Grade['spec'] }> = ({ spec }) => (
  <td className="correxit-corrector-spec">
    {spec && (
      <>
        <span>{spec.display_name}</span>
        <span className="correxit-corrector-spec-name">: {spec.name}</span>
      </>
    )}
  </td>
);

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
