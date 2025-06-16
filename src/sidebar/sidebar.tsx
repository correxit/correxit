import { JupyterFrontEnd } from '@jupyterlab/application';
import {
  InputDialog,
  showDialog,
  showErrorMessage
} from '@jupyterlab/apputils';
import { PathExt } from '@jupyterlab/coreutils';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { IRenderMime } from '@jupyterlab/rendermime';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import {
  lockIcon,
  notebookIcon,
  ReactWidget,
  UseSignal
} from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React from 'react';
import { Correxit } from '../correxit';
import { encrypt, keygen } from '../correxit/security';
import { Body } from './body';
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
    export const reset = 'correxit:reset';
    export const unlock = 'correxit:unlock';
  }

  export function addCommands(commands: CommandRegistry, sidebar: Sidebar) {
    const { trans } = sidebar;
    const quiet = true;
    const enabled = {
      [CommandIDs.add]: ({ cell }: { cell?: string }) =>
        Correxit.open(sidebar.workbook, { quiet })?.locked === false && !!cell,
      [CommandIDs.convert]: () => {
        const model = sidebar.workbook?.content.model;
        return !!(model && !model.getMetadata('correxit'));
      },
      [CommandIDs.correct]: ({ cell }: { cell?: string }) =>
        Correxit.correctable(sidebar.workbook, cell),
      [CommandIDs.lock]: () =>
        Correxit.open(sidebar.workbook, { quiet })?.locked === false,
      [CommandIDs.reset]: () =>
        Correxit.open(sidebar.workbook, { quiet })?.locked === false,
      [CommandIDs.unlock]: () =>
        Correxit.open(sidebar.workbook!, { quiet })?.locked ?? false
    };
    return [
      commands.addCommand(CommandIDs.add, {
        isEnabled: enabled[CommandIDs.add],
        isVisible: enabled[CommandIDs.add],
        label: trans.__('Add an answer for this cell...'),
        execute: async ({ cell }: { cell?: string }) => {
          if (!enabled[CommandIDs.add]({ cell })) {
            return;
          }
          const workbook = sidebar.workbook!;
          console.log('implement add functionality');
          const rubric = Correxit.open(workbook);
          const payload = [await (async () => encrypt('42', rubric!.key!))()];
          Correxit.add(workbook, {
            section: 'shared',
            cell: { id: cell!, format: 'digest', payload }
          });
        }
      }),
      commands.addCommand(CommandIDs.convert, {
        isEnabled: enabled[CommandIDs.convert],
        isVisible: enabled[CommandIDs.convert],
        label: trans.__('Convert notebook to a workbook...'),
        execute: async () => {
          if (!enabled[CommandIDs.convert]()) {
            return;
          }
          const workbook = sidebar.workbook!;
          const key = await Private.prompt({
            title: trans.__('Enter a passphrase'),
            label: trans.__('Enter a passphrase for this workbook')
          });
          if (key) {
            const rubric = await Correxit.convert(workbook, key);
            await workbook.context.save();
            return rubric;
          }
        }
      }),
      commands.addCommand(CommandIDs.correct, {
        isEnabled: enabled[CommandIDs.correct],
        isVisible: enabled[CommandIDs.correct],
        label: ({ cell }: { cell?: string }) =>
          cell ? trans.__('Correct cell...') : trans.__('Correct workbook...'),
        execute: async ({ cell }: { cell?: string }) => {
          if (!enabled[CommandIDs.correct]({ cell })) {
            return;
          }
          console.log('implement correct functionality');
        }
      }),
      commands.addCommand(CommandIDs.lock, {
        icon: lockIcon,
        isEnabled: enabled[CommandIDs.lock],
        isVisible: enabled[CommandIDs.lock],
        label: trans.__('Lock grader mode (PGP encrypt)'),
        execute: async () => {
          if (!enabled[CommandIDs.lock]()) {
            return;
          }
          try {
            const rubric = await Correxit.lock(sidebar.workbook!);
            await sidebar.workbook!.context.save();
            return rubric;
          } catch (error) {
            void showErrorMessage(trans.__('Could not lock'), error as Error);
          }
        }
      }),
      commands.addCommand(CommandIDs.reset, {
        icon: notebookIcon,
        isEnabled: enabled[CommandIDs.reset],
        isVisible: enabled[CommandIDs.reset],
        caption: 'Delete workbook metadata, leave notebook cells unmodified',
        label: trans.__('Revert to notebook (delete workbook metadata)...'),
        execute: async () => {
          if (!enabled[CommandIDs.reset]()) {
            return;
          }
          const title = trans.__('Revert to notebook');
          const body = commands.caption(CommandIDs.reset);
          const { button } = await showDialog({ body, title });
          if (button.accept) {
            await Correxit.reset(sidebar.workbook!);
            await sidebar.workbook!.context.save();
          }
        }
      }),
      commands.addCommand(CommandIDs.unlock, {
        icon: lockIcon,
        isEnabled: enabled[CommandIDs.unlock],
        isVisible: enabled[CommandIDs.unlock],
        label: trans.__('Unlock grader mode (PGP decrypt)...'),
        usage: `
The command execute args type is: { key?: string }

If no key is provided, the command invokes a user prompt dialog.

The command execute return type is: Promise<Rubric<"unlocked"> | null>
The returned promise never rejects.

The command invokes an error message dialog if unlock fails.
        `,
        execute: async ({ key }: { key?: string }) => {
          if (!enabled[CommandIDs.unlock]()) {
            return null;
          }
          try {
            const workbook = sidebar.workbook!;
            key ||= await Private.prompt({
              title: trans.__('Enter a passphrase to unlock'),
              label: trans.__('Enter a passphrase to unlock this workbook')
            });
            if (!key) {
              return null;
            }
            const rubric = await Correxit.unlock(workbook, key);
            await workbook.context.save();
            return rubric;
          } catch (error) {
            const file = PathExt.basename(sidebar.workbook!.context.path);
            void showErrorMessage(
              trans.__('Could not unlock %1', file),
              error as Error
            );
            return null;
          }
        }
      })
    ];
  }
}

namespace Private {
  export const prompt = async ({ label, title }: InputDialog.ITextOptions) => {
    const { button, value } = await InputDialog.getText({ label, title });
    return (button.accept && value && (await keygen(value))) || '';
  };
}
