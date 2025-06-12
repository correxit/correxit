import { JupyterFrontEnd } from '@jupyterlab/application';
import { showErrorMessage } from '@jupyterlab/apputils';
import { PathExt } from '@jupyterlab/coreutils';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { IRenderMime } from '@jupyterlab/rendermime';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { ReactWidget, UseSignal } from '@jupyterlab/ui-components';
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
            <Header trans={trans} workbook={workbook} />
            <Controls trans={trans} workbook={workbook} />
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
    export const convert = 'correxit:convert';
    export const lock = 'correxit:lock';
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
      [CommandIDs.lock]: () => {
        if (sidebar.workbook?.content.model?.getMetadata('correxit')) {
          return Correxit.Rubric.get(sidebar.workbook)?.locked === false;
        }
        return false;
      },
      [CommandIDs.reset]: () => {
        if (sidebar.workbook?.content.model?.getMetadata('correxit')) {
          return Correxit.Rubric.get(sidebar.workbook)?.locked === false;
        }
        return false;
      },
      [CommandIDs.unlock]: () => {
        if (sidebar.workbook?.content.model?.getMetadata('correxit')) {
          const rubric = Correxit.Rubric.get(sidebar.workbook);
          return rubric ? rubric.locked : true;
        }
        return false;
      }
    };
    return [
      commands.addCommand(CommandIDs.convert, {
        isEnabled: enabled[CommandIDs.convert],
        isVisible: enabled[CommandIDs.convert],
        label: trans.__('Convert notebook to a workbook...'),
        execute: async () => {
          if (enabled[CommandIDs.convert]()) {
            Correxit.unlock({ trans, workbook: sidebar.workbook! }).catch(noop);
          }
        }
      }),
      commands.addCommand(CommandIDs.lock, {
        isEnabled: enabled[CommandIDs.lock],
        isVisible: enabled[CommandIDs.lock],
        label: trans.__('Deactivate grader mode (PGP encrypt)'),
        execute: async () => {
          if (enabled[CommandIDs.lock]()) {
            return Correxit.lock({ workbook: sidebar.workbook! }).catch(noop);
          }
        }
      }),
      commands.addCommand(CommandIDs.reset, {
        isEnabled: enabled[CommandIDs.reset],
        isVisible: enabled[CommandIDs.reset],
        caption: 'Delete workbook metadata, leave notebook cells unmodified',
        label: trans.__('Revert to notebook (delete workbook metadata)...'),
        execute: async () => {
          const title = trans.__('Revert to notebook');
          const body = commands.caption(CommandIDs.reset);
          if (enabled[CommandIDs.reset]()) {
            return Correxit.reset({ body, title, workbook: sidebar.workbook! });
          }
        }
      }),
      commands.addCommand(CommandIDs.unlock, {
        isEnabled: enabled[CommandIDs.unlock],
        isVisible: enabled[CommandIDs.unlock],
        label: trans.__('Activate grader mode (PGP decrypt)...'),
        execute: async () => {
          if (!enabled[CommandIDs.unlock]()) {
            return;
          }
          try {
            await Correxit.unlock({ trans, workbook: sidebar.workbook! });
          } catch (error) {
            const file = PathExt.basename(sidebar.workbook!.context.path);
            void showErrorMessage(
              trans.__('Could not unlock.'),
              trans.__('Correxit could not unlock this workbook (%1)', file)
            );
          }
        }
      })
    ];
  }
}
