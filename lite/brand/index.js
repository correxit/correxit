import { ILabShell } from '@jupyterlab/application';
import { LabIcon } from '@jupyterlab/ui-components';
import { Widget } from '@lumino/widgets';
import CORREXIT from '../../style/brand/correxit-mark-jupyter.svg';

let widget = null;

const icon = new LabIcon({ name: 'correxit:lite-logo', svgstr: CORREXIT });

const plugin = {
  id: '@correxit:lite-logo',
  description: 'Sets the Correxit mark on the JupyterLite app.',
  autoStart: true,
  optional: [ILabShell],
  activate: (_, shell) => {
    if (!shell) return;
    const logo = document.createElement('a');
    logo.href = '/';
    logo.append(
      icon.element({
        elementPosition: 'center',
        margin: '2px 2px 2px 8px',
        height: 'auto',
        width: '18px'
      })
    );
    widget = new Widget({ node: logo });
    widget.id = 'jp-MainLogo';
    widget.node.setAttribute('aria-label', 'Correxit home');
    widget.node.setAttribute('title', 'Correxit home');
    shell.add(widget, 'top', { rank: 0 });
  },
  deactivate: () => widget?.dispose()
};

const showcase = {
  id: '@correxit:lite-demo',
  description: 'Opens Correxit sidebar.',
  autoStart: true,
  activate: app => {
    const launch = 'correxit:launch';
    const expand = async app => {
      await Promise.all([app.started, app.restored]);
      if (!app.commands.hasCommand(launch)) return false;
      await app.commands.execute(launch);
      return true;
    };
    void expand(app).catch(reason =>
      console.warn('@correxit:lite-demo', 'sidebar error', reason)
    );
  }
};

export default [plugin, showcase];
