import { INotebookTree } from '@jupyter-notebook/tree';
import { JupyterFrontEnd } from '@jupyterlab/application';
import { WidgetTracker } from '@jupyterlab/apputils';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { FileDialog, IDefaultFileBrowser } from '@jupyterlab/filebrowser';
import { IRenderMime } from '@jupyterlab/rendermime';
import { folderIcon, refreshIcon } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import { Corrector } from '.';
import { IStateDB } from '@jupyterlab/statedb';

export namespace CommandIDs {
  export const cd = 'correxit-corrector:cd';
  export const launch = 'correxit-corrector:launch';
  export const refresh = 'correxit-corrector:refresh';
}

export function addCommands(args: {
  browser: IDefaultFileBrowser | null;
  commands: CommandRegistry;
  db: IStateDB;
  manager: IDocumentManager;
  shell: JupyterFrontEnd.IShell;
  tracker: WidgetTracker<Corrector.Widget>;
  trans: IRenderMime.TranslationBundle;
  tree: INotebookTree | null;
}) {
  const { browser, commands, db, manager, shell, tracker, trans, tree } = args;
  const disposables = [];
  const { cd, launch, refresh } = CommandIDs;
  let widget: Corrector.Widget | null = null;
  disposables.push(
    commands.addCommand(cd, {
      icon: folderIcon,
      caption: () => trans.__('Change directory – current: %1', widget?.path),
      label: () => `/ ${widget?.path.split('/').join(' / ')} /`,
      execute: async ({ path }: { path?: string }) => {
        if (!widget || widget.isDisposed) {
          return;
        }
        widget.addClass('cxt-mod-cd');
        if (typeof path !== 'string') {
          const title = trans.__('Correxit Corrector: change directory');
          const label = trans.__('Choose a directory for Correxit Corrector');
          const defaultPath = widget.path;
          const host = widget.node;
          const options = { defaultPath, host, label, title, manager };
          const pending = await FileDialog.getExistingDirectory(options);
          path = pending.value?.[0].path;
        }
        if (typeof path === 'string') {
          widget.path = path || '.';
        }
        widget.removeClass('cxt-mod-cd');
      }
    })
  );
  disposables.push(
    commands.addCommand(launch, {
      label: trans.__('Launch Correxit Corrector'),
      execute: ({ path }: { path?: string }) => {
        if (!widget || widget.isDisposed) {
          path ||= browser?.model.path || '.';
          widget = new Corrector.Widget({ commands, db, path, trans });
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
  disposables.push(
    commands.addCommand(refresh, {
      icon: refreshIcon,
      caption: () => trans.__('Rescan directory'),
      execute: ({ hard }: { hard?: boolean }) => {
        if (widget && !widget.isDisposed) {
          return hard ? void (widget.path = `${widget.path}`) : widget.update();
        }
      }
    })
  );
  return disposables;
}
