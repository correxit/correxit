import { Cell } from '@jupyterlab/cells';
import { IRenderMime } from '@jupyterlab/rendermime';
import { HTMLSelect, ReactWidget, UseSignal } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React from 'react';
import { Correxit } from '../correxit';
import { NotebookPanel } from '@jupyterlab/notebook';

const CELL_MODE_CLASS = 'correxit-cell-mode-select';

export const CellMode: React.FC<CellMode.Props> = props => {
  type Mode = Correxit.Workbook.Cell['is'] | '';
  const { commands, trans } = props;
  const { parent } = props.cell;
  const { add, replace } = Correxit.CommandIDs;
  const workbook = parent?.parent instanceof NotebookPanel && parent.parent;
  if (!workbook) {
    return <></>;
  }

  // Enable the dropdown for either adding or replacing a workbook cell.
  const id = Correxit.Workbook.Cell.id(props.cell.model);
  const args = { id };
  if (!commands.isEnabled(add, args) && !commands.isEnabled(replace, args)) {
    return <></>;
  }

  const rubric = Correxit.open(workbook, { quiet: true })!;
  const model = workbook.model!;
  return (
    <UseSignal signal={model.metadataChanged} initialSender={model}>
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

export namespace CellMode {
  export type Props = {
    cell: Cell;
    commands: CommandRegistry;
    trans: IRenderMime.TranslationBundle;
  };
}

/**
 * A toolbar widget that switches cell types.
 */
export class CellModeSwitcher extends ReactWidget {
  constructor(readonly props: CellMode.Props) {
    super();
  }
  render() {
    return <CellMode {...this.props} />;
  }
}
