import {
  ILayoutRestorer,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import {
  CommandToolbarButton,
  IToolbarWidgetRegistry
} from '@jupyterlab/apputils';
import { Cell } from '@jupyterlab/cells';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator } from '@jupyterlab/translation';
import { Poll } from '@lumino/polling';

import { CellModeSwitcher } from './toolbars/cell-mode-switcher';
import { Correxit } from './correxit';
import { addCommands } from './correxit/commands';
import { Sidebar } from './sidebar';

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
      const source = new Poll<Correxit.Workbook | null>({
        auto: false,
        // Set the poll to never tick except when manually scheduled.
        frequency: { backoff: false, interval: Poll.NEVER, max: Poll.NEVER },
        factory: async () => null
      });
      const added = addCommands({ commands, source, translator });
      let current: Correxit.Workbook | null = null;
      const schedule = (workbook: Correxit.Workbook | null) => {
        if (workbook === source.state.payload) {
          return;
        }
        Correxit.open(workbook, { quiet: true });
        workbook?.context.fileChanged.connect(notifyCommands);
        workbook?.content.model?.metadataChanged.connect(notifyCommands);
        current?.context.fileChanged.disconnect(notifyCommands);
        current?.content.model?.metadataChanged.disconnect(notifyCommands);
        current = workbook;
        void source.schedule({ payload: workbook });
      };
      const notifyCommands = () => {
        commands.notifyCommandChanged(Correxit.CommandIDs.correct);
        commands.notifyCommandChanged(Correxit.CommandIDs.lock);
        commands.notifyCommandChanged(Correxit.CommandIDs.unlock);
      };
      const shellSlot = (_: unknown, { newValue }: { newValue: unknown }) =>
        schedule(newValue instanceof NotebookPanel ? newValue : null);
      const trackerSlot = (_: unknown, workbook: Correxit.Workbook | null) =>
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
    translator: ITranslator
  ) => {
    toolbarRegistry.addFactory(
      'Cell',
      'correxit-correct',
      ({ model }: Cell) =>
        new CommandToolbarButton({
          commands,
          id: Correxit.CommandIDs.correct,
          args: { id: Correxit.Workbook.Cell.id(model, true), toolbar: true }
        })
    );
    toolbarRegistry.addFactory(
      'Cell',
      'correxit-switch',
      (cell: Cell) => new CellModeSwitcher({ cell, commands, translator })
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
}
