import { INotebookTree } from '@jupyter-notebook/tree';
import {
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ICommandPalette, WidgetTracker } from '@jupyterlab/apputils';
import { IEditorServices } from '@jupyterlab/codeeditor';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { IDefaultFileBrowser } from '@jupyterlab/filebrowser';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { IStatusBar } from '@jupyterlab/statusbar';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { DisposableDelegate } from '@lumino/disposable';
import { Signal, Stream } from '@lumino/signaling';
import { ISecretsManager, SecretsManager } from 'jupyter-secrets-manager';
import { Corrector, Reviewer } from './corrector';
import { Correxit, Unlocker, Workbook } from './correxit';
import * as collectors from './correxit/collectors';
import * as dispatcher from './correxit/dispatcher';
import * as distributors from './correxit/distributors';
import { Moodle } from './correxit/providers/moodle';
import * as kernels from './correxit/kernels';
import * as registrars from './correxit/registrars';
import * as state from './correxit/state';
import * as submitters from './correxit/submitters';
import { Sidebar } from './ui';

/** The Correxit grade collector dispatches to the configured provider. */
const collector: JupyterFrontEndPlugin<Correxit.Collector> =
  dispatcher.dispatch(
    Correxit.COLLECTOR,
    Correxit.DESCRIPTION.COLLECTOR,
    Correxit.Collector,
    (_, { moodle: settings, provider }) => {
      const collector: Correxit.Collector = certified => {
        switch (provider()) {
          case 'moodle':
            return Moodle.collector(certified, settings());
          default:
            return collectors.manual(certified);
        }
      };
      return [collector, () => {}];
    }
  );

/** The Correxit distributor dispatches to the configured provider. */
const distributor: JupyterFrontEndPlugin<Correxit.Distributor> =
  dispatcher.dispatch(
    Correxit.DISTRIBUTOR,
    Correxit.DESCRIPTION.DISTRIBUTOR,
    Correxit.Distributor,
    (_, { moodle: settings, provider }) => {
      const distributor: Correxit.Distributor = propagated => {
        switch (provider()) {
          case 'moodle':
            return Moodle.distributor(propagated, settings());
          default:
            return distributors.manual(propagated);
        }
      };
      return [distributor, () => {}];
    }
  );

/** The Correxit Corrector UI. */
const corrector: JupyterFrontEndPlugin<void> = {
  id: Correxit.CORRECTOR,
  description: Correxit.DESCRIPTION.CORRECTOR,
  requires: [Correxit.Collector, IDocumentManager, Correxit.Unlocker],
  optional: [
    ICommandPalette,
    IDefaultFileBrowser,
    IEditorServices,
    ILayoutRestorer,
    INotebookTree,
    IRenderMimeRegistry,
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
      unlocker: Correxit.Unlocker,
      palette: ICommandPalette | null,
      browser: IDefaultFileBrowser | null,
      editors: IEditorServices | null,
      restorer: ILayoutRestorer | null,
      tree: INotebookTree | null,
      rendermime: IRenderMimeRegistry | null,
      registry: ISettingRegistry | null,
      status: IStatusBar | null,
      translator: ITranslator | null
    ) => {
      const corrector = 'correxit-corrector';
      const reviewer = 'correxit-reviewer';
      const trans = (translator || nullTranslator).load('correxit');
      const tracker = {
        corrector: new WidgetTracker<Corrector.Widget>({
          namespace: corrector
        }),
        reviewer: new WidgetTracker<Reviewer.Widget>({
          namespace: reviewer
        })
      };
      const indicator = new Corrector.Status(trans);
      const active = new Signal<typeof tracker, void>(tracker);
      tracker.corrector.currentChanged.connect(() => active.emit(undefined));
      const { down, fail, launch, left, pass, review, right, up } =
        Corrector.CommandIDs;
      const added = Corrector.commands(app, {
        browser,
        collector,
        documents,
        editors,
        indicator,
        rendermime,
        tracker,
        trans,
        tree,
        unlocker
      });
      if (status) {
        status.registerStatusItem('correxit-corrector:indicator', {
          item: indicator,
          align: 'right',
          isActive: () => !!tracker.corrector.currentWidget,
          activeStateChanged: active
        });
      }
      if (palette) palette.addItem({ category: 'Correxit', command: launch });
      if (palette) palette.addItem({ category: 'Correxit', command: review });
      if (restorer) {
        restorer.restore(tracker.corrector, {
          command: launch,
          name: ({ id }) => id,
          args: ({ path }) => ({ path })
        });
        restorer.restore(tracker.reviewer, {
          command: review,
          name: ({ id }) => id
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
      // Reviewer keybindings scoped to the reviewer widget.
      const selector = '.correxit-reviewer-widget';
      const bindings = [
        { keys: ['ArrowUp'], command: up, selector },
        { keys: ['K'], command: up, selector },
        { keys: ['ArrowDown'], command: down, selector },
        { keys: ['J'], command: down, selector },
        { keys: ['ArrowLeft'], command: left, selector },
        { keys: ['H'], command: left, selector },
        { keys: ['ArrowRight'], command: right, selector },
        { keys: ['L'], command: right, selector },
        { keys: ['P'], command: pass, selector },
        { keys: ['F'], command: fail, selector }
      ];
      for (const binding of bindings)
        added.push(app.commands.addKeyBinding(binding));
      deactivator = () => {
        added.forEach(command => command.dispose());
        indicator.dispose();
        tracker.corrector.dispose();
        tracker.reviewer.dispose();
      };
    },
    deactivate: () => deactivator?.()
  }))()
};

/** The Correxit workbook monitor yields the active workbook or null. */
const monitor: JupyterFrontEndPlugin<Correxit.Monitor> = {
  id: Correxit.MONITOR,
  description: Correxit.DESCRIPTION.MONITOR,
  autoStart: true,
  requires: [
    Correxit.Collector,
    Correxit.Distributor,
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
      distributor: Correxit.Distributor,
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
        Correxit.CommandIDs.distribute,
        Correxit.CommandIDs.draft,
        Correxit.CommandIDs.lock,
        Correxit.CommandIDs.share,
        Correxit.CommandIDs.submit,
        Correxit.CommandIDs.unlock
      ];
      let ready = false;
      const notify = () =>
        ready && ui.forEach(command => commands.notifyCommandChanged(command));
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
      const slots = {
        shell: (_: unknown, { newValue }: { newValue: unknown }) =>
          injector(newValue instanceof NotebookPanel ? newValue : null),
        tracker: (_: unknown, workbook: Workbook.Headed | null) =>
          injector(workbook)
      };
      shell.currentChanged?.connect(slots.shell);
      tracker.currentChanged.connect(slots.tracker);
      injector(
        shell.currentWidget instanceof NotebookPanel
          ? shell.currentWidget
          : null
      );
      const added = Correxit.commands(app, {
        collector,
        distributor,
        injector,
        registrar,
        submitter,
        translator,
        unlocker
      });
      ready = true;
      notify();
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

/** The Correxit assignment registrar dispatches to the configured provider. */
const registrar: JupyterFrontEndPlugin<Correxit.Registrar> =
  dispatcher.dispatch(
    Correxit.REGISTRAR,
    Correxit.DESCRIPTION.REGISTRAR,
    Correxit.Registrar,
    (_, { moodle: settings, provider }) => {
      const registrar: Correxit.Registrar = (workbook, identifier) => {
        switch (provider()) {
          case 'moodle':
            return Moodle.registrar(workbook, identifier, settings());
          default:
            return registrars.manual(workbook, identifier);
        }
      };
      return [registrar, () => {}];
    }
  );

/** The default Correxit assignment submitter, content-addressed digest. */
const submitter: JupyterFrontEndPlugin<Correxit.Submitter> = {
  id: Correxit.SUBMITTER,
  description: Correxit.DESCRIPTION.SUBMITTER,
  autoStart: true,
  ...((deactivator?: () => void) => ({
    provides: Correxit.Submitter,
    activate: (): Correxit.Submitter => submitters.manual,
    deactivate: () => deactivator?.()
  }))()
};

/** The Correxit sidebar and notebook decoration UI. */
const ui: JupyterFrontEndPlugin<void> = {
  id: Correxit.UI,
  description: Correxit.DESCRIPTION.UI,
  autoStart: true,
  requires: [Correxit.Monitor],
  optional: [ICommandPalette, ITranslator, ILayoutRestorer, ISettingRegistry],
  ...((deactivator?: () => void) => ({
    activate: (
      { commands, shell },
      monitor: Correxit.Monitor,
      palette: ICommandPalette | null,
      translator: ITranslator | null,
      restorer: ILayoutRestorer | null,
      registry: ISettingRegistry | null
    ) => {
      const settings = registry ? registry.load(Correxit.UI) : null;
      const trans = (translator || nullTranslator).load('correxit');
      const options = { commands, monitor, settings, trans };
      const widget = new Sidebar.Widget(options);
      const launch = Correxit.CommandIDs.launch;
      const label = trans.__('Correxit');
      widget.id = 'correxit-sidebar';
      widget.title.caption = label;
      widget.title.label = label;
      widget.title.icon = Correxit.Icons.correct;
      shell.add(widget, 'right', {});
      const added = [
        commands.addCommand(launch, {
          icon: Correxit.Icons.correct,
          caption: trans.__('Open Correxit sidebar'),
          label: trans.__('Open Correxit sidebar'),
          execute: () => shell.activateById(widget.id)
        })
      ];
      if (restorer) restorer.add(widget, widget.id);
      if (palette) {
        const { CommandIDs } = Correxit;
        const exposed = [
          CommandIDs.launch,
          CommandIDs.convert,
          CommandIDs.lock,
          CommandIDs.unlock,
          CommandIDs.track,
          CommandIDs.certify,
          CommandIDs.correct,
          CommandIDs.collect,
          CommandIDs.distribute,
          CommandIDs.submit,
          CommandIDs.revise,
          CommandIDs.draft,
          CommandIDs.reset
        ];
        for (const command of exposed)
          palette.addItem({ category: 'Correxit', command });
      }
      deactivator = () => {
        added.forEach(command => command.dispose());
        widget.dispose();
      };
    },
    deactivate: () => deactivator?.()
  }))()
};

/** The default Correxit unlocker, signed by the Jupyter secrets manager. */
const unlocker: JupyterFrontEndPlugin<Correxit.Unlocker> = SecretsManager.sign(
  Correxit.UNLOCKER,
  token => {
    return {
      id: Correxit.UNLOCKER,
      description: Correxit.DESCRIPTION.UNLOCKER,
      autoStart: true,
      provides: Correxit.Unlocker,
      requires: [ISecretsManager],
      optional: [ITranslator],
      ...((deactivator?: () => void) => ({
        activate: (
          _: JupyterFrontEnd,
          manager: ISecretsManager,
          translator: ITranslator | null
        ) => {
          if (!token) {
            console.warn(
              Correxit.UNLOCKER,
              'Secrets manager token unavailable'
            );
            return {
              store: () => Promise.resolve(),
              unlock: () =>
                Promise.reject(
                  new Correxit.Error.Plugin('Secrets manager token unavailable')
                )
            } as Correxit.Unlocker;
          }
          const trans = (translator || nullTranslator).load('correxit');
          const secrets = {
            manager,
            passphrases: new Set<string>(),
            pending: null as Promise<string | null> | null,
            token
          };
          return {
            store: (id: string, key: string) =>
              Unlocker.store(id, key, secrets),
            unlock: async (workbook, credentials) =>
              Unlocker.unlock(workbook, credentials, secrets, trans)
          } as Correxit.Unlocker;
        },
        deactivate: () => deactivator?.()
      }))()
    };
  }
);

export const plugins = [
  collector,
  distributor,
  corrector,
  monitor,
  registrar,
  submitter,
  ui,
  unlocker
];
