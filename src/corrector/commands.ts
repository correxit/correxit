import { INotebookTree } from '@jupyter-notebook/tree';
import { JupyterFrontEnd } from '@jupyterlab/application';
import { WidgetTracker } from '@jupyterlab/apputils';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { FileDialog, IDefaultFileBrowser } from '@jupyterlab/filebrowser';
import { IRenderMime } from '@jupyterlab/rendermime';
import { Contents } from '@jupyterlab/services';
import { folderIcon, refreshIcon } from '@jupyterlab/ui-components';
import { filter } from '@lumino/algorithm';
import { Correxit, Rubric, Workbook } from '..';
import { Corrector } from '.';

export namespace CommandIDs {
  export const batch = 'correxit-corrector:batch';
  export const cd = 'correxit-corrector:cd';
  export const launch = 'correxit-corrector:launch';
  export const refresh = 'correxit-corrector:refresh';
  export const scan = 'correxit-corrector:scan';
}

type Credentials = Workbook.Credentials;
type Grade = Workbook.Grade;
type Headless = Workbook.Headless;

export function addCommands(
  app: JupyterFrontEnd,
  dependencies: {
    browser: IDefaultFileBrowser | null;
    collector: Correxit.Collector;
    documents: IDocumentManager;
    tracker: WidgetTracker<Corrector.Widget>;
    trans: IRenderMime.TranslationBundle;
    tree: INotebookTree | null;
  }
) {
  const { commands, shell } = app;
  const manager = app.serviceManager;
  const { browser, collector, tracker, trans, tree } = dependencies;
  const { batch, cd, launch, refresh, scan } = CommandIDs;
  const fetch = (handle: Credentials) =>
    commands.execute(Correxit.CommandIDs.fetch, handle);
  const { normalize } = Workbook.Credentials;
  const disposables = [];
  let widget: Corrector.Widget | null = null;
  disposables.push(
    commands.addCommand(batch, {
      label: trans.__('Batch grade a scanned workbook directory...'),
      execute: (
        args: Partial<Credentials & { certify: boolean }>
      ): AsyncGenerator<[string, { grade: Grade; workbook: Headless }]> => {
        const seal = args.certify;
        const handle = normalize(args) || ({} as Partial<Workbook.Credentials>);
        const { certify, correct, open } = Workbook;
        const credentials = handle.key ? handle : { ...handle, unlock: true };
        const grader = async function* () {
          const workbooks = await commands.execute(scan, credentials);
          for await (const workbook of workbooks as AsyncGenerator<Headless>) {
            const { path } = workbook.context;
            const grade = seal
              ? await certify(workbook)
              : { ...(await correct(workbook)), path };
            const rubric = open(workbook, true)!;
            const identifier = Rubric.Assignment.identifier(rubric);
            yield { grade, identifier, workbook };
          }
        };
        return (async function* (grades) {
          for await (const { grade, workbook } of grades) {
            yield [grade.path, { grade, workbook: workbook as Headless }];
          }
        })(seal ? collector(grader()) : grader());
      }
    })
  );
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
          const manager = dependencies.documents;
          const options = { defaultPath, host, label, manager, title };
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
          widget = new Corrector.Widget({
            commands,
            path,
            trans
          });
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
  disposables.push(
    commands.addCommand(scan, {
      label: trans.__('Scan a directory for Correxit workbooks'),
      describedBy: {
        args: {
          type: 'object',
          properties: {
            path: { type: 'string', description: trans.__('Optional path') }
          }
        }
      },
      execute: (handle: Partial<Credentials>): AsyncGenerator<Headless> =>
        (async function* (handle) {
          const directory = handle && handle.path;
          const notebook = ({ type }: Contents.IModel) => type === 'notebook';
          const sort = (list: Contents.IModel[]) =>
            list.sort((a, b) => a.name.localeCompare(b.name));
          let response: Contents.IModel;
          if (!directory) {
            return;
          }
          try {
            response = await manager.contents.get(directory);
          } catch (error) {
            console.warn(CommandIDs.scan, directory, error);
            return;
          }
          if (response.type !== 'directory') {
            console.warn(CommandIDs.scan, directory, 'not a directory');
            return;
          }
          for (const { path } of filter(sort(response.content), notebook)) {
            const fetched = await fetch({ ...handle, path });
            if (fetched) {
              yield fetched as Headless;
            }
          }
        })(normalize({ ...handle, path: handle.path || '.' }))
    })
  );
  return disposables;
}
