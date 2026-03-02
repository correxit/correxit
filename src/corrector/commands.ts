import { INotebookTree } from '@jupyter-notebook/tree';
import { JupyterFrontEnd } from '@jupyterlab/application';
import { WidgetTracker } from '@jupyterlab/apputils';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { FileDialog, IDefaultFileBrowser } from '@jupyterlab/filebrowser';
import { IRenderMime } from '@jupyterlab/rendermime';
import { Contents } from '@jupyterlab/services';
import { folderIcon } from '@jupyterlab/ui-components';
import { Correxit, Rubric, Workbook } from '..';
import * as kernels from '../correxit/kernels';
import { Corrector } from '.';
import { Actions, grader } from './grader';

type Certified = Workbook.Certified;
type Credentials = Workbook.Credentials;
type Grade = Workbook.Grade;
type Headless = Workbook.Headless;

export type Hollow = { hollow: true; context: { path: string } };

export type Scanned = (Headless & { hollow?: undefined }) | Hollow;

export namespace CommandIDs {
  export const batch = 'correxit-corrector:batch';
  export const cd = 'correxit-corrector:cd';
  export const collect = 'correxit-corrector:collect';
  export const launch = 'correxit-corrector:launch';
  export const scan = 'correxit-corrector:scan';
}

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
  const fetch = (handle: Credentials, silent = false) =>
    commands.execute(Correxit.CommandIDs.fetch, { ...handle, silent });
  const { normalize } = Workbook.Credentials;
  const disposables = [];
  let widget: Corrector.Widget | null = null;
  disposables.push(
    commands.addCommand(CommandIDs.batch, {
      label: trans.__('Batch grade a scanned workbook directory...'),
      execute: (
        args: Partial<Credentials & { overwrite: boolean }>
      ): AsyncGenerator<[string, { grade: Grade; workbook: Headless }]> => {
        const overwrite = !!args.overwrite;
        const actions: Actions = {
          correct: workbook => correct(workbook),
          exclude: workbook => exclude(workbook, overwrite),
          recover
        };
        const auth = !!(args.key || args.passphrase);
        const potential = { ...args, unlock: auth ? !!args.unlock : true };
        const handle = normalize(potential as Partial<Credentials>);
        if (!handle)
          throw new Error(`batch failed, args: ${JSON.stringify(args)}`);

        const cap = kernels.cap();
        const retries = kernels.retries();
        const source = scanner({ commands }, handle);
        return (async function* (grades: AsyncGenerator<Workbook.Certified>) {
          for await (const { grade, workbook } of grades)
            yield [grade.path, { grade, workbook: workbook as Headless }];
        })(grader(source, actions, cap, retries));
      }
    })
  );
  disposables.push(
    commands.addCommand(CommandIDs.cd, {
      icon: folderIcon,
      caption: () => trans.__('Change directory - current: %1', widget?.path),
      label: () => `/ ${widget?.path.split('/').join(' / ')} /`,
      execute: async ({ path }: { path?: string }) => {
        if (!widget || widget.isDisposed) return;

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
        if (typeof path === 'string') widget.path = path || '.';
        widget.removeClass('cxt-mod-cd');
      }
    })
  );
  disposables.push(
    commands.addCommand(CommandIDs.collect, {
      label: trans.__('Collect certified workbooks into a grade store...'),
      execute: (
        args: Partial<Credentials & { overwrite: boolean }>
      ): AsyncGenerator<[string, { grade: Grade; workbook: Headless }]> => {
        const overwrite = !!args.overwrite;
        const auth = !!(args.key || args.passphrase);
        const potential = { ...args, unlock: auth ? !!args.unlock : true };
        const handle = normalize(potential as Partial<Credentials>);
        if (!handle)
          throw new Error(`collect failed, args: ${JSON.stringify(args)}`);
        const source = scanner({ commands }, handle);
        return (async function* () {
          for await (const workbook of source) {
            const item = certified(workbook);
            if (!item) continue;
            if (!overwrite) {
              const { collected } =
                Workbook.open(workbook, true)?.assignment ?? {};
              if (collected) continue;
            }
            const collected = await collector(item);
            await Workbook.collect(workbook, collected);
            const { grade } = item;
            yield [grade.path, { grade, workbook: workbook as Headless }];
          }
        })();
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
        if (!tracker.has(widget)) tracker.add(widget);
        if (tree) {
          if (!widget.isAttached) tree.addWidget(widget);
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
      execute: (handle: Partial<Credentials>): AsyncGenerator<Scanned> =>
        (async function* scanner(handle) {
          const directory = handle && handle.path;
          let response: Contents.IModel;
          if (!directory) return;
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

          const notebook = ({ type }: Contents.IModel) => type === 'notebook';
          const lexical = (a: { name: string }, b: { name: string }) =>
            a.name.localeCompare(b.name);
          const notebooks = response.content.filter(notebook).sort(lexical);
          for (const { path } of notebooks)
            yield { hollow: true, context: { path } };

          let prompted = false;
          for (const { path } of notebooks) {
            const fetched = await fetch({ ...handle, path }, prompted);
            if (fetched) {
              const locked = Workbook.open(fetched, true)?.locked;
              const unauthenticated = !handle.key && !handle.passphrase;
              prompted ||= !locked || !handle.unlock || !unauthenticated;
              yield fetched as Headless;
            }
          }
        })(normalize({ ...handle, path: handle.path || '.' }))
    })
  );
  return disposables;
}

function certified(workbook: Headless): Certified | null {
  const rubric = Workbook.open(workbook, true);
  if (!rubric) return null;

  const { assignment, cells } = rubric;
  const { interventions, scores } = assignment.report;
  const path = workbook.context.path;
  const transient = ({ code }: Rubric.Score) =>
    code === 'missing-given' || code === 'missing-reference';
  const incomplete = Object.keys(cells).some(id => !scores[id]);
  const partial = Object.values(scores).some(transient);
  const pending = Object.values(cells)
    .filter(cell => cell.is === 'reviewable')
    .some(cell => !interventions[cell.id]);
  const uncertified = !assignment.certification;
  const summary = Rubric.Assignment.summary(assignment.report);
  const unscored = summary.status === 'unscored';
  if (incomplete || partial || pending || uncertified || unscored) return null;

  const grade: Grade = { path, resolved: true, score: summary, spec: null };
  const identifier = Workbook.identifier(workbook);
  return { grade, identifier, workbook };
}

async function correct(workbook: Headless): Promise<Certified> {
  const rubric = Workbook.open(workbook, true);
  if (!rubric || rubric.locked) return recover(workbook);

  const { interventions } = rubric.assignment.report;
  const pending = Object.values(rubric.cells)
    .filter(cell => cell.is === 'reviewable')
    .some(cell => !interventions[cell.id]);
  if (!pending) {
    const result = await Workbook.certify(workbook);
    await save(workbook);
    return result;
  }

  const corrected = await Workbook.correct(workbook);
  const grade = { ...corrected, path: workbook.context.path };
  const identifier = Workbook.identifier(workbook);
  await save(workbook);
  return { grade, identifier, workbook };
}

function exclude(workbook: Headless, overwrite: boolean): Certified | null {
  const rubric = Workbook.open(workbook, true);
  if (!rubric) return null;
  if (overwrite) return null;
  if (rubric.locked) return certified(workbook);

  const { interventions, scores } = rubric.assignment.report;
  const ids = Object.keys(rubric.cells);
  const transient = ({ code }: Rubric.Score) =>
    code === 'missing-given' || code === 'missing-reference';
  const complete =
    ids.length > 0 &&
    ids.every(id => {
      const score = scores[id];
      return score && !transient(score);
    });
  if (!complete) return null;

  const pending = Object.values(rubric.cells)
    .filter(cell => cell.is === 'reviewable')
    .some(cell => !interventions[cell.id]);
  if (!pending) return null;

  const path = workbook.context.path;
  const summary = Rubric.Assignment.summary(rubric.assignment.report);
  const grade: Grade = { path, resolved: true, score: summary, spec: null };
  const identifier = Workbook.identifier(workbook);
  return { grade, identifier, workbook };
}

function recover(workbook: Headless): Certified {
  const path = workbook.context.path;
  const unscored = { ...Rubric.Score.UNSCORED };
  const grade: Grade = { path, resolved: false, score: unscored, spec: null };
  let identifier: Workbook.Identifier;
  try {
    identifier = Workbook.identifier(workbook);
  } catch {
    identifier = { assignee: null, assignment: '', signature: null };
  }
  return { grade, identifier, workbook };
}

async function save(workbook: Headless | null) {
  await workbook?.context.save();
}

async function* scanner(
  { commands }: Pick<JupyterFrontEnd, 'commands'>,
  credentials: Partial<Credentials>
): AsyncGenerator<Headless> {
  const stream = await commands.execute(CommandIDs.scan, credentials);
  for await (const workbook of stream as AsyncIterable<Scanned>)
    if (!workbook.hollow) yield workbook;
}
