import { ILabShell } from '@jupyterlab/application';
import { LabIcon } from '@jupyterlab/ui-components';
import { Widget } from '@lumino/widgets';
import CORREXIT from '../../style/brand/correxit-mark-jupyter.svg';

const icon = new LabIcon({
  name: '@quantstack/correxit-lite:logo',
  svgstr: CORREXIT
});

let widget = null;

const plugin = {
  id: '@quantstack/correxit-lite:logo',
  description: 'Sets the Correxit mark on the JupyterLite app.',
  autoStart: true,
  optional: [ILabShell],
  activate: (_, shell) => {
    if (!shell) {
      return;
    }
    widget = new Widget();
    widget.id = 'jp-MainLogo';
    widget.node.setAttribute('aria-label', 'Correxit');
    icon.element({
      container: widget.node,
      elementPosition: 'center',
      margin: '2px 2px 2px 8px',
      height: 'auto',
      width: '18px'
    });
    shell.add(widget, 'top', { rank: 0 });
  },
  deactivate: () => widget?.dispose()
};

export default plugin;
