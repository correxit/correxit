import { showDialog, showErrorMessage } from '@jupyterlab/apputils';
import { PathExt } from '@jupyterlab/coreutils';
import { Context } from '@jupyterlab/docregistry';
import { NotebookModelFactory } from '@jupyterlab/notebook';
import { IRenderMime } from '@jupyterlab/rendermime';
import { Contents, ServiceManager } from '@jupyterlab/services';
import { notebookIcon, saveIcon } from '@jupyterlab/ui-components';
import { filter, find } from '@lumino/algorithm';
import { CommandRegistry } from '@lumino/commands';
import { ReadonlyPartialJSONObject } from '@lumino/coreutils';
import { useEffect, useState } from 'react';
import { Corrector } from '../corrector';
import { Correxit, Rubric, Workbook } from '.';
import * as input from './input';
import * as security from './security';

export namespace CommandIDs {
  export const add = 'correxit:add';
  export const assign = 'correxit:assign';
  export const batch = 'correxit:batch';
  export const convert = 'correxit:convert';
  export const correct = 'correxit:correct';
  export const emit = 'correxit:emit';
  export const fetch = 'correxit:fetch';
  export const lock = 'correxit:lock';
  export const propagate = 'correxit:propagate';
  export const remove = 'correxit:remove';
  export const reset = 'correxit:reset';
  export const save = 'correxit:save';
  export const scan = 'correxit:scan';
  export const toggle = 'correxit:toggle';
  export const unlock = 'correxit:unlock';
}

const { get, has, size } = Rubric;
const {
  add, assign, convert, correct, lock, propagate, remove, reset, toggle, unlock
} = Workbook;

export function addCommands(options: {
  commands: CommandRegistry;
  manager: ServiceManager.IManager;
  schedule: (workbook: Workbook | null) => void;
  source: Correxit.Source;
  trans: IRenderMime.TranslationBundle;
}) {
  type Assignment = Rubric.Assignment;
  type Cell = Rubric.Cell;
  type CellToolbar = { [Correxit.CELL_TOOLBAR]?: boolean };
  type Credentials = Workbook.Credentials;
  type Grade = Workbook.Grade;
  type Headless = Workbook.Headless;
  const { commands, schedule, manager, source, trans } = options;
  const active = (active =>
    (update?: Workbook | null) => (active.workbook = update ?? active.workbook)
  )({ workbook: null } as { workbook: Workbook | null });
  const cd = async (commands: CommandRegistry, path: string): Promise<void> => {
    if (commands.hasCommand(Corrector.CommandIDs.cd)) {
      commands.execute(Corrector.CommandIDs.cd, { path })
    }
    if (commands.hasCommand('filebrowser:go-to-path')) {
      commands.execute('filebrowser:go-to-path', { path });
    }
  };
  const fetch = async (handle: Credentials): Promise<Headless | null> => {
    const { path } = handle;
    const context = new Context({ manager, factory, path });
    const workbook = { content: null, context };
    await context.initialize(false);

    const rubric = open(workbook);
    if (!rubric) {
      context.dispose();
      return null;
    }
    if (!rubric.locked || !(handle.passphrase || handle.key)) {
      return workbook;
    }
    try {
      const { passphrase } = handle;
      const key = handle.key || await security.keygen(passphrase!, rubric.id);
      await unlock(workbook, key);
    } catch (error) {
      console.warn(`access error, ${path}`, error);
    }
    return workbook;
  };
  const normalize = (
    credentials: Partial<Credentials> | null
  ): Credentials | null => {
    const { key, passphrase, path } = credentials || {};
    if (key && passphrase || !path) {
      return null;
    }
    return {
      key: key || null, passphrase: passphrase || null, path
    } as Credentials;
  };
  const open = (workbook: Workbook | null): Rubric | null =>
    Workbook.open(workbook, true);
  const resolve = (cell: Partial<Cell & CellToolbar>): Cell['id'] => {
    const notebook = active()?.content;
    const toolbar = cell[Correxit.CELL_TOOLBAR];
    return cell.id || toolbar && notebook?.activeCell?.model.id || '';
  };
  const subscribe = async () => {
    for await (const { payload } of source) {
      active(payload);
    }
  };
  const factory = new NotebookModelFactory();
  const deep = true;
  const disposables = [];
  void subscribe();
  disposables.push(commands.addCommand(CommandIDs.add, {
    className: 'correxit-ToolbarButtonComponent',
    icon: (args: Partial<Rubric.Cell>) => {
      if (args.is === 'answerable') {
        return Correxit.Icons.answer;
      }
      if (args.is === 'comparable') {
        return Correxit.Icons.compare;
      }
      if (args.is === 'correctable') {
        return Correxit.Icons.cellCorrect;
      }
    },
    isEnabled: (args: Partial<Cell>) => {
      const cells = active()?.context.model.sharedModel.cells || [];
      const id = resolve(args);
      const cell = find(cells, cell => cell.id === id);
      const reference = args.reference;
      const rubric = open(active());
      if (!cell || !rubric || rubric.locked || !id || id === reference?.[0]) {
        return false;
      }

      const code = cell.cell_type === 'code';
      return code && !has(rubric, id, deep) || has(rubric, id);
    },
    isToggled: (args: Partial<Cell>) => {
      const id = resolve(args);
      const rubric = open(active());
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
    execute: async (cell: Partial<Cell>) => {
      if (!commands.isEnabled(CommandIDs.add, cell)) {
        return;
      }

      const id = resolve(cell);
      const is = cell.is!;
      const workbook = active()!;
      await commands.execute(CommandIDs.remove, { id });
      if (is === 'answerable') {
        const expected = await input.text({
          title: trans.__('Enter expected cell output'),
          label: commands.label(CommandIDs.add, cell)
        });
        if (!expected) {
          return;
        }

        const payload = [await security.digest(expected)];
        const reference = null;
        const shared = false;
        await add(workbook, { id, is, payload, reference, shared });
        return;
      }
      if (is !== 'comparable' && is !== 'correctable') {
        return;
      }

      let reference = cell.reference;
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
      const shared = false;
      await add(workbook, { id, is, payload, reference, shared });
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.assign, {
    icon: Correxit.Icons.assignment,
    isEnabled: () => open(active())?.locked === false,
    isVisible: () => commands.isEnabled(CommandIDs.assign),
    label: trans.__('Assign workbook...'),
    execute: async (args: Partial<Credentials & Assignment>) => {
      const handle = normalize(args);
      const workbook = handle ? await fetch(handle) : active();
      const rubric = open(workbook);
      if (!workbook || !rubric) {
        return;
      }

      const assignment: Partial<Assignment> = {
        assignee: args.assignee || '',
        roster: args.roster || []
      };
      const different = (a: Partial<Assignment>, b: Assignment) =>
        JSON.stringify({ x: a.assignee, y: a.roster }) !==
        JSON.stringify({ x: b.assignee, y: b.roster });
      if (different(assignment, rubric.assignment)) {
        await assign(workbook, assignment);
        await commands.execute(CommandIDs.save, handle || {});
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.batch, {
    label: trans.__('Batch grade a scanned workbook directory...'),
    execute: (args: Partial<Credentials>): AsyncGenerator<[Grade, Headless]> =>
      (async function*(handle) {
        const workbooks = await commands.execute(CommandIDs.scan, handle);
        for await (const workbook of workbooks as AsyncGenerator<Headless>) {
          yield [
            { ...await correct(workbook), path: workbook.context.path },
            workbook
          ];
          workbook.context.dispose();
        }
      })(normalize(args) || {})
  }));
  disposables.push(commands.addCommand(CommandIDs.convert, {
    icon: Correxit.Icons.convert,
    isEnabled: () => {
      try {
        return !open(active());
      } catch (error) {
        return error === Correxit.NO_CORREXIT_METADATA;
      }
    },
    isVisible: () => commands.isEnabled(CommandIDs.convert),
    label: trans.__('Convert to a Correxit workbook...'),
    execute: async (args: Partial<Credentials>) => {
      const handle = normalize(args);
      const workbook = handle ? await fetch(handle) : active();
      if (!workbook) {
        return;
      }

      const passphrase = await input.text({
        title: trans.__('Enter a passphrase'),
        label: trans.__('Enter a passphrase for this workbook')
      });
      if (passphrase) {
        await convert(workbook, passphrase);
        await commands.execute(CommandIDs.save, args);
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.correct, {
    icon: Correxit.Icons.correct,
    isEnabled: (args: Partial<Cell & CellToolbar>) => {
      const workbook = active();
      const rubric = open(workbook);
      const id = resolve(args);
      const headed = workbook && workbook.content;
      if (args[Correxit.CELL_TOOLBAR] && !id) {
        return false;
      }
      return !!rubric && !!headed && (id ? has(rubric, id) : size(rubric) > 0);
    },
    isVisible: (args: Partial<Rubric.Cell> & CellToolbar) =>
      commands.isEnabled(CommandIDs.correct, args),
    label: (args: Partial<Rubric.Cell> & CellToolbar) => {
      if (!commands.isEnabled(CommandIDs.correct, args)) {
        return '';
      }
      return resolve(args)
        ? trans.__('Correct cell...')
        : trans.__('Correct workbook...');
    },
    execute: async (args: Partial<Rubric.Cell & Credentials & CellToolbar>) => {
      const handle = normalize(args);
      const workbook = handle ? await fetch(handle) : active();
      if (!workbook) {
        return { score: Rubric.UNSCORED, spec: null };
      }

      const id = resolve(args);
      if (args[Correxit.CELL_TOOLBAR] && !id) {
        return { score: Rubric.UNSCORED, spec: null };
      }

      const result = await correct(workbook, id);
      if (!workbook.content) {
        return result;
      }

      const unscored = result.score === Rubric.UNSCORED;
      const [x, y] = result.score;
      void showDialog({
        title: trans.__('Computed score'),
        body: unscored ? trans.__('Unscored') : trans.__('%1 of %2', x, y)
      });
      if (workbook.content.activeCell) {
        workbook.content.scrollToCell(workbook.content.activeCell);
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.emit, {
    label: trans.__('Schedule one Correxit source emission'),
    execute: () => (once => (emission: Workbook | null) =>
      void (once &&= Boolean(schedule(emission))))(true)
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
    icon: Correxit.Icons.locked,
    isEnabled: () => {
      const workbook = active();
      const rubric = open(workbook);
      const headed = !!workbook?.content;
      return !!(workbook && headed && rubric && !rubric.locked);
    },
    isVisible: () => commands.isEnabled(CommandIDs.lock),
    label: trans.__('Lock'),
    execute: async (args: Partial<Credentials>) => {
      const handle = normalize(args);
      const workbook = handle ? await fetch(handle) : active();
      const rubric = open(workbook);
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
      const rubric = open(active());
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
      const handle = normalize(args);
      const workbook = handle ? await fetch(handle) : active();
      const rubric = open(workbook);
      if (!workbook || !rubric || rubric.locked) {
        return empty();
      }

      const { path } = workbook.context;
      const base = PathExt.basename(path, '.ipynb');
      const parent = PathExt.dirname(path);
      try {
        const potential = await folder(manager, parent, base);
        const directory = await mkdir(manager, parent, potential);
        const location = { base, pwd: directory.path };
        const output = propagate({ factory, location, manager, workbook });
        after(output, () => cd(commands, directory.path));
        return translate(output, trans);
      } catch (error) {
        console.warn(CommandIDs.propagate, error);
      }
      return empty();
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.remove, {
    isEnabled: (args: Partial<Rubric.Cell>) => {
      const id = resolve(args);
      const rubric = open(active());
      return !!id && !!rubric && !rubric.locked && has(rubric, id);
    },
    isVisible: args => commands.isEnabled(CommandIDs.remove, args),
    icon: Correxit.Icons.reset,
    label: trans.__('Reset cell configuration'),
    execute: async (args: Partial<Rubric.Cell>) => {
      const workbook = active();
      const id = resolve(args);
      if (workbook && id) {
        remove(workbook, id);
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.reset, {
    icon: notebookIcon,
    isEnabled: () => open(active())?.locked === false,
    isVisible: () => commands.isEnabled(CommandIDs.reset),
    caption: trans.__('Deletes Correxit metadata, keeps notebook content'),
    label: trans.__('Revert to notebook...'),
    execute: async (args: Partial<Credentials>) => {
      const handle = normalize(args);
      const workbook = handle ? await fetch(handle) : active();
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
      const handle = normalize(args);
      const workbook = handle ? await fetch(handle) : active();
      if (!workbook || workbook.context.isDisposed) {
        console.warn('save failed for (handle, workbook)', handle, workbook);
        return;
      }
      if (args.undo === false) {
        workbook.context.model.sharedModel.clearUndoHistory();
      }
      await workbook.context.save();
      if (commands.hasCommand(Corrector.CommandIDs.refresh)) {
        await commands.execute(Corrector.CommandIDs.refresh);
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.scan, {
    label: trans.__('Scan a directory for Correxit workbooks'),
    describedBy: {
      args: {
        type: 'object',
        properties: {
          path: { type: 'string', description: trans.__('Optional path') }
        }
      }
    },
    execute: (handle: Partial<Credentials>): AsyncGenerator<Headless> =>
      (async function*(handle) {
        const directory = handle && handle.path;
        const notebook = ({ type }: Contents.IModel) => type === 'notebook';
        const sort = (list: Contents.IModel[]) =>
          list.sort((a, b) => a.name.localeCompare(b.name));
        let response: Contents.IModel;
        if (!directory) {
          return;
        }
        try {
          response = await manager.contents.get(directory);
        } catch (error) {
          console.warn(CommandIDs.scan, directory, error);
          return;
        }
        if (response.type !== 'directory') {
          console.warn(CommandIDs.scan, directory, 'not a directory');
          return;
        }
        for (const { path } of filter(sort(response.content), notebook)) {
          const fetched = await fetch({ ...handle, path });
          if (fetched) {
            yield fetched as Headless;
          }
        }
      })(normalize({ ...handle, path: handle.path || '.' }))
  }));
  disposables.push(commands.addCommand(CommandIDs.toggle, {
    icon: (args: Partial<Rubric.Cell & CellToolbar>) => {
      if (!commands.isEnabled(CommandIDs.toggle, args)) {
        return void 0;
      }

      const { shared } = Rubric.get(open(active())!, resolve(args))!;
      return shared ? Correxit.Icons.shared : Correxit.Icons.secret;
    },
    isEnabled: (args: Partial<Rubric.Cell & CellToolbar>) => {
      const rubric = open(active());
      const id = resolve(args);
      return !!id && !!rubric && !rubric.locked && has(rubric, id);
    },
    isVisible: (args: Partial<Rubric.Cell & CellToolbar>) => {
      return commands.isEnabled(CommandIDs.toggle, args);
    },
    label: (args: Partial<Rubric.Cell & CellToolbar>) => {
      if (!commands.isEnabled(CommandIDs.toggle, args)) {
        return '';
      }

      const { shared } = Rubric.get(open(active())!, resolve(args))!;
      return shared
        ? trans.__('Allow correction only in grader mode')
        : trans.__('Allow correction in all modes');
    },
    execute: async (args: Partial<Rubric.Cell>) => {
      if (commands.isEnabled(CommandIDs.toggle, args)) {
        toggle(active()!, resolve(args));
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.unlock, {
    icon: Correxit.Icons.unlocked,
    isEnabled: () => {
      const workbook = active();
      const rubric = open(workbook);
      const headed = !!workbook?.content;
      return !!(workbook && headed && rubric && rubric.locked);
    },
    isVisible: () => commands.isEnabled(CommandIDs.unlock),
    label: trans.__('unlock'),
    usage: `
The command execute args type is \`Partial<Workbook.Credentials>\`

If no passphrase or key is provided, the command invokes a user prompt dialog.
The returned promise never rejects. The command invokes an error message dialog
if unlock fails.
    `,
    execute: async (args: Partial<Credentials>):
      Promise<Rubric.Unlocked | null> => {
      const handle = normalize(args);
      const workbook = handle ? await fetch(handle) : active();
      if (!workbook) {
        return null;
      }
      try {
        const rubric = open(workbook);
        let key = handle?.key || rubric?.key || null;
        let passphrase: string | null = null;
        if (!key) {
          passphrase = handle?.passphrase || await input.text({
            title: trans.__('Enter a passphrase to unlock'),
            label: trans.__('Enter a passphrase to unlock this workbook')
          }) || null;
        }

        if (!rubric || !rubric.locked || !(key || passphrase)) {
          return null;
        }
        key ||= await security.keygen(passphrase!, rubric.id);
        const unlocked = await unlock(workbook, key);
        await commands.execute(CommandIDs.save, { ...args, undo: false });
        return unlocked;
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

/**
 * A utility hook for collecting the output of an async iterable command.
 *
 * @param commands - the command registry.
 * @param id - the command ID.
 * @param args - the (optional) command args.
 * @returns a tuple, the collected list and whether iteration is complete.
 *
 * #### Notes
 * This utility will work with any command that returns an async iterator,
 * generator, or any other iterable. The collected list is updated with every
 * yield/iteration and allows a component to display the collection as it grows.
 *
 * For performance, collected items should be rendered by a memoized component.
 *
 * If the command `id` is not found, e.g., `id: ""`, the collection is empty.
 */
export function useCommand<T>(
  commands: CommandRegistry,
  id: string,
  args?: ReadonlyPartialJSONObject
): [T[], boolean] {
  const [list, setList] = useState([] as T[]);
  const [idle, setIdle] = useState(true);
  useEffect((interrupted = false) => {
    (async (stream?: Promise<AsyncIterable<T> | Iterable<T>>) => {
      setIdle(false);
      for await (const item of await (stream || empty())) {
        if (interrupted) {
          return;
        }
        setList(list => [...list, item]);
      }
      setIdle(true);
    })(commands.hasCommand(id) ? commands.execute(id, args) : void 0);
    return () => void (interrupted = true);
  }, [id, JSON.stringify(args)]);
  return [list, idle];
}

async function after(emitter: Correxit.Emitter, action: () => void) {
  for await (const _ of emitter) {
    void _;
  }
  action();
}

async function* empty() {}

async function folder(
  services: ServiceManager.IManager,
  pwd: string,
  seed: string
): Promise<string> {
  const response = await services.contents.get(pwd);
  if (response.type !== 'directory') {
    throw new Error(`not a folder(${pwd}, ${seed})`);
  }
  const paths = (response.content as Contents.IModel[]).reduce(
    (paths, { path }) => paths.set(path, null),
    new Map<string, null>()
  );
  let suffix = 0;
  let folder: string;
  do {
    folder = PathExt.join(pwd, `${seed}${suffix ? `-${suffix}` : ''}`);
    suffix += 1;
  } while (paths.has(folder));
  return folder;
};

async function mkdir(
  services: ServiceManager.IManager,
  pwd: string,
  path: string
) {
  const type = 'directory';
  const created = await services.contents.newUntitled({ path: pwd, type });
  return await services.contents.rename(created.path, path);
};

async function* translate(
  emitter: Correxit.Emitter,
  trans: IRenderMime.TranslationBundle
) {
  const translate = (emission: Correxit.Emitter.Emission) => {
    const { slots, type } = emission;
    return ({
      '': slots.join(' '),
      'assigned': trans.__('Assigned to %1', ...slots),
      'created': trans.__('Created %1', ...slots),
      'create-error': trans.__('Create ERROR %1', ...slots),
      'error': trans.__('ERROR %1', ...slots),
      'locked': trans.__('Locked %1', ...slots),
      'progress': trans.__('%1 of %2', ...slots),
      'saved': trans.__('Saved %1', ...slots),
      'save-error': trans.__('Save ERROR %1', ...slots),
      'separator': '------------',
      'success': trans.__('Finished! (roster: %1}', ...slots),
      'unlocked': trans.__('Unlocked %1', ...slots)
    })[type] || '';
  };
  for await (const { payload } of emitter) {
    const message = payload && translate(payload);
    if (message) {
      yield [message, payload] as [string, Correxit.Emitter.Emission];
    }
  }
}
