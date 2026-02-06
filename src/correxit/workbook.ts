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
      const { model: { sharedModel } } = workbook.context;
      const index = findIndex(sharedModel.cells, ({ id }) => id === reference);
      if (!key || index === -1) {
        throw new Error('decrypt error');
      }

      const cell = sharedModel.cells[index];
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
      sharedModel.transact(() => {
        sharedModel.deleteCell(index);
        sharedModel.insertCell(index, code);
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
      const { model: { sharedModel } } = workbook.context;
      const index = findIndex(sharedModel.cells, ({ id }) => id === reference);
      if (!key || index === -1) {
        throw new Error('encrypt error');
      }

      const cell = sharedModel.cells[index];
      const encrypted = await security.encrypt(cell.getSource(), key);
      cell.transact(() => {
        const jupyter = (cell.getMetadata('jupyter') || {}) as any;
        cell.setMetadata('jupyter', { ...jupyter, 'source_hidden': true });
        cell.deleteMetadata('trusted');
        cell.setMetadata('editable', false);
        cell.setSource(encrypted);
      });

      const raw = { ...cell.toJSON(), cell_type: 'raw' };
      sharedModel.transact(() => {
        sharedModel.deleteCell(index);
        sharedModel.insertCell(index, raw);
      }, false);
      if (workbook.content) {
        NotebookActions.deselectAll(workbook.content);
      }
    }
  }

  const quiet = true;
  const [get, set] = (pool => {
    const get = (workbook: Workbook) => pool.get(workbook) || null;
    const set = (workbook: Workbook, rubric: Rubric | null) =>
      pool.set(workbook, rubric).has(workbook);
    return [get, set];
  })(new WeakMap<Workbook, Rubric | null>());
  const metadata = (workbook: Workbook, metadata: any) => {
    if (get(workbook)?.locked === false) {
      workbook.context.model.sharedModel.setMetadata('correxit', metadata);
    }
  };

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

  export async function assign(
    workbook: Workbook,
    { assignee, roster }: Partial<Rubric.Assignment> = {}
  ): Promise<Rubric.Unlocked> {
    const rubric = open(workbook, quiet);
    if (!rubric || rubric.locked) {
      throw new Error('assign error');
    }
    const assigned = await Rubric.assign(rubric, assignee, roster || []);
    return update(workbook, assigned);
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

    const pruned: { cell: Rubric.Cell; reason: string; }[] = [];
    const known = Object.fromEntries(
      workbook.context.model.sharedModel.cells.map(cell =>
        [cell.id, cell.cell_type === 'code' || cell.cell_type === 'raw']
      )
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
      const code: Rubric.Score.Code = 'missing-rubric';
      return { spec: null, score: { ...Rubric.Score.UNSCORED, code }};
    }

    const result = await execute(workbook, rubric, id);
    if (!result) {
      const code: Rubric.Score.Code = 'error-execute';
      return { spec: null, score: { ...Rubric.Score.UNSCORED, code }};
    }

    const { score, summary } = Rubric.Assignment;
    const { spec, outputs } = result;
    const report = await score(rubric, outputs, id);
    if (!rubric.locked) {
      await update(workbook, await Rubric.sign(rubric, report));
    }
    return { spec, score: id ? report.scores[id] : summary(report) };
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
    const { report } = rubric.assignment;
    const scores = {
      ...report.scores,
      [id]: { ...report.scores[id], comment }
    };
    return update(workbook, await Rubric.sign(rubric, { ...report, scores }));
  }

  /**
   * Decrypts workbook content.
   */
  export async function decrypt(workbook: Workbook, rubric: Rubric.Unlocked) {
    const audit = Workbook.audit(workbook, rubric);
    if (!audit.ok) {
      throw new Error(`decrypt error: ${audit.error}`);
    }

    const { key, cells } = audit.rubric as Rubric.Unlocked;
    for (const id in cells) {
      const cell = cells[id];
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
    const { model: { cells } } = workbook.context;
    const position = (target: string) =>
      1 + findIndex(cells, ({ id }) => id === target);
    const scan = (cell: Rubric.Cell) =>
      cell.is === 'correctable' || cell.is === 'comparable'
        ? Math.max(position(cell.id), position(cell.reference[0]))
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

    const { execute } = Rubric.Cell;
    const [kernel, release] = leased;
    for (const index of range(cell ? scan(cell) : cells.length)) {
      const cell = cells.get(index);
      if (cell.type === 'code') {
        try {
          outputs.set(cell.id, await execute(cell as ICodeCellModel, kernel));
        } catch (error) {
          console.warn('cell execute error', cell, error);
        }
      }
    }
    release();
    return { spec: await kernel.spec || null, outputs };
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

    const metadata = workbook.context.model.sharedModel.getMetadata('correxit');
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
    audited = Workbook.audit(workbook, rubric)
  ): Promise<Rubric | null> {
    const { sharedModel } = workbook.context.model;
    set(workbook, null);
    if (!audited || !rubric) {
      sharedModel.deleteMetadata('correxit');
      sharedModel.clearUndoHistory();
      return null;
    }
    if (!audited.ok) {
      throw new Error(`update error: ${audited.error}`);
    }
    set(workbook, audited.rubric);
    metadata(workbook, await Rubric.lock(audited.rubric));
    return audited.rubric;
  }
}
