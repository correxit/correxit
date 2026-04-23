import { INotebookTree } from '@jupyter-notebook/tree';
import { JupyterFrontEnd } from '@jupyterlab/application';
import { showErrorMessage, WidgetTracker } from '@jupyterlab/apputils';
import { IEditorServices } from '@jupyterlab/codeeditor';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { FileDialog, IDefaultFileBrowser } from '@jupyterlab/filebrowser';
import { IRenderMime, IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { Contents } from '@jupyterlab/services';
import { Correxit, Rubric, Workbook } from '..';
import * as io from '../correxit/io';
import * as kernels from '../correxit/kernels';
import { Corrector, Reviewer } from '.';
import * as bridge from './bridge';
import * as csv from './csv';
import * as grader from './grader';

type Actions = grader.Actions;
type Certified = Workbook.Certified;
type Credentials = Workbook.Credentials;
type Failed = grader.Result.Failed;
type Grade = Workbook.Grade;
type Headless = Workbook.Headless;
type Result = grader.Result;

export type Hollow = { hollow: true; context: { path: string } };

export type Scanned = (Headless & { hollow?: undefined }) | Hollow;

export namespace CommandIDs {
  export const batch = 'correxit-corrector:batch';
  export const cd = 'correxit-corrector:cd';
  export const collect = 'correxit-corrector:collect';
  export const csv = 'correxit-corrector:csv';
  export const down = 'correxit-reviewer:down';
  export const fail = 'correxit-reviewer:fail';
  export const intervene = 'correxit-reviewer:intervene';
  export const launch = 'correxit-corrector:launch';
  export const left = 'correxit-reviewer:left';
  export const pass = 'correxit-reviewer:pass';
  export const review = 'correxit-reviewer:review';
  export const right = 'correxit-reviewer:right';
  export const scan = 'correxit-corrector:scan';
  export const up = 'correxit-reviewer:up';
}

export function commands(
  app: JupyterFrontEnd,
  utilities: {
    browser: IDefaultFileBrowser | null;
    collector: Correxit.Collector;
    documents: IDocumentManager;
    editors: IEditorServices | null;
    indicator: Corrector.Status | null;
    rendermime: IRenderMimeRegistry | null;
    tracker: {
      corrector: WidgetTracker<Corrector.Widget>;
      reviewer: WidgetTracker<Reviewer.Widget>;
    };
    trans: IRenderMime.TranslationBundle;
    tree: INotebookTree | null;
    unlocker: Correxit.Unlocker;
  }
) {
  const { commands, serviceManager: manager, shell } = app;
  const {
    browser,
    collector,
    editors,
    indicator,
    rendermime,
    tracker,
    trans,
    tree,
    unlocker
  } = utilities;
  const { Error, Icons } = Correxit;
  const fetch = (handle: Credentials, silent = false) =>
    commands.execute(Correxit.CommandIDs.fetch, { ...handle, silent });
  const { normalize } = Workbook.Credentials;
  const disposables = [];
  let corrector: Corrector.Widget | null = null;
  let reviewer: Reviewer.Widget | null = null;
  disposables.push(
    commands.addCommand(CommandIDs.batch, {
      label: trans.__('Batch grade a scanned workbook directory...'),
      execute: (
        args: Partial<Credentials & { overwrite: boolean; submitted: boolean }>
      ): AsyncGenerator<[string, { grade: Grade; workbook: Headless }]> => {
        const overwrite = !!args.overwrite;
        const actions: Actions = {
          correct: workbook => correct(workbook, trans),
          exclude: workbook => exclude(workbook, overwrite),
          recover
        };
        const auth = !!(args.key || args.passphrase);
        const potential = { ...args, unlock: auth ? !!args.unlock : true };
        const handle = normalize(potential as Partial<Credentials>);
        if (!handle)
          throw new Error.Invalid(`batch error, ${JSON.stringify(args)}`);

        const cap = kernels.cap();
        const retries = kernels.retries();
        const source = scanner(
          { commands },
          { ...handle, submitted: !!args.submitted }
        );
        return (async function* (results: AsyncGenerator<Result>) {
          for await (const result of results) {
            const { grade, workbook } = result.ok ? result.certified : result;
            yield [grade.path, { grade, workbook: workbook as Headless }];
          }
        })(grader.grade(source, actions, cap, retries));
      }
    })
  );
  disposables.push(
    commands.addCommand(CommandIDs.cd, {
      icon: Icons.folder,
      caption: () =>
        trans.__('Change directory - current: %1', corrector?.path),
      label: () => `/ ${corrector?.path.split('/').join(' / ')} /`,
      execute: async ({ path }: { path?: string }) => {
        if (!corrector || corrector.isDisposed) return;

        corrector.addClass('cxt-mod-cd');
        if (typeof path !== 'string') {
          const title = trans.__('Correxit Corrector: change directory');
          const label = trans.__('Choose a directory for Correxit Corrector');
          const defaultPath = corrector.path;
          const host = corrector.node;
          const manager = browser?.model.manager || utilities.documents;
          const options = { defaultPath, host, label, manager, title };
          const pending = await FileDialog.getExistingDirectory(options);
          path = pending.value?.[0].path;
        }
        if (typeof path === 'string') corrector.path = path || '.';
        corrector.removeClass('cxt-mod-cd');
      }
    })
  );
  disposables.push(
    commands.addCommand(CommandIDs.csv, {
      icon: Icons.csv,
      caption: trans.__('Export to CSV'),
      isEnabled: () => !!indicator?.idle,
      execute: async () => {
        if (!corrector || corrector.isDisposed) return;

        const { contents } = manager;
        const { path } = corrector;
        const { workbooks, grades } = bridge.peek();
        const content = csv.generate(workbooks, grades);
        const target = await io.available(manager, path, 'grades', '.csv');
        await contents.save(target, { type: 'file', format: 'text', content });
        void commands.execute('docmanager:open', { path: target });
      }
    })
  );
  disposables.push(
    commands.addCommand(CommandIDs.collect, {
      label: trans.__('Collect certified workbook grades...'),
      execute: (
        args: Partial<{ overwrite: boolean; path: string }>
      ): AsyncGenerator<[string, { grade: Grade; workbook: Headless }]> => {
        const overwrite = !!args.overwrite;
        const handle = normalize(args);
        if (!handle) throw new Error.Invalid('collect error, bad handle');
        return (async function* () {
          for await (const workbook of scanner({ commands }, handle)) {
            const certified = precertified(workbook);
            if (!certified) continue;

            const { collected } = open(workbook)?.assignment || {};
            if (collected && !overwrite) continue;

            const receipt = await collector(certified);
            await Workbook.collect(workbook, receipt);
            await save(workbook);
            yield [certified.grade.path, { grade: certified.grade, workbook }];
          }
        })();
      }
    })
  );
  disposables.push(
    commands.addCommand(CommandIDs.launch, {
      label: trans.__('Launch Correxit Corrector'),
      execute: ({ path }: { path?: string }) => {
        if (!corrector || corrector.isDisposed) {
          corrector = new Corrector.Widget({
            commands,
            path: path || browser?.model.path || '.',
            indicator,
            trans
          });
          corrector.id = 'correxit-corrector-widget';
          corrector.title.label = trans.__('Correxit Corrector');
          corrector.title.closable = true;
          disposables.push(corrector);
        }
        if (!tracker.corrector.has(corrector)) tracker.corrector.add(corrector);
        if (tree) {
          if (!corrector.isAttached) tree.addWidget(corrector);
          tree.currentWidget = corrector;
        } else if (!corrector.isAttached) {
          shell.add(corrector, 'main');
        }
        shell.activateById(corrector.id);
      }
    })
  );
  disposables.push(
    commands.addCommand(CommandIDs.scan, {
      label: trans.__('Scan a directory for Correxit workbooks'),
      execute: (
        handle: Partial<Credentials & { submitted: boolean }>
      ): AsyncGenerator<Scanned> =>
        (async function* scanner(handle, submitted) {
          const directory = handle && handle.path;
          if (!directory) return;

          let notebooks: Contents.IModel[];
          try {
            notebooks = await io.notebooks(manager, directory);
          } catch (error) {
            console.warn(CommandIDs.scan, directory, error);
            return;
          }
          if (!submitted) {
            for (const { path } of notebooks)
              yield { hollow: true, context: { path } };
          }

          let prompted = false;
          for (const { path } of notebooks) {
            const fetched = await fetch({ ...handle, path }, prompted);
            if (fetched) {
              const locked = open(fetched)?.locked;
              const unauthenticated = !handle.key && !handle.passphrase;
              prompted ||= !locked || !handle.unlock || !unauthenticated;
              if (submitted && !submittedLocally(fetched as Headless)) {
                fetched.context.dispose();
                continue;
              }
              yield fetched as Headless;
            }
          }
        })(
          normalize({ ...handle, path: handle.path || '.' }),
          !!handle.submitted
        )
    })
  );
  disposables.push(
    commands.addCommand(CommandIDs.review, {
      label: trans.__('Launch Correxit Reviewer'),
      execute: (args: { path?: string; cell?: string }) => {
        if (!reviewer || reviewer.isDisposed) {
          reviewer = new Reviewer.Widget({
            commands,
            factory: editors
              ? options => editors.factoryService.newInlineEditor(options)
              : null,
            mimeTypeService: editors?.mimeTypeService || null,
            rendermime,
            trans
          });
          reviewer.id = 'correxit-reviewer-widget';
          reviewer.title.label = trans.__('Correxit Reviewer');
          reviewer.title.closable = true;
          disposables.push(reviewer);
        }
        if (!tracker.reviewer.has(reviewer)) tracker.reviewer.add(reviewer);
        if (!reviewer.isAttached) shell.add(reviewer, 'main');
        shell.activateById(reviewer.id);
        if (args.path && args.cell)
          reviewer.navigate({ path: args.path, cell: args.cell });
      }
    })
  );
  disposables.push(
    commands.addCommand(CommandIDs.intervene, {
      label: trans.__('Intervene on reviewer cell'),
      execute: async (
        args: Partial<{
          comment: string;
          id: string;
          intervention: Rubric.Score | null;
        }>
      ) => {
        const workbook = reviewer?.workbook ?? null;
        const { comment, id, intervention } = args;
        if (!workbook || !id) return;
        try {
          const rubric = open(workbook);
          if (!rubric) return;
          if (rubric.locked) await unlocker.unlock(workbook, null);
          if (intervention !== undefined)
            await Workbook.intervene(workbook, id, intervention ?? null);
          if (comment !== undefined)
            await Workbook.comment(workbook, id, comment);
          await save(workbook);

          // Auto-certify if this was the last pending reviewable cell.
          const updated = open(workbook);
          const { certification } = updated?.assignment ?? {};
          if (updated && !updated.locked && !certification) {
            const pending = Object.values(updated.cells)
              .filter(cell => cell.is === 'reviewable')
              .some(cell => !updated.assignment.report.interventions[cell.id]);
            if (!pending) {
              try {
                await Workbook.certify(workbook, trans, true);
                await save(workbook);
              } catch {
                // Certification may fail if auto-graded cells are unresolved;
                // the workbook will be certified on the next batch pass.
              }
            }
          }
        } catch (error) {
          void showErrorMessage(...Error.interpret(error, trans));
        }
      }
    })
  );
  disposables.push(
    commands.addCommand(CommandIDs.up, {
      caption: trans.__('Previous cell'),
      label: '↑',
      execute: () => reviewer?.move('up')
    })
  );
  disposables.push(
    commands.addCommand(CommandIDs.down, {
      caption: trans.__('Next cell'),
      label: '↓',
      execute: () => reviewer?.move('down')
    })
  );
  disposables.push(
    commands.addCommand(CommandIDs.left, {
      caption: trans.__('Previous workbook'),
      label: '←',
      execute: () => reviewer?.move('left')
    })
  );
  disposables.push(
    commands.addCommand(CommandIDs.right, {
      caption: trans.__('Next workbook'),
      label: '→',
      execute: () => reviewer?.move('right')
    })
  );
  disposables.push(
    commands.addCommand(CommandIDs.pass, {
      caption: trans.__('Pass cell'),
      label: trans.__('Pass'),
      execute: () => reviewer?.score('pass')
    })
  );
  disposables.push(
    commands.addCommand(CommandIDs.fail, {
      caption: trans.__('Fail cell'),
      label: trans.__('Fail'),
      execute: () => reviewer?.score('fail')
    })
  );
  return disposables;
}

async function correct(
  workbook: Headless,
  trans: IRenderMime.TranslationBundle
): Promise<Certified> {
  const rubric = open(workbook);
  if (!rubric || rubric.locked)
    throw new Correxit.Error.Certify('correct error: invalid rubric');

  const { interventions } = rubric.assignment.report;
  const pending = Object.values(rubric.cells)
    .filter(cell => cell.is === 'reviewable')
    .some(cell => !interventions[cell.id]);
  if (!pending) {
    const result = await Workbook.certify(workbook, trans);
    await save(workbook);
    return result;
  }

  const grade = await Workbook.correct(workbook);
  const identifier = Workbook.identifier(workbook);
  if (!Workbook.Identifier.assigned(identifier))
    throw new Correxit.Error.Certify('correct error: unassigned');
  await Workbook.lock(workbook);
  await save(workbook);
  return { grade, identifier, workbook };
}

function exclude(workbook: Headless, overwrite: boolean): Certified | null {
  const rubric = open(workbook);
  if (!rubric || overwrite) return null;

  const path = workbook.context.path;
  const { assignment } = rubric;
  const { report } = assignment;
  const summary = Rubric.Assignment.summary(report, assignment);
  const identifier = Workbook.identifier(workbook);
  if (!Workbook.Identifier.assigned(identifier)) return null;

  const grade = (spec: Grade['spec']): Certified => ({
    grade: { path, resolved: true, score: summary, spec },
    identifier,
    workbook
  });
  if (assignment.certification) return grade(report.kernel);

  const { interventions, scores } = report;
  const ids = Object.keys(rubric.cells);
  const scored =
    ids.length > 0 && ids.every(id => scores[id] && !unexecuted(scores[id]));
  if (!scored) return null;

  const reviewing = Object.values(rubric.cells)
    .filter(cell => cell.is === 'reviewable')
    .some(cell => !interventions[cell.id]);
  return reviewing ? grade(report.kernel) : null;
}

function open(workbook: Workbook): Rubric | null {
  return Workbook.open(workbook, true);
}

function precertified(workbook: Headless): Certified | null {
  const rubric = open(workbook);
  if (!rubric || !rubric.locked) return null;

  const { assignment, cells } = rubric;
  const { interventions, kernel, scores } = assignment.report;
  const path = workbook.context.path;
  const incomplete = Object.keys(cells).some(id => !scores[id]);
  const partial = Object.values(scores).some(unexecuted);
  const pending = Object.values(cells)
    .filter(cell => cell.is === 'reviewable')
    .some(cell => !interventions[cell.id]);
  const uncertified = !assignment.certification;
  const summary = Rubric.Assignment.summary(assignment.report, assignment);
  const unscored = summary.status === 'unscored';
  if (incomplete || partial || pending || uncertified || unscored) return null;

  const grade: Grade = { path, resolved: true, score: summary, spec: kernel };
  const identifier = Workbook.identifier(workbook);
  if (!Workbook.Identifier.assigned(identifier)) return null;
  return { grade, identifier, workbook };
}

function recover(workbook: Headless): Failed {
  const grade: Grade = {
    path: workbook.context.path,
    resolved: false,
    score: { ...Rubric.Score.UNSCORED },
    spec: null
  };
  return { ok: false, grade, workbook };
}

async function save(workbook: Headless | null) {
  await workbook?.context.save();
}

async function* scanner(
  { commands }: Pick<JupyterFrontEnd, 'commands'>,
  credentials: Partial<Credentials & { submitted: boolean }>
): AsyncGenerator<Headless> {
  const stream = await commands.execute(CommandIDs.scan, credentials);
  for await (const workbook of stream as AsyncIterable<Scanned>)
    if (!workbook.hollow) yield workbook;
}

function submittedLocally(workbook: Headless): boolean {
  return open(workbook)?.assignment.submission !== null;
}

function unexecuted({ code }: Rubric.Score): boolean {
  return code === 'missing-given' || code === 'missing-reference';
}
