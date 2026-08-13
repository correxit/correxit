import { ILabShell } from '@jupyterlab/application';
import { LabIcon } from '@jupyterlab/ui-components';
import { Widget } from '@lumino/widgets';
import CORREXIT from '../../style/brand/correxit-mark-jupyter.svg';

let widget = null;

const icon = new LabIcon({ name: 'correxit:lite-logo', svgstr: CORREXIT });

const plugin = {
  id: '@quantstack/correxit-lite:logo',
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

export default plugin;
