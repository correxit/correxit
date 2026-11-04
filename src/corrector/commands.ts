import { INotebookTree } from '@jupyter-notebook/tree';
import { JupyterFrontEnd } from '@jupyterlab/application';
import { showErrorMessage, WidgetTracker } from '@jupyterlab/apputils';
import { IEditorServices } from '@jupyterlab/codeeditor';
import { PathExt } from '@jupyterlab/coreutils';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { FileDialog, IDefaultFileBrowser } from '@jupyterlab/filebrowser';
import { INotebookContent } from '@jupyterlab/nbformat';
import { NotebookModelFactory } from '@jupyterlab/notebook';
import { PromiseDelegate } from '@lumino/coreutils';
import { IRenderMime, IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { ServiceManager } from '@jupyterlab/services';
import { Assignment, Correxit, Rubric, Workbook } from '..';
import * as unlockerService from '../correxit/unlocker';
import * as io from '../correxit/io';
import * as kernels from '../correxit/kernels';
import * as state from '../correxit/state';
import { Corrector, Reviewer } from '.';
import * as session from './session';
import * as csv from './csv';
import { Event, File, Mode, run } from './run';

type Certified = Workbook.Certified;
type Credentials = Workbook.Credentials;
type Grade = Workbook.Grade;
type Graded = Workbook.Graded;
type Headless = Workbook.Headless;

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
  export const run = 'correxit-reviewer:run';
  export const scan = 'correxit-corrector:scan';
  export const process = 'correxit-corrector:run';
  export const stop = 'correxit-corrector:stop';
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
  type Options = Partial<
    Credentials & {
      run: string;
      mode: Mode;
      overwrite: boolean;
      submitted: boolean;
    }
  >;
  const runs = new Map<
    string,
    {
      controller: AbortController;
      done: PromiseDelegate<void>;
      contexts: Set<Headless>;
    }
  >();
  const active = new Map<string, Promise<void>>();
  const retain = (path: string) => {
    const done = new PromiseDelegate<void>();
    active.set(path, done.promise);
    return () => {
      active.delete(path);
      done.resolve();
    };
  };
  const factory = new NotebookModelFactory();
  async function* stream(
    args: Options,
    mode: Mode,
    retained: Set<Headless> | null = null
  ): AsyncGenerator<Event> {
    const id = retained ? null : (args.run ?? null);
    if (id && runs.has(id))
      throw new Error.Invalid('Run identity is already in use');
    const controller = new AbortController();
    const done = new PromiseDelegate<void>();
    const contexts = new Set<Headless>();
    if (id) runs.set(id, { controller, done, contexts });
    const auth = !!(args.key || args.passphrase);
    const handle = normalize({
      ...args,
      path: args.path || '.',
      unlock: auth ? !!args.unlock : true
    } as Partial<Credentials>);
    if (!handle) {
      if (id) runs.delete(id);
      done.resolve();
      throw new Error.Invalid('Invalid Corrector directory or credentials');
    }
    if (id && corrector?.content.run === id) session.begin(id, mode);
    let prompted = false;
    const directory = {
      signal: controller.signal,
      list: async () =>
        (await io.notebooks(manager, handle.path)).map(({ path }) => path),
      read: async (path: string) => {
        const scan =
          mode === 'scan'
            ? normalize({
                ...handle,
                path,
                unlock: !!args.unlock
              } as Partial<Credentials>)
            : normalize({ path, unlock: false });
        if (!scan) return null;
        // A replacement run must read the saved review, not its prior contents.
        await active.get(path);
        if (controller.signal.aborted) return null;
        const workbook = await io.request(
          scan,
          factory,
          manager,
          unlocker,
          prompted,
          true
        );
        if (!workbook) return null;
        const locked = open(workbook)?.locked;
        if (mode === 'scan') prompted ||= !locked || !scan.unlock || auth;
        contexts.add(workbook);
        if (args.submitted && mode !== 'collect' && !submission(workbook)) {
          workbook.context.dispose();
          contexts.delete(workbook);
          return null;
        }
        return workbook;
      }
    };
    const grade = async (workbook: Headless): Promise<File> => {
      const path = workbook.context.path;
      if (active.has(path))
        throw new Error.Invalid('Workbook is already being processed');
      const release = retain(path);
      try {
        const graded = await correct(workbook, handle, !!args.overwrite, {
          fetch,
          manager,
          trans,
          unlocker
        });
        return { grade: graded.grade, workbook };
      } finally {
        release();
      }
    };
    const collect = async (workbook: Headless) => {
      const path = workbook.context.path;
      if (active.has(path))
        throw new Error.Invalid('Workbook is already being processed');
      const release = retain(path);
      try {
        try {
          await authenticate(workbook, handle, unlocker, auth || prompted);
        } finally {
          prompted = true;
        }
        await Workbook.lock(workbook);
        const certified = precertified(workbook);
        if (!certified) {
          return {
            file: {
              workbook,
              grade: { ...unverified(workbook), resolved: true }
            },
            completed: false
          };
        }
        if (open(workbook)?.assignment.collected && !args.overwrite) {
          return {
            file: { workbook, grade: certified.grade },
            completed: false
          };
        }
        const receipt = await collector(
          Workbook.payload({ ...certified, workbook })
        );
        await Workbook.collect(workbook, receipt);
        await save(workbook);
        return { file: { workbook, grade: certified.grade }, completed: true };
      } finally {
        release();
      }
    };
    const events = run(
      mode === 'scan'
        ? { ...directory, mode }
        : mode === 'grade'
          ? {
              ...directory,
              mode,
              grade,
              cap: kernels.cap(),
              retries: kernels.retries()
            }
          : { ...directory, mode, collect }
    );
    try {
      // Explicit pulls let abort precede the delegated iterator's cleanup.
      for (
        let event = await events.next();
        !event.done;
        event = await events.next()
      ) {
        if (id) session.advance(id, event.value);
        yield event.value;
      }
    } finally {
      controller.abort();
      try {
        await events.return(undefined);
      } finally {
        if (!id) {
          contexts.forEach(workbook => {
            if (!retained?.has(workbook)) workbook.context.dispose();
          });
        }
        done.resolve();
      }
    }
  }
  const results = async function* (args: Options, mode: 'grade' | 'collect') {
    const retained = new Set<Headless>();
    for await (const event of stream(args, mode, retained)) {
      if (event.type === 'result' && (mode === 'grade' || event.completed)) {
        retained.add(event.file.workbook);
        yield [event.path, event.file] as [string, File];
      }
    }
  };
  disposables.push(
    commands.addCommand(CommandIDs.process, {
      label: trans.__('Run Corrector'),
      execute: (args: Options) => {
        if (
          typeof args.run !== 'string' ||
          !args.run ||
          !Corrector.Modes.includes(args.mode ?? 'scan')
        )
          throw new Error.Invalid('Invalid Corrector run identity or mode');
        return stream(args, args.mode ?? 'scan');
      }
    })
  );
  disposables.push(
    commands.addCommand(CommandIDs.stop, {
      label: trans.__('Stop Corrector'),
      execute: async ({
        run,
        release
      }: Partial<{ run: string; release: boolean }>) => {
        if (!run) return;
        const pending = runs.get(run);
        if (!pending) return;
        pending.controller.abort();
        if (release) {
          if (reviewer?.workbook && pending.contexts.has(reviewer.workbook))
            reviewer.dispose();
          session.clear(run);
        }
        await pending.done.promise;
        await Promise.all(
          Array.from(pending.contexts, ({ context }) =>
            active.get(context.path)
          )
        );
        if (!release) return;
        const inject = await commands.execute(Correxit.CommandIDs.inject);
        if (runs.get(run) === pending) {
          runs.delete(run);
          const workbook = state.workbook();
          if (workbook && !workbook.content && pending.contexts.has(workbook))
            inject?.(null);
          pending.contexts.forEach(({ context }) => context.dispose());
        }
      }
    })
  );
  disposables.push(
    commands.addCommand(CommandIDs.batch, {
      label: trans.__('Batch grade a scanned workbook directory...'),
      execute: (args: Options) =>
        (async function* () {
          const loaded = new Map<string, Headless>();
          const retained = new Set<Headless>();
          for await (const event of stream(args, 'grade', retained)) {
            if (event.type === 'read' && event.workbook)
              loaded.set(event.path, event.workbook);
            if (event.type === 'result') {
              retained.add(event.file.workbook);
              yield [event.path, event.file] as [string, File];
            }
            if (
              event.type === 'error' &&
              event.path &&
              loaded.has(event.path)
            ) {
              const workbook = loaded.get(event.path)!;
              retained.add(workbook);
              yield [event.path, { workbook, grade: unverified(workbook) }] as [
                string,
                File
              ];
            }
          }
        })()
    })
  );
  disposables.push(
    commands.addCommand(CommandIDs.cd, {
      icon: Icons.folder,
      caption: () =>
        trans.__('Change directory - current: %1', corrector?.path),
      label: trans.__('Change directory'),
      isEnabled: () => !!corrector && corrector.idle,
      execute: async ({ path }: { path?: string }) => {
        if (!corrector || corrector.isDisposed || !corrector.idle) return;

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
      isEnabled: () => !!corrector && corrector.idle,
      execute: async () => {
        if (!corrector || corrector.isDisposed || !corrector.idle) return;

        const { contents } = manager;
        const { path } = corrector;
        const content = csv.generate(session.peek().entries.values());
        const target = await io.available(manager, path, 'grades', '.csv');
        await contents.save(target, { type: 'file', format: 'text', content });
        void commands.execute('docmanager:open', { path: target });
      }
    })
  );
  disposables.push(
    commands.addCommand(CommandIDs.collect, {
      label: trans.__('Save and sync certified workbook grades...'),
      execute: (args: Options) => results(args, 'collect')
    })
  );
  disposables.push(
    commands.addCommand(CommandIDs.launch, {
      icon: Icons.correxit,
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
      execute: (args: Options): AsyncGenerator<Scanned> =>
        (async function* () {
          const retained = new Set<Headless>();
          for await (const event of stream(args, 'scan', retained)) {
            if (event.type === 'listed' && !args.submitted) {
              for (const path of event.paths)
                yield { hollow: true, context: { path } };
            }
            if (event.type === 'read' && event.workbook) {
              retained.add(event.workbook);
              yield event.workbook;
            }
          }
        })()
    })
  );
  disposables.push(
    commands.addCommand(CommandIDs.review, {
      label: trans.__('Launch Correxit Reviewer'),
      execute: (args: { path?: string; cell?: string }) => {
        if (args.path && active.has(args.path)) return;
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
        const workbook = reviewer?.isDisposed
          ? null
          : (reviewer?.workbook ?? null);
        const { comment, id, intervention } = args;
        if (!workbook || !id || active.has(workbook.context.path)) return;
        const release = retain(workbook.context.path);
        try {
          const rubric = open(workbook);
          if (!rubric) return;
          session.record({ workbook, grade: unverified(workbook) });
          await authenticate(
            workbook,
            {
              path: workbook.context.path,
              unlock: true,
              key: null,
              passphrase: null
            },
            unlocker,
            false
          );
          if (intervention !== undefined)
            await Workbook.intervene(workbook, id, intervention ?? null);
          if (comment !== undefined)
            await Workbook.comment(workbook, id, comment);
          await save(workbook);
          let result = reuse(workbook, false)?.grade ?? unverified(workbook);

          // Auto-certify if this was the last pending reviewable cell.
          const updated = open(workbook);
          const { certification } = updated?.assignment ?? {};
          if (
            updated &&
            !updated.locked &&
            !certification &&
            !Rubric.pending(updated)
          ) {
            // Unresolved automatic cells can defer certification to the next batch.
            const certified = await Workbook.certify(
              workbook,
              trans,
              true
            ).catch(() => null);
            if (certified) {
              await save(workbook);
              result = certified.grade;
            }
          }
          session.record({ workbook, grade: result });
        } catch (error) {
          session.record({ workbook, grade: unverified(workbook) });
          void showErrorMessage(...Error.interpret(error, trans));
        } finally {
          release();
        }
      }
    })
  );
  disposables.push(
    commands.addCommand(CommandIDs.run, {
      caption: trans.__('Run reviewer cell'),
      label: trans.__('Run'),
      execute: async (
        args: Partial<{ id: string }>
      ): Promise<Rubric.Cell.Output[] | null> => {
        const workbook = reviewer?.isDisposed
          ? null
          : (reviewer?.workbook ?? null);
        const id = args.id ?? session.peek().cursor?.cell ?? null;
        if (!workbook || !id || active.has(workbook.context.path)) return null;
        const release = retain(workbook.context.path);
        try {
          const rubric = open(workbook);
          if (!rubric) return null;
          const result = await Workbook.execute(workbook, rubric, id);
          if (!result) throw new globalThis.Error('run error: execute failed');
          return result.outputs.get(id) ?? [];
        } catch (error) {
          void showErrorMessage(...Error.interpret(error, trans));
          return null;
        } finally {
          release();
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
  disposables.push(factory);
  return disposables;
}

async function authenticate(
  workbook: Headless,
  handle: Credentials,
  unlocker: Correxit.Unlocker,
  silent: boolean
): Promise<void> {
  const { path } = workbook.context;
  const unlocked = await unlockerService.Unlocker.unlock(workbook, unlocker, {
    ...handle,
    path,
    silent
  });
  const rubric = open(workbook);
  if (!unlocked || !rubric || rubric.locked)
    throw new Correxit.Error.Unlock('Workbook authentication failed');
  await Assignment.authenticate(
    workbook.context.model.sharedModel.toJSON(),
    rubric
  );
}

async function correct(
  workbook: Headless,
  handle: Credentials,
  overwrite: boolean,
  {
    fetch,
    manager,
    trans,
    unlocker
  }: {
    fetch: (handle: Credentials, silent?: boolean) => Promise<unknown>;
    manager: ServiceManager.IManager;
    trans: IRenderMime.TranslationBundle;
    unlocker: Correxit.Unlocker;
  }
): Promise<Graded> {
  const { path } = workbook.context;
  const silent = !!(handle.key || handle.passphrase);
  await authenticate(workbook, handle, unlocker, silent);
  const cached = reuse(workbook, overwrite);
  if (cached) {
    await Workbook.lock(workbook);
    // A prior attempt may have restored this report but failed to save it.
    await save(workbook);
    return cached;
  }
  const dir = PathExt.dirname(path) || '.';
  const notebook = workbook.context.model.toJSON() as INotebookContent;
  const resources = open(workbook)?.assignment.resources ?? null;
  const capacity = kernels.cap();
  const local = await io.stage({ capacity, dir, manager, notebook, resources });
  const staged = (await fetch({
    ...handle,
    path: local.path
  })) as Headless | null;
  if (!staged) {
    await local.release();
    throw new Correxit.Error.Certify('correct error: staging failed');
  }
  try {
    const graded = await grade(staged, trans);
    const snapshot = staged.context.model.toJSON() as INotebookContent;
    const restored = Workbook.restore(workbook, snapshot);
    if (!restored)
      throw new Correxit.Error.Certify('correct error: restore failed');
    await workbook.context.save();

    const identifier = Workbook.identifier(workbook);
    if (!Workbook.Identifier.assigned(identifier))
      throw new Correxit.Error.Certify('correct error: unassigned');
    return {
      ...graded,
      grade: { ...graded.grade, path },
      identifier,
      workbook
    };
  } finally {
    staged.context.dispose();
    await local.release();
  }
}

function reuse(workbook: Headless, overwrite: boolean): Graded | null {
  const rubric = open(workbook);
  if (!rubric || rubric.locked || overwrite) return null;

  const path = workbook.context.path;
  const { assignment } = rubric;
  const { report } = assignment;
  if (Rubric.Assignment.rejected(assignment)) return null;

  const summary = Rubric.Assignment.summary(report, assignment);
  const identifier = Workbook.identifier(workbook);
  if (!Workbook.Identifier.assigned(identifier)) return null;

  const grade = (spec: Grade['spec']): Graded => ({
    grade: { path, resolved: true, score: summary, spec, verified: true },
    identifier,
    workbook
  });
  const { scores } = report;
  const ids = Object.keys(rubric.cells);
  const scored =
    ids.length > 0 &&
    ids.every(id => {
      const score = Rubric.Score.get(scores, id);
      return score && !unexecuted(score);
    });
  if (!scored) return null;
  if (
    assignment.certification &&
    !Rubric.pending(rubric) &&
    summary.status !== 'unscored'
  )
    return grade(report.kernel);

  return Rubric.pending(rubric) ? grade(report.kernel) : null;
}

async function grade(
  workbook: Headless,
  trans: IRenderMime.TranslationBundle
): Promise<Graded> {
  const rubric = open(workbook);
  if (!rubric || rubric.locked)
    throw new Correxit.Error.Certify('grade error: invalid rubric');
  if (Rubric.Assignment.rejected(rubric.assignment))
    throw new Correxit.Error.Certify('grade error: overdue rejected');

  if (!Rubric.pending(rubric)) {
    const certified = await Workbook.certify(workbook, trans);
    await save(workbook);
    return certified;
  }

  const grade = await Workbook.correct(workbook);
  if (!grade.verified)
    throw new Correxit.Error.Certify('grade error: authentication failed');
  const identifier = Workbook.identifier(workbook);
  if (!Workbook.Identifier.assigned(identifier))
    throw new Correxit.Error.Certify('grade error: unassigned');
  await Workbook.lock(workbook);
  await save(workbook);
  return { grade, identifier, workbook };
}

function open(workbook: Workbook): Rubric | null {
  return Workbook.open(workbook, true);
}

function precertified(workbook: Headless): Certified | null {
  const rubric = open(workbook);
  if (!rubric || !rubric.locked) return null;

  const { assignment, cells } = rubric;
  const { kernel, scores } = assignment.report;
  if (Rubric.Assignment.rejected(assignment)) return null;

  const path = workbook.context.path;
  const nonexistent = (id: string) => !Rubric.Score.get(scores, id);
  const incomplete = Object.keys(cells).some(nonexistent);
  const partial = Object.values(scores).some(unexecuted);
  const uncertified = !assignment.certification;
  const summary = Rubric.Assignment.summary(assignment.report, assignment);
  const unscored = summary.status === 'unscored';
  if (
    incomplete ||
    partial ||
    Rubric.pending(rubric) ||
    uncertified ||
    unscored
  )
    return null;

  const grade: Workbook.Grade.Verified = {
    path,
    resolved: true,
    score: summary,
    spec: kernel,
    verified: true
  };
  const identifier = Workbook.identifier(workbook);
  if (!Workbook.Identifier.assigned(identifier)) return null;
  return { grade, identifier, workbook };
}

function unverified(workbook: Headless): Grade & { verified: false } {
  return {
    path: workbook.context.path,
    resolved: false,
    score: { ...Rubric.Score.UNSCORED },
    spec: null,
    verified: false
  };
}

async function save(workbook: Headless | null) {
  await workbook?.context.save();
}

function submission(workbook: Headless): boolean {
  return open(workbook)?.assignment.submission !== null;
}

function unexecuted({ code }: Pick<Rubric.Score, 'code'>): boolean {
  return code === 'missing-given' || code === 'missing-reference';
}
