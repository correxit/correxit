import { INotebookTree } from '@jupyter-notebook/tree';
import {
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import {
  ICommandPalette,
  IToolbarWidgetRegistry,
  ReactWidget,
  WidgetTracker
} from '@jupyterlab/apputils';
import { Cell } from '@jupyterlab/cells';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { IDefaultFileBrowser } from '@jupyterlab/filebrowser';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { IStateDB, StateDB } from '@jupyterlab/statedb';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { Poll } from '@lumino/polling';
import React from 'react';
import { addCommands, Correxit, Workbook } from './correxit';
import { Corrector } from './corrector';
import { Sidebar } from './sidebar';
import { CellModeSwitcher } from './toolbars';

export const corrector: JupyterFrontEndPlugin<void> = {
  id: Correxit.CORRECTOR,
  description: Correxit.DESCRIPTION.CORRECTOR,
  requires: [IDocumentManager],
  optional: [
    IDefaultFileBrowser,
    ICommandPalette,
    ILayoutRestorer,
    INotebookTree,
    ITranslator,
    IStateDB
  ],
  autoStart: true,
  ...((deactivator?: () => void) => ({
    activate: (
      app: JupyterFrontEnd,
      manager: IDocumentManager,
      browser: IDefaultFileBrowser | null,
      palette: ICommandPalette | null,
      restorer: ILayoutRestorer | null,
      tree: INotebookTree | null,
      translator: ITranslator | null,
      db: IStateDB | null
    ) => {
      const name = 'correxit-corrector';
      const trans = (translator || nullTranslator).load('correxit');
      const tracker = new WidgetTracker<Corrector.Widget>({ namespace: name });
      const { launch } = Corrector.CommandIDs;
      const added = Corrector.addCommands({
        browser,
        commands: app.commands,
        db: db || new StateDB(),
        manager,
        shell: app.shell,
        tracker,
        trans,
        tree
      });
      if (palette) {
        palette.addItem({ category: 'correxit', command: launch });
      }
      if (restorer) {
        restorer.restore(tracker, { command: launch, name: () => name });
      }
      deactivator = () => {
        added.forEach(item => item.dispose());
        tracker.dispose();
      };
    },
    deactivate: () => deactivator?.()
  }))()
};

export const sidebar: JupyterFrontEndPlugin<void> = {
  id: Correxit.SIDEBAR,
  description: Correxit.DESCRIPTION.SIDEBAR,
  autoStart: true,
  requires: [Correxit.Source],
  optional: [ITranslator, ILayoutRestorer],
  ...((deactivator?: () => void) => ({
    activate: (
      { commands, shell },
      source: Correxit.Source,
      translator: ITranslator | null,
      restorer: ILayoutRestorer | null
    ) => {
      const trans = (translator || nullTranslator).load('correxit');
      const widget = new Sidebar.Widget({ commands, source, trans });
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

/**
 * The Correxit source plugin loads settings, adds commands, and provides an
 * async iterable workbook source that emits when the user changes tabs.
 */
export const source: JupyterFrontEndPlugin<Correxit.Source> = {
  id: Correxit.SOURCE,
  description: Correxit.DESCRIPTION.SOURCE,
  autoStart: true,
  requires: [INotebookTracker],
  optional: [ISettingRegistry, ITranslator],
  provides: Correxit.Source,
  ...((deactivator?: () => void) => ({
    activate: (
      { commands, serviceManager, shell },
      tracker: INotebookTracker,
      registry: ISettingRegistry | null,
      translator: ITranslator | null
    ): Correxit.Source => {
      console.log('JupyterLab extension correxit is activated!');
      if (registry) {
        void Private.loadSettings(registry);
      }
      const services = serviceManager;
      const source = new Poll<Workbook | null>({
        auto: false,
        // Set the poll to never tick except when manually scheduled.
        frequency: { backoff: false, interval: Poll.NEVER, max: Poll.NEVER },
        factory: async () => null
      });
      const quiet = true;
      const added = addCommands({ commands, services, source, translator });
      let current: Workbook | null = null;
      const schedule = (workbook: Workbook.Headed | null) => {
        if (workbook === source.state.payload) {
          return;
        }
        Workbook.open(workbook, quiet);
        subscribe(current, workbook);
        current = workbook;
        void source.schedule({ payload: workbook });
      };
      const subscribe = (prev: Workbook | null, next: Workbook | null) => {
        prev?.context.fileChanged.disconnect(handler);
        prev?.context.model.sharedModel.metadataChanged.disconnect(handler);
        next?.context.fileChanged.connect(handler);
        next?.context.model.sharedModel.metadataChanged.connect(handler);
      };
      const handler = () => {
        // The sidebar can rely on metadata changes, but the native toolbar
        // buttons only change when their respective command has changed.
        commands.notifyCommandChanged(Correxit.CommandIDs.convert);
        commands.notifyCommandChanged(Correxit.CommandIDs.correct);
        commands.notifyCommandChanged(Correxit.CommandIDs.lock);
        commands.notifyCommandChanged(Correxit.CommandIDs.toggle);
        commands.notifyCommandChanged(Correxit.CommandIDs.unlock);
      };
      const shellSlot = (_: unknown, { newValue }: { newValue: unknown }) =>
        schedule(newValue instanceof NotebookPanel ? newValue : null);
      const trackerSlot = (_: unknown, workbook: Workbook.Headed | null) =>
        schedule(workbook);
      shell.currentChanged?.connect(shellSlot);
      tracker.currentChanged.connect(trackerSlot);
      deactivator = () => {
        added.forEach(command => command.dispose());
        source.dispose();
        shell.currentChanged?.disconnect(shellSlot);
        tracker.currentChanged.disconnect(trackerSlot);
      };
      return source;
    },
    deactivate: () => deactivator?.()
  }))()
};

export const toolbars: JupyterFrontEndPlugin<void> = {
  id: Correxit.TOOLBARS,
  description: Correxit.DESCRIPTION.TOOLBARS,
  autoStart: true,
  requires: [Correxit.Source, IToolbarWidgetRegistry],
  optional: [ITranslator],
  activate: async (
    { commands },
    _: Correxit.Source, // Load source to ensure commands are available.
    toolbarRegistry: IToolbarWidgetRegistry,
    translator: ITranslator | null
  ) => {
    const trans = (translator || nullTranslator).load('correxit');
    toolbarRegistry.addFactory(
      'Cell',
      'correxit-add',
      (cell: Cell) => new Private.CellMode({ cell, commands, trans })
    );
  }
};

namespace Private {
  export async function loadSettings(registry: ISettingRegistry) {
    try {
      const settings = await registry.load(Correxit.SOURCE);
      console.log(`${Correxit.SOURCE} settings loaded:`, settings.composite);
    } catch (error) {
      console.error(`Failed to load settings for ${Correxit.SOURCE}.`, error);
    }
  }

  export class CellMode extends ReactWidget {
    constructor(readonly props: Parameters<typeof CellModeSwitcher>[0]) {
      super();
    }
    render() {
      return <CellModeSwitcher {...this.props} />;
    }
  }
}
