import { JupyterFrontEnd } from '@jupyterlab/application';
import { Dialog, showDialog, showErrorMessage } from '@jupyterlab/apputils';
import { PathExt } from '@jupyterlab/coreutils';
import { NotebookModelFactory } from '@jupyterlab/notebook';
import { IRenderMime } from '@jupyterlab/rendermime';
import { ITranslator } from '@jupyterlab/translation';
import { find } from '@lumino/algorithm';
import { Correxit, Rubric, Workbook } from '..';
import { Propagator } from '../ui/propagator';
import * as input from './input';
import * as io from './io';
import * as nbgrader from './nbgrader';
import * as propagator from './propagator';
import * as security from './security';
import * as state from './state';

export namespace CommandIDs {
  export const assign = 'correxit:assign';
  export const certify = 'correxit:certify';
  export const comment = 'correxit:comment';
  export const configure = 'correxit:configure';
  export const convert = 'correxit:convert';
  export const correct = 'correxit:correct';
  export const dereference = 'correxit:dereference';
  export const draft = 'correxit:draft';
  export const enroll = 'correxit:enroll';
  export const fetch = 'correxit:fetch';
  export const inject = 'correxit:inject';
  export const intervene = 'correxit:intervene';
  export const lock = 'correxit:lock';
  export const propagate = 'correxit:propagate';
  export const refer = 'correxit:refer';
  export const remove = 'correxit:remove';
  export const reset = 'correxit:reset';
  export const revise = 'correxit:revise';
  export const reweight = 'correxit:reweight';
  export const save = 'correxit:save';
  export const share = 'correxit:share';
  export const submit = 'correxit:submit';
  export const track = 'correxit:track';
  export const unassign = 'correxit:unassign';
  export const unlock = 'correxit:unlock';
}

type Assignment = Rubric.Assignment;
type Cell = Rubric.Cell;
type CellToolbar = Rubric.Cell.Toolbar;
type Credentials = Workbook.Credentials;
type Headless = Workbook.Headless;
type Reified =
  { handle: Credentials | null; rubric: null; workbook: null; } |
  { handle: Credentials | null; rubric: null; workbook: Workbook; } |
  { handle: Credentials | null; rubric: Rubric; workbook: Workbook; };

const { get, has, size } = Rubric;
const {
  acknowledge, add, assign, certify, collect, comment, convert, correct,
  dereference, draft, intervene, lock, refer, remove, reset, revise, reweight,
  submit, toggle
} = Workbook;
const { normalize } = Workbook.Credentials;

export function commands(
  app: JupyterFrontEnd,
  utilities: {
    collector: Correxit.Collector;
    consumer: Correxit.Consumer;
    injector: Correxit.Injector;
    registrar: Correxit.Registrar;
    submitter: Correxit.Submitter;
    translator: ITranslator;
    unlocker: Correxit.Unlocker;
  }
) {
  const { commands, serviceManager: manager, shell } = app;
  const { Icons } = Correxit;
  const {
    collector, consumer, injector, registrar, submitter, unlocker
  } = utilities;
  const trans = utilities.translator.load('correxit');
  const factory = new NotebookModelFactory();
  const fetch = (handle: Credentials, silent = false) =>
    io.request(handle, factory, manager, unlocker, silent);
  const open = (workbook: Workbook | null) => Workbook.open(workbook, true);
  const reify = async (args: Partial<Credentials>): Promise<Reified> => {
    const handle = normalize(args);
    const workbook = handle ? await fetch(handle) : state.workbook();
    const rubric = open(workbook);
    return { handle, rubric, workbook } as Reified;
  };
  const disposables = [];
  disposables.push(commands.addCommand(CommandIDs.assign, {
    icon: Icons.assignment,
    isEnabled: () => open(state.workbook())?.locked === false,
    isVisible: () => commands.isEnabled(CommandIDs.assign),
    label: trans.__('Assign workbook...'),
    execute: async (args: Partial<Credentials & Assignment>) => {
      const { rubric, workbook } = await reify(args);
      if (!rubric) return;
      await assign(workbook, args);
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.unassign, {
    icon: Icons.remove,
    isEnabled: () => {
      const rubric = open(state.workbook());
      return !!rubric && !rubric.locked && !!rubric.assignment.assignee;
    },
    isVisible: () => commands.isEnabled(CommandIDs.unassign),
    label: trans.__('Clear assignee'),
    execute: async (args: Partial<Credentials>) => {
      const { rubric, workbook } = await reify(args);
      if (!rubric) return;
      const title = trans.__('Clear assignee');
      const body = trans.__(
        'Clear assignee "%1"?', rubric.assignment.assignee
      );
      const { button } = await showDialog({ body, title });
      if (!button.accept) return;
      await assign(workbook, { assignee: '' });
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.certify, {
    icon: Icons.certify,
    isEnabled: () => {
      const rubric = open(state.workbook());
      const assigned = !!rubric?.assignment.assignee;
      return assigned && !rubric.locked;
    },
    label: trans.__('Certify workbook...'),
    execute: async (args: Partial<Credentials>) => {
      const { rubric, workbook } = await reify(args);
      if (!rubric || rubric.locked || !rubric.assignment.assignee) return;
      try {
        const certified = await certify(workbook);
        const receipt = await collector(certified);
        await collect(workbook, receipt);
        await commands.execute(CommandIDs.save, { ...args, undo: false });
      } catch (error) {
        void showErrorMessage(trans.__('Could not certify'), error as Error);
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.comment, {
    label: trans.__('Comment on cell'),
    execute: async (args: Partial<Cell & { comment: string; }>) => {
      const workbook = state.workbook();
      const id = state.cell(args);
      const rubric = open(workbook);
      if (!workbook || !id || !rubric) return;
      await comment(workbook, id, args.comment || '');
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.configure, {
    className: 'correxit-configure',
    icon: ({ is }: Partial<Cell>) => is && Icons[is] || undefined,
    isEnabled: (args: Partial<Cell & CellToolbar>) => {
      const notebook = state.workbook()?.context.model.sharedModel;
      const id = state.cell(args);
      const cell = find(notebook?.cells || [], cell => cell.id === id);
      const references = args.references;
      const rubric = open(state.workbook());
      if (!cell || !rubric || !id || references?.includes(id)) return false;
      if (rubric.locked || rubric.assignment.assignee) return false;
      if (has(rubric, id)) return get(rubric, id)?.is === args.is;

      const code = cell.cell_type === 'code';
      if (!code) return args.is === 'reviewable';
      return !(id in rubric.references);
    },
    isToggled: (args: Partial<Cell>) => {
      const id = state.cell(args);
      const rubric = open(state.workbook());
      return !!rubric && !!id && get(rubric, id)?.is === args.is;
    },
    isVisible: (args: Partial<Cell>) => {
      const id = state.cell(args);
      const rubric = open(state.workbook());
      if (!id || !rubric) return false;
      if (rubric.locked || rubric.assignment.assignee) return false;
      if (has(rubric, id)) return get(rubric, id)?.is === args.is;
      return commands.isEnabled(CommandIDs.configure, args);
    },
    caption: (cell: Partial<Cell>) => {
      if (cell.is === 'answerable') return trans.__('Has known answer');
      if (cell.is === 'comparable') return trans.__('Compares to reference');
      if (cell.is === 'correctable') return trans.__('Executes correction');
      if (cell.is === 'reviewable') return trans.__('Needs manual review');
      return '';
    },
    label: (cell: Partial<Cell>) => {
      if (cell.is === 'answerable') return trans.__('Answer');
      if (cell.is === 'comparable') return trans.__('Compare');
      if (cell.is === 'correctable') return trans.__('Correct');
      if (cell.is === 'reviewable') return trans.__('Manual');
      return '';
    },
    execute: async (args: Partial<Cell & Credentials>) => {
      const { rubric, workbook } = await reify(args);
      const id = state.cell(args);
      const is = args.is;
      if (!rubric || !id || !is) return;

      const confirm = () => showDialog({
        title: trans.__('Reset cell configuration?'),
        body: trans.__('Do you want to replace the existing configuration?'),
        buttons: [
          Dialog.cancelButton({ label: trans.__('No') }),
          Dialog.okButton({ label: trans.__('Yes') })
        ]
      });
      if (has(rubric, id)) {
        if (!(await confirm()).button.accept) return;
        remove(workbook, id);
      }
      if (is === 'answerable') {
        const expected = await input.text({
          title: trans.__('Enter expected cell output'),
          label: commands.label(CommandIDs.configure, args)
        });
        if (!expected) return;

        const payload = [await security.digest(expected)];
        const points = 1;
        const references = null;
        await add(workbook, { id, is, payload, points, references });
        return;
      }
      if (is === 'reviewable') {
        const payload = null;
        const points = 1;
        const references = null;
        await add(workbook, { id, is, payload, points, references });
        return;
      }
      if (is !== 'comparable' && is !== 'correctable') return;

      let references: string[] | null = args.references || null;
      if (!references) {
        const selected = workbook.content && await input.cell(workbook);
        references = selected && [selected.id];
      }
      if (!references || references.includes(id)) return;
      if (workbook.content) {
        const { widgets } = workbook.content;
        const original = find(widgets, ({ model }) => model.id === id);
        if (original) await workbook.content.scrollToCell(original);
      }

      const payload = null;
      const points = 1;
      await add(
        workbook,
        { id, is, payload, points, references },
        references.map(referent =>
          ({ cell: id, referent, points: 1, secret: true })
        )
      );
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
    label: trans.__('Convert to a workbook assignment...'),
    execute: async (args: Partial<Credentials>) => {
      const { workbook } = await reify(args);
      if (!workbook) return;

      const passphrase = await input.text({
        title: trans.__('Enter a passphrase'),
        label: trans.__('Enter a passphrase for this workbook')
      });
      if (!passphrase) return;

      await convert(workbook, passphrase, unlocker);
      const body = await nbgrader.convert(workbook, trans);
      if (!body) return;

      void showDialog({
        title: trans.__('Converted from nbgrader'),
        body,
        buttons: [Dialog.okButton()]
      });
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.correct, {
    icon: Icons.correct,
    isEnabled: (args: Partial<Cell & CellToolbar>) => {
      const workbook = state.workbook();
      const rubric = open(workbook);
      const id = state.cell(args);
      const headed = workbook && workbook.content;
      if (args[Rubric.Cell.TOOLBAR] && !id) return false;
      if (!rubric || !headed) return false;
      if (!id) return size(rubric) > 0;
      const cell = get(rubric, id);
      if (!cell || cell.is === 'reviewable') return false;
      if (!rubric.locked) return true;
      const references = Object.values(rubric.references)
        .filter(reference => reference.cell === id);
      return !references.length || references.some(
        reference => !reference.secret
      );
    },
    isVisible: args => commands.isEnabled(CommandIDs.correct, args),
    label: (args: Partial<Cell> & CellToolbar) => {
      if (!commands.isEnabled(CommandIDs.correct, args)) return '';
      return state.cell(args)
        ? trans.__('Correct cell...')
        : trans.__('Correct workbook...');
    },
    execute: async (args: Partial<Cell & Credentials & CellToolbar>) => {
      const { rubric, workbook } = await reify(args);
      if (!rubric)
        return { resolved: false, score: Rubric.Score.UNSCORED, spec: null };

      const id = state.cell(args);
      if (args[Rubric.Cell.TOOLBAR] && !id)
        return { resolved: true, score: Rubric.Score.UNSCORED, spec: null };

      const result = await correct(workbook, id);
      if (!workbook.content) return result;

      const unscored = result.score.status === 'unscored';
      const [x, y] = [result.score.points, result.score.possible];
      void showDialog({
        title: trans.__('Computed score'),
        body: unscored ? trans.__('Unscored') : trans.__('%1 of %2', x, y)
      });
      if (workbook.content.activeCell)
        workbook.content.scrollToCell(workbook.content.activeCell);
      if (rubric.locked) state.refresh();
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.dereference, {
    icon: Icons.remove,
    isEnabled: (args: Partial<{ referent: string }>) => {
      const rubric = open(state.workbook());
      if (!rubric || rubric.locked) return false;
      if (rubric.assignment.assignee) return false;
      return !!args.referent && args.referent in rubric.references;
    },
    isVisible: args =>
      commands.isEnabled(CommandIDs.dereference, args),
    label: trans.__('Remove reference'),
    execute: async (args: Partial<{ referent: string }>) => {
      const workbook = state.workbook();
      if (!workbook || !args.referent) return;
      dereference(workbook, args.referent);
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.draft, {
    isEnabled: () => {
      const rubric = open(state.workbook());
      const submitted = !!rubric?.assignment.submission;
      const certified = !!rubric?.assignment.certification;
      const sealed = !!rubric?.assignment.seal;
      return !!rubric?.locked && submitted && !certified && !sealed;
    },
    isVisible: () => commands.isEnabled(CommandIDs.draft),
    label: trans.__('Revert to draft...'),
    execute: async (args: Partial<Credentials>) => {
      const { workbook } = await reify(args);
      if (!workbook) return;
      const title = trans.__('Revert to draft');
      const body = trans.__('Revert read-only submission to draft workbook?');
      const buttons = [
        Dialog.cancelButton({ label: trans.__('Cancel') }),
        Dialog.okButton({ label: trans.__('Revert') })
      ];
      const { button } = await showDialog({ title, body, buttons });
      if (!button.accept) return;
      try {
        await draft(workbook);
        await commands.execute(CommandIDs.save, { ...args, undo: false });
      } catch (error) {
        void showErrorMessage(trans.__('Could not revert'), error as Error);
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.fetch, {
    label: trans.__('Fetch a headless Correxit workbook for a given path'),
    execute: async (args: Partial<Credentials & { silent: boolean }>):
      Promise<Headless | null> => {
      const handle = normalize(args);
      try {
        return handle && await fetch(handle, !!args.silent);
      } catch (error) {
        console.warn(CommandIDs.fetch, error);
        return null;
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.inject, {
    label: trans.__('Inject one Correxit monitor emission'),
    execute: () => (fired => {
      return (emission: Workbook | null) => {
        if (fired) return;
        fired = true;
        injector(emission);
      };
    })(false)
  }));
  disposables.push(commands.addCommand(CommandIDs.intervene, {
    label: trans.__('Manually set cell score'),
    execute: async (
      args: Partial<Cell & { intervention: Rubric.Score | null }>
    ) => {
      const workbook = state.workbook();
      const id = state.cell(args);
      const rubric = open(workbook);
      if (!workbook || !id || !rubric) return;
      if (args.intervention !== undefined)
        await intervene(workbook, id, args.intervention);
      await commands.execute(CommandIDs.save, { undo: false });
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
      if (!rubric) return;
      try {
        await lock(workbook);
        await commands.execute(CommandIDs.save, { ...args, undo: false });
      } catch (error) {
        void showErrorMessage(trans.__('Could not lock'), error as Error);
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.propagate, {
    label: () => {
      const rubric = open(state.workbook());
      if (!rubric) return '';

      const total = rubric.assignment.roster.length;
      return trans.__('Create %1 assigned workbooks...', total);
    },
    isEnabled: () => {
      const rubric = open(state.workbook());
      if (!rubric) return false;

      const { locked, assignment: { assignee, roster }} = rubric;
      return !locked && !!roster.length && !assignee;
    },
    isVisible: () => commands.isEnabled(CommandIDs.propagate),
    execute: async (
      args: Partial<Credentials>
    ): Promise<AsyncIterable<[string, Correxit.Emitter.Emission]>> => {
      const { rubric, workbook } = await reify(args);
      if (!rubric || rubric.locked) return (async function* empty() {})();
      try {
        return translate(propagator.propagate({ consumer, workbook }), trans);
      } catch (error) {
        console.warn(CommandIDs.propagate, error);
      }
      return (async function* empty() {})();
    }
  }));

  let busy = false;
  let serial = 0;
  disposables.push(commands.addCommand(CommandIDs.track, {
    icon: Icons.assignment,
    label: () => commands.label(CommandIDs.propagate),
    isEnabled: () =>
      !busy && commands.isEnabled(CommandIDs.propagate),
    isVisible: () => commands.isEnabled(CommandIDs.propagate),
    execute: () => {
      if (busy) return;
      busy = true;
      commands.notifyCommandChanged(CommandIDs.track);

      const rubric = open(state.workbook());
      const name = rubric?.assignment.name || '';
      const roster = rubric?.assignment.roster.length || 0;
      const title = roster
        ? trans.__('%1 (roster: %2)', name, roster)
        : name || trans.__('Creating assigned workbooks');
      const release = () => {
        if (!busy) return;
        busy = false;
        commands.notifyCommandChanged(CommandIDs.track);
      };
      const refocus = () => shell.activateById('correxit-sidebar');
      const options = { commands, refocus, release, trans };
      const widget = new Propagator.Widget(options);
      widget.id = `correxit-propagator-${++serial}`;
      widget.title.caption = title;
      widget.title.icon = Icons.assignment;
      shell.add(widget, 'right', {});
      shell.activateById(widget.id);
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.enroll, {
    execute: async (
      args: Partial<Credentials>
    ): ReturnType<Correxit.Registrar> => {
      const { rubric, workbook } = await reify(args);
      if (!rubric) return null;

      const warn = (error: any) => {
        console.warn('enroll failed for workbook', workbook, error);
        return null;
      };
      const identifier = Workbook.identifier(workbook);
      return await registrar(workbook, identifier).catch(warn);
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.refer, {
    icon: Icons.refer,
    isEnabled: (args: Partial<Cell>) => {
      const id = state.cell(args);
      const rubric = open(state.workbook());
      if (!id || !rubric || rubric.locked) return false;
      if (rubric.assignment.assignee) return false;

      const cell = get(rubric, id);
      if (!cell) return false;
      if (cell.is === 'correctable') return true;
      return cell.is === 'comparable' && !cell.references.length;
    },
    isVisible: args => commands.isEnabled(CommandIDs.refer, args),
    label: trans.__('Add a reference cell'),
    execute: async (args: Partial<Cell>) => {
      const workbook = state.workbook();
      const id = state.cell(args);
      if (!workbook?.content || !id) return;

      const selected = await input.cell(workbook);
      if (!selected) return;

      const rubric = open(workbook);
      if (!rubric || rubric.locked) return;
      const cell = get(rubric, id);
      if (!cell) return;
      if (
        cell.is !== 'comparable' &&
        cell.is !== 'correctable'
      ) return;

      const referent = selected.id;
      if (
        referent === id ||
        referent in rubric.references ||
        referent in rubric.cells
      ) return;

      const reference = {
        cell: id,
        referent,
        points: 1,
        secret: true
      };
      await refer(workbook, id, reference);

      const { widgets } = workbook.content;
      const original = find(
        widgets, ({ model }) => model.id === id
      );
      if (original)
        await workbook.content.scrollToCell(original);
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.remove, {
    className: 'correxit-remove',
    isEnabled: (args: Partial<Cell>) => {
      const id = state.cell(args);
      const rubric = open(state.workbook());
      if (!id || !rubric || rubric.locked || rubric.assignment.assignee)
        return false;

      return has(rubric, id);
    },
    isVisible: args => commands.isEnabled(CommandIDs.remove, args),
    icon: Icons.remove,
    label: trans.__('Reset cell'),
    execute: async (args: Partial<Cell>) => {
      const workbook = state.workbook();
      const id = state.cell(args);
      if (workbook && id) remove(workbook, id);
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.reset, {
    icon: Icons.reset,
    isEnabled: () => {
      const rubric = open(state.workbook());
      return rubric?.locked === false && !rubric.assignment.assignee;
    },
    isVisible: () => commands.isEnabled(CommandIDs.reset),
    caption: trans.__('Deletes Correxit metadata, keeps notebook content'),
    label: trans.__('Revert to notebook...'),
    execute: async (args: Partial<Credentials>) => {
      const { workbook } = await reify(args);
      if (!workbook) return;

      const title = trans.__('Revert to notebook');
      const body = commands.caption(CommandIDs.reset);
      const { button } = await showDialog({ body, title });
      if (button.accept) {
        await reset(workbook);
        await commands.execute(CommandIDs.save, { ...args, undo: false });
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.reweight, {
    label: trans.__('Update points'),
    execute: async (
      args: Partial<Cell & { points: number }>
    ) => {
      const workbook = state.workbook();
      const id = args.id || state.cell(args);
      if (workbook && id && typeof args.points === 'number')
        await reweight(workbook, id, args.points);
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.save, {
    icon: Icons.save,
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
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.share, {
    icon: (args: Partial<Cell & CellToolbar>) => {
      if (!commands.isEnabled(CommandIDs.share, args)) return undefined;
      const rubric = open(state.workbook())!;
      const id = state.cell(args);
      const reference = rubric.references[id];
      return reference.secret ? Icons.secret : Icons.shared;
    },
    isEnabled: (args: Partial<Cell & CellToolbar>) => {
      const id = state.cell(args);
      const rubric = open(state.workbook());
      if (!id || !rubric || rubric.locked || rubric.assignment.assignee)
        return false;
      return id in rubric.references;
    },
    isVisible: args => commands.isEnabled(CommandIDs.share, args),
    label: (args: Partial<Cell & CellToolbar>) => {
      if (!commands.isEnabled(CommandIDs.share, args)) return '';
      const rubric = open(state.workbook())!;
      const id = state.cell(args);
      const reference = rubric.references[id];
      return reference.secret
        ? trans.__('Mode: secret')
        : trans.__('Mode: shared');
    },
    execute: async (args: Partial<Cell>) => {
      if (!commands.isEnabled(CommandIDs.share, args)) return;
      const id = state.cell(args);
      await toggle(state.workbook()!, id);
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.submit, {
    isEnabled: () => {
      const rubric = open(state.workbook());
      const locked = !!rubric?.locked;
      const assigned = !!rubric?.assignment.assignee;
      const submitted = !!rubric?.assignment.submission;
      const certified = !!rubric?.assignment.certification;
      return locked && assigned && !submitted && !certified;
    },
    isVisible: () => commands.isEnabled(CommandIDs.submit),
    label: trans.__('Submit assignment...'),
    execute: async (args: Partial<Credentials>) => {
      const { rubric, workbook } = await reify(args);
      if (!rubric) return;

      const author = rubric.assignment.keys.public.author;
      const title = trans.__('Submit assignment');
      let recipients: string[];

      const body = trans.__(
`Would you like to set a passphrase to revise your submission later?
Or do you just want to seal and submit? This document will be locked.`
      );
      const { button } = await showDialog({
        title,
        body,
        buttons: [
          Dialog.cancelButton({ label: trans.__('Cancel') }),
          Dialog.okButton({
            className: 'jp-mod-styled correxit-dialog-revert',
            label: trans.__('Submit without passphrase')
          }),
          Dialog.okButton({
            className: 'jp-mod-styled',
            label: trans.__('Set passphrase'),
            actions: ['passphrase']
          })
        ]
      });
      if (!button.accept) return;

      if (button.actions.includes('passphrase')) {
        const passphrase = await input.text({
          title: trans.__('Set a submission passphrase'),
          label: trans.__('Enter a passphrase to seal your submission')
        });
        if (!passphrase) return;

        const student = await security.keygen(passphrase, rubric.id);
        const pair = await security.keypair();
        const armored = await security.encrypt(pair.private, student);
        const keys: Rubric.Assignment.Keys = {
          private: { ...rubric.assignment.keys.private, assignee: armored },
          public: { ...rubric.assignment.keys.public, assignee: pair.public }
        };
        await Workbook.update(workbook, {
          ...rubric, assignment: { ...rubric.assignment, keys }
        } as Rubric.Locked);
        recipients = [author, pair.public];
      } else {
        recipients = [author];
      }

      try {
        const identifier = Workbook.identifier(workbook);
        if (!Workbook.Identifier.assigned(identifier)) return;
        await submit(workbook, recipients);

        const receipt = await submitter(workbook, identifier);
        await acknowledge(workbook, receipt);
        await commands.execute(CommandIDs.save, { ...args, undo: false });
      } catch (error) {
        void showErrorMessage(trans.__('Could not submit'), error as Error);
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.revise, {
    isEnabled: () => {
      const rubric = open(state.workbook());
      if (!rubric?.locked) return false;
      const { certification, keys, seal, submission } = rubric.assignment;
      return !!seal && !!submission
        && !certification && !!keys.private.assignee;
    },
    isVisible: () => commands.isEnabled(CommandIDs.revise),
    label: trans.__('Revise submission...'),
    execute: async (args: Partial<Credentials>) => {
      const { rubric, workbook } = await reify(args);
      if (!rubric?.locked) return;

      const passphrase = await input.text({
        title: trans.__('Enter your submission passphrase'),
        label: trans.__('Enter the passphrase you used when submitting')
      });
      if (!passphrase) return;

      try {
        const secret = await security.keygen(passphrase, rubric.id);
        const armored = await security.decrypt(
          rubric.assignment.keys.private.assignee!, secret
        );
        await revise(workbook, await security.parse(armored));
        await commands.execute(CommandIDs.save, { ...args, undo: false });
      } catch (error) {
        void showErrorMessage(trans.__('Could not revise'), error as Error);
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
      if (!workbook) return null;
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
): AsyncGenerator<[string, Correxit.Emitter.Emission]> {
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
  for await (const emission of emitter) {
    const message = emission && translate(emission);
    if (message) yield [message, emission];
  }
}
