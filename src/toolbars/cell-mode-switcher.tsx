import { Cell } from '@jupyterlab/cells';
import { NotebookPanel } from '@jupyterlab/notebook';
import { IRenderMime } from '@jupyterlab/rendermime';
import { HTMLSelect, UseSignal } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React from 'react';
import { Correxit } from '../correxit';

const CELL_MODE_CLASS = 'correxit-cell-mode-select';

export const CellModeSwitcher: React.FC<{
  cell: Cell;
  commands: CommandRegistry;
  trans: IRenderMime.TranslationBundle;
}> = ({ cell: { model, parent }, commands, trans }) => {
  type Mode = Correxit.Workbook.Cell['is'] | '';
  const { add, replace } = Correxit.CommandIDs;
  const workbook = parent?.parent instanceof NotebookPanel && parent.parent;
  if (!workbook) {
    return <></>;
  }

  // Enable the dropdown for either adding or replacing a workbook cell.
  const id = Correxit.Workbook.Cell.id(model);
  const args = { id };
  if (!commands.isEnabled(add, args) && !commands.isEnabled(replace, args)) {
    return <></>;
  }

  const rubric = Correxit.open(workbook, { quiet: true })!;
  const sender = workbook.model!;
  return (
    <UseSignal signal={sender.metadataChanged} initialSender={sender}>
      {() => {
        const cell = Correxit.Rubric.get(rubric, id);
        return (
          <HTMLSelect
            className={CELL_MODE_CLASS}
            onChange={({ target: { value } }) =>
              commands.execute(replace, { id, is: value as Mode })
            }
            value={cell?.is ?? ''}
            aria-label={trans.__('Workbook cell grading mode')}
            title={trans.__('Select the cell grading mode')}
          >
            <option value="">{trans.__('Not configured')}</option>
            <option value="answerable">{trans.__('Answer')}</option>
            <option value="comparable">{trans.__('Compare')}</option>
            <option value="correctable">{trans.__('Correct')}</option>
          </HTMLSelect>
        );
      }}
    </UseSignal>
  );
};
