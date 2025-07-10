import {
  ILayoutRestorer,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator } from '@jupyterlab/translation';
import { Poll } from '@lumino/polling';
import { Correxit } from './correxit';
import { addCommands } from './correxit/commands';
import { Sidebar } from './sidebar';

/**
 * The correxit sidebar UI.
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
 * The corrext source plugin loads settings, adds commands and provides an
 * (async iterable) workbook source.
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
        frequency: { backoff: false, interval: Poll.NEVER, max: Poll.NEVER },
        factory: async () => null
      });
      const added = addCommands({ commands, source, translator });
      const schedule = (workbook: Correxit.Workbook | null) => {
        if (source.state.payload !== workbook) {
          void Correxit.open(workbook, { quiet: true });
          source.schedule({ payload: workbook });
        }
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
