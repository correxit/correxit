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
import { IStatusBar } from '@jupyterlab/statusbar';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { UUID } from '@lumino/coreutils';
import { DisposableDelegate } from '@lumino/disposable';
import { Signal, Stream } from '@lumino/signaling';
import { ISecretsManager, SecretsManager } from 'jupyter-secrets-manager';
import { Corrector } from './corrector';
import { Correxit, Unlocker, Workbook } from './correxit';
import * as kernels from './correxit/kernels';
import * as io from './correxit/io';
import * as state from './correxit/state';
import { Sidebar } from './ui';

/**
 * The default (file-based) Correxit assignment propagation consumer.
 */
const consumer: JupyterFrontEndPlugin<Correxit.Consumer> = {
  id: Correxit.CONSUMER,
  description: Correxit.DESCRIPTION.CONSUMER,
  provides: Correxit.Consumer,
  ...((deactivator?: () => void) => ({
    activate: ({ commands, serviceManager: manager }): Correxit.Consumer => {
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
      return async function* consumer({ path, rubric, stream }) {
        let progress = 0;
        const total = rubric.assignment.roster.length;
        const { directory, location } = await mkdir(path);
        yield { type: 'mkdir', slots: [directory.path] };
        yield { type: 'progress', slots: [++progress, total] };
        for await (const created of await stream(location)) {
          const { identifier, notebook, path } = created;
          const saved = await io.create({ factory, manager, notebook, path });
          yield { type: 'separator', slots: [] };
          yield { type: 'assigned', slots: [identifier.assignee!] };
          yield { type: saved ? 'saved' : 'create-error', slots: [path] };
          yield { type: 'progress', slots: [++progress, total] };
        }
        await io.cd(commands, directory.path);
        yield { type: 'success', slots: [total] };
      };
    },
    deactivate: () => deactivator?.()
  }))()
};

/**
 * The default Correxit grade collector, returns a UUID.
 */
const collector: JupyterFrontEndPlugin<Correxit.Collector> = {
  id: Correxit.COLLECTOR,
  description: Correxit.DESCRIPTION.COLLECTOR,
  provides: Correxit.Collector,
  ...((deactivator?: () => void) => ({
    activate: (): Correxit.Collector => async _ => UUID.uuid4(),
    deactivate: () => deactivator?.()
  }))()
};

/**
 * The Correxit Corrector UI.
 */
const corrector: JupyterFrontEndPlugin<void> = {
  id: Correxit.CORRECTOR,
  description: Correxit.DESCRIPTION.CORRECTOR,
  requires: [Correxit.Collector, IDocumentManager],
  optional: [
    ICommandPalette,
    IDefaultFileBrowser,
    ILayoutRestorer,
    INotebookTree,
    ISettingRegistry,
    IStatusBar,
    ITranslator
  ],
  autoStart: true,
  ...((deactivator?: () => void) => ({
    activate: (
      app: JupyterFrontEnd,
      collector: Correxit.Collector,
      documents: IDocumentManager,
      palette: ICommandPalette | null,
      browser: IDefaultFileBrowser | null,
      restorer: ILayoutRestorer | null,
      tree: INotebookTree | null,
      registry: ISettingRegistry | null,
      status: IStatusBar | null,
      translator: ITranslator | null
    ) => {
      const name = 'correxit-corrector';
      const trans = (translator || nullTranslator).load('correxit');
      const tracker = new WidgetTracker<Corrector.Widget>({ namespace: name });
      const indicator = new Corrector.Status(trans);
      const active = new Signal<typeof tracker, void>(tracker);
      tracker.currentChanged.connect(() => active.emit(undefined));
      const { launch } = Corrector.CommandIDs;
      const added = Corrector.commands(app, {
        browser,
        collector,
        documents,
        indicator,
        tracker,
        trans,
        tree
      });
      if (status) {
        status.registerStatusItem('correxit-corrector:indicator', {
          item: indicator,
          align: 'right',
          isActive: () => !!tracker.currentWidget,
          activeStateChanged: active
        });
      }
      if (palette) palette.addItem({ category: 'correxit', command: launch });
      if (restorer) {
        restorer.restore(tracker, {
          command: launch,
          name: ({ id }) => id,
          args: ({ path }) => ({ path })
        });
      }
      if (registry) {
        void registry
          .load(Correxit.CORRECTOR)
          .then(settings => {
            const reconfigure = () =>
              kernels.configure(settings.composite as kernels.Config);
            const disconnect = new DisposableDelegate(() =>
              settings.changed.disconnect(reconfigure)
            );
            settings.changed.connect(reconfigure);
            added.push(disconnect);
            reconfigure();
          })
          .catch(reason =>
            console.warn(Correxit.CORRECTOR, 'settings error', reason)
          );
      }
      deactivator = () => {
        added.forEach(command => command.dispose());
        indicator.dispose();
        tracker.dispose();
      };
    },
    deactivate: () => deactivator?.()
  }))()
};

/**
 * The default Correxit roster registrar.
 */
const registrar: JupyterFrontEndPlugin<Correxit.Registrar> = {
  id: Correxit.REGISTRAR,
  description: Correxit.DESCRIPTION.REGISTRAR,
  autoStart: true,
  ...((deactivator?: () => void) => ({
    provides: Correxit.Registrar,
    activate: (): Correxit.Registrar => async _ => {
      const week = 7 * 24 * 60 * 60 * 1000;
      return [
        {
          expiration: Date.now() + week,
          id: 'example-assignment-1',
          name: 'Example Assignment 1',
          roster: ['alpha@example.com', 'bravo@example.com']
        },
        {
          expiration: Date.now() + week,
          id: 'example-assignment-2',
          name: 'Example Assignment 2',
          roster: ['charlie@example.com', 'delta@example.com']
        }
      ];
    },
    deactivate: () => deactivator?.()
  }))()
};

/**
 * The Correxit workbook monitor asynchronously yields the active workbook or null.
 */
const monitor: JupyterFrontEndPlugin<Correxit.Monitor> = {
  id: Correxit.MONITOR,
  description: Correxit.DESCRIPTION.MONITOR,
  autoStart: true,
  requires: [
    Correxit.Collector,
    Correxit.Consumer,
    Correxit.Registrar,
    Correxit.Submitter,
    Correxit.Unlocker,
    INotebookTracker
  ],
  optional: [ITranslator],
  provides: Correxit.Monitor,
  ...((deactivator?: () => void) => ({
    activate: (
      app,
      collector: Correxit.Collector,
      consumer: Correxit.Consumer,
      registrar: Correxit.Registrar,
      submitter: Correxit.Submitter,
      unlocker: Correxit.Unlocker,
      tracker: INotebookTracker,
      translator: ITranslator | null
    ): Correxit.Monitor => {
      translator ||= nullTranslator;

      const { commands, shell } = app;
      // The sidebar can rely on metadata changes, but the native toolbar
      // buttons only change when their respective command has changed.
      const ui = [
        Correxit.CommandIDs.configure,
        Correxit.CommandIDs.convert,
        Correxit.CommandIDs.correct,
        Correxit.CommandIDs.draft,
        Correxit.CommandIDs.lock,
        Correxit.CommandIDs.share,
        Correxit.CommandIDs.submit,
        Correxit.CommandIDs.unlock
      ];
      const notify = () =>
        ui.forEach(command => commands.notifyCommandChanged(command));
      const monitor = new Stream<null, Workbook | null>(null);
      const swap = (prev: Workbook | null, next: Workbook | null) => {
        prev?.context.fileChanged.disconnect(notify);
        prev?.context.model.sharedModel.metadataChanged.disconnect(notify);
        next?.context.fileChanged.connect(notify);
        next?.context.model.sharedModel.metadataChanged.connect(notify);
      };
      const injector: (workbook: Workbook | null) => void = (
        previous => workbook => {
          if (workbook === state.workbook()) return;
          Workbook.open(workbook, true);
          swap(previous, workbook);
          state.workbook(workbook);
          previous = workbook;
          monitor.emit(workbook);
          notify();
        }
      )(null as Workbook | null);
      const added = Correxit.commands(app, {
        collector,
        consumer,
        injector,
        registrar,
        submitter,
        translator,
        unlocker
      });
      const slots = {
        shell: (_: unknown, { newValue }: { newValue: unknown }) =>
          injector(newValue instanceof NotebookPanel ? newValue : null),
        tracker: (_: unknown, workbook: Workbook.Headed | null) =>
          injector(workbook)
      };
      shell.currentChanged?.connect(slots.shell);
      tracker.currentChanged.connect(slots.tracker);
      deactivator = () => {
        for (const command of added) command.dispose();
        shell.currentChanged?.disconnect(slots.shell);
        monitor.stop();
        Signal.clearData(monitor);
        tracker.currentChanged.disconnect(slots.tracker);
      };
      return monitor;
    },
    deactivate: () => deactivator?.()
  }))()
};

/**
 * The default Correxit assignment submitter, returns a UUID.
 */
const submitter: JupyterFrontEndPlugin<Correxit.Submitter> = {
  id: Correxit.SUBMITTER,
  description: Correxit.DESCRIPTION.SUBMITTER,
  autoStart: true,
  ...((deactivator?: () => void) => ({
    provides: Correxit.Submitter,
    activate: (): Correxit.Submitter => async _ => UUID.uuid4(),
    deactivate: () => deactivator?.()
  }))()
};

const ui: JupyterFrontEndPlugin<void> = {
  id: Correxit.UI,
  description: Correxit.DESCRIPTION.UI,
  autoStart: true,
  requires: [Correxit.Monitor],
  optional: [ITranslator, ILayoutRestorer, ISettingRegistry],
  ...((deactivator?: () => void) => ({
    activate: (
      { commands, shell },
      monitor: Correxit.Monitor,
      translator: ITranslator | null,
      restorer: ILayoutRestorer | null,
      registry: ISettingRegistry
    ) => {
      const settings = registry ? registry.load(Correxit.UI) : null;
      const trans = (translator || nullTranslator).load('correxit');
      const options = { commands, monitor, settings, trans };
      const widget = new Sidebar.Widget(options);
      widget.id = 'correxit-sidebar';
      widget.title.caption = 'Correxit';
      widget.title.icon = Correxit.Icons.correct;
      shell.add(widget, 'right', {});
      if (restorer) restorer.add(widget, widget.id);
      deactivator = () => widget.dispose();
    },
    deactivate: () => deactivator?.()
  }))()
};

const unlocker: JupyterFrontEndPlugin<Correxit.Unlocker> = SecretsManager.sign(
  Correxit.UNLOCKER,
  token => ({
    id: Correxit.UNLOCKER,
    description: Correxit.DESCRIPTION.UNLOCKER,
    autoStart: true,
    provides: Correxit.Unlocker,
    optional: [ISecretsManager, ITranslator],
    ...((deactivator?: () => void) => ({
      activate: (
        _: JupyterFrontEnd,
        manager: ISecretsManager | null,
        translator: ITranslator | null
      ) => {
        const trans = (translator || nullTranslator).load('correxit');
        const secrets = {
          manager,
          passphrases: new Set<string>(),
          pending: null as Promise<string | null> | null,
          token
        };
        return {
          store: (id: string, key: string) => Unlocker.store(id, key, secrets),
          unlock: async (workbook, credentials) =>
            Unlocker.unlock(workbook, credentials, secrets, trans)
        } as Correxit.Unlocker;
      },
      deactivate: () => deactivator?.()
    }))()
  })
);

export const plugins = [
  collector,
  consumer,
  corrector,
  monitor,
  registrar,
  submitter,
  ui,
  unlocker
];
