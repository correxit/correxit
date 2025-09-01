import { showDialog, showErrorMessage } from '@jupyterlab/apputils';
import { PathExt } from '@jupyterlab/coreutils';
import { Context } from '@jupyterlab/docregistry';
import { NotebookModelFactory } from '@jupyterlab/notebook';
import { Contents, ServiceManager } from '@jupyterlab/services';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { notebookIcon } from '@jupyterlab/ui-components';
import { filter, find } from '@lumino/algorithm';
import { CommandRegistry } from '@lumino/commands';
import { useEffect, useState } from 'react';
import { Correxit, Rubric, Workbook } from '.';
import * as input from './input';
import * as security from './security';

export namespace CommandIDs {
  export const add = 'correxit:add';
  export const convert = 'correxit:convert';
  export const correct = 'correxit:correct';
  export const fetch = 'correxit:fetch';
  export const lock = 'correxit:lock';
  export const multicorrect = 'correxit:multicorrect';
  export const remove = 'correxit:remove';
  export const replace = 'correxit:replace';
  export const reset = 'correxit:reset';
  export const scan = 'correxit:scan';
  export const toggle = 'correxit:toggle';
  export const unlock = 'correxit:unlock';
}

export function addCommands(options: {
  commands: CommandRegistry;
  services: ServiceManager.IManager;
  source: Correxit.Source;
  translator: ITranslator | null;
}) {
  type CellToolbar = { [Correxit.CELL_TOOLBAR]?: boolean };
  type Credentials = Workbook.Credentials;
  type Headed = Workbook.Headed;
  type Headless = Workbook.Headless;
  const { correct, lock, open, toggle, unlock } = Workbook;
  const { commands, services, source, translator } = options;
  const active: { workbook: Headed | null } = { workbook: null };
  const trans = (translator || nullTranslator).load('correxit');
  const { get, has, size } = Rubric;
  const deep = true;
  const quiet = true;

  // Update the active workbook when the source emits.
  void (async () => {
    for await (const { payload } of source) {
      active.workbook = payload;
    }
  })();

  // Resolve to a cell ID from command arguments when possible.
  const resolve = (cell: Partial<Rubric.Cell & CellToolbar>): string => {
    const notebook = active.workbook?.content;
    const toolbar = cell[Correxit.CELL_TOOLBAR];
    return cell.id || toolbar && notebook?.activeCell?.model.id || '';
  };
  const disposables = [];
  disposables.push(commands.addCommand(CommandIDs.add, {
    isEnabled: ({ id, reference }: Partial<Rubric.Cell>) => {
      const cells = active.workbook?.context.model.sharedModel.cells || [];
      const cell = find(cells, cell => cell.id === id);
      const rubric = open(active.workbook, quiet);
      if (!cell || !rubric || rubric.locked || !id || id === reference?.[0]) {
        return false;
      }
      return cell.cell_type === 'code' && !has(rubric, id, deep);
    },
    isVisible: cell => commands.isEnabled(CommandIDs.add, cell),
    label: (cell: Partial<Rubric.Cell>) => {
      if (!commands.isEnabled(CommandIDs.add, cell)) {
        return '';
      }
      if (cell.is === 'answerable') {
        return trans.__('Expect output of this cell to match answer...');
      }
      if (cell.is === 'comparable') {
        return trans.__('Select another cell for comparing cell output...');
      }
      if (cell.is === 'correctable') {
        return trans.__('Select another cell that corrects this cell...');
      }
      return '';
    },
    execute: async (cell: Partial<Rubric.Cell>) => {
      if (!commands.isEnabled(CommandIDs.add, cell)) {
        return;
      }

      const id = cell.id!;
      const is = cell.is!;
      const workbook = active.workbook!;
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
        Workbook.add(workbook, { id, is, payload, reference, shared });
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
      if (!reference || id === reference?.[0]) {
        return;
      }
      if (workbook.content) {
        const { widgets } = workbook.content;
        const original = find(widgets, ({ model }) => model.id === id)!;
        await workbook.content.scrollToCell(original);
      }

      const payload = null;
      const shared = false;
      Workbook.add(workbook, { id, is, payload, reference, shared });
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.convert, {
    icon: Correxit.Icons.convert,
    isEnabled: () => {
      try {
        return !open(active.workbook);
      } catch (error) {
        return error === Correxit.NO_CORREXIT_METADATA;
      }
    },
    isVisible: () => commands.isEnabled(CommandIDs.convert),
    label: trans.__('Convert notebook to a workbook...'),
    execute: async () => {
      if (!commands.isEnabled(CommandIDs.convert)) {
        return;
      }

      const workbook = active.workbook!;
      const passphrase = await input.text({
        title: trans.__('Enter a passphrase'),
        label: trans.__('Enter a passphrase for this workbook')
      });
      if (passphrase) {
        await Workbook.convert(workbook, passphrase);
        await workbook.context.save();
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.correct, {
    icon: Correxit.Icons.correct,
    isEnabled: (args: Partial<Rubric.Cell> & CellToolbar) => {
      const rubric = open(active.workbook, quiet);
      const id = resolve(args);
      if (args[Correxit.CELL_TOOLBAR] && !id) {
        return false;
      }
      return !!rubric && (id ? has(rubric, id) : size(rubric) > 0);
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
      const fetch = (handle: Credentials): Promise<Headless> =>
        commands.execute(CommandIDs.fetch, handle);
      const workbook = handle ? await fetch(handle) : active.workbook;
      if (!workbook) {
        return { score: Rubric.UNSCORED, spec: null };
      }

      const id = resolve(args);
      if (args[Correxit.CELL_TOOLBAR] && !id) {
        return { score: Rubric.UNSCORED, spec: null };
      }

      const result = await correct(workbook, id);
      if (handle) {
        workbook.context.dispose();
        return result;
      }

      const unscored = result.score === Rubric.UNSCORED;
      const [x, y] = result.score;
      void showDialog({
        title: trans.__('Computed score'),
        body: unscored ? trans.__('Unscored') : trans.__('%1 of %2', x, y)
      });
      workbook.content!.scrollToCell(workbook.content!.activeCell!);
    }
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
            description: trans.__('Path for Correxit workbook')
          }
        }
      }
    },
    execute: async (args: Partial<Credentials>) => {
      const fetch = async (path: string): Promise<Headless | null> => {
        const factory = new NotebookModelFactory();
        const context = new Context({ manager: services, factory, path });
        const workbook = { content: null, context };
        context.initialize(false);
        await context.ready;
        if (open(workbook, quiet)) {
          return workbook;
        }
        context.dispose();
        return null;
      }
      const access = async (
        workbook: Workbook,
        { key, passphrase, path }: Credentials
      ) => {
        const { assignee, id, locked } = open(workbook, quiet)!;
        key ||= passphrase &&
          await security.keygen(passphrase, id, assignee ?? void 0);
        try {
          void (locked && key && await unlock(workbook, key));
        } catch (error) {
          console.warn(`${CommandIDs.fetch} unlock error, ${path}`, error);
        }
        return workbook;
      }
      try {
        const handle = normalize(args);
        const workbook = handle && await fetch(handle.path);
        return workbook && access(workbook, handle);
      } catch (error) {
        console.warn(CommandIDs.fetch, error);
      }
      return null;
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.lock, {
    icon: Correxit.Icons.unlocked,
    isEnabled: () => open(active.workbook, quiet)?.locked === false,
    isVisible: () => commands.isEnabled(CommandIDs.lock),
    label: trans.__('Lock grader mode'),
    execute: async () => {
      if (!commands.isEnabled(CommandIDs.lock)) {
        return;
      }
      try {
        const workbook = active.workbook!;
        await lock(workbook);
        await workbook.context.save();
      } catch (error) {
        void showErrorMessage(trans.__('Could not lock'), error as Error);
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.multicorrect, {
    label: trans.__('Correct multiple workbooks (with the same passphrase)...'),
    execute: (handle: Partial<Credentials>): AsyncGenerator<Workbook.Grade> =>
      (async function*(handle) {
        const workbooks = await commands.execute(CommandIDs.scan, handle);
        for await (const workbook of workbooks as AsyncGenerator<Workbook>) {
          yield { ...await correct(workbook), path: workbook.context.path };
          workbook.context.dispose();

        }
      })(normalize(handle) || {})
  }));
  disposables.push(commands.addCommand(CommandIDs.remove, {
    isEnabled: ({ id }: Partial<Rubric.Cell>) => {
      const rubric = open(active.workbook, quiet);
      return !!id && !!rubric && !rubric.locked && has(rubric, id);
    },
    isVisible: cell => commands.isEnabled(CommandIDs.remove, cell),
    label: trans.__('Reset expected cell output'),
    execute: async (cell: Partial<Rubric.Cell>) => {
      if (commands.isEnabled(CommandIDs.remove, cell)) {
        Workbook.remove(active.workbook!, cell.id!);
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.replace, {
    isEnabled: ({ id }: Partial<Rubric.Cell>) => {
      const rubric = open(active.workbook, quiet);
      if (!rubric || rubric.locked || !id) {
        return false;
      }

      const cells = active.workbook?.context.model.sharedModel.cells || [];
      const code = find(cells, cell => cell.id === id)?.cell_type === 'code';
      return code && !has(rubric, id, deep) || has(rubric, id);
    },
    label: (cell: Partial<Rubric.Cell>) =>
      commands.isEnabled(CommandIDs.replace, cell) ?
        trans.__('Replace workbook cell in rubric') : '',
    execute: async ({ id, is }: Partial<Rubric.Cell>) => {
      if (!commands.isEnabled(CommandIDs.replace, { id, is })) {
        return;
      }
      const rubric = open(active.workbook, quiet)!;
      const replace = is && get(rubric, id!)?.is !== is;
      await commands.execute(CommandIDs.remove, { id });
      if (replace) {
        await commands.execute(CommandIDs.add, { id, is });
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.reset, {
    icon: notebookIcon,
    isEnabled: () => open(active.workbook, quiet)?.locked === false,
    isVisible: () => commands.isEnabled(CommandIDs.reset),
    caption: 'Delete workbook metadata, leave notebook cells unmodified',
    label: trans.__('Revert to notebook...'),
    execute: async () => {
      if (!commands.isEnabled(CommandIDs.reset)) {
        return;
      }
      const title = trans.__('Revert to notebook');
      const body = commands.caption(CommandIDs.reset);
      const workbook = active.workbook!;
      const { button } = await showDialog({ body, title });
      if (button.accept) {
        await Workbook.reset(workbook);
        await workbook.context.save();
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
      (async function*(directory) {
        const notebook = ({ type }: Contents.IModel) => type === 'notebook';
        let response: Contents.IModel;
        try {
          response = await services.contents.get(directory);
        } catch (error) {
          console.warn(CommandIDs.scan, directory, error);
          return;
        }
        if (response.type !== 'directory') {
          console.warn(CommandIDs.scan, directory, 'not a directory');
          return;
        }
        for (const { path } of filter(response.content, notebook)) {
          const file = { ...handle, path };
          const fetched = await commands.execute(CommandIDs.fetch, file);
          if (fetched) {
            yield fetched as Headless;
          }
        }
      })(handle.path || '.')
  }));
  disposables.push(commands.addCommand(CommandIDs.toggle, {
    icon: (args: Partial<Rubric.Cell & CellToolbar>) => {
      if (!commands.isEnabled(CommandIDs.toggle, args)) {
        return void 0;
      }

      const { shared } = Rubric.get(open(active.workbook)!, resolve(args))!;
      return shared ? Correxit.Icons.shared : Correxit.Icons.secret;
    },
    isEnabled: (args: Partial<Rubric.Cell & CellToolbar>) => {
      const rubric = open(active.workbook, quiet);
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

      const { shared } = Rubric.get(open(active.workbook)!, resolve(args))!;
      return shared
        ? trans.__('Allow correction only in grader mode')
        : trans.__('Allow correction in all modes');
    },
    execute: async (args: Partial<Rubric.Cell>) => {
      if (commands.isEnabled(CommandIDs.toggle, args)) {
        toggle(active.workbook!, resolve(args));
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.unlock, {
    icon: Correxit.Icons.key,
    isEnabled: () => open(active.workbook, quiet)?.locked ?? false,
    isVisible: () => commands.isEnabled(CommandIDs.unlock),
    label: trans.__('Unlock grader mode...'),
    usage: `
The command execute args type is: { passphrase?: string }

If no passphrase is provided, the command invokes a user prompt dialog. The
returned promise never rejects. The command invokes an error message dialog if
unlock fails.
    `,
    execute: async ({ passphrase }: { passphrase?: string }) => {
      if (!commands.isEnabled(CommandIDs.unlock)) {
        return;
      }
      const workbook = active.workbook!;
      try {
        passphrase ||= await input.text({
          title: trans.__('Enter a passphrase to unlock'),
          label: trans.__('Enter a passphrase to unlock this workbook')
        });
        if (!passphrase) {
          return;
        }

        const { assignee, id } = open(workbook, quiet)!;
        await Workbook.unlock(
          workbook,
          await security.keygen(passphrase, id, assignee ?? void 0)
        );
        await workbook.context.save();
      } catch (error) {
        const file = PathExt.basename(workbook.context.path);
        void showErrorMessage(
          trans.__('Could not unlock %1', file),
          error as Error
        );
      }
    }
  }));
  return disposables;
}

/**
 * A utility hook for collecting the output of an async generator command.
 *
 * @param commands - the command registry.
 * @param id - the command ID.
 * @param args - the (optional) command args.
 * @returns a tuple, the collected list and whether the generator is done.
 *
 * #### Notes
 * This utility will work with any command that returns an async generator,
 * generator, or any other iterable. But its primary use case is with async
 * generators, because the collected list is updated with every yield and allows
 * a component to display the list as it grows.
 *
 * If the command `id` is an empty string, an empty generator is returned.
 */
export function collect<T>(commands: CommandRegistry, id: string, args = {}) {
  const [list, setList] = useState([] as T[]);
  const [done, setDone] = useState(false);
  useEffect((disposed = false) => {
    (async generator => {
      for await (const item of await generator) {
        if (disposed) {
          return;
        }
        setList(list => list.concat(item));
      }
      setDone(true);
    })(id ? commands.execute(id, args) as Promise<Iterable<T>> : []);
    return () => void (disposed = true);
  }, [id, JSON.stringify(args)]);
  return [list, done] as [T[], boolean];
}

export function normalize(
  credentials: Partial<Workbook.Credentials>
): Workbook.Credentials | null {
  const { key, passphrase, path } = credentials;
  if (key && passphrase || !path) {
    return null;
  }
  return {
    key: key || null, passphrase: passphrase || null, path
  } as Workbook.Credentials;
}
