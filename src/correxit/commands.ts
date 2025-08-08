import { showDialog, showErrorMessage } from '@jupyterlab/apputils';
import { PathExt } from '@jupyterlab/coreutils';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { checkIcon, lockIcon, notebookIcon } from '@jupyterlab/ui-components';
import { find } from '@lumino/algorithm';
import { CommandRegistry } from '@lumino/commands';
import { Correxit } from '.';
import * as input from './input';
import { digest, keygen } from './security';

export function addCommands(options: {
  commands: CommandRegistry;
  source: Correxit.Source;
  translator: ITranslator | null;
}) {
  const { commands, source, translator } = options;
  const active: { workbook: Correxit.Workbook | null } = { workbook: null };
  const trans = (translator || nullTranslator).load('correxit');
  const { CommandIDs } = Correxit;
  const { get, has, size } = Correxit.Rubric;
  const deep = true;
  const quiet = true;

  // Update the active workbook when the source emits.
  void (async () => {
    for await (const { payload } of source) {
      active.workbook = payload;
    }
  })();

  const disposables = [];
  disposables.push(commands.addCommand(CommandIDs.add, {
    isEnabled: ({ id, reference }: Partial<Correxit.Workbook.Cell>) => {
      const cells = active.workbook?.context.model?.cells || [];
      const model = find(cells, cell => cell.id === id);
      const rubric = Correxit.open(active.workbook, quiet);
      if (!model || !rubric || rubric.locked || !id || id === reference) {
        return false;
      }
      return model.type === 'code' && !has(rubric, id, deep);
    },
    isVisible: cell => commands.isEnabled(CommandIDs.add, cell),
    label: (cell: Partial<Correxit.Workbook.Cell>) => {
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
    execute: async (cell: Partial<Correxit.Workbook.Cell>) => {
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

        const payload = [await digest(expected)];
        const reference = null;
        const shared = false;
        return Correxit.add(workbook, { id, is, payload, reference, shared });
      }
      if (is !== 'comparable' && is !== 'correctable') {
        return;
      }

      let reference = cell.reference;
      if (!reference) {
        const selected = workbook.content && await input.cell(workbook);
        reference = selected && selected.id;
      }
      if (!reference || id === reference) {
        return;
      }
      if (workbook.content) {
        const { widgets } = workbook.content;
        const original = find(widgets, ({ model }) => model.id === id)!;
        await workbook.content.scrollToCell(original);
      }

      const payload = null;
      const shared = false;
      return Correxit.add(workbook, { id, is, payload, reference, shared });
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.convert, {
    isEnabled: () => {
      try {
        return !Correxit.open(active.workbook);
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
        const rubric = await Correxit.convert(workbook, passphrase);
        await workbook.context.save();
        return rubric;
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.correct, {
    icon: checkIcon,
    isEnabled: ({ id }: Partial<Correxit.Workbook.Cell>) => {
      const rubric = Correxit.open(active.workbook, quiet);
      return !!rubric && (id ? has(rubric, id) : size(rubric) > 0);
    },
    isVisible: ({ id }) => {
      const rubric = Correxit.open(active.workbook, quiet);
      if (!rubric) {
        return false;
      }
      if (!id) {
        return true;
      }
      const cells = active.workbook!.context.model!.cells;
      const model = find(cells, model => model.id === id)
      return model?.type === 'code';
    },
    label: ({ id }: Partial<Correxit.Workbook.Cell>) => {
      if (!Correxit.open(active.workbook, quiet)) {
        return '';
      }
      return id
        ? trans.__('Correct cell...')
        : trans.__('Correct workbook...');
    },
    execute: async ({ id }: Partial<Correxit.Workbook.Cell>) => {
      if (!commands.isEnabled(CommandIDs.correct, { id: id ?? '' })) {
        return;
      }

      const workbook = active.workbook!;
      const score = await Correxit.correct(workbook, id);
      const unscored = score === Correxit.Rubric.UNSCORED;
      const [x, y] = score;
      void showDialog({
        title: trans.__('Computed score'),
        body: unscored ? trans.__('Unscored') : trans.__('%1 of %2', x, y)
      });
      if (workbook.content) {
        workbook.content.scrollToCell(workbook.content.activeCell!);
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.lock, {
    icon: lockIcon,
    isEnabled: () =>
        Correxit.open(active.workbook, quiet)?.locked === false,
    isVisible: () => commands.isEnabled(CommandIDs.lock),
    label: trans.__('Lock grader mode'),
    execute: async () => {
      if (!commands.isEnabled(CommandIDs.lock)) {
        return;
      }
      try {
        const workbook = active.workbook!;
        const rubric = await Correxit.lock(workbook);
        await workbook.context.save();
        return rubric;
      } catch (error) {
        void showErrorMessage(trans.__('Could not lock'), error as Error);
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.remove, {
    isEnabled: ({ id }: Partial<Correxit.Workbook.Cell>) => {
      const rubric = Correxit.open(active.workbook, quiet);
      return !!id && !!rubric && !rubric.locked && has(rubric, id);
    },
    isVisible: cell => commands.isEnabled(CommandIDs.remove, cell),
    label: trans.__('Reset expected cell output'),
    execute: async (cell: Partial<Correxit.Workbook.Cell>) => {
      if (commands.isEnabled(CommandIDs.remove, cell)) {
        return Correxit.remove(active.workbook!, cell.id!);
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.replace, {
    isEnabled: ({ id }: Partial<Correxit.Workbook.Cell>) => {
      const rubric = Correxit.open(active.workbook, quiet);
      if (!rubric || rubric.locked || !id) {
        return false;
      }

      const cells = active.workbook?.context.model?.cells || [];
      const code = find(cells, cell => cell.id === id)?.type === 'code';
      return code && !has(rubric, id, deep) || has(rubric, id);
    },
    label: (cell: Partial<Correxit.Workbook.Cell>) =>
      commands.isEnabled(CommandIDs.replace, cell) ?
        trans.__('Replace workbook cell in rubric') : '',
    execute: async ({ id, is }: Partial<Correxit.Workbook.Cell>) => {
      if (!commands.isEnabled(CommandIDs.replace, { id, is })) {
        return;
      }
      const rubric = Correxit.open(active.workbook, quiet)!;
      const replace = is && get(rubric, id!)?.is !== is;
      await commands.execute(CommandIDs.remove, { id });
      if (replace) {
        await commands.execute(CommandIDs.add, { id, is });
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.reset, {
    icon: notebookIcon,
    isEnabled: () =>
      Correxit.open(active.workbook, quiet)?.locked === false,
    isVisible: () => commands.isEnabled(CommandIDs.reset),
    caption: 'Delete workbook metadata, leave notebook cells unmodified',
    label: trans.__('Revert to notebook (delete workbook metadata)...'),
    execute: async () => {
      if (!commands.isEnabled(CommandIDs.reset)) {
        return;
      }
      const title = trans.__('Revert to notebook');
      const body = commands.caption(CommandIDs.reset);
      const workbook = active.workbook!;
      const { button } = await showDialog({ body, title });
      if (button.accept) {
        await Correxit.reset(workbook);
        await workbook.context.save();
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.toggle, {
    isEnabled: ({ id }: Partial<Correxit.Workbook.Cell>) => {
      const rubric = Correxit.open(active.workbook, quiet);
      return !!id && !!rubric && !rubric.locked && has(rubric, id);
    },
    isVisible: cell => commands.isEnabled(CommandIDs.toggle, cell),
    label: ({ id }: Partial<Correxit.Workbook.Cell>) => {
      if (!id || !commands.isEnabled(CommandIDs.toggle, { id })) {
        return '';
      }
      const rubric = Correxit.open(active.workbook)!;
      const cell = Correxit.Rubric.get(rubric, id)!;
      return cell.shared
        ? trans.__('Allow correction only in grader mode')
        : trans.__('Allow correction in all modes');
    },
    execute: async (cell: Partial<Correxit.Workbook.Cell>) => {
      if (commands.isEnabled(CommandIDs.toggle, cell)) {
        return Correxit.toggle(active.workbook!, cell.id!);
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.unlock, {
    icon: lockIcon,
    isEnabled: () =>
      Correxit.open(active.workbook, quiet)?.locked ?? false,
    isVisible: () => commands.isEnabled(CommandIDs.unlock),
    label: trans.__('Unlock grader mode...'),
    usage: `
The command execute args type is: { passphrase?: string }

If no passphrase is provided, the command invokes a user prompt dialog.

The command execute return type is: Promise<Rubric.Unlocked | null>
The returned promise never rejects.

The command invokes an error message dialog if unlock fails.
    `,
    execute: async ({ passphrase }: { passphrase?: string }) => {
      if (!commands.isEnabled(CommandIDs.unlock)) {
        return null;
      }
      const workbook = active.workbook!;
      try {
        passphrase ||= await input.text({
          title: trans.__('Enter a passphrase to unlock'),
          label: trans.__('Enter a passphrase to unlock this workbook')
        });
        if (!passphrase) {
          return null;
        }

        const opened = Correxit.open(workbook, quiet)!;
        const key = await keygen(passphrase, opened.id);
        const rubric = await Correxit.unlock(workbook, key);
        await workbook.context.save();
        return rubric;
      } catch (error) {
        const file = PathExt.basename(workbook.context.path);
        void showErrorMessage(
          trans.__('Could not unlock %1', file),
          error as Error
        );
        return null;
      }
    }
  }));
  return disposables;
}
