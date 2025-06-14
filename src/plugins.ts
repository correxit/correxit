import {
  ILayoutRestorer,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ICommandPalette } from '@jupyterlab/apputils';
import { INotebookTracker } from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator } from '@jupyterlab/translation';
import { Correxit } from './correxit';
import { Sidebar } from './sidebar';

/**
 * The primary corrext plugin.
 */
export const plugin: JupyterFrontEndPlugin<void> = {
  id: Correxit.PLUGIN,
  description: Correxit.DESCRIPTION.PLUGIN,
  autoStart: true,
  optional: [ISettingRegistry],
  ...((deactivator?: () => void) => ({
    activate: (_, registry: ISettingRegistry | null) => {
      console.log('JupyterLab extension correxit is activated!');

      if (registry) {
        void Private.loadSettings(registry);
      }
      deactivator = () => undefined;
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
  requires: [INotebookTracker, ITranslator],
  optional: [ICommandPalette, ILayoutRestorer],
  ...((deactivator?: () => void) => ({
    activate: (
      { commands, shell },
      tracker: INotebookTracker,
      translator: ITranslator | null,
      palette: ICommandPalette | null,
      restorer: ILayoutRestorer | null
    ) => {
      const { addCommands, CommandIDs } = Sidebar;
      const sidebar = new Sidebar({ commands, shell, tracker, translator });

      sidebar.id = 'correxit-sidebar';
      shell.add(sidebar, 'right');
      if (restorer) {
        restorer.add(sidebar, sidebar.id);
      }

      // Add sidebar commands and keep track of their disposables.
      const disposables = addCommands(commands, sidebar);
      disposables.push(sidebar);
      if (palette) {
        disposables.push(
          palette.addItem({ category: 'Correxit', command: CommandIDs.unlock })
        );
      }
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
