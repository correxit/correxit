import { Cell } from '@jupyterlab/cells';
import { NotebookPanel } from '@jupyterlab/notebook';
import { IRenderMime } from '@jupyterlab/rendermime';
import { HTMLSelect, UseSignal } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React from 'react';
import { Correxit } from '../correxit';

const CELL_MODE_SWITCHER_CLASS = 'correxit-cell-mode-switcher';

export const CellModeSwitcher: React.FC<{
  cell: Cell;
  commands: CommandRegistry;
  trans: IRenderMime.TranslationBundle;
}> = ({ cell: { model, parent }, commands, trans }) => {
  const id = Correxit.Workbook.Cell.id(model);
  const workbook = parent?.parent instanceof NotebookPanel && parent.parent;
  if (!workbook || !workbook.model) {
    return <></>;
  }

  const { sharedModel } = workbook.model;
  const switcher = () => <Switcher {...{ commands, id, trans, workbook }} />;
  return <UseSignal signal={sharedModel.metadataChanged}>{switcher}</UseSignal>;
};

const Switcher: React.FC<{
  commands: CommandRegistry;
  id: string;
  trans: IRenderMime.TranslationBundle;
  workbook: Correxit.Workbook;
}> = ({ commands, id, trans, workbook }) => {
  const { add, replace } = Correxit.CommandIDs;
  const enabled =
    commands.isEnabled(add, { id }) || commands.isEnabled(replace, { id });
  const rubric = Correxit.open(workbook, { quiet: true });
  if (!enabled || !rubric) {
    return <></>;
  }
  return (
    <HTMLSelect
      className={CELL_MODE_SWITCHER_CLASS}
      onChange={({ target: { value } }) =>
        commands.execute(replace, { id, is: value })
      }
      value={Correxit.Rubric.get(rubric, id)?.is ?? ''}
      aria-label={trans.__('Workbook cell grading mode')}
      title={trans.__('Select the cell grading mode')}
    >
      <option value="">{trans.__('Not configured')}</option>
      <option value="answerable">{trans.__('Answer')}</option>
      <option value="comparable">{trans.__('Compare')}</option>
      <option value="correctable">{trans.__('Correct')}</option>
    </HTMLSelect>
  );
};
