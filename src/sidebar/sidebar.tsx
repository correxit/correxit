import { JupyterFrontEnd } from '@jupyterlab/application';
import { showErrorMessage } from '@jupyterlab/apputils';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { IRenderMime } from '@jupyterlab/rendermime';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { ReactWidget } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import { IDisposable } from '@lumino/disposable';
import React from 'react';
import { Controls } from './controls';
import { Correxit } from '../correxit';
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
      this._workbook = workbook;
      this.update();
    }
  }

  protected commands: CommandRegistry;

  protected render() {
    if (this.workbook === null || this.workbook.content.model === null) {
      const DISCONNECTED = '[correxit idle, waiting for notebook]';
      return (
        <section>
          <small>{this.trans.__(DISCONNECTED)}</small>
        </section>
      );
    }
    return (
      <>
        <Header trans={this.trans} workbook={this.workbook} />
        <Controls trans={this.trans} workbook={this.workbook} />
        <Footer commands={this.commands} workbook={this.workbook} />
      </>
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
    export const convert = 'correxit:convert';
    export const reset = 'correxit:reset';
    export const unlock = 'correxit:unlock';
  }

  export function addCommands({
    commands,
    sidebar
  }: {
    commands: CommandRegistry;
    sidebar: Sidebar;
  }): IDisposable[] {
    const { trans } = sidebar;
    const noop = () => undefined;
    const enabled = {
      [CommandIDs.convert]: () => {
        const model = sidebar.workbook?.content.model;
        return !!(model && !model.getMetadata('correxit'));
      },
      [CommandIDs.reset]: () => {
        return !!sidebar.workbook?.content.model?.getMetadata('correxit');
      },
      [CommandIDs.unlock]: () => {
        if (sidebar.workbook?.content.model?.getMetadata('correxit')) {
          const rubric = Correxit.Rubric.get(sidebar.workbook!);
          return rubric ? rubric.locked : true;
        }
        return false;
      }
    };
    return [
      commands.addCommand(CommandIDs.convert, {
        isEnabled: enabled[CommandIDs.convert],
        label: trans.__('Convert notebook to a workbook'),
        execute: async () => {
          if (enabled[CommandIDs.convert]()) {
            Correxit.unlock({ trans, workbook: sidebar.workbook! }).catch(noop);
          }
        }
      }),
      commands.addCommand(CommandIDs.reset, {
        isEnabled: enabled[CommandIDs.reset],
        label: trans.__('Reset workbook back to a notebook'),
        execute: async () => {
          if (enabled[CommandIDs.reset]()) {
            Correxit.reset({ trans, workbook: sidebar.workbook! }).catch(noop);
          }
        }
      }),
      commands.addCommand(CommandIDs.unlock, {
        isEnabled: enabled[CommandIDs.unlock],
        label: trans.__('Unlock workbook'),
        execute: async () => {
          if (!enabled[CommandIDs.unlock]()) {
            return;
          }
          try {
            await Correxit.unlock({ trans, workbook: sidebar.workbook! });
          } catch (error) {
            void showErrorMessage(
              trans.__('Could not unlock.'),
              trans.__('Correxit was unable to unlock a workbook.')
            );
          }
        }
      })
    ];
  }
}
