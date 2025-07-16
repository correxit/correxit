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
import { Workbook } from '../correxit/workbook';
import { Rubric } from '../correxit/rubric';

const CELL_MODE_CLASS = 'correxit-cell-mode-select';

/**
 * A toolbar widget that switches cell types.
 */
export class CellModeSwitcher extends ReactWidget {
  /**
   * Construct a new cell type switcher.
   */
  constructor(options: IOptions) {
    super();
    this._commands = options.commands;
    this._trans = (options.translator || nullTranslator).load('correxit');
    this.addClass(CELL_MODE_CLASS);
    this._cell = options.cell;
    void this.subscribe(options.source);
  }

  /**
   * Handle `change` events for the HTMLSelect component.
   */
  handleChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    this._switch(event.target.value);
  };

  /**
   * Handle `keydown` events for the HTMLSelect component.
   */
  handleKeyDown = (event: React.KeyboardEvent): void => {
    const target = event.target as HTMLSelectElement;
    if (event.key === 'Enter') {
      this._switch(target.value);
    }
  };

  render(): JSX.Element {
    const rubric = Correxit.open(this._workbook, { quiet: true });
    let value = '-';
    let disabled = true;
    const id = Workbook.Cell.id(this._cell.model);

    if (rubric && !rubric.locked && this._isEnabled(id)) {
      const cell = Rubric.get(rubric, id);
      value = cell?.is ?? '-';
      disabled = false;
    }

    return (
      <HTMLSelect
        className={disabled ? 'lm-mod-hidden' : ''}
        onChange={this.handleChange}
        onKeyDown={this.handleKeyDown}
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

  private _switch = async (mode: string) => {
    const id = Workbook.Cell.id(this._cell.model);
    await this._commands.execute(Correxit.CommandIDs.remove, {
      id
    });
    this.update();
    if (mode !== '-') {
      await this._commands.execute(Correxit.CommandIDs.add, {
        id,
        is: mode
      });
    }
    this.update();
  };

  protected async subscribe(source: Correxit.Source) {
    for await (const { payload } of source) {
      if (this.isDisposed) {
        return;
      }
      this._workbook = payload;
    }
  }

  private _commands: CommandRegistry;
  private _trans: TranslationBundle;
  private _cell: Cell;
  private _workbook: Workbook | null = null;
}

interface IOptions {
  commands: CommandRegistry;
  source: Correxit.Source;
  cell: Cell;
  translator?: ITranslator;
}
