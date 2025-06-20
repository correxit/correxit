import {
  InputDialog,
  showDialog,
  showErrorMessage
} from '@jupyterlab/apputils';
import { PathExt } from '@jupyterlab/coreutils';
import { lockIcon, notebookIcon } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import { Correxit } from '../correxit';
import { digest, keygen } from '../correxit/security';
import { Sidebar } from '.';
import { find } from '@lumino/algorithm';

export function addCommands(commands: CommandRegistry, sidebar: Sidebar) {
  type CellCommandArgs = Partial<Correxit.Workbook.Cell>;
  const { CommandIDs } = Sidebar;
  const { has, size } = Correxit.Rubric;
  const { Cell } = Correxit.Workbook;
  const { trans } = sidebar;
  const quiet = true;
  const validate = {
    [CommandIDs.add]: ({ id, is, reference }: CellCommandArgs) => {
      const rubric = Correxit.open(sidebar.workbook, { quiet });
      const cells = sidebar.workbook?.content.model?.cells || [];
      const model = find(cells, cell => Cell.id(cell) === id);
      if (!id || !is || !model || !rubric || rubric.locked) {
        return false;
      }
      if (has(rubric, id) || (reference && has(rubric, reference))) {
        return false;
      }
      return id !== reference && model.type === 'code';
    },
    [CommandIDs.convert]: () => {
      const model = sidebar.workbook?.content.model;
      return !!(model && !model.getMetadata('correxit'));
    },
    [CommandIDs.correct]: ({ id }: CellCommandArgs) => {
      const rubric = Correxit.open(sidebar.workbook, { quiet: true });
      if (!rubric) {
        return false;
      }
      if (!id) {
        return size(rubric) > 0;
      }
      const model = sidebar.workbook!.content.activeCell?.model;
      return Cell.id(model) === id && model?.type === 'code' && has(rubric, id);
    },
    [CommandIDs.lock]: () =>
      Correxit.open(sidebar.workbook, { quiet })?.locked === false,
    [CommandIDs.remove]: ({ id }: CellCommandArgs) => {
      const { has } = Correxit.Rubric;
      const rubric = Correxit.open(sidebar.workbook, { quiet });
      return !!id && !!rubric && !rubric.locked && has(rubric, id);
    },
    [CommandIDs.toggle]: ({ id }: CellCommandArgs) => {
      const { has } = Correxit.Rubric;
      const rubric = Correxit.open(sidebar.workbook, { quiet });
      const shallow = true;
      if (!id || !rubric || rubric.locked || !has(rubric, id, shallow)) {
        return false;
      }
      const cell = rubric.secret.cells[id] || rubric.shared.cells[id];
      console.log(rubric, cell, id);
      return cell.is === 'answerable';
    },
    [CommandIDs.reset]: () =>
      Correxit.open(sidebar.workbook, { quiet })?.locked === false,
    [CommandIDs.unlock]: () =>
      Correxit.open(sidebar.workbook!, { quiet })?.locked ?? false
  };
  return [
    commands.addCommand(CommandIDs.add, {
      isEnabled: validate[CommandIDs.add],
      isVisible: validate[CommandIDs.add],
      label: (cell: CellCommandArgs) => {
        if (!validate[CommandIDs.add](cell)) {
          return '';
        }
        if (cell.is === 'answerable') {
          return trans.__('Expect output of this cell to match answer...');
        }
        if (cell.is === 'comparable') {
          if (cell.id && cell.reference) {
            return trans.__("Select this cell's output as expected value");
          }
          return trans.__('Select another cell for comparing cell output...');
        }
        if (cell.is === 'correctable') {
          if (cell.id && cell.reference) {
            return trans.__('Select this cell for correction');
          }
          return trans.__('Select another cell that corrects this cell...');
        }
        return '';
      },
      execute: async (cell: CellCommandArgs) => {
        if (!validate[CommandIDs.add](cell)) {
          return;
        }
        const id = cell.id!;
        const is = cell.is!;
        const { reference } = cell;
        const workbook = sidebar.workbook!;
        if (is === 'answerable') {
          const expected = await Private.prompt({
            title: trans.__('Add expected output'),
            label: commands.label(CommandIDs.add, cell)
          });
          if (!expected) {
            return;
          }
          const payload = [await digest(expected)];
          return Correxit.add(workbook, { id, is, payload });
        }
        if (is === 'comparable' || is === 'correctable') {
          if (reference) {
            sidebar.waiting = null;
            return Correxit.add(workbook, { ...cell, id, is });
          }
          const { button } = await showDialog({
            title: trans.__('Select another cell to continue'),
            body: trans.__('Select another cell for comparing or correcting')
          });
          if (button.accept) {
            sidebar.waiting = id;
          }
        }
      }
    }),
    commands.addCommand(CommandIDs.convert, {
      isEnabled: validate[CommandIDs.convert],
      isVisible: validate[CommandIDs.convert],
      label: trans.__('Convert notebook to a workbook...'),
      execute: async () => {
        if (!validate[CommandIDs.convert]()) {
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
      isEnabled: validate[CommandIDs.correct],
      isVisible: validate[CommandIDs.correct],
      label: ({ id }: CellCommandArgs) =>
        id ? trans.__('Correct cell...') : trans.__('Correct workbook...'),
      execute: async ({ id }: CellCommandArgs) => {
        if (!validate[CommandIDs.correct]({ id: id ?? '' })) {
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
      isEnabled: validate[CommandIDs.lock],
      isVisible: validate[CommandIDs.lock],
      label: trans.__('Lock grader mode (PGP encrypt)'),
      execute: async () => {
        if (!validate[CommandIDs.lock]()) {
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
      isEnabled: validate[CommandIDs.remove],
      isVisible: validate[CommandIDs.remove],
      label: trans.__('Reset expected cell output'),
      execute: async (cell: CellCommandArgs) => {
        if (validate[CommandIDs.remove](cell)) {
          return Correxit.remove(sidebar.workbook!, cell.id!);
        }
      }
    }),
    commands.addCommand(CommandIDs.reset, {
      icon: notebookIcon,
      isEnabled: validate[CommandIDs.reset],
      isVisible: validate[CommandIDs.reset],
      caption: 'Delete workbook metadata, leave notebook cells unmodified',
      label: trans.__('Revert to notebook (delete workbook metadata)...'),
      execute: async () => {
        if (!validate[CommandIDs.reset]()) {
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
    commands.addCommand(CommandIDs.toggle, {
      isEnabled: validate[CommandIDs.toggle],
      isVisible: validate[CommandIDs.toggle],
      label: (cell: CellCommandArgs) => {
        return cell.shared
          ? trans.__('Only allow correction in grader mode')
          : trans.__('Allow correction when workbook is locked');
      },
      execute: async (cell: CellCommandArgs) => {
        if (validate[CommandIDs.toggle](cell)) {
          return Correxit.remove(sidebar.workbook!, cell.id!);
        }
      }
    }),
    commands.addCommand(CommandIDs.unlock, {
      icon: lockIcon,
      isEnabled: validate[CommandIDs.unlock],
      isVisible: validate[CommandIDs.unlock],
      label: trans.__('Unlock grader mode (PGP decrypt)...'),
      usage: `
The command execute args type is: { key?: string }

If no key is provided, the command invokes a user prompt dialog.

The command execute return type is: Promise<Rubric<"unlocked"> | null>
The returned promise never rejects.

The command invokes an error message dialog if unlock fails.
      `,
      execute: async ({ key }: { key?: string }) => {
        if (!validate[CommandIDs.unlock]()) {
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
