import { JupyterFrontEnd } from '@jupyterlab/application';
import { Dialog, showDialog, showErrorMessage } from '@jupyterlab/apputils';
import { PathExt } from '@jupyterlab/coreutils';
import { NotebookModelFactory } from '@jupyterlab/notebook';
import { IRenderMime } from '@jupyterlab/rendermime';
import { ITranslator } from '@jupyterlab/translation';
import { notebookIcon, saveIcon } from '@jupyterlab/ui-components';
import { find } from '@lumino/algorithm';
import { Correxit, Rubric, Workbook } from '..';
import { Corrector } from '../corrector';
import * as input from './input';
import * as io from './io';
import * as propagator from './propagator';
import * as security from './security';
import * as state from './state';

export namespace CommandIDs {
  export const add = 'correxit:add';
  export const assign = 'correxit:assign';
  export const comment = 'correxit:comment';
  export const convert = 'correxit:convert';
  export const correct = 'correxit:correct';
  export const draft = 'correxit:draft';
  export const emit = 'correxit:emit';
  export const fetch = 'correxit:fetch';
  export const lock = 'correxit:lock';
  export const propagate = 'correxit:propagate';
  export const registrar = 'correxit:registrar';
  export const remove = 'correxit:remove';
  export const reset = 'correxit:reset';
  export const save = 'correxit:save';
  export const submit = 'correxit:submit';
  export const toggle = 'correxit:toggle';
  export const unlock = 'correxit:unlock';
}

type Assignment = Rubric.Assignment;
type Cell = Rubric.Cell;
type CellToolbar = Rubric.Cell.Toolbar;
type Credentials = Workbook.Credentials;
type Headless = Workbook.Headless;

const { get, has, size } = Rubric;
const { add, assign, comment, convert, correct, draft } = Workbook;
const { lock, remove, reset, submit, toggle } = Workbook;
const { normalize } = Workbook.Credentials;

export function addCommands(
  app: JupyterFrontEnd,
  { consumer, registrar, scheduler, submitter, translator, unlocker }: {
    consumer: Correxit.Consumer;
    registrar: Correxit.Registrar;
    scheduler: Correxit.Scheduler;
    submitter: Correxit.Submitter;
    translator: ITranslator;
    unlocker: Correxit.Unlocker;
  }
) {
  const { commands } = app;
  const manager = app.serviceManager;
  const trans = translator.load('correxit');
  const { Icons } = Correxit;
  const factory = new NotebookModelFactory();
  const fetch = (handle: Credentials) =>
    io.request(handle, factory, manager, unlocker);
  const open = (workbook: Workbook | null) => Workbook.open(workbook, true);
  const reify = async (args: Partial<Credentials>): Promise<{
    handle: Credentials | null;
    rubric: Rubric | null;
    workbook: Workbook | null;
  }> => {
    const handle = normalize(args);
    const workbook = handle ? await fetch(handle) : state.workbook();
    const rubric = open(workbook);
    return { handle, rubric, workbook };
  };
  const disposables = [];
  disposables.push(commands.addCommand(CommandIDs.add, {
    className: 'correxit-add',
    icon: ({ is }: Partial<Cell>) =>
      Rubric.Cell.types.some(type => is === type) ? Icons[is!] : void 0,
    isEnabled: (args: Partial<Cell & CellToolbar>) => {
      const notebook = state.workbook()?.context.model.sharedModel;
      const id = state.cell(args);
      const cell = find(notebook?.cells || [], cell => cell.id === id);
      const reference = args.reference;
      const rubric = open(state.workbook());
      if (!cell || !rubric || rubric.locked || !id || id === reference?.[0]) {
        return false;
      }

      const code = cell.cell_type === 'code';
      return code && !has(rubric, id, true) || has(rubric, id);
    },
    isToggled: (args: Partial<Cell>) => {
      const id = state.cell(args);
      const rubric = open(state.workbook());
      return !!rubric && !!id && get(rubric, id)?.is === args.is;
    },
    isVisible: cell => commands.isEnabled(CommandIDs.add, cell),
    label: (cell: Partial<Cell>) => {
      if (!commands.isEnabled(CommandIDs.add, cell)) {
        return '';
      }
      if (cell.is === 'answerable') {
        return trans.__('Answer');
      }
      if (cell.is === 'comparable') {
        return trans.__('Compare');
      }
      if (cell.is === 'correctable') {
        return trans.__('Correct');
      }
      return '';
    },
    execute: async (args: Partial<Cell & Credentials>) => {
      const { workbook, rubric } = await reify(args);
      const id = state.cell(args);
      const is = args.is;
      if (!workbook || !rubric || !id || !is) {
        return;
      }

      const confirm = () => showDialog({
        title: trans.__('Reset cell configuration?'),
        body: trans.__('Do you want to replace the existing configuration?'),
        buttons: [
          Dialog.cancelButton({ label: trans.__('No') }),
          Dialog.okButton({ label: trans.__('Yes') })
        ]
      });
      if (has(rubric, id)) {
        if (!(await confirm()).button.accept) {
          return;
        }
        remove(workbook, id);
      }
      if (is === 'answerable') {
        const expected = await input.text({
          title: trans.__('Enter expected cell output'),
          label: commands.label(CommandIDs.add, args)
        });
        if (!expected) {
          return;
        }

        const payload = [await security.digest(expected)];
        const points = 1;
        const reference = null;
        const shared = false;
        await add(workbook, { id, is, payload, points, reference, shared });
        return;
      }
      if (is !== 'comparable' && is !== 'correctable') {
        return;
      }

      let reference: string[] | null = args.reference || null;
      if (!reference) {
        const selected = workbook.content && await input.cell(workbook);
        reference = selected && [selected.id];
      }
      if (!reference || id === reference[0]) {
        return;
      }
      if (workbook.content) {
        const { widgets } = workbook.content;
        const original = find(widgets, ({ model }) => model.id === id);
        if (original) {
          await workbook.content.scrollToCell(original);
        }
      }

      const payload = null;
      const points = 1;
      const shared = false;
      await add(workbook, { id, is, payload, points, reference, shared });
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.assign, {
    icon: Icons.assignment,
    isEnabled: () => open(state.workbook())?.locked === false,
    isVisible: () => commands.isEnabled(CommandIDs.assign),
    label: trans.__('Assign workbook...'),
    execute: async (args: Partial<Credentials & Assignment>) => {
      const { rubric, workbook } = await reify(args);
      if (!workbook || !rubric) {
        return;
      }

      const roster = await registrar(workbook) || args.roster;
      await assign(workbook, { ...args, roster });
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.comment, {
    label: trans.__('Comment on cell'),
    execute: async (args: Partial<Cell> & { comment?: string; }) => {
      const workbook = state.workbook();
      const id = state.cell(args);
      if (workbook && id) {
        await comment(workbook, id, args.comment || '');
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.convert, {
    icon: Icons.convert,
    isEnabled: () => {
      try {
        void Workbook.open(state.workbook());
        return false;
      } catch (error) {
        return error === Correxit.NO_CORREXIT_METADATA;
      }
    },
    isVisible: () => commands.isEnabled(CommandIDs.convert),
    label: trans.__('Convert to a Correxit workbook...'),
    execute: async (args: Partial<Credentials>) => {
      const { workbook } = await reify(args);
      if (!workbook) {
        return;
      }

      const passphrase = await input.text({
        title: trans.__('Enter a passphrase'),
        label: trans.__('Enter a passphrase for this workbook')
      });
      if (passphrase) {
        await convert(workbook, passphrase, unlocker);
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.correct, {
    icon: Icons.correct,
    isEnabled: (args: Partial<Cell & CellToolbar>) => {
      const workbook = state.workbook();
      const rubric = open(workbook);
      const id = state.cell(args);
      const headed = workbook && workbook.content;
      if (args[Rubric.Cell.TOOLBAR] && !id) {
        return false;
      }
      return !!rubric && !!headed && (id ? has(rubric, id) : size(rubric) > 0);
    },
    isVisible: (args: Partial<Cell> & CellToolbar) =>
      commands.isEnabled(CommandIDs.correct, args),
    label: (args: Partial<Cell> & CellToolbar) => {
      if (!commands.isEnabled(CommandIDs.correct, args)) {
        return '';
      }
      return state.cell(args)
        ? trans.__('Correct cell...')
        : trans.__('Correct workbook...');
    },
    execute: async (args: Partial<Cell & Credentials & CellToolbar>) => {
      const { workbook } = await reify(args);
      if (!workbook) {
        return { score: Rubric.Score.UNSCORED, spec: null };
      }

      const id = state.cell(args);
      if (args[Rubric.Cell.TOOLBAR] && !id) {
        return { score: Rubric.Score.UNSCORED, spec: null };
      }

      const result = await correct(workbook, id);
      if (!workbook.content) {
        return result;
      }

      const unscored = result.score.status === 'unscored';
      const [x, y] = [result.score.points, result.score.possible];
      void showDialog({
        title: trans.__('Computed score'),
        body: unscored ? trans.__('Unscored') : trans.__('%1 of %2', x, y)
      });
      if (workbook.content.activeCell) {
        workbook.content.scrollToCell(workbook.content.activeCell);
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.draft, {
    isEnabled: () => {
      const rubric = open(state.workbook());
      return !!rubric?.locked && !!rubric.assignment.submission;
    },
    isVisible: () => commands.isEnabled(CommandIDs.draft),
    label: trans.__('Revert to draft...'),
    execute: async (args: Partial<Credentials>) => {
      const { workbook } = await reify(args);
      if (!workbook) {
        return;
      }
      const title = trans.__('Revert to draft');
      const body = trans.__('Revert read-only submission to draft workbook?');
      const buttons = [
        Dialog.cancelButton({ label: trans.__('Cancel') }),
        Dialog.okButton({ label: trans.__('Revert') })
      ];
      const { button } = await showDialog({ title, body, buttons });
      if (!button.accept) {
        return;
      }
      try {
        await draft(workbook);
        await commands.execute(CommandIDs.save, { ...args, undo: false });
      } catch (error) {
        void showErrorMessage(trans.__('Could not revert'), error as Error);
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.emit, {
    label: trans.__('Schedule one Correxit source emission'),
    execute: () => (fired => {
      return (emission: Workbook | null) => {
        if (fired) {
          return;
        }
        fired = true;
        scheduler(emission);
      };
    })(false)
  }));
  disposables.push(commands.addCommand(CommandIDs.fetch, {
    label: trans.__('Fetch a headless Correxit workbook for a given path'),
    describedBy: {
      args: {
        type: 'object',
        required: ['path'],
        properties: {
          key: {
            type: 'string',
            description: trans.__('Optional rubric key')
          },
          passphrase: {
            type: 'string',
            description: trans.__('Optional workbook passphrase')
          },
          path: {
            type: 'string',
            description: trans.__('Workbook path')
          }
        }
      }
    },
    execute: async (args: Partial<Credentials>):
      Promise<Headless | null> => {
      const handle = normalize(args);
      try {
        return handle && await fetch(handle);
      } catch (error) {
        console.warn(CommandIDs.fetch, error);
        return null;
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.lock, {
    icon: Icons.locked,
    isEnabled: () => {
      const workbook = state.workbook();
      const rubric = open(workbook);
      const headed = !!workbook?.content;
      return !!(workbook && headed && rubric && !rubric.locked);
    },
    isVisible: () => commands.isEnabled(CommandIDs.lock),
    label: trans.__('Lock'),
    execute: async (args: Partial<Credentials>) => {
      const { rubric, workbook } = await reify(args);
      if (!workbook || !rubric) {
        return;
      }
      try {
        await lock(workbook);
        await commands.execute(CommandIDs.save, { ...args, undo: false });
      } catch (error) {
        void showErrorMessage(trans.__('Could not lock'), error as Error);
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.propagate, {
    label: trans.__('Propagate assignment to roster...'),
    isEnabled: () => {
      const rubric = open(state.workbook());
      if (!rubric) {
        return false;
      }
      const { locked, assignment: { assignee, roster }} = rubric;
      return !locked && !!roster.length && !assignee;
    },
    isVisible: () => commands.isEnabled(CommandIDs.propagate),
    execute: async (
      args: Partial<Credentials>
    ): Promise<AsyncIterable<[string, Correxit.Emitter.Emission]>> => {
      const { rubric, workbook } = await reify(args);
      if (!workbook || !rubric || rubric.locked) {
        return (async function* empty() {})();
      }

      try {
        const output = propagator.invoke({ consumer, workbook });
        return translate(output, trans);
      } catch (error) {
        console.warn(CommandIDs.propagate, error);
      }
      return (async function* empty() {})();
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.registrar, {
    execute: async (args: Partial<Credentials>): Promise<string[] | null> => {
      const { workbook } = await reify(args);
      const warn = (error: any) => {
        console.warn('registrar failed for workbook', workbook, error);
        return [];
      };
      return workbook && await registrar(workbook).catch(warn);
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.remove, {
    isEnabled: (args: Partial<Cell>) => {
      const id = state.cell(args);
      const rubric = open(state.workbook());
      return !!id && !!rubric && !rubric.locked && has(rubric, id);
    },
    isVisible: args => commands.isEnabled(CommandIDs.remove, args),
    icon: Icons.reset,
    label: trans.__('Reset cell configuration'),
    execute: async (args: Partial<Cell>) => {
      const workbook = state.workbook();
      const id = state.cell(args);
      if (workbook && id) {
        remove(workbook, id);
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.reset, {
    icon: notebookIcon,
    isEnabled: () => open(state.workbook())?.locked === false,
    isVisible: () => commands.isEnabled(CommandIDs.reset),
    caption: trans.__('Deletes Correxit metadata, keeps notebook content'),
    label: trans.__('Revert to notebook...'),
    execute: async (args: Partial<Credentials>) => {
      const { workbook } = await reify(args);
      if (!workbook) {
        return;
      }
      const title = trans.__('Revert to notebook');
      const body = commands.caption(CommandIDs.reset);
      const { button } = await showDialog({ body, title });
      if (button.accept) {
        await reset(workbook);
        await commands.execute(CommandIDs.save, { ...args, undo: false });
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.save, {
    icon: saveIcon,
    label: trans.__('Save workbook metadata'),
    execute: async (args: Partial<Credentials & { undo?: boolean }>) => {
      const { handle, workbook } = await reify(args);
      if (!workbook || workbook.context.isDisposed) {
        console.warn('save failed for (handle, workbook)', handle, workbook);
        return;
      }
      if (args.undo === false) {
        const notebook = workbook.context.model.sharedModel;
        notebook.clearUndoHistory();
      }
      await workbook.context.save();
      if (commands.hasCommand(Corrector.CommandIDs.refresh)) {
        await commands.execute(Corrector.CommandIDs.refresh);
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.submit, {
    isEnabled: () => {
      const rubric = open(state.workbook());
      return !!rubric?.locked && !rubric.assignment.submission;
    },
    isVisible: () => commands.isEnabled(CommandIDs.submit),
    label: trans.__('Submit assignment...'),
    execute: async (args: Partial<Credentials>) => {
      const { workbook } = await reify(args);
      if (!workbook) {
        return;
      }
      const title = trans.__('Submit assignment');
      const body = trans.__(
        'Submit assignment? This workbook will be set to read-only.'
      );
      const { button } = await showDialog({
        title,
        body,
        buttons: [
          Dialog.cancelButton({ label: trans.__('Cancel') }),
          Dialog.okButton({ label: trans.__('Submit') })
        ]
      });
      if (!button.accept) {
        return;
      }
      try {
        const confirmation = await submitter(workbook);
        await submit(workbook, confirmation);
        await commands.execute(CommandIDs.save, { ...args, undo: false });
      } catch (error) {
        void showErrorMessage(trans.__('Could not submit'), error as Error);
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.toggle, {
    icon: (args: Partial<Cell & CellToolbar>) => {
      if (!commands.isEnabled(CommandIDs.toggle, args)) {
        return void 0;
      }

      const { shared } = get(open(state.workbook())!, state.cell(args))!;
      return shared ? Icons.shared : Icons.secret;
    },
    isEnabled: (args: Partial<Cell & CellToolbar>) => {
      const rubric = open(state.workbook());
      const id = state.cell(args);
      return !!id && !!rubric && !rubric.locked && has(rubric, id);
    },
    isVisible: (args: Partial<Cell & CellToolbar>) => {
      return commands.isEnabled(CommandIDs.toggle, args);
    },
    label: (args: Partial<Cell & CellToolbar>) => {
      if (!commands.isEnabled(CommandIDs.toggle, args)) {
        return '';
      }

      const { shared } = get(open(state.workbook())!, state.cell(args))!;
      return shared
        ? trans.__('Allow correction only in grader mode')
        : trans.__('Allow correction in all modes');
    },
    execute: async (args: Partial<Cell>) => {
      if (commands.isEnabled(CommandIDs.toggle, args)) {
        toggle(state.workbook()!, state.cell(args));
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.unlock, {
    icon: Icons.unlocked,
    isEnabled: () => {
      const workbook = state.workbook();
      const rubric = open(workbook);
      const headed = !!workbook?.content;
      return !!(workbook && headed && rubric && rubric.locked);
    },
    isVisible: () => commands.isEnabled(CommandIDs.unlock),
    label: trans.__('Unlock'),
    usage: `
The command execute args type is \`Partial<Workbook.Credentials>\`

If no passphrase or key is provided, the command invokes a user prompt dialog.
The returned promise never rejects. The command invokes an error message dialog
if unlock fails. It returns a promise that resolves to either null or if
successful, an unlocked rubric.
    `,
    execute: async (args: Partial<Credentials>):
      Promise<Rubric.Unlocked | null> => {
      const { handle, workbook } = await reify(args);
      if (!workbook) {
        return null;
      }
      try {
        return unlocker.unlock(workbook, handle);
      } catch (error) {
        const file = PathExt.basename(workbook.context.path);
        void showErrorMessage(
          trans.__('Could not unlock %1', file),
          error as Error
        );
      }
      return null;
    }
  }));
  disposables.push(factory);
  return disposables;
}

async function* translate(
  emitter: Correxit.Emitter,
  trans: IRenderMime.TranslationBundle
) {
  const translate = (emission: Correxit.Emitter.Emission) => {
    const { slots, type } = emission;
    return ({
      '': slots.join(' '),
      'assigned': trans.__('Assigned to %1', ...slots),
      'create-error': trans.__('Create ERROR %1', ...slots),
      'encrypted': trans.__('Encrypted cell %1', ...slots),
      'error': trans.__('ERROR %1', ...slots),
      'mkdir': trans.__('Created directory %1', ...slots),
      'progress': trans.__('%1 of %2', ...slots),
      'saved': trans.__('Saved %1', ...slots),
      'separator': '------------',
      'success': trans.__('Finished! (roster: %1)', ...slots)
    })[type] || '';
  };
  for await (const { payload } of emitter) {
    const message = payload && translate(payload);
    if (message) {
      yield [message, payload] as [string, Correxit.Emitter.Emission];
    }
  }
}
