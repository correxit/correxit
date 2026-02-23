import { ICodeCellModel } from '@jupyterlab/cells';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import {
  INotebookModel,
  Notebook,
  NotebookActions
} from '@jupyterlab/notebook';
import { KernelSpec } from '@jupyterlab/services';
import { findIndex, range } from '@lumino/algorithm';
import { Correxit, Rubric } from '.';
import * as kernels from './kernels';
import * as security from './security';
import * as state from './state';

/**
 * A headed or headless Correxit workbook.
 */
export type Workbook = Workbook.Headed | Workbook.Headless;

export namespace Workbook {
  /**
   * The result of an audit on a workbook's rubric.
   */
  export type Audit = Audit.Pass | Audit.Fail;

  namespace Audit {
    export type Pass = {
      ok: true;
      pruned: { cell: Rubric.Cell; reason: string; }[];
      rubric: Rubric;
    };

    export type Fail = { ok: false; error: string; rubric: Rubric | null; };
  }

  export type Certified = {
    grade: Workbook.Grade;
    identifier: Workbook.Identifier;
    timestamp: number;
    workbook: Workbook;
  };

  export type Credentials = |
    { path: string; unlock: null; key: null; passphrase: null; } |
    { path: string; unlock: null; key: string; passphrase: null; } |
    { path: string; unlock: null; key: null; passphrase: string; } |
    { path: string; unlock: boolean; key: null; passphrase: null; };

  export namespace Credentials {
    export function normalize (credentials: Partial<Credentials> | null) {
      const { key, passphrase, path, unlock } = credentials || {};
      if (key && unlock || !path) {
        return null;
      }
      return {
        path,
        key: key || null,
        passphrase: key ? null : passphrase || null,
        unlock: unlock || null
      } as Credentials;
    }
  }

  export type Grade = {
    path: string;
    resolved: boolean;
    score: Rubric.Score;
    spec: KernelSpec.ISpecModel | null;
  };

  export type Headed = {
    readonly content: Notebook;
    readonly context: DocumentRegistry.IContext<INotebookModel>;
  };

  export type Headless = {
    readonly content: null;
    readonly context: DocumentRegistry.IContext<INotebookModel>;
  };

  /**
   * A type for plugins to identify a workbook/assignment/assignee match.
   */
  export type Identifier = {
    /**
     * The assignee (typically an email address) or `null` if unassigned.
     */
    assignee: string | null;

    /**
     * The workbook/assignment id, i.e. the rubric id of the workbook.
     */
    assignment: string;

    /**
     * The workbook/assignment signature for the assignee/roster/report.
     */
    signature: string | null;
  }

  export namespace Cell {
    /**
     * Decrypts a workbook cell, modifying its source and changing its cell type
     * from `raw` to `code`.
     */
    export async function decrypt(
      workbook: Workbook,
      reference: string,
      key: string
    ): Promise<void> {
      const notebook = workbook.context.model.sharedModel;
      const index = findIndex(notebook.cells, ({ id }) => id === reference);
      if (!key || index === -1) {
        throw new Error('decrypt error');
      }

      const cell = notebook.cells[index];
      const decrypted = await security.decrypt(cell.getSource(), key);
      cell.transact(() => {
        const jupyter = (cell.getMetadata('jupyter') as any || {});
        delete jupyter['source_hidden'];
        cell.setMetadata('jupyter', jupyter);
        cell.setMetadata('trusted', true);
        cell.deleteMetadata('editable');
        cell.setSource(decrypted);
      });

      const code = { ...cell.toJSON(), cell_type: 'code' };
      notebook.transact(() => {
        notebook.deleteCell(index);
        notebook.insertCell(index, code);
      }, false);
      if (workbook.content) {
        NotebookActions.deselectAll(workbook.content);
      }
    }

    /**
     * Encrypts a workbook cell, modifying its source and changing its cell type
     * from `code` to `raw`.
     */
    export async function encrypt(
      workbook: Workbook,
      reference: string,
      key: string
    ): Promise<void> {
      const notebook = workbook.context.model.sharedModel;
      const index = findIndex(notebook.cells, ({ id }) => id === reference);
      if (!key || index === -1) {
        throw new Error('encrypt error');
      }

      const cell = notebook.cells[index];
      const encrypted = await security.encrypt(cell.getSource(), key);
      cell.transact(() => {
        const jupyter = (cell.getMetadata('jupyter') || {}) as any;
        cell.setMetadata('jupyter', { ...jupyter, 'source_hidden': true });
        cell.deleteMetadata('trusted');
        cell.setMetadata('editable', false);
        cell.setSource(encrypted);
      });

      const raw = { ...cell.toJSON(), cell_type: 'raw' };
      notebook.transact(() => {
        notebook.deleteCell(index);
        notebook.insertCell(index, raw);
      }, false);
      if (workbook.content) {
        NotebookActions.deselectAll(workbook.content);
      }
    }
  }

  const quiet = true;
  const defrost = (workbook: Workbook) => {
    const notebook = workbook.context.model.sharedModel;
    for (const cell of notebook.cells) {
      const jupyter = cell.getMetadata('jupyter') as any;
      if (jupyter?.source_hidden) {
        continue;
      }
      cell.transact(() => cell.deleteMetadata('editable'));
    }
  };
  const freeze = (workbook: Workbook) => {
    const notebook = workbook.context.model.sharedModel;
    for (const cell of notebook.cells) {
      cell.transact(() => cell.setMetadata('editable', false));
    }
  };
  const [get, set] = (pool => {
    const get = (workbook: Workbook) => pool.get(workbook) || null;
    const set = (workbook: Workbook, rubric: Rubric | null) =>
      pool.set(workbook, rubric).has(workbook);
    return [get, set];
  })(new WeakMap<Workbook, Rubric | null>());
  const stale = (
    assignment: Rubric.Assignment,
    {
      assignee = assignment.assignee,
      confirmation = assignment.confirmation,
      expiration = assignment.expiration,
      submission = assignment.submission,
      roster = assignment.roster,
      signature = assignment.signature
    }: Partial<Rubric.Assignment>
  ): boolean => (
    assignee !== assignment.assignee ||
    confirmation !== assignment.confirmation ||
    expiration !== assignment.expiration ||
    submission !== assignment.submission ||
    (roster !== assignment.roster &&
      (roster.length !== assignment.roster.length ||
        roster.some((record, i) => record !== assignment.roster[i]))) ||
    signature !== assignment.signature
  );

  /**
   * Add a cell to a workbook's rubric.
   */
  export async function add(
    workbook: Workbook,
    cell: Rubric.Cell
  ): Promise<Rubric.Unlocked> {
    const rubric = open(workbook, quiet);
    if (!rubric || rubric.locked) {
      throw new Error('add error, invalid rubric');
    }
    return update(workbook, Rubric.add(rubric, cell));
  }

  /**
   * Update a workbook's assignment metadata.
   *
   * @param workbook - the workbook to update.
   * @param assignment - the partial assignment data to apply.
   *
   * #### Notes
   * Fields that are `undefined` in the `assignment` argument are ignored, i.e.,
   * the existing values in the rubric are preserved.
   *
   * Fields that are `null` (where allowed, e.g. `expiration`) will explicitly
   * clear the value in the rubric.
   */
  export async function assign(
    workbook: Workbook,
    assignment: Partial<Rubric.Assignment> = {}
  ): Promise<Rubric.Unlocked> {
    const rubric = open(workbook, quiet);
    if (!rubric || rubric.locked) {
      throw new Error('assign error');
    }
    return stale(rubric.assignment, assignment)
      ? update(workbook, await Rubric.assign(rubric, assignment))
      : rubric;
  }

  /**
   * Audits a workbook's rubric, prunes unknown or invalid cells. Never throws.
   *
   * #### Notes
   * If the rubric is locked, it is left unmodified.
   */
  export function audit(workbook: Workbook, rubric: Rubric | null): Audit {
    if (!rubric) {
      return { ok: false, error: 'null rubric', rubric };
    }
    if (rubric.locked) {
      return { ok: true, pruned: [], rubric };
    }

    const notebook = workbook.context.model.sharedModel;
    const pruned: { cell: Rubric.Cell; reason: string; }[] = [];
    const known = Object.fromEntries(notebook.cells.map(
      ({ id, cell_type }) => [id, cell_type === 'code' || cell_type === 'raw'])
    );
    for (const id in rubric.cells) {
      const cell = rubric.cells[id];
      const { is, payload } = cell;
      const reference = cell.reference?.[0] ?? '';
      const valid = is === 'answerable' ? !!payload.length : known[reference];
      if (known[id] && valid) {
        continue;
      }

      const reason = known[id] ? 'invalid cell' : 'unknown cell';
      pruned.push({ cell: { ...cell }, reason });
    }
    if (pruned.length) {
      console.warn('audit pruned these rubric cells', pruned);
      const modified: Rubric = pruned.reduce((rubric, { cell: { id } }) =>
        Rubric.remove(rubric, id), rubric);
      return { ok: true, pruned, rubric: modified };
    }
    return { ok: true, pruned: [], rubric };
  }

  /**
   * Certify a workbook: correct, lock, and freeze.
   */
  export async function certify(workbook: Workbook): Promise<Certified> {
    const rubric = open(workbook, quiet);
    if (!rubric || rubric.locked) {
      throw new Error('certify error');
    }

    const corrected = await correct(workbook);
    const grade = { ...corrected, path: workbook.context.path };
    const identifier = Workbook.identifier(workbook);
    if (corrected.resolved) {
      await lock(workbook);
      freeze(workbook);
    }

    // If timestamp() throws, certify() should fail.
    return { grade, identifier, timestamp: timestamp(workbook), workbook };
  }

  /**
   * Convert a plain notebook into a workbook and return its rubric.
   */
  export async function convert(
    workbook: Workbook,
    passphrase: string,
    unlocker: Correxit.Unlocker
  ): Promise<Rubric.Unlocked> {
    try {
      const opened = open(workbook)!;
      const key = await security.keygen(passphrase, opened.id);
      const rubric = opened.locked ? await Rubric.unlock(opened, key) : opened;
      return update(workbook, rubric);
    } catch (error) {
      if (error === Correxit.NO_CORREXIT_METADATA) {
        const created = Rubric.create();
        const key = await security.keygen(passphrase, created.id);
        unlocker.store(created.id, key);
        return update(workbook, { ...created, key });
      }
      throw error;
    }
  }

  /**
   * Correct a cell (if `id` is provided) or an entire workbook.
   *
   * @param workbook - the workbook to correct.
   * @param id - the id of the cell to correct.
   *
   * @returns a promise that resolves to the correction result, i.e.,
   *  - the score for the cell or the whole workbook
   *  - the spec of the kernel used to get that score
   */
  export async function correct(
    workbook: Workbook,
    id?:string
  ): Promise<Omit<Grade, 'path'>> {
    const rubric = open(workbook, quiet);
    if (!rubric) {
      return {
        resolved: false,
        score: { ...Rubric.Score.UNSCORED, code: 'missing-rubric' },
        spec: null
      };
    }

    const result = await execute(workbook, rubric, id);
    if (!result) {
      const code: Rubric.Score.Code = 'error-execute';
      return {
        resolved: false,
        score: { ...Rubric.Score.UNSCORED, code },
        spec: null
      };
    }

    const { score, summary } = Rubric.Assignment;
    const { spec, outputs } = result;
    const report = await score(rubric, outputs, id);
    const scored = Object.entries(report.scores);
    scored.forEach(([id, score]) => state.cache(workbook, id, score));

    const final = id ? report.scores[id] : summary(report);
    const notebook = workbook.context.model.sharedModel;
    const existing = new Set(Array.from(notebook.cells).map(cell => cell.id));
    const missing = !id && Object.values(rubric.cells).some(cell => {
      const { id, is, reference } = cell;
      if (existing.has(id) && !outputs.has(id)) {
        return true;
      }
      if ((is === 'comparable' || is === 'correctable') && reference) {
        return reference.some(id => existing.has(id) && !outputs.has(id));
      }
      return false;
    });
    const resolved = !missing && final.status !== 'unscored';
    if (resolved && !rubric.locked) {
      await update(workbook, await Rubric.sign(rubric, report));
    }
    return { resolved, spec, score: final };
  }

   /**
   * Adds a comment to a cell in the assignment score report.
   *
   * @param workbook - the workbook to modify the report for.
   * @param id - the id of the cell to add comment for.
   *
   * @returns a promise that resolves when the workbook has been updated.
   */
  export async function comment(
    workbook: Workbook,
    id: string,
    comment: string
  ) {
    const rubric = open(workbook, quiet);
    if (!rubric || rubric.locked) {
      return null;
    }

    const { report: kept } = rubric.assignment;
    const scores = { ...kept.scores, [id]: { ...kept.scores[id], comment } };
    return update(workbook, await Rubric.sign(rubric, { ...kept, scores }));
  }

  /**
   * Decrypts workbook content.
   */
  export async function decrypt(workbook: Workbook, rubric: Rubric.Unlocked) {
    const audit = Workbook.audit(workbook, rubric);
    if (!audit.ok) {
      throw new Error(`decrypt error: ${audit.error}`);
    }

    const { cells, key } = audit.rubric as Rubric.Unlocked;
    for (const [, cell] of Object.entries(cells)) {
      if (cell.shared) {
        continue;
      }
      if (cell.is === 'comparable' || cell.is === 'correctable') {
        const [reference] = cell.reference;
        await Cell.decrypt(workbook, reference, key);
      }
    };
    return update(workbook, rubric, audit);
  }

  /**
   * Revert a submission to draft, restoring cell editability.
   */
  export async function draft(workbook: Workbook): Promise<Rubric.Locked> {
    const rubric = open(workbook, quiet);
    if (!rubric?.locked || !rubric.assignment.submission) {
      throw new Error('draft error');
    }
    defrost(workbook);
    return update(workbook, Rubric.draft(rubric));
  }

  /**
   * Executes the code cells of a workbook.
   *
   * @param workbook - the workbook to run.
   * @param id - the ID of the target cell.
   *
   * @returns a promise that resolves to a collection of executed cell outputs.
   *
   * #### Notes
   * If `id` is not provided, the whole workbook is executed.
   * If `id` is provided and the target cell is 'answerable', the workbook is
   * executed up to this cell.
   * If `id` is provided and the target cell is `comparable` or `correctable`,
   * the workbook is executed up to both target and reference cells.
   */
  export async function execute(
    workbook: Workbook,
    rubric: Rubric,
    id?: string
  ): Promise<{
    spec: KernelSpec.ISpecModel | null;
    outputs: Rubric.Outputs;
  } | null> {
    const { execute } = Rubric.Cell;
    const { model: { cells } } = workbook.context;
    const position = (target: string) =>
      1 + findIndex(cells, ({ id }) => id === target);
    const scan = (cell: Rubric.Cell) =>
      cell.is === 'correctable' || cell.is === 'comparable'
        ? Math.max(position(cell.id), ...cell.reference.map(position))
        : position(cell.id);
    const cell = id && Rubric.get(rubric, id);
    if (id && !cell) {
      return null;
    }

    const outputs: Rubric.Outputs = new Map();
    const leased = await kernels.lease(workbook);
    if (!leased) {
      return null;
    }

    const [kernel, release] = leased;
    const spec = await kernel.spec || null;
    for (const index of range(cell ? scan(cell) : cells.length)) {
      const cell = cells.get(index) as ICodeCellModel;
      if (cells.get(index).type !== 'code') {
        continue;
      }
      try {
        outputs.set(cell.id, await execute(cell, kernel));
      } catch (error) {
        console.warn('cell execute error', cell, error);
      }
    }
    release();
    return { outputs, spec };
  }

  export function identifier(workbook: Workbook): Identifier {
    const rubric = open(workbook, quiet);
    if (!rubric) {
      throw new Error('identifier error');
    }
    const assignee = rubric.assignment.assignee || null;
    const assignment = rubric.id;
    const signature = rubric.assignment.signature || null;
    return { assignee, assignment, signature };
  }

  /**
   * Lock a workbook if its rubric is unlocked.
   */
  export async function lock(workbook: Workbook): Promise<void> {
    const rubric = open(workbook, quiet);
    if (!rubric || rubric.locked) {
      return;
    }
    for (const id in rubric.cells) {
      const cell = rubric.cells[id];
      if (cell.shared) {
        continue;
      }
      if (cell.is === 'comparable' || cell.is === 'correctable') {
        const [reference] = cell.reference;
        await Cell.encrypt(workbook, reference, rubric.key);
      }
    };
    update(workbook, await Rubric.lock(rubric));
  }

  /**
   * Synchronously returns a workbook's rubric or `null` from notebook metadata.
   *
   * @param workbook - The current workbook. May be `null`.
   * @param quiet - Whether to return `null` or throw errors.
   *
   * #### Notes
   * If a rubric exists in the pool for the given workbook, it is returned.
   *
   * If no rubric exists in the pool for the given workbook, its notebook
   * metadata for the key `correxit` is read, parsed, normalized, and audited.
   * Each of these steps may throw an error or return null.
   * @see update
   */
  export function open(
    workbook: Workbook | null,
    quiet = false
  ): Rubric | null {
    if (!workbook) {
      if (quiet) {
        return null;
      }
      throw new TypeError('open error');
    }
    if (get(workbook)) {
      return get(workbook);
    }

    const notebook = workbook.context.model.sharedModel;
    const metadata = notebook.getMetadata('correxit');
    try {
      if (!metadata) {
        throw Correxit.NO_CORREXIT_METADATA;
      }
      const rubric = Rubric.normalize(metadata as Partial<Rubric.Locked>);
      const audit = Workbook.audit(workbook, rubric);
      if (!audit.ok) {
        throw new Error(`open error: ${audit.error}`);
      }
      set(workbook, audit.rubric);
      return audit.rubric;
    } catch (error) {
      if (quiet) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Remove a cell from a workbook's rubric.
   */
  export function remove(workbook: Workbook, id: string): void {
    const rubric = open(workbook, quiet);
    if (!rubric || rubric.locked) {
      throw new Error('remove error, invalid rubric');
    }
    update(workbook, Rubric.remove(rubric, id));
  }

  /**
   * Reset a workbook back to a plain Jupyter notebook.
   */
  export async function reset(workbook: Workbook) {
    const rubric = open(workbook, quiet);
    if (!rubric || rubric.locked) {
      throw new Error('reset error');
    }
    update(workbook, null);
  }

  /**
   * Submit an assignment, locking all cells to read-only.
   */
  export async function submit(
    workbook: Workbook,
    confirmation: string | null = null
  ): Promise<Rubric.Locked> {
    const rubric = open(workbook, quiet);
    if (!rubric?.locked) {
      throw new Error('submit error');
    }
    freeze(workbook);
    return update(workbook, Rubric.submit(rubric, confirmation));
  }

  /**
   * @returns the timestamp recorded when the assignment was signed.
   *
   * #### Notes
   * This function is only meant for use when a client expects a timestamp to
   * exist. It will throw an error if it fails to find a timestamp.
   */
  export function timestamp(workbook: Workbook): number {
    const rubric = open(workbook, quiet);
    const timestamp = rubric?.assignment.report.timestamp;
    if (!timestamp) {
      throw new Error('timestamp error');
    }
    return timestamp;
  };

  /**
   * Toggle a workbook cell's `shared` flag.
   */
  export async function toggle(
    workbook: Workbook, id: string
  ): Promise<Rubric.Unlocked> {
    const rubric = open(workbook, quiet);
    if (!rubric || rubric.locked || !Rubric.has(rubric, id)) {
      throw new Error('toggle error');
    }
    return update(workbook, Rubric.toggle(rubric, id));
  }

  /**
   * Unlocks a workbook's rubric, decrypts its contents, and returns the rubric.
   */
  export async function unlock(
    workbook: Workbook,
    key: string
  ): Promise<Rubric.Unlocked> {
    const rubric = open(workbook, quiet);
    if (!rubric) {
      throw new Error('unlock error');
    }
    if (rubric.locked) {
      return decrypt(workbook, await Rubric.unlock(rubric, key));
    }
    return rubric;
  }

  /**
   * Updates the workbook metadata with an audited rubric.
   *
   * #### Notes
   * If an `audited` value is passed in, its results are used instead of running
   * another audit.
   *
   * If `rubric` is `null`, the workbook is reset back to a notebook.
   *
   * If the given rubric passes an audit, which may prune broken cells, it is
   * locked and written to the notebook metadata `correxit` key.
   *
   * The audited rubric is returned.
   */
  export async function update(
    workbook: Workbook,
    rubric: Rubric.Locked,
    audited?: Audit
  ): Promise<Rubric.Locked>;
  export async function update(
    workbook: Workbook,
    rubric: Rubric.Unlocked,
    audited?: Audit
  ): Promise<Rubric.Unlocked>;
  export async function update(
    workbook: Workbook,
    rubric: null
  ): Promise<null>;
  export async function update(
    workbook: Workbook,
    rubric: Rubric | null,
    audited = audit(workbook, rubric)
  ): Promise<Rubric | null> {
    const notebook = workbook.context.model.sharedModel;
    if (!audited || !rubric) {
      set(workbook, null);
      notebook.deleteMetadata('correxit');
      notebook.clearUndoHistory();
      return null;
    }
    if (!audited.ok) {
      throw new Error(`update error: ${audited.error}`);
    }
    set(workbook, audited.rubric);
    notebook.setMetadata('correxit', await Rubric.lock(audited.rubric));
    return audited.rubric;
  }
}
