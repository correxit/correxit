import { INotebookTree } from '@jupyter-notebook/tree';
import { JupyterFrontEnd } from '@jupyterlab/application';
import { WidgetTracker } from '@jupyterlab/apputils';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { FileDialog, IDefaultFileBrowser } from '@jupyterlab/filebrowser';
import { IRenderMime } from '@jupyterlab/rendermime';
import { folderIcon } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import { Correxit } from '..';
import { Corrector } from '.';

export function addCommands(options: {
  browser: IDefaultFileBrowser | null;
  commands: CommandRegistry;
  manager: IDocumentManager;
  shell: JupyterFrontEnd.IShell;
  tracker: WidgetTracker<Corrector.Widget>;
  trans: IRenderMime.TranslationBundle;
  tree: INotebookTree | null;
}) {
  const { browser, commands, manager, shell, tracker, trans, tree } = options;
  const disposables = [];
  const { cd, launch } = Correxit.CommandIDs;
  let widget: Corrector.Widget;
  disposables.push(
    commands.addCommand(cd, {
      icon: folderIcon,
      label: () => trans.__('Change directory – current: %1', widget?.path),
      execute: async () => {
        const title = trans.__('Change directory');
        const label = trans.__('Select a directory to run Correxit Corrector');
        const options = { label, title, manager };
        const directory = await FileDialog.getExistingDirectory(options);
        if (directory.value && widget) {
          const [{ path }] = directory.value;
          widget.path = path || '.';
        }
      }
    })
  );
  disposables.push(
    commands.addCommand(launch, {
      label: trans.__('Launch Correxit Corrector'),
      execute: ({ path }: { path?: string }) => {
        if (!widget || widget.isDisposed) {
          path ||= browser?.model.path || '.';
          widget = new Corrector.Widget({ commands, path, trans });
          widget.id = 'correxit-corrector-widget';
          widget.title.label = trans.__('Correxit Corrector');
          widget.title.closable = true;
          disposables.push(widget);
        }
        if (!tracker.has(widget)) {
          tracker.add(widget);
        }
        if (tree) {
          if (!widget.isAttached) {
            tree.addWidget(widget);
          }
          tree.currentWidget = widget;
        } else if (!widget.isAttached) {
          shell.add(widget, 'main');
        }
        shell.activateById(widget.id);
      }
    })
  );
  return disposables;
}
