import {
  ILayoutRestorer,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator } from '@jupyterlab/translation';
import { Poll } from '@lumino/polling';
import { Correxit } from './correxit';
import { Sidebar } from './sidebar';

/**
 * The main correxit plugin loads user settings and provides a workbook source.
 */
export const plugin: JupyterFrontEndPlugin<Correxit.IPlugin> = {
  id: Correxit.PLUGIN,
  description: Correxit.DESCRIPTION.PLUGIN,
  autoStart: true,
  requires: [INotebookTracker],
  optional: [ISettingRegistry],
  provides: Correxit.IPlugin,
  ...((deactivator?: () => void) => ({
    activate: (
      { shell },
      tracker: INotebookTracker,
      registry: ISettingRegistry | null
    ): Correxit.IPlugin => {
      console.log('JupyterLab extension correxit is activated!');

      if (registry) {
        void Private.loadSettings(registry);
      }
      const poll = new Poll<Correxit.Workbook | null>({
        auto: false,
        frequency: { backoff: false, interval: Poll.NEVER, max: Poll.NEVER },
        factory: async () => null
      });
      const shellSlot = (_: unknown, { newValue }: { newValue: unknown }) => {
        const workbook = newValue instanceof NotebookPanel ? newValue : null;
        if (poll.state.payload !== workbook) {
          poll.schedule({ payload: workbook });
        }
      };
      const trackerSlot = (_: unknown, workbook: Correxit.Workbook | null) => {
        if (poll.state.payload !== workbook) {
          poll.schedule({ payload: workbook });
        }
      };
      shell.currentChanged?.connect(shellSlot);
      tracker.currentChanged.connect(trackerSlot);
      deactivator = () => {
        shell.currentChanged?.disconnect(shellSlot);
        tracker.currentChanged.disconnect(trackerSlot);
        poll.dispose();
      };
      return poll;
    },
    deactivate: () => deactivator?.()
  }))()
};

/**
 * The correxit sidebar UI.
 */
export const sidebar: JupyterFrontEndPlugin<void> = {
  id: Correxit.SIDEBAR,
  description: Correxit.DESCRIPTION.SIDEBAR,
  autoStart: true,
  requires: [Correxit.IPlugin],
  optional: [ITranslator, ILayoutRestorer],
  ...((deactivator?: () => void) => ({
    activate: (
      { commands, shell },
      source: Correxit.IPlugin,
      translator: ITranslator | null,
      restorer: ILayoutRestorer | null
    ) => {
      const sidebar = new Sidebar({ commands, source, translator });

      sidebar.id = 'correxit-sidebar';
      shell.add(sidebar, 'right');
      if (restorer) {
        restorer.add(sidebar, sidebar.id);
      }

      // Add sidebar commands and keep track of their disposables.
      const disposables = Sidebar.addCommands(commands, sidebar);
      disposables.push(sidebar);
      deactivator = () => disposables.forEach(item => item.dispose());
    },
    deactivate: () => deactivator?.()
  }))()
};

namespace Private {
  export async function loadSettings(registry: ISettingRegistry) {
    try {
      const settings = await registry.load(Correxit.PLUGIN);
      console.log(`${Correxit.PLUGIN} settings loaded:`, settings.composite);
    } catch (error) {
      console.error(`Failed to load settings for ${Correxit.PLUGIN}.`, error);
    }
  }
}
