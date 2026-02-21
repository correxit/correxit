import { INotebookTree } from '@jupyter-notebook/tree';
import { JupyterFrontEnd } from '@jupyterlab/application';
import { WidgetTracker } from '@jupyterlab/apputils';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { FileDialog, IDefaultFileBrowser } from '@jupyterlab/filebrowser';
import { IRenderMime } from '@jupyterlab/rendermime';
import { Contents } from '@jupyterlab/services';
import { folderIcon } from '@jupyterlab/ui-components';
import { filter } from '@lumino/algorithm';
import { Correxit, Workbook } from '..';
import { Corrector } from '.';
import { grader } from './grader';

export namespace CommandIDs {
  export const batch = 'correxit-corrector:batch';
  export const cd = 'correxit-corrector:cd';
  export const launch = 'correxit-corrector:launch';
  export const scan = 'correxit-corrector:scan';
}

type Certified = Workbook.Certified;
type Credentials = Workbook.Credentials;
type Grade = Workbook.Grade;
type Headless = Workbook.Headless;

export function addCommands(
  app: JupyterFrontEnd,
  utilities: {
    browser: IDefaultFileBrowser | null;
    collector: Correxit.Collector;
    documents: IDocumentManager;
    status: Corrector.Status | null;
    tracker: WidgetTracker<Corrector.Widget>;
    trans: IRenderMime.TranslationBundle;
    tree: INotebookTree | null;
  }
) {
  const { commands, serviceManager: manager, shell } = app;
  const { browser, collector, status, tracker, trans, tree } = utilities;
  const { certify } = Workbook;
  const fetch = (handle: Credentials) =>
    commands.execute(Correxit.CommandIDs.fetch, handle);
  const save = (workbook: Workbook | null) => workbook?.context.save();
  const { normalize } = Workbook.Credentials;
  const disposables = [];
  let widget: Corrector.Widget | null = null;
  disposables.push(
    commands.addCommand(CommandIDs.batch, {
      label: trans.__('Batch grade a scanned workbook directory...'),
      execute: (
        args: Partial<Credentials & { certify: boolean }>
      ): AsyncGenerator<[string, { grade: Grade; workbook: Headless }]> => {
        const commit = !!args.certify;
        const handle: Partial<Workbook.Credentials> = normalize(args) || {};
        const credentials = handle.key ? handle : { ...handle, unlock: true };
        const grade = async (workbook: Workbook): Promise<Certified> => {
          const corrected = await Workbook.correct(workbook);
          const grade = { ...corrected, path: workbook.context.path };
          const identifier = Workbook.identifier(workbook);
          const timestamp = Workbook.timestamp(workbook);
          return { grade, identifier, timestamp, workbook };
        };
        const correct = async (workbook: Workbook): Promise<Certified> => {
          const graded = await (commit ? certify(workbook) : grade(workbook));
          await save(commit ? workbook : null);
          return graded;
        };
        const scanner = (): Promise<AsyncGenerator<Headless>> =>
          commands.execute(CommandIDs.scan, credentials);
        const grades = async function* (): AsyncGenerator<Certified> {
          yield* grader(await scanner(), correct, 5);
        };
        return (async function* (stream: AsyncGenerator<Certified>) {
          for await (const { grade, workbook } of stream) {
            yield [grade.path, { grade, workbook: workbook as Headless }];
          }
        })(args.certify ? collector(grades()) : grades());
      }
    })
  );
  disposables.push(
    commands.addCommand(CommandIDs.cd, {
      icon: folderIcon,
      caption: () => trans.__('Change directory - current: %1', widget?.path),
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
          const manager = browser?.model.manager || utilities.documents;
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
    commands.addCommand(CommandIDs.launch, {
      label: trans.__('Launch Correxit Corrector'),
      execute: ({ path }: { path?: string }) => {
        if (!widget || widget.isDisposed) {
          path ||= browser?.model.path || '.';
          widget = new Corrector.Widget({ commands, path, status, trans });
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
    commands.addCommand(CommandIDs.scan, {
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
