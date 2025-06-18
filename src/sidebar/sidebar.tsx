import { JupyterFrontEnd } from '@jupyterlab/application';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { IRenderMime } from '@jupyterlab/rendermime';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { ReactWidget, UseSignal } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React from 'react';
import { Correxit } from '../correxit';
import { Body } from './body';
import { addCommands as ADD_COMMANDS } from './commands';
import { Footer } from './footer';
import { Header } from './header';

export class Sidebar extends ReactWidget {
  constructor({ commands, shell, tracker, translator }: Sidebar.IOptions) {
    super();
    this.addClass('correxit');
    this.commands = commands;
    this.trans = (translator || nullTranslator).load('correxit');
    shell.currentChanged?.connect((_, { newValue }) => {
      this.workbook = newValue instanceof NotebookPanel ? newValue : null;
    }, this);
    tracker.currentChanged.connect((_, workbook) => {
      this.workbook = workbook;
    }, this);
    this._workbook = tracker.currentWidget;
  }

  readonly trans: IRenderMime.TranslationBundle;

  public get workbook(): Correxit.Workbook | null {
    return this._workbook;
  }
  protected set workbook(workbook: Correxit.Workbook | null) {
    if (this._workbook !== workbook) {
      void Correxit.open(workbook, { quiet: true });
      this._workbook = workbook;
      this.update();
    }
  }

  protected commands: CommandRegistry;

  protected render() {
    const { commands, trans, workbook } = this;
    if (workbook === null || workbook.content.model === null) {
      return (
        <section>
          <small>{trans.__('[correxit idle, waiting for notebook]')}</small>
        </section>
      );
    }
    const { model } = workbook.content;
    const key = model.cells.get(0).id;
    return (
      <UseSignal key={key} signal={model.metadataChanged} initialSender={model}>
        {() => (
          <>
            <Header commands={commands} trans={trans} workbook={workbook} />
            <Body commands={commands} trans={trans} workbook={workbook} />
            <Footer commands={commands} />
          </>
        )}
      </UseSignal>
    );
  }

  private _workbook: Correxit.Workbook | null = null;
}

export namespace Sidebar {
  export interface IOptions {
    commands: CommandRegistry;
    shell: JupyterFrontEnd.IShell;
    tracker: INotebookTracker;
    translator?: ITranslator | null;
  }

  export namespace CommandIDs {
    export const add = 'correxit:add';
    export const convert = 'correxit:convert';
    export const correct = 'correxit:correct';
    export const lock = 'correxit:lock';
    export const remove = 'correxit:delete';
    export const reset = 'correxit:reset';
    export const unlock = 'correxit:unlock';
  }

  export const WAITING = 'correxit-mod-waiting';

  export const addCommands: typeof ADD_COMMANDS = ADD_COMMANDS;
}
