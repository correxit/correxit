import { JupyterFrontEnd } from '@jupyterlab/application';
import { Dialog, showDialog, showErrorMessage } from '@jupyterlab/apputils';
import { PathExt } from '@jupyterlab/coreutils';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { FileDialog } from '@jupyterlab/filebrowser';
import { INotebookContent } from '@jupyterlab/nbformat';
import { NotebookModelFactory, NotebookPanel } from '@jupyterlab/notebook';
import { IRenderMime } from '@jupyterlab/rendermime';
import { ITranslator } from '@jupyterlab/translation';
import { find } from '@lumino/algorithm';
import { Widget } from '@lumino/widgets';
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
  export const collect = 'correxit:collect';
  export const comment = 'correxit:comment';
  export const configure = 'correxit:configure';
  export const convert = 'correxit:convert';
  export const correct = 'correxit:correct';
  export const dereference = 'correxit:dereference';
  export const distribute = 'correxit:distribute';
  export const draft = 'correxit:draft';
  export const enroll = 'correxit:enroll';
  export const fetch = 'correxit:fetch';
  export const inject = 'correxit:inject';
  export const intervene = 'correxit:intervene';
  export const launch = 'correxit:launch';
  export const lock = 'correxit:lock';
  export const propagate = 'correxit:propagate';
  export const redistribute = 'correxit:redistribute';
  export const refer = 'correxit:refer';
  export const remove = 'correxit:remove';
  export const reset = 'correxit:reset';
  export const resource = 'correxit:resource';
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
type Resources = { resources: string[] | null };

const { get, has } = Rubric;
const {
  acknowledge, add, assign, certify, collect, comment, convert, correct,
  dereference, distribute, draft, headed, headless, intervene, lock, recover,
  refer, remove, reset, restore, revise, reweight, submit, toggle
} = Workbook;
const { normalize } = Workbook.Credentials;

export function commands(
  app: JupyterFrontEnd,
  utilities: {
    collector: Correxit.Collector;
    distributor: Correxit.Distributor;
    documents: IDocumentManager;
    injector: Correxit.Injector;
    registrar: Correxit.Registrar;
    submitter: Correxit.Submitter;
    translator: ITranslator;
    unlocker: Correxit.Unlocker;
  }
) {
  const { commands, serviceManager: manager, shell } = app;
  const { Error, Icons } = Correxit;
  const {
    collector, distributor, documents, injector, registrar, submitter, unlocker
  } = utilities;
  const trans = utilities.translator.load('correxit');
  const factory = new NotebookModelFactory();
  const fetch = (handle: Credentials, silent = false) =>
    io.request(handle, factory, manager, unlocker, silent);
  const open = (workbook: Workbook | null) => Workbook.open(workbook, true);
  const block = (rubric: Rubric.Unlocked, id: string) => new Set([
    id,
    ...Object.keys(rubric.cells),
    ...Object.keys(rubric.references)
  ]);
  const choose = (
    workbook: Workbook.Headed,
    rubric: Rubric.Unlocked,
    id: string
  ) => input.cell(workbook, {
    blocked: block(rubric, id),
    empty: trans.__('No code cells available.'),
    id,
    message: ({ index, valid }) => valid
      ? trans.__('Cell %1 selected.', index)
      : trans.__('Cell %1 is unavailable.', index),
    prompt: trans.__('↑ ↓ to move, Enter to confirm, Escape to cancel.'),
    title: trans.__('Choose a reference cell')
  });
  const current = (): Workbook.Headed | null =>
    shell.currentWidget instanceof NotebookPanel ? shell.currentWidget : null;
  const active = (): Workbook.Headed | null => {
    const workbook = state.workbook();
    if (Workbook.headed(workbook) && !workbook.context.isDisposed)
      return workbook;
    if (workbook?.context.isDisposed) state.workbook(null);
    return current();
  };
  const files = (paths: string[], parent: string): string[] | null => {
    const folder = parent || '.';
    const root = PathExt.resolve(folder || '.');
    const files = Array.from(new Set(paths.map(path => {
      const full = PathExt.resolve(path);
      if (full === root) {
        throw new Error.Invalid(
          trans.__('Select one or more files in "%1".', folder)
        );
      }

      const name = PathExt.basename(path);
      if (PathExt.resolve(folder, name) !== full) {
        throw new Error.Invalid(
          trans.__(
            'Files must be in (%1). Move or copy them there to select them.',
            folder
          )
        );
      }
      return name;
    })));
    return files.length ? files : null;
  };
  const outputs = (workbook: Workbook, rubric: Rubric): string[] => {
    const secrets = new Set(
      Object.values(rubric.references)
        .filter(({ secret }) => secret)
        .map(({ referent }) => referent)
    );
    return workbook.context.model.sharedModel.toJSON().cells.flatMap(cell => {
      const { id, outputs } = cell as { id?: string; outputs?: unknown[]; };
      return id && secrets.has(id) && Array.isArray(outputs) && outputs.length
        ? [id]
        : [];
    });
  };
  const reify = async (args: Partial<Credentials>): Promise<Reified> => {
    const handle = normalize(args);
    const workbook = handle
      ? await fetch(handle)
      : active();
    const rubric = open(workbook);
    return { handle, rubric, workbook } as Reified;
  };
  const deliver = async (
    args: Partial<Credentials & { quiet: boolean; silent: boolean }>
  ): Promise<{
    assignee: string;
    error: string | null;
    ok: boolean;
    path: string;
  }> => {
    const current = state.workbook();
    const path = args.path || current?.context.path || '';
    const handle = path && normalize({ path });
    if (!path || !handle) {
      const error = 'distribute error: invalid path';
      return { assignee: path, error, ok: false, path };
    }

    const active = current?.context.path === path ? current : null;
    const workbook = active || await fetch(handle, !!args.silent);
    if (!workbook) {
      const error = 'distribute error: workbook unavailable';
      return { assignee: path, error, ok: false, path };
    }

    let assignee = path;
    try {
      const rubric = open(workbook);
      if (!rubric) throw new Error.Invalid('distribute error: invalid rubric');

      const identifier = Workbook.identifier(workbook);
      if (!Workbook.Identifier.assigned(identifier))
        throw new Error.Invalid('distribute error: unassigned');
      assignee = identifier.assignee;
      if (!(await Workbook.unstarted(workbook)))
        throw new Error.Invalid('distribute error: unstarted must be true');
      if (rubric.assignment.distribution !== null)
        return { assignee, error: null, ok: true, path };

      const notebook = workbook.context.model.sharedModel.toJSON();
      const directory = PathExt.dirname(path);
      const load = async (name: string) =>
        ({ name, data: await io.load(manager, directory, name) });
      const names = rubric.assignment.resources;
      const resources = names ? await Promise.all(names.map(load)) : null;
      const overwrite = true;
      await distributor({ identifier, notebook, overwrite, path, resources });
      await distribute(workbook);
      await workbook.context.save();
      return { assignee, error: null, ok: true, path };
    } catch (error) {
      const reason = `${error}`;
      if (args.quiet) console.warn(CommandIDs.distribute, error);
      else showErrorMessage(...Error.interpret(error, trans));
      return { assignee, error: reason, ok: false, path };
    } finally {
      if (!active) workbook.context.dispose();
    }
  };
  const pending = async (directory: string): Promise<string[]> => {
    if (!directory) return [];

    const current = state.workbook();
    try {
      const notebooks = await io.notebooks(manager, directory);
      const paths: string[] = [];
      for (const { path } of notebooks) {
        const active = current?.context.path === path ? current : null;
        const handle = normalize({ path });
        const workbook = active || (handle && await fetch(handle, true));
        if (!workbook) continue;
        try {
          const rubric = open(workbook);
          if (rubric?.assignment.distribution === null) paths.push(path);
        } finally {
          if (!active) workbook.context.dispose();
        }
      }
      return paths;
    } catch (error) {
      console.warn(CommandIDs.redistribute, directory, error);
      return [];
    }
  };
  const redistribute = async function* (directory: string, paths: string[]) {
    paths = paths.length ? paths : await pending(directory);
    const total = paths.length;
    if (!total) return;

    let progress = 0;
    yield { type: 'separator', slots: [] };
    for (const path of paths) {
      const result = await deliver({ path, quiet: true, silent: true });
      if (result.ok) {
        yield { type: 'distributed', slots: [result.assignee, result.path] };
      } else {
        yield {
          type: 'distribute-error',
          slots: [result.assignee, result.path, result.error || '']
        };
      }
      yield { type: 'progress', slots: [++progress, total] };
    }
    yield { type: 'retried', slots: [total] };
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
  disposables.push(commands.addCommand(CommandIDs.resource, {
    icon: Icons.assignment,
    isEnabled: () => {
      const rubric = open(state.workbook());
      return !!rubric && !rubric.locked && !rubric.assignment.assignee;
    },
    isVisible: () => commands.isEnabled(CommandIDs.resource),
    label: trans.__('Set resources...'),
    execute: async (args: Partial<Credentials & Resources>) => {
      const { rubric, workbook } = await reify(args);
      if (!rubric || rubric.locked || rubric.assignment.assignee) return;

      const directory = PathExt.dirname(workbook.context.path) || '.';
      try {
        if ('resources' in args) {
          const resources = args.resources && files(args.resources, directory);
          await assign(workbook, { resources });
          return;
        }

        const filter = (item: { name: string; path: string; type: string }) =>
          item.type === 'file' &&
          PathExt.resolve(item.path) === PathExt.resolve(directory, item.name)
            ? {} : null;
        const { button, value } = await FileDialog.getOpenFiles({
          defaultPath: directory,
          filter,
          label: trans.__('Select files in "%1" to distribute.', directory),
          manager: documents,
          title: trans.__('Select resource files'),
          translator: utilities.translator
        });
        if (!button.accept) return;

        const paths = (value || []).map(item => {
          if (item.type !== 'file') {
            const message =
              trans.__('Select one or more files in "%1".', directory);
            throw new Error.Invalid(message);
          }
          return item.path;
        });
        const resources = files(paths, directory);
        await assign(workbook, { resources });
      } catch (error) {
        showErrorMessage(...Error.interpret(error, trans));
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.certify, {
    icon: Icons.certify,
    isEnabled: () => {
      const rubric = open(state.workbook());
      const assigned = !!rubric?.assignment.assignee;
      return assigned && !rubric.locked;
    },
    label: () => {
      const rubric = open(state.workbook());
      return rubric?.assignment.certification
        ? trans.__('Recertify workbook...')
        : trans.__('Certify workbook...');
    },
    execute: async (args: Partial<Credentials>) => {
      const { rubric, workbook } = await reify(args);
      if (!rubric || rubric.locked || !rubric.assignment.assignee) return;
      try {
        await certify(workbook, trans);
        await commands.execute(CommandIDs.save, { ...args, undo: false });
      } catch (error) {
        showErrorMessage(...Error.interpret(error, trans));
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.collect, {
    icon: Icons.certify,
    isEnabled: () => {
      const rubric = open(state.workbook());
      const assigned = !!rubric?.assignment.assignee;
      const certified = !!rubric?.assignment.certification;
      const collected = !!rubric?.assignment.collected;
      return assigned && !rubric.locked && certified && !collected;
    },
    label: trans.__('Collect workbook...'),
    execute: async (args: Partial<Credentials>) => {
      const { rubric, workbook } = await reify(args);
      if (!rubric || rubric.locked || !rubric.assignment.assignee) return;
      try {
        const certified = await certify(workbook, trans, true);
        const receipt = await collector(certified);
        await collect(workbook, receipt);
        await commands.execute(CommandIDs.save, { ...args, undo: false });
      } catch (error) {
        showErrorMessage(...Error.interpret(error, trans));
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
      const workbook = active();
      const notebook = workbook?.context.model.sharedModel;
      const id = state.cell(args);
      const cell = find(notebook?.cells || [], cell => cell.id === id);
      const references = args.references;
      const rubric = open(workbook);
      if (!cell || !rubric || !id || references?.includes(id)) return false;
      if (rubric.locked || rubric.assignment.assignee) return false;
      if (has(rubric, id)) return get(rubric, id)?.is === args.is;

      const code = cell.cell_type === 'code';
      if (!code) return args.is === 'reviewable';
      return !(id in rubric.references);
    },
    isToggled: (args: Partial<Cell>) => {
      const id = state.cell(args);
      const rubric = open(active());
      return !!rubric && !!id && get(rubric, id)?.is === args.is;
    },
    isVisible: (args: Partial<Cell>) => {
      const id = state.cell(args);
      const rubric = open(active());
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
      if (!rubric || !id || !is || rubric.locked) return;

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
        await remove(workbook, id);
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
        const rubric = open(workbook);
        if (!rubric || rubric.locked) return;
        const selected = headed(workbook)
          ? await choose(workbook, rubric, id)
          : null;
        references = selected && [selected.id];
      }
      if (!references || references.includes(id)) return;
      if (headed(workbook)) {
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

      const notebook = workbook.context.model.sharedModel;
      const detected = nbgrader.detect(notebook.cells.map(cell => ({
        id: cell.id,
        cell_type: cell.cell_type,
        source: cell.getSource(),
        metadata: cell.toJSON().metadata as Record<string, any>
      })));
      if (detected) {
        const { button } = await showDialog({
          title: trans.__('Convert nbgrader notebook?'),
          body: trans.__(
`This rewrites the current notebook in place as a Correxit workbook.
If conversion fails, Correxit restores the original notebook.`
          ),
          buttons: [
            Dialog.cancelButton({ label: trans.__('Cancel') }),
            Dialog.okButton({ label: trans.__('Convert') })
          ]
        });
        if (!button.accept) return;
      }

      const passphrase = await input.text({
        title: trans.__('Enter a passphrase'),
        label: trans.__('Enter a passphrase for this workbook')
      });
      if (!passphrase) return;

      const snapshot = workbook.context.model.toJSON() as INotebookContent;
      const overlay = document.createElement('div');
      const converting = trans.__('Converting...');
      overlay.classList.add('correxit-overlay', 'cxt-mod-loading');
      overlay.dataset.label = converting;
      overlay.setAttribute('role', 'status');
      overlay.setAttribute('aria-live', 'polite');
      overlay.setAttribute('aria-label', converting);
      workbook.content?.node.parentElement?.appendChild(overlay);

      let report: string[] | null;
      try {
        await convert(workbook, passphrase, unlocker);
        report = await nbgrader.convert(workbook, trans);
      } catch (error) {
        restore(workbook, snapshot);

        const restored = trans.__('The original notebook was restored.');
        const detail = Error.reason(error);
        void showErrorMessage(
          trans.__('Conversion failed; original notebook restored'),
          new globalThis.Error(`${restored}\n\n${detail}`)
        );
        return;
      } finally {
        overlay.remove();
      }
      if (!report) return;

      const node = document.createElement('span');
      report.forEach((line, i) => {
        if (i > 0) node.appendChild(document.createElement('br'));
        node.appendChild(document.createTextNode(line));
      });
      void showDialog({
        title: trans.__('Conversion summary'),
        body: new Widget({ node }),
        buttons: [Dialog.okButton({ label: trans.__('Continue') })]
      });
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.correct, {
    icon: Icons.correct,
    isEnabled: (args: Partial<Cell & CellToolbar>) => {
      const workbook = state.workbook();
      const rubric = open(workbook);
      const id = state.cell(args);
      if (args[Rubric.Cell.TOOLBAR] && !id) return false;
      if (!rubric || !headed(workbook)) return false;
      if (!id) {
        const cells = Object.values(rubric.cells);
        const references = rubric.references;
        return cells.some(({ id, is }) => {
          if (is === 'reviewable') return false;
          if (!rubric.locked) return true;

          const refs = Object.values(references)
            .filter(({ cell }) => cell === id);
          return !refs.length || refs.some(({ secret }) => !secret);
        });
      }

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
    if (headless(workbook)) return result;

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
  disposables.push(commands.addCommand(CommandIDs.distribute, {
    icon: Icons.assignment,
    isEnabled: () => {
      const rubric = open(state.workbook());
      return !!(
        rubric?.assignment.assignee &&
        rubric.assignment.issue &&
        rubric.assignment.issuer &&
        rubric.assignment.distribution === null
      );
    },
    isVisible: () => commands.isEnabled(CommandIDs.distribute),
    label: trans.__('Distribute assignment...'),
    execute: async (
      args: Partial<Credentials & { quiet: boolean; silent: boolean }>
    ): Promise<boolean> => (await deliver(args)).ok
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
        showErrorMessage(...Error.interpret(error, trans));
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
      return !!(headed(workbook) && rubric && !rubric.locked);
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
        showErrorMessage(...Error.interpret(error, trans));
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
      args: Partial<Credentials & { overwrite: boolean }>
    ): Promise<AsyncIterable<[string, propagator.Emission]>> => {
      const { rubric, workbook } = await reify(args);
      if (!rubric || rubric.locked) return (async function* empty() {})();

      const exposed = outputs(workbook, rubric);
      if (exposed.length) {
        const body = [
          trans.__('Secret reference cells have outputs.'),
          trans.__('Those outputs are not encrypted and will be distributed.')
        ].join(' ');
        const title = trans.__('Distribute visible outputs?');
        const buttons = [
          Dialog.cancelButton({ label: trans.__('Cancel') }),
          Dialog.okButton({ label: trans.__('Distribute') })
        ];
        const { button } = await showDialog({ body, buttons, title });
        if (!button.accept) return (async function* empty() {})();
      }
      try {
        const { propagate } = propagator;
        const configuration = { commands, distributor, factory, manager };
        const content = { overwrite: args.overwrite ?? true, workbook };
        return translate(propagate({ ...configuration, ...content }), trans);
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
    isEnabled: () => !busy && commands.isEnabled(CommandIDs.propagate),
    isVisible: () => commands.isEnabled(CommandIDs.propagate),
    execute: ({ overwrite = false }: { overwrite?: boolean }) => {
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
      const options = { commands, overwrite, refocus, release, trans };
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
  disposables.push(commands.addCommand(CommandIDs.redistribute, {
    label: trans.__('Retry distribution'),
    execute: async (
      args: Partial<{ path: string; paths: string[] }>
    ): Promise<AsyncIterable<[string, propagator.Emission]>> => {
      return translate(redistribute(args.path || '', args.paths || []), trans);
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
    execute: async (args: Partial<Cell & Credentials>) => {
      const { rubric: unmodified, workbook } = await reify(args);
      const id = state.cell(args);
      if (!unmodified || !id || unmodified.locked || !headed(workbook)) return;

      const { id: referent } = await choose(workbook, unmodified, id) ?? {};
      if (!referent) return;

      const rubric = open(workbook);
      if (!rubric || rubric.locked) return;

      const { is } = get(rubric, id) ?? {};
      if (!is || is !== 'comparable' && is !== 'correctable') return;
      if (
        referent === id ||
        referent in rubric.references ||
        referent in rubric.cells
      ) return;
      const reference = { cell: id, referent, points: 1, secret: true };
      await refer(workbook, id, reference);

      const { widgets } = workbook.content;
      const original = find(widgets, ({ model }) => model.id === id);
      if (original) await workbook.content.scrollToCell(original);
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
      const workbook = state.workbook();
      const rubric = open(workbook);
      if (rubric) return !rubric.locked && !rubric.assignment.assignee;
      const notebook = workbook?.context.model.sharedModel;
      return !!notebook?.getMetadata('correxit');
    },
    isVisible: () => commands.isEnabled(CommandIDs.reset),
    caption: trans.__('Deletes Correxit metadata, keeps notebook content'),
    label: trans.__('Revert to notebook...'),
    execute: async (args: Partial<Credentials>) => {
      const { workbook } = await reify(args);
      if (!workbook) return;

      const notebook = workbook.context.model.sharedModel;
      const encrypted = notebook.cells.some(
        cell => security.encrypted(cell.getSource())
      );
      if (encrypted) {
        const passphrase = args.key ?? await input.text({
          title: trans.__('Recover encrypted cells'),
          label: trans.__('Enter a passphrase to attempt decryption')
        });
        if (passphrase) {
          const recovered = await recover(workbook, passphrase);
          if (!recovered) {
            const { button } = await showDialog({
              title: trans.__('Recovery failed'),
              body: trans.__('No cells could be decrypted. Reset anyway?')
            });
            if (!button.accept) return;
          }
        } else {
          const { button } = await showDialog({
            title: trans.__('Revert to notebook'),
            body: trans.__(
              'Encrypted cells were detected. Reset without recovering?'
            )
          });
          if (!button.accept) return;
        }
      } else {
        const title = trans.__('Revert to notebook');
        const body = commands.caption(CommandIDs.reset);
        const { button } = await showDialog({ body, title });
        if (!button.accept) return;
      }
      await reset(workbook);
      await commands.execute(CommandIDs.save, { ...args, undo: false });
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
      const sealed = !!rubric?.assignment.submission;
      const receipt = !!rubric?.assignment.submitted;
      const certified = !!rubric?.assignment.certification;
      return locked && assigned && !certified && (!sealed || !receipt);
    },
    isVisible: () => commands.isEnabled(CommandIDs.submit),
    label: trans.__('Submit assignment...'),
    execute: async (args: Partial<Credentials>) => {
      const { rubric, workbook } = await reify(args);
      if (!rubric) return;

      const identifier = Workbook.identifier(workbook);
      if (!Workbook.Identifier.assigned(identifier)) return;
      if (rubric.assignment.submission && !rubric.assignment.submitted) {
        try {
          const receipt = await submitter(workbook, identifier);
          await acknowledge(workbook, receipt);
          await commands.execute(CommandIDs.save, { ...args, undo: false });
        } catch (error) {
          showErrorMessage(...Error.interpret(error, trans));
        }
        return;
      }

      const title = trans.__('Submit assignment');
      const body = trans.__(
`Would you like to set a passphrase to revise your submission later?
Or do you just want to seal and submit? This document will be locked.`
      );
      const { button: { accept, actions } } = await showDialog({
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
      if (!accept) return;

      const passphrase = actions.includes('passphrase')
        ? await input.text({
            title: trans.__('Set a submission passphrase'),
            label: trans.__('Enter a passphrase to seal your submission')
          })
        : null;
      if (actions.includes('passphrase') && !passphrase) return;
      try {
        const recipients = await Workbook.recipients(workbook, passphrase);
        await submit(workbook, recipients);
        try {
          const receipt = await submitter(workbook, identifier);
          await acknowledge(workbook, receipt);
        } catch (error) {
          const reason = Error.reason(error);
          const message = `Submission sealed but receipt failed: ${reason}`;
          await commands.execute(CommandIDs.save, { ...args, undo: false });
          throw new Error.Plugin(message);
        }
        await commands.execute(CommandIDs.save, { ...args, undo: false });
      } catch (error) {
        showErrorMessage(...Error.interpret(error, trans));
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
        showErrorMessage(...Error.interpret(error, trans));
      }
    }
  }));
  disposables.push(commands.addCommand(CommandIDs.unlock, {
    icon: Icons.unlocked,
    isEnabled: () => {
      const workbook = state.workbook();
      const rubric = open(workbook);
      return !!(headed(workbook) && rubric && rubric.locked);
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
        return await unlocker.unlock(workbook, handle);
      } catch (error) {
        showErrorMessage(...Error.interpret(error, trans));
      }
      return null;
    }
  }));
  disposables.push(factory);
  return disposables;
}

async function* translate(
  emitter: propagator.Emitter,
  trans: IRenderMime.TranslationBundle
): AsyncGenerator<[string, propagator.Emission]> {
  const translate = (emission: propagator.Emission) => {
    const { slots, type } = emission;
    return ({
      '': slots.join(' '),
      'assigned': trans.__('Assigned to %1', ...slots),
      'create-error': trans.__('Create ERROR %1', ...slots),
      'distributed': trans.__('Distributed %1', slots[0]),
      'distribute-error': trans.__('Distribute ERROR %1 (%3)', ...slots),
      'encrypted': trans.__('Encrypted cell %1', ...slots),
      'error': trans.__('ERROR %1', ...slots),
      'mkdir': trans.__('Created directory %1', ...slots),
      'progress': trans.__('%1 of %2', ...slots),
      'retried': trans.__('Finished retrying %1', ...slots),
      'saved': trans.__('Saved %1', ...slots),
      'separator': '------------',
      'skipped': trans.__('Skipped %1', slots[0]),
      'success': trans.__('Finished! (roster: %1)', ...slots)
    })[type] || '';
  };
  for await (const emission of emitter) {
    const message = emission && translate(emission);
    if (message) yield [message, emission];
  }
}
