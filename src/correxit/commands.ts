import { showDialog, showErrorMessage } from '@jupyterlab/apputils';
import { PathExt } from '@jupyterlab/coreutils';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { checkIcon, lockIcon, notebookIcon } from '@jupyterlab/ui-components';
import { find } from '@lumino/algorithm';
import { CommandRegistry } from '@lumino/commands';
import { Correxit } from '.';
import * as input from './input';
import { digest } from './security';

export function addCommands(options: {
  commands: CommandRegistry;
  source: Correxit.Source;
  translator: ITranslator | null;
}) {
  type CellCommandArgs = Partial<Correxit.Workbook.Cell>;
  type CorrectCommandArgs = CellCommandArgs & {
    toolbar?: boolean;
  };
  const { commands, source, translator } = options;
  const active: { workbook: Correxit.Workbook | null } = { workbook: null };
  const trans = (translator || nullTranslator).load('correxit');
  const { CommandIDs } = Correxit;
  const { has, size } = Correxit.Rubric;
  const { Cell } = Correxit.Workbook;
  const deep = true;
  const quiet = true;

  // Update the active workbook when the source emits.
  void (async () => {
    for await (const { payload } of source) {
      active.workbook = payload;
    }
  })();

  const validate = {
    [CommandIDs.add]: ({ id, is, reference }: CellCommandArgs) => {
      const cells = active.workbook?.content.model?.cells || [];
      const model = find(cells, cell => Cell.id(cell) === id);
      const rubric = Correxit.open(active.workbook, { quiet });
      return (
        !!id &&
        !!is &&
        !!model &&
        !!rubric &&
        !rubric.locked &&
        !has(rubric, id, deep) &&
        !(reference && has(rubric, reference, deep)) &&
        id !== reference &&
        model.type === 'code'
      );
    },
    [CommandIDs.convert]: () => {
      try {
        return !Correxit.open(active.workbook);
      } catch (error) {
        return error === Correxit.NO_CORREXIT_METADATA;
      }
    },
    [CommandIDs.correct]: ({ id }: CellCommandArgs) => {
      const rubric = Correxit.open(active.workbook, { quiet: true });
      if (!rubric) {
        return false;
      }
      if (!id) {
        return size(rubric) > 0;
      }

      const model = active.workbook!.content.activeCell?.model;
      if (!model || Cell.id(model) !== id || model.type !== 'code') {
        return false;
      }
      return has(rubric, id);
    },
    [CommandIDs.lock]: () =>
      Correxit.open(active.workbook, { quiet })?.locked === false,
    [CommandIDs.remove]: ({ id }: CellCommandArgs) => {
      const rubric = Correxit.open(active.workbook, { quiet });
      return !!id && !!rubric && !rubric.locked && has(rubric, id);
    },
    [CommandIDs.toggle]: ({ id }: CellCommandArgs) => {
      const rubric = Correxit.open(active.workbook, { quiet });
      return !!id && !!rubric && !rubric.locked && has(rubric, id);
    },
    [CommandIDs.reset]: () =>
      Correxit.open(active.workbook, { quiet })?.locked === false,
    [CommandIDs.unlock]: () =>
      Correxit.open(active.workbook!, { quiet })?.locked ?? false
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
        const workbook = active.workbook!;

        let rubric: Correxit.Rubric<'unlocked'> | undefined;
        if (is === 'answerable') {
          const expected = await input.answer({
            title: trans.__('Add expected output'),
            label: commands.label(CommandIDs.add, cell)
          });
          if (!expected) {
            return;
          }
          const payload = [await digest(expected)];
          rubric = await Correxit.add(workbook, { id, is, payload });
        }

        if (is !== 'comparable' && is !== 'correctable') {
          return;
        }
        if (cell.reference) {
          rubric = await Correxit.add(workbook, { ...cell, id, is });
        }
        const selected = await input.cell(workbook);
        if (selected) {
          const { widgets } = workbook.content;
          const reference = Correxit.Workbook.Cell.id(selected, true);
          const original = find(widgets, ({ model }) => Cell.id(model) === id)!;
          await workbook.content.scrollToCell(original);
          rubric = await Correxit.add(workbook, { ...cell, id, is, reference });
        }
        commands.notifyCommandChanged(CommandIDs.correct);
        return rubric;
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
        const workbook = active.workbook!;
        const key = await input.passphrase({
          title: trans.__('Enter a passphrase'),
          label: trans.__('Enter a passphrase for this workbook')
        });
        if (key) {
          const rubric = await Correxit.convert(workbook, key);
          await workbook.context.save();
          commands.notifyCommandChanged(CommandIDs.correct);
          return rubric;
        }
      }
    }),
    commands.addCommand(CommandIDs.correct, {
      icon: checkIcon,
      isEnabled: validate[CommandIDs.correct],
      isVisible: validate[CommandIDs.correct],
      label: ({ id, toolbar }: CorrectCommandArgs) => {
        if (!validate[CommandIDs.correct]({ id }) || toolbar) {
          return '';
        }
        return id
          ? trans.__('Correct cell...')
          : trans.__('Correct workbook...');
      },
      execute: async ({ id }: CellCommandArgs) => {
        if (!validate[CommandIDs.correct]({ id: id ?? '' })) {
          return;
        }
        const workbook = active.workbook!;
        workbook.content.scrollToCell(workbook.content.activeCell!);
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
          const workbook = active.workbook!;
          const rubric = await Correxit.lock(workbook);
          await workbook.context.save();
          commands.notifyCommandChanged(CommandIDs.correct);
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
          const rubric = await Correxit.remove(active.workbook!, cell.id!);
          commands.notifyCommandChanged(CommandIDs.correct);
          return rubric;
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
        const workbook = active.workbook!;
        const { button } = await showDialog({ body, title });
        if (button.accept) {
          await Correxit.reset(workbook);
          await workbook.context.save();
          commands.notifyCommandChanged(CommandIDs.correct);
        }
      }
    }),
    commands.addCommand(CommandIDs.toggle, {
      isEnabled: validate[CommandIDs.toggle],
      isVisible: validate[CommandIDs.toggle],
      label: ({ id }: CellCommandArgs) => {
        if (!id || !validate[CommandIDs.toggle]({ id })) {
          return '';
        }
        const rubric = Correxit.open(active.workbook)!;
        const cell = Correxit.Rubric.get(rubric, id)!;
        return cell.shared
          ? trans.__('Allow correction only in grader mode')
          : trans.__('Allow correction in all modes');
      },
      execute: async (cell: CellCommandArgs) => {
        if (validate[CommandIDs.toggle](cell)) {
          const rubric = await Correxit.toggle(active.workbook!, cell.id!);
          commands.notifyCommandChanged(CommandIDs.correct);
          return rubric;
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
        const workbook = active.workbook!;
        try {
          key ||= await input.passphrase({
            title: trans.__('Enter a passphrase to unlock'),
            label: trans.__('Enter a passphrase to unlock this workbook')
          });
          if (!key) {
            return null;
          }
          const rubric = await Correxit.unlock(workbook, key);
          await workbook.context.save();
          commands.notifyCommandChanged(CommandIDs.correct);
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
    })
  ];
}
