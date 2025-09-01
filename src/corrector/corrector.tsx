import { IRenderMime } from '@jupyterlab/rendermime';
import { CommandRegistry } from '@lumino/commands';
import React, { useEffect, useState } from 'react';
import { Correxit, Rubric, Workbook } from '..';
import { collect } from '../correxit/commands';
import { addCommands as ADD_COMMANDS } from './commands';
import { CorrectorWidget } from './widget';
import { ToolbarButtonComponent } from '@jupyterlab/ui-components';

type Grade = Workbook.Grade;
const PENDING_CLASS = 'cxt-mod-pending';
const quiet = true;

export function Corrector(props: Corrector.Props) {
  const className = 'correxit-corrector';
  const { commands, correct, notify, passphrase, path, trans } = props;
  const { scan } = Correxit.CommandIDs;
  const args = { key: null, passphrase, path };
  const [workbooks, scanned] = collect<Workbook.Headless>(commands, scan, args);
  const multicorrect = correct ? Correxit.CommandIDs.multicorrect : '';
  const [results, corrected] = collect<Grade>(commands, multicorrect, args);
  const grades = results.reduce(
    (grades, grade) => ({ ...grades, [grade.path]: grade }),
    {} as Record<string, Grade>
  );
  const dispose = () => workbooks.forEach(({ context }) => context.dispose());
  useEffect(() => dispose, [scanned]);
  useEffect(() => notify(scanned, corrected), [scanned, corrected]);
  return (
    <table {...{ className }}>
      {workbooks.map(workbook => {
        const { path } = workbook.context;
        const row: Grade | 'idle' | 'pending' =
          path in grades ? grades[path] : corrected ? 'idle' : 'pending';
        const key =
          row === 'idle' || row === 'pending'
            ? `${path}:${row}`
            : `${path}:${row.score[0]}:${row.score[1]}`;
        const props = { key, commands, passphrase, row, trans, workbook };
        return <Row {...props} />;
      })}
    </table>
  );
}

export namespace Corrector {
  export const addCommands = ADD_COMMANDS;
  export type Widget = CorrectorWidget;
  export const Widget = CorrectorWidget;
  export type Props = {
    commands: CommandRegistry;
    correct: boolean;
    notify: (scanned: boolean, corrected: boolean) => void;
    passphrase: string;
    path: string;
    trans: IRenderMime.TranslationBundle;
  };
}

const Row: React.FC<{
  commands: CommandRegistry;
  passphrase: string;
  row: Grade | 'idle' | 'pending';
  trans: IRenderMime.TranslationBundle;
  workbook: Workbook.Headless;
}> = ({ commands, passphrase, row, trans, workbook }) => {
  const { correct } = Correxit.CommandIDs;
  const { path } = workbook.context;
  const [state, setState] = useState<Grade | 'idle' | 'pending'>(row);
  const rescore = async () => {
    setState('pending');
    setState(await commands.execute(correct, { path, passphrase }));
  };
  return (
    <tr className={state === 'pending' ? PENDING_CLASS : ''}>
      <Lock {...{ trans, workbook }} />
      <Path path={path} />
      {state !== 'idle' && <Score row={state} {...{ rescore, trans }} />}
    </tr>
  );
};

const Lock: React.FC<{
  trans: IRenderMime.TranslationBundle;
  workbook: Workbook.Headless;
}> = ({ trans, workbook }) => {
  const className = 'correxit-corrector-lock';
  const { locked } = Workbook.open(workbook, quiet)!;
  const icon = locked ? Correxit.Icons.locked : Correxit.Icons.unlocked;
  const title = locked
    ? trans.__('Locked workbook')
    : trans.__('Unlocked workbook');
  return (
    <td {...{ className }}>
      <div className="correxit-corrector-icon">
        <icon.react tag="span" title={title} />
      </div>
    </td>
  );
};

const Path: React.FC<{ path: string }> = ({ path }) => (
  <td width="*">{path}</td>
);

const Score: React.FC<{
  rescore: () => unknown;
  row: Grade | 'pending';
  trans: IRenderMime.TranslationBundle;
}> = ({ rescore, row, trans }) => {
  if (row === 'pending') {
    return <Pending />;
  }
  return (
    <>
      <Kernel spec={row.spec} />
      <Spec spec={row.spec} />
      <Report score={row.score} trans={trans} />
      <Rescore {...{ rescore, trans }} />
    </>
  );
};

const Pending: React.FC = () => (
  <td className="correxit-corrector-pending" colSpan={4}>
    <span>
      <span className="correxit-corrector-pending-dot"></span>
      <span className="correxit-corrector-pending-dot"></span>
      <span className="correxit-corrector-pending-dot"></span>
    </span>
  </td>
);

const Kernel: React.FC<{ spec: Workbook.Grade['spec'] }> = ({ spec }) => {
  const className = 'correxit-corrector-kernel';
  if (!spec) {
    return <td {...{ className }}></td>;
  }

  const { name, resources } = spec;
  const src =
    resources['logo-svg'] || resources['logo-64x64'] || resources['logo-32x32'];
  return (
    <td {...{ className }}>
      <div className="correxit-corrector-icon">
        {src ? (
          <img src={src} title={name} alt={name} />
        ) : (
          <Correxit.Icons.kernel.react tag="span" title={name} />
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
  trans: IRenderMime.TranslationBundle;
}> = ({ score, trans }) => {
  const className = 'correxit-corrector-score-report';
  const report =
    score === Rubric.UNSCORED
      ? trans.__('unscored')
      : trans.__('%1 of %2', score[0], score[1]);
  return <td {...{ className }}>{report}</td>;
};

const Rescore: React.FC<{
  rescore: () => unknown;
  trans: IRenderMime.TranslationBundle;
}> = ({ rescore, trans }) => (
  <td className="correxit-corrector-rescore">
    <div className="correxit-corrector-icon">
      <ToolbarButtonComponent
        onClick={rescore}
        icon={Correxit.Icons.correct}
        tooltip={trans.__('Correct workbook')}
      />
    </div>
  </td>
);
