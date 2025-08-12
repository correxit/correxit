import { INotebookTree } from '@jupyter-notebook/tree';
import {
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import {
  CommandToolbarButton,
  ICommandPalette,
  IToolbarWidgetRegistry,
  MainAreaWidget,
  ReactWidget,
  WidgetTracker
} from '@jupyterlab/apputils';
import { Cell } from '@jupyterlab/cells';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { IDefaultFileBrowser } from '@jupyterlab/filebrowser';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { Poll } from '@lumino/polling';
import React from 'react';
import { Correxit, Workbook } from '.';
import { addCommands } from './correxit/commands';
import { CellModeSwitcher } from './toolbars';
import { Sidebar } from './sidebar';
import { MultiCorrectCommandIDs } from './multicorrect/types';
import { MultiCorrect } from './multicorrect/widget';

/**
 * The Correxit sidebar UI.
 */
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
      const sidebar = new Sidebar({ commands, source, translator });
      sidebar.id = 'correxit-sidebar';
      shell.add(sidebar, 'right');
      if (restorer) {
        restorer.add(sidebar, sidebar.id);
      }
      deactivator = () => sidebar.dispose();
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
      { commands, shell },
      tracker: INotebookTracker,
      registry: ISettingRegistry | null,
      translator: ITranslator | null
    ): Correxit.Source => {
      console.log('JupyterLab extension correxit is activated!');
      if (registry) {
        void Private.loadSettings(registry);
      }
      const source = new Poll<Workbook | null>({
        auto: false,
        // Set the poll to never tick except when manually scheduled.
        frequency: { backoff: false, interval: Poll.NEVER, max: Poll.NEVER },
        factory: async () => null
      });
      const added = addCommands({ commands, source, translator });
      const quiet = true;
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
      'correxit-correct',
      ({ model: { id } }: Cell) =>
        new CommandToolbarButton({
          commands,
          id: Correxit.CommandIDs.correct,
          label: '',
          args: { id }
        })
    );
    toolbarRegistry.addFactory(
      'Cell',
      'correxit-replace',
      (cell: Cell) => new Private.CellMode({ cell, commands, trans })
    );
  }
};

export const multiCorrect: JupyterFrontEndPlugin<void> = {
  id: Correxit.MULTI_CORRECT,
  description: Correxit.DESCRIPTION.MULTI_CORRECT,
  autoStart: true,
  requires: [IDocumentManager],
  optional: [
    ICommandPalette,
    IDefaultFileBrowser,
    ILayoutRestorer,
    INotebookTree,
    ITranslator
  ],
  activate: (
    app: JupyterFrontEnd,
    docManager: IDocumentManager,
    palette: ICommandPalette,
    filebrowser: IDefaultFileBrowser,
    restorer: ILayoutRestorer,
    notebookTree: INotebookTree,
    translator: ITranslator
  ) => {
    // Declare a widget variable
    let widget: MainAreaWidget<MultiCorrect>;

    // Track the widget state
    const tracker = new WidgetTracker<MainAreaWidget<MultiCorrect>>({
      namespace: 'correxit'
    });

    const openMultiCorrect = (path?: string) => {
      if (!widget || widget.isDisposed) {
        const serviceManager = app.serviceManager;
        const initialPath = path ?? filebrowser?.model.path ?? '';
        const content = new MultiCorrect({
          serviceManager,
          docManager,
          initialPath
        });

        widget = new MainAreaWidget({ content });
        widget.id = 'multi-correct';
        widget.title.label = 'Correxit';
        widget.title.closable = true;
      }

      if (!tracker.has(widget)) {
        // Track the state of the widget for later restoration
        tracker.add(widget);
      }

      // Attach the widget to the main area if it's not there
      if (notebookTree) {
        if (!widget.isAttached) {
          notebookTree.addWidget(widget);
        }
        notebookTree.currentWidget = widget;
      } else if (!widget.isAttached) {
        app.shell.add(widget, 'main');
      }

      widget.content.update();

      app.shell.activateById(widget.id);

      // Notify the instance tracker if restore data needs to update.
      widget.content.pathChanged.connect(() => {
        tracker.save(widget);
      });
    };

    // Command to open formgrader
    app.commands.addCommand(MultiCorrectCommandIDs.open, {
      label: 'Open Multi Correct',
      execute: args => {
        const path = (args.path as string) ?? undefined;
        openMultiCorrect(path);
      },
      describedBy: {
        args: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Optional path'
            }
          }
        }
      }
    });

    if (palette) {
      palette.addItem({
        category: 'correxit',
        command: MultiCorrectCommandIDs.open
      });
    }
    // Restore the widget state
    if (restorer) {
      restorer.restore(tracker, {
        command: MultiCorrectCommandIDs.open,
        name: () => 'multi-correct',
        args: widget => ({
          path: widget.content.path
        })
      });
    }
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
