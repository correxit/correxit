import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { requestAPI } from './handler';

/**
 * Initialization data for the correxit extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'correxit:plugin',
  description: 'correxit is a JupyterLab extension and the third-person singular perfect active indicative conjugation of the Latin verb corrigere',
  autoStart: true,
  optional: [ISettingRegistry],
  activate: (app: JupyterFrontEnd, settingRegistry: ISettingRegistry | null) => {
    console.log('JupyterLab extension correxit is activated!');

    if (settingRegistry) {
      settingRegistry
        .load(plugin.id)
        .then(settings => {
          console.log('correxit settings loaded:', settings.composite);
        })
        .catch(reason => {
          console.error('Failed to load settings for correxit.', reason);
        });
    }

    requestAPI<any>('get-example')
      .then(data => {
        console.log(data);
      })
      .catch(reason => {
        console.error(
          `The correxit server extension appears to be missing.\n${reason}`
        );
      });
  }
};

export default plugin;
