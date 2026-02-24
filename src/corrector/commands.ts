import { INotebookTree } from '@jupyter-notebook/tree';
import { JupyterFrontEnd } from '@jupyterlab/application';
import { WidgetTracker } from '@jupyterlab/apputils';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { FileDialog, IDefaultFileBrowser } from '@jupyterlab/filebrowser';
import { IRenderMime } from '@jupyterlab/rendermime';
import { Contents } from '@jupyterlab/services';
import { folderIcon } from '@jupyterlab/ui-components';
import { filter } from '@lumino/algorithm';
import { Correxit, Rubric, Workbook } from '..';
import * as kernels from '../correxit/kernels';
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

export type Hollow = { hollow: true; context: { path: string } };

export type Scanned = (Headless & { hollow?: undefined }) | Hollow;

export function addCommands(
  app: JupyterFrontEnd,
  utilities: {
    browser: IDefaultFileBrowser | null;
    collector: Correxit.Collector;
    documents: IDocumentManager;
    indicator: Corrector.Status | null;
    tracker: WidgetTracker<Corrector.Widget>;
    trans: IRenderMime.TranslationBundle;
    tree: INotebookTree | null;
  }
) {
  const { commands, serviceManager: manager, shell } = app;
  const { browser, collector, indicator, tracker, trans, tree } = utilities;
  const { certify } = Workbook;
  const fetch = (handle: Credentials, silent = false) =>
    commands.execute(Correxit.CommandIDs.fetch, { ...handle, silent });
  const save = (workbook: Workbook | null) => workbook?.context.save();
  const { normalize } = Workbook.Credentials;
  const certified = (workbook: Workbook): Certified | null => {
    const rubric = Workbook.open(workbook, true);
    if (!rubric || rubric.locked) {
      return null;
    }

    const { report } = rubric.assignment;
    const score = Rubric.Assignment.summary(report);
    const transient = ({ code }: Rubric.Score) =>
      code === 'missing-given' || code === 'missing-reference';
    const partial = Object.values(report.scores).some(transient);
    const incomplete = Object.keys(rubric.cells).some(id => !report.scores[id]);
    const unscored = score.status === 'unscored';
    if (!report.timestamp || unscored || partial || incomplete) {
      return null;
    }

    const path = workbook.context.path;
    const grade: Grade = { path, resolved: true, score, spec: null };
    const identifier = Workbook.identifier(workbook);
    return { grade, identifier, timestamp: report.timestamp, workbook };
  };
  const grade = async (workbook: Workbook): Promise<Certified> => {
    const corrected = await Workbook.correct(workbook);
    const grade = { ...corrected, path: workbook.context.path };
    const identifier = Workbook.identifier(workbook);
    const timestamp = Workbook.timestamp(workbook);
    return { grade, identifier, timestamp, workbook };
  };
  const recover = (workbook: Headless): Certified => {
    const path = workbook.context.path;
    const grade: Grade = {
      path,
      resolved: false,
      score: Rubric.Score.UNSCORED,
      spec: null
    };
    let identifier: Workbook.Identifier;
    try {
      identifier = Workbook.identifier(workbook);
    } catch {
      identifier = { assignee: null, assignment: '', signature: null };
    }
    return { grade, identifier, timestamp: 0, workbook };
  };
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
        const auth = handle.key || handle.passphrase;
        const credentials = auth ? handle : { ...handle, unlock: true };
        const cap = kernels.cap();
        const retries = kernels.retries();
        const correct = async (workbook: Headless): Promise<Certified> => {
          const rubric = Workbook.open(workbook, true);
          if (!rubric || rubric.locked) {
            return recover(workbook);
          }
          const existing = certified(workbook);
          if (existing) {
            return existing;
          }

          const graded = await (commit ? certify(workbook) : grade(workbook));
          await save(commit ? workbook : null);
          return graded;
        };
        const scanner = async function* (): AsyncGenerator<Headless> {
          const stream = await commands.execute(CommandIDs.scan, credentials);
          for await (const workbook of stream as AsyncIterable<Scanned>) {
            if (!workbook.hollow) {
              yield workbook;
            }
          }
        };
        const grades = async function* (): AsyncGenerator<Certified> {
          yield* grader(scanner(), correct, recover, cap, retries);
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
          widget = new Corrector.Widget({ commands, path, indicator, trans });
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
      execute: (handle: Partial<Credentials>): AsyncGenerator<Scanned> =>
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
          const files = Array.from(filter(sort(response.content), notebook));
          for (const { path } of files) {
            yield { hollow: true, context: { path } };
          }
          let prompted = false;
          for (const { path } of files) {
            const fetched = await fetch({ ...handle, path }, prompted);
            prompted = true;
            if (fetched) {
              yield fetched as Headless;
            }
          }
        })(normalize({ ...handle, path: handle.path || '.' }))
    })
  );
  return disposables;
}
