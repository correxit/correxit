import {
  InputDialog,
  showDialog,
  showErrorMessage
} from '@jupyterlab/apputils';
import { ICellModel } from '@jupyterlab/cells';
import { PathExt } from '@jupyterlab/coreutils';
import { lockIcon, notebookIcon } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import { Correxit } from '../correxit';
import { keygen } from '../correxit/security';
import { Sidebar } from '.';

export function addCommands(commands: CommandRegistry, sidebar: Sidebar) {
  const { CommandIDs } = Sidebar;
  const { has, size } = Correxit.Rubric;
  const { trans } = sidebar;
  const quiet = true;
  const enabled = {
    [CommandIDs.add]: ({ id, is }: Partial<Correxit.Workbook.Cell>) => {
      const rubric = Correxit.open(sidebar.workbook, { quiet });
      const model = sidebar.workbook?.content.activeCell?.model;
      if (!id || !is || !model || !rubric || rubric.locked) {
        return false;
      }
      return model.id === id && model.type === 'code' && !has(rubric, id);
    },
    [CommandIDs.convert]: () => {
      const model = sidebar.workbook?.content.model;
      return !!(model && !model.getMetadata('correxit'));
    },
    [CommandIDs.correct]: ({ id }: Partial<Correxit.Workbook.Cell>) => {
      const rubric = Correxit.open(sidebar.workbook, { quiet: true });
      if (!rubric) {
        return false;
      }
      if (!id) {
        return size(rubric) > 0;
      }
      const model = sidebar.workbook!.content.activeCell?.model;
      return model?.id === id && model.type === 'code' && has(rubric, id);
    },
    [CommandIDs.lock]: () =>
      Correxit.open(sidebar.workbook, { quiet })?.locked === false,
    [CommandIDs.remove]: ({ id }: Partial<Correxit.Workbook.Cell>) => {
      const { has } = Correxit.Rubric;
      const rubric = Correxit.open(sidebar.workbook, { quiet });
      return !!id && !!rubric && !rubric.locked && has(rubric, id);
    },
    [CommandIDs.reset]: () =>
      Correxit.open(sidebar.workbook, { quiet })?.locked === false,
    [CommandIDs.unlock]: () =>
      Correxit.open(sidebar.workbook!, { quiet })?.locked ?? false
  };
  return [
    commands.addCommand(CommandIDs.add, {
      isEnabled: enabled[CommandIDs.add],
      isVisible: enabled[CommandIDs.add],
      label: (cell: Partial<Correxit.Workbook.Cell>) => {
        const waiting = sidebar.hasClass(Sidebar.WAITING);
        if (cell.is === 'answerable') {
          return trans.__('Expect output of this cell to match answer...');
        }
        if (cell.is === 'comparable') {
          if (waiting) {
            trans.__("Select this cell's output as expected value");
          }
          return trans.__('Select another cell for comparing cell output...');
        }
        if (cell.is === 'correctable') {
          if (waiting) {
            trans.__('Select this cell for correction');
          }
          return trans.__('Select another cell that corrects this cell...');
        }
        return '';
      },
      execute: async (cell: Partial<Correxit.Workbook.Cell>) => {
        if (!enabled[CommandIDs.add](cell)) {
          return;
        }
        const expected = await Private.prompt({
          title: trans.__('Add expected output'),
          label: commands.label(CommandIDs.add, cell)
        });
        if (!expected) {
          return;
        }
        const id: ICellModel['id'] = cell.id!;
        const payload: Correxit.Workbook.Cell['payload'] = [];
        const workbook = sidebar.workbook!;
        workbook.content.scrollToCell(workbook.content.activeCell!);
        Correxit.add(workbook, { id, is: 'answerable', payload }, 'shared');
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
      label: ({ id }: Partial<Correxit.Workbook.Cell>) =>
        id ? trans.__('Correct cell...') : trans.__('Correct workbook...'),
      execute: async ({ id }: { id?: ICellModel['id'] }) => {
        if (!enabled[CommandIDs.correct]({ id: id ?? '' })) {
          return;
        }
        const workbook = sidebar.workbook!;
        workbook!.content.scrollToCell(workbook.content.activeCell!);
        const score = await Correxit.correct(workbook, id);
        const unscored = score === Correxit.Rubric.UNSCORED;
        const [x, y] = score;
        void showDialog({
          title: trans.__('Computed score'),
          body: unscored ? trans.__('Unscored') : trans.__('%1 of %2', x, y)
        });
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
    commands.addCommand(CommandIDs.remove, {
      isEnabled: enabled[CommandIDs.remove],
      isVisible: enabled[CommandIDs.remove],
      label: trans.__('Reset expected cell output'),
      execute: async (cell: Partial<Correxit.Workbook.Cell>) => {
        if (enabled[CommandIDs.remove](cell)) {
          return Correxit.remove(sidebar.workbook!, cell.id!);
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

namespace Private {
  export const prompt = async ({ label, title }: InputDialog.ITextOptions) => {
    const { button, value } = await InputDialog.getText({ label, title });
    return (button.accept && value && (await keygen(value))) || '';
  };
}
