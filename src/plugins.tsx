import { INotebookTree } from '@jupyter-notebook/tree';
import {
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ICommandPalette, WidgetTracker } from '@jupyterlab/apputils';
import { PathExt } from '@jupyterlab/coreutils';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { IDefaultFileBrowser } from '@jupyterlab/filebrowser';
import {
  INotebookTracker,
  NotebookModelFactory,
  NotebookPanel
} from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { Poll } from '@lumino/polling';
import { ISecretsManager, SecretsManager } from 'jupyter-secrets-manager';
import { Corrector } from './corrector';
import { addCommands, Correxit, Unlocker, Workbook } from './correxit';
import * as io from './correxit/io';
import { Sidebar } from './ui';

export const consumer: JupyterFrontEndPlugin<Correxit.Consumer> = {
  id: Correxit.CONSUMER,
  description: Correxit.DESCRIPTION.CONSUMER,
  provides: Correxit.Consumer,
  ...((deactivator?: () => void) => ({
    activate: ({ commands, serviceManager }): Correxit.Consumer => {
      const manager = serviceManager;
      const factory = new NotebookModelFactory();
      const mkdir = async (path: string) => {
        const parent = PathExt.dirname(path);
        const base = PathExt.basename(path, '.ipynb');
        const potential = await io.folder(manager, parent, base);
        const directory = await io.mkdir(manager, parent, potential);
        const pwd = directory.path;
        return { directory, location: { base, pwd } };
      };
      deactivator = () => factory.dispose();
      return async function consumer({ log, stream, path, rubric }) {
        let progress = 0;
        const total = rubric.assignment.roster.length + 1;
        await log({ type: 'separator', slots: [] });
        const { directory, location } = await mkdir(path);
        await log({ type: 'mkdir', slots: [directory.path] });
        await log({ type: 'progress', slots: [++progress, total] });
        for await (const { notebook, path } of await stream(location)) {
          await log({ type: 'separator', slots: [] });
          const saved = await io.create({ factory, manager, notebook, path });
          await log({ type: saved ? 'saved' : 'create-error', slots: [path] });
          await log({ type: 'progress', slots: [++progress, total] });
        }
        await io.cd(commands, directory.path);
        await log({ type: 'success', slots: [total] });
      };
    },
    deactivate: () => deactivator?.()
  }))()
};

export const unlocker: JupyterFrontEndPlugin<Correxit.Unlocker> =
  SecretsManager.sign(Correxit.UNLOCKER, token => ({
    id: Correxit.UNLOCKER,
    description: 'Centralized unlock service for Correxit workbooks',
    autoStart: true,
    provides: Correxit.Unlocker,
    requires: [ISecretsManager],
    ...((deactivator?: () => void) => ({
      activate: (_, manager: ISecretsManager): Correxit.Unlocker => {
        const passphrases = new Set<string>();
        const remember = (value: string) => {
          passphrases.add(value);
        };
        const secrets = { manager, passphrases, remember, token };
        return {
          unlock: async (workbook: Workbook, key: string | null) =>
            Unlocker.unlock(workbook, key, secrets),
          store: (id: string, key: string) => Unlocker.store(id, key, secrets)
        };
      },
      deactivate: () => deactivator?.()
    }))()
  }));

export const corrector: JupyterFrontEndPlugin<void> = {
  id: Correxit.CORRECTOR,
  description: Correxit.DESCRIPTION.CORRECTOR,
  requires: [IDocumentManager],
  optional: [
    IDefaultFileBrowser,
    ICommandPalette,
    ILayoutRestorer,
    INotebookTree,
    ITranslator
  ],
  autoStart: true,
  ...((deactivator?: () => void) => ({
    activate: (
      app: JupyterFrontEnd,
      documents: IDocumentManager,
      browser: IDefaultFileBrowser | null,
      palette: ICommandPalette | null,
      restorer: ILayoutRestorer | null,
      tree: INotebookTree | null,
      translator: ITranslator | null
    ) => {
      const name = 'correxit-corrector';
      const trans = (translator || nullTranslator).load('correxit');
      const tracker = new WidgetTracker<Corrector.Widget>({ namespace: name });
      const { launch } = Corrector.CommandIDs;
      const dependencies = { browser, documents, tracker, trans, tree };
      const added = Corrector.addCommands(app, dependencies);
      if (palette) {
        palette.addItem({ category: 'correxit', command: launch });
      }
      if (restorer) {
        restorer.restore(tracker, {
          command: launch,
          name: ({ id }) => id,
          args: ({ path }) => ({ path })
        });
      }
      deactivator = () => {
        added.forEach(command => command.dispose());
        tracker.dispose();
      };
    },
    deactivate: () => deactivator?.()
  }))()
};

/**
 * The Correxit source plugin loads settings, adds commands, and provides an
 * async iterable workbook source that emits when the user changes tabs.
 */
export const source: JupyterFrontEndPlugin<Correxit.Source> = {
  id: Correxit.SOURCE,
  description: Correxit.DESCRIPTION.SOURCE,
  autoStart: true,
  requires: [Correxit.Consumer, Correxit.Unlocker, INotebookTracker],
  optional: [ITranslator],
  provides: Correxit.Source,
  ...((deactivator?: () => void) => ({
    activate: (
      app,
      consumer: Correxit.Consumer,
      unlocker: Correxit.Unlocker,
      tracker: INotebookTracker,
      translator: ITranslator | null
    ): Correxit.Source => {
      console.log('JupyterLab extension correxit is activated!');
      const { commands, shell } = app;
      const source = new Poll<Workbook | null>({
        auto: false,
        frequency: { backoff: false, interval: Poll.NEVER, max: Poll.NEVER },
        factory: async () => null
      });
      const { CommandIDs } = Correxit;
      const { open } = Workbook;
      const quiet = true;
      const notify = () => {
        // The sidebar can rely on metadata changes, but the native toolbar
        // buttons only change when their respective command has changed.
        const { add, convert, correct, lock, toggle, unlock } = CommandIDs;
        const buttons = [add, convert, correct, lock, toggle, unlock];
        for (const command of buttons) {
          commands.notifyCommandChanged(command);
        }
      };
      const subscribe = (prev: Workbook | null, next: Workbook | null) => {
        prev?.context.fileChanged.disconnect(notify);
        prev?.context.model.sharedModel.metadataChanged.disconnect(notify);
        next?.context.fileChanged.connect(notify);
        next?.context.model.sharedModel.metadataChanged.connect(notify);
      };
      const schedule: (workbook: Workbook | null) => void = (
        previous => workbook => {
          if (workbook !== source.state.payload) {
            void open(workbook, quiet);
            subscribe(previous, workbook);
            previous = workbook;
            void source.schedule({ payload: workbook });
            notify();
          }
        }
      )(null as Workbook | null);
      const trans = (translator || nullTranslator).load('correxit');
      const dependencies = { consumer, schedule, source, trans, unlocker };
      const added = addCommands(app, dependencies);
      const slots = {
        shell: (_: unknown, { newValue }: { newValue: unknown }) =>
          schedule(newValue instanceof NotebookPanel ? newValue : null),
        tracker: (_: unknown, workbook: Workbook.Headed | null) =>
          schedule(workbook)
      };
      shell.currentChanged?.connect(slots.shell);
      tracker.currentChanged.connect(slots.tracker);
      deactivator = () => {
        for (const command of added) {
          command.dispose();
        }
        source.dispose();
        shell.currentChanged?.disconnect(slots.shell);
        tracker.currentChanged.disconnect(slots.tracker);
      };
      return source;
    },
    deactivate: () => deactivator?.()
  }))()
};

export const ui: JupyterFrontEndPlugin<void> = {
  id: Correxit.UI,
  description: Correxit.DESCRIPTION.UI,
  autoStart: true,
  requires: [Correxit.Source],
  optional: [ITranslator, ILayoutRestorer, ISettingRegistry],
  ...((deactivator?: () => void) => ({
    activate: (
      { commands, shell },
      source: Correxit.Source,
      translator: ITranslator | null,
      restorer: ILayoutRestorer | null,
      registry: ISettingRegistry
    ) => {
      const settings = registry ? registry.load(Correxit.UI) : null;
      const trans = (translator || nullTranslator).load('correxit');
      const widget = new Sidebar.Widget({ commands, settings, source, trans });
      widget.id = 'correxit-sidebar';
      widget.title.caption = 'Correxit';
      widget.title.icon = Correxit.Icons.correct;
      shell.add(widget, 'right', {});
      if (restorer) {
        restorer.add(widget, widget.id);
      }
      deactivator = () => widget.dispose();
    },
    deactivate: () => deactivator?.()
  }))()
};
