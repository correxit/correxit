import { Cell } from '@jupyterlab/cells';
import {
  ITranslator,
  nullTranslator,
  TranslationBundle
} from '@jupyterlab/translation';
import { HTMLSelect, ReactWidget } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React from 'react';
import { Correxit } from '../correxit';
import { NotebookPanel } from '@jupyterlab/notebook';

const CELL_MODE_CLASS = 'correxit-cell-mode-select';

/**
 * A toolbar widget that switches cell types.
 */
export class CellModeSwitcher extends ReactWidget {
  /**
   * Construct a new cell type switcher.
   */
  constructor({ cell, commands, translator }: IOptions) {
    super();
    this._commands = commands;
    this._trans = (translator || nullTranslator).load('correxit');
    this.addClass(CELL_MODE_CLASS);
    this._cell = cell;
    this._workbook =
      cell.parent?.parent instanceof NotebookPanel ? cell.parent.parent : null;
  }

  render(): JSX.Element {
    type Mode = Correxit.Workbook.Cell['is'] | '-';
    const rubric = Correxit.open(this._workbook, { quiet: true });
    let value = '-';
    let disabled = true;
    const id = Correxit.Workbook.Cell.id(this._cell.model);
    if (rubric && !rubric.locked && this._isEnabled(id)) {
      const cell = Correxit.Rubric.get(rubric, id);
      value = cell?.is ?? '-';
      disabled = false;
    }

    const change = async (mode: Mode) => {
      await this._commands.execute(Correxit.CommandIDs.remove, { id });
      if (mode !== '-') {
        await this._commands.execute(Correxit.CommandIDs.add, { id, is: mode });
      }
    };
    return (
      <HTMLSelect
        className={disabled ? 'lm-mod-hidden' : ''}
        onChange={({ target: { value } }) => void change(value as Mode)}
        value={value}
        aria-label={this._trans.__('Cell mode')}
        title={this._trans.__('Select the cell mode')}
        disabled={disabled}
      >
        <option value="-">-</option>
        <option value="answerable">{this._trans.__('Answer')}</option>
        <option value="comparable">{this._trans.__('Compare')}</option>
        <option value="correctable">{this._trans.__('Correct')}</option>
      </HTMLSelect>
    );
  }

  private _isEnabled = (id: string) => {
    const toolbar = true;
    return (
      this._commands.isEnabled(Correxit.CommandIDs.remove, { id, toolbar }) &&
      this._commands.isEnabled(Correxit.CommandIDs.add, { id, toolbar })
    );
  };

  private _commands: CommandRegistry;
  private _trans: TranslationBundle;
  private _cell: Cell;
  private _workbook: Correxit.Workbook | null;
}

interface IOptions {
  commands: CommandRegistry;
  cell: Cell;
  translator?: ITranslator;
}
