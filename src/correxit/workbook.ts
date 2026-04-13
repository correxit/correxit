import { SharedCell } from '@jupyter/ydoc';
import { ICodeCellModel } from '@jupyterlab/cells';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import { INotebookContent } from '@jupyterlab/nbformat';
import {
  INotebookModel,
  Notebook,
  NotebookActions
} from '@jupyterlab/notebook';
import { KernelSpec } from '@jupyterlab/services';
import { findIndex, range } from '@lumino/algorithm';
import { IRenderMime } from '@jupyterlab/rendermime';
import { Correxit, Rubric } from '.';
import * as certificate from './certificate';
import * as Error from './error';
import * as kernels from './kernels';
import * as security from './security';
import * as state from './state';

/** A headed or headless Correxit workbook. */
export type Workbook = Workbook.Headed | Workbook.Headless;

export namespace Workbook {
  /** The result of an audit on a workbook's rubric. */
  export type Audit = Audit.Pass | Audit.Fail;

  namespace Audit {
    export type Pass = {
      ok: true;
      rubric: Rubric;
    };

    export type Fail = { ok: false; error: string; rubric: Rubric | null; };
  }

  export type Certified = {
    grade: Workbook.Grade;
    identifier: Workbook.Identifier.Assigned;
    workbook: Workbook;
  };

  export type Credentials = |
    { path: string; unlock: null; key: null; passphrase: null; } |
    { path: string; unlock: null; key: string; passphrase: null; } |
    { path: string; unlock: null; key: null; passphrase: string; } |
    { path: string; unlock: boolean; key: null; passphrase: null; };

  export namespace Credentials {
    export function normalize(
      credentials: Partial<Credentials> | null
    ): Credentials | null {
      const { key, passphrase, path, unlock } = credentials || {};
      if (key && unlock || !path) return null;
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

  export namespace Grade {
    export type Verbose = Grade & { outputs: Rubric.Outputs; };
  }

  export type Headed = {
    readonly content: Notebook;
    readonly context: DocumentRegistry.IContext<INotebookModel>;
  };

  export type Headless = {
    readonly content: null;
    readonly context: DocumentRegistry.IContext<INotebookModel>;
  };

  /** Type guard for workbooks with a live notebook widget. */
  export function headed(workbook: Workbook | null): workbook is Headed {
    return !!workbook?.content;
  }

  /** Type guard for workbooks without a live notebook widget. */
  export function headless(workbook: Workbook | null): workbook is Headless {
    return !!workbook && workbook.content === null;
  }

  /** A type for plugins to identify a workbook/assignment/assignee match. */
  export type Identifier = {
    assignee: string | null;
    assignment: string | null;
    issue: string | null;
    rubric: string;
  };

  export namespace Identifier {
    /** An identifier with a guaranteed assignee. */
    export type Assigned = Identifier & {
      assignee: string;
    };

    /** Type guard for assigned identifiers. */
    export function assigned(id: Identifier): id is Assigned {
      return id.assignee !== null;
    }
  }

  export namespace Cell {
    export type Prepared = { index: number; replacement: SharedCell.Cell; };

    /** Returns a prepared decrypted cell replacement. */
    export async function decrypt(
      workbook: Workbook,
      reference: string,
      key: string
    ): Promise<Prepared> {
      const notebook = workbook.context.model.sharedModel;
      const index = findIndex(notebook.cells, ({ id }) => id === reference);
      if (!key || index === -1) throw new Error.Decrypt('decrypt error');

      const cell = notebook.cells[index];
      const source = await security.decrypt(cell.getSource(), key);
      const jupyter = { ...(cell.getMetadata('jupyter') as any || {}) };
      delete jupyter['source_hidden'];

      const snapshot = cell.toJSON();
      const metadata = { ...snapshot.metadata as any, jupyter, trusted: true };
      delete metadata['editable'];

      const replacement = { ...snapshot, cell_type: 'code', metadata, source };
      return { index, replacement };
    }

    /**
     * Prepares an encrypted cell replacement.
     *
     * @returns cell index and encrypted JSON with `cell_type` set to `'raw'`.
     */
    export async function encrypt(
      workbook: Workbook,
      reference: string,
      key: string
    ): Promise<Prepared> {
      const notebook = workbook.context.model.sharedModel;
      const index = findIndex(notebook.cells, ({ id }) => id === reference);
      if (!key || index === -1) throw new Error.Encrypt('encrypt error');

      const cell = notebook.cells[index];
      const source = await security.encrypt(cell.getSource(), key);
      const jupyter = {
        ...(cell.getMetadata('jupyter') as any || {}),
        source_hidden: true
      };
      const snapshot = cell.toJSON();
      const metadata = { ...snapshot.metadata, editable: false, jupyter };
      delete metadata['trusted'];

      const replacement = { ...snapshot, cell_type: 'raw', metadata, source };
      return { index, replacement };
    }

    /** Prepares a PGP-sealed cell replacement (any type -> raw). */
    export async function seal(
      workbook: Workbook,
      id: string,
      assignee: string,
      recipients: string[]
    ): Promise<Prepared> {
      const notebook = workbook.context.model.sharedModel;
      const index = findIndex(notebook.cells, cell => cell.id === id);
      if (index === -1) throw new Error.Seal('seal error: cell not found');

      const cell = notebook.cells[index];
      const type = cell.toJSON().cell_type;
      const source = cell.getSource();
      const payload = JSON.stringify({ assignee, id, source, type });
      const ciphertext = await security.seal(payload, recipients);
      const jupyter = {
        ...(cell.getMetadata('jupyter') as any || {}),
        source_hidden: true
      };
      const snapshot = cell.toJSON();
      const metadata = { ...snapshot.metadata, editable: false, jupyter };
      delete metadata['trusted'];

      const replacement = {
        ...snapshot, cell_type: 'raw', metadata, source: ciphertext
      };
      return { index, replacement };
    }

    /** Prepares an unsealed cell replacement (raw -> original type). */
    export async function unseal(
      workbook: Workbook,
      id: string,
      assignee: string,
      key: security.PrivateKey | string
    ): Promise<Prepared> {
      const notebook = workbook.context.model.sharedModel;
      const index = findIndex(notebook.cells, cell => cell.id === id);
      if (index === -1) throw new Error.Unseal('unseal error: cell not found');

      const cell = notebook.cells[index];
      const json = await security.unseal(cell.getSource(), key);
      const payload = JSON.parse(json);
      if (payload.assignee !== assignee) {
        throw new Error.Mismatch(
          `assignee mismatch: ${assignee} ≠ ${payload.assignee}`
        );
      }
      if (payload.id !== id)
        throw new Error.Mismatch('cell id mismatch: sealed cell was moved');

      const jupyter = { ...(cell.getMetadata('jupyter') as any || {}) };
      delete jupyter['source_hidden'];
      const snapshot = cell.toJSON();
      const metadata = { ...snapshot.metadata as any, jupyter };
      delete metadata['editable'];

      const replacement = {
        ...snapshot, cell_type: payload.type, metadata, source: payload.source
      };
      return { index, replacement };
    }

  }

  const quiet = true;
  const defrost = (workbook: Workbook) => {
    const notebook = workbook.context.model.sharedModel;
    for (const cell of notebook.cells) {
      const jupyter = cell.getMetadata('jupyter') as any;
      if (jupyter?.source_hidden) continue;
      cell.transact(() => cell.deleteMetadata('editable'));
    }
  };
  const freeze = (workbook: Workbook) => {
    const notebook = workbook.context.model.sharedModel;
    for (const cell of notebook.cells)
      cell.transact(() => cell.setMetadata('editable', false));

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
      expiration = assignment.expiration,
      id = assignment.id,
      issue = assignment.issue,
      issuer = assignment.issuer,
      mac = assignment.mac,
      name = assignment.name,
      submission = assignment.submission,
      submitted = assignment.submitted,
      roster = assignment.roster,
    }: Partial<Rubric.Assignment>
  ): boolean => (
    assignee !== assignment.assignee ||
    expiration !== assignment.expiration ||
    id !== assignment.id ||
    issue !== assignment.issue ||
    issuer !== assignment.issuer ||
    mac !== assignment.mac ||
    name !== assignment.name ||
    submission !== assignment.submission ||
    submitted !== assignment.submitted ||
    (roster !== assignment.roster &&
      (roster.length !== assignment.roster.length ||
        roster.some((record, i) => record !== assignment.roster[i]))) ||
    false
  );
  const transact = (workbook: Workbook, prepared: Cell.Prepared[]): void => {
    if (!prepared.length) return;
    const notebook = workbook.context.model.sharedModel;
    notebook.transact(() => {
      for (const { index, replacement } of prepared) {
        notebook.deleteCell(index);
        notebook.insertCell(index, replacement);
      }
    }, false);
    if (headed(workbook)) NotebookActions.deselectAll(workbook.content);
  };
  const verify = async (
    workbook: Workbook,
    rubric: Rubric.Locked,
    action: 'unlock' | 'revise'
  ): Promise<string[]> => {
    const { seal } = rubric.assignment;
    if (!seal) return [];

    const ids = Object.keys(rubric.cells).sort();
    const notebook = workbook.context.model.sharedModel;
    const index = Object.fromEntries(
      notebook.cells.map(cell => [cell.id, cell])
    );
    const present = ids.filter(id => id in index);
    const missing = ids.filter(id => !(id in index));
    if (missing.length) {
      if (headless(workbook))
        throw new Error.Unseal(`${action} seal error: missing cells`);
      console.warn(`${action}: skipping seal verify, missing cells`, missing);
      return present;
    }

    const ciphertexts = present.map(id => index[id].getSource());
    const hash = await security.digest(ciphertexts.join('\n'));
    if (hash !== seal)
      throw new Error.Mismatch('seal mismatch: ciphertexts tampered');
    return present;
  };
  type Keys = { private: Record<string, unknown> | null; };
  type Payload = {
    assignee?: unknown;
    id?: unknown;
    source?: unknown;
    type?: unknown;
  };
  type Recovered = Cell.Prepared & { payload: Payload | null; };
  const forensic = (metadata: unknown) => {
    const root = record(metadata) ? metadata : null;
    const assignment = root && record(root.assignment) ? root.assignment : null;
    const keys: Keys | null = assignment && record(assignment.keys)
      ? {
          private: record(assignment.keys.private)
            ? assignment.keys.private
            : null
        }
      : null;
    return {
      assignment,
      assignee: text(assignment?.assignee),
      id: text(root?.id),
      keys
    };
  };
  const record = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  const rescue = async (
    field: unknown,
    key: string,
    recipients: security.PrivateKey[]
  ): Promise<void> => {
    const armored = text(field);
    if (!armored) return;
    try {
      const decrypted = await security.decrypt(armored, key);
      if (decrypted !== armored)
        recipients.push(await security.parse(decrypted));
    } catch { /* wrong key or corrupt */ }
  };
  const reveal = async (
    source: string,
    key: string,
    recipients: security.PrivateKey[]
  ): Promise<{ payload: Payload | null; recovered: string | null; }> => {
    try {
      const decrypted = await security.decrypt(source, key);
      if (decrypted !== source)
        return { payload: null, recovered: decrypted };
    } catch { /* wrong key */ }
    for (const recipient of recipients) {
      try {
        const json = await security.unseal(source, recipient);
        const decoded = JSON.parse(json) as unknown;
        return {
          payload: record(decoded) ? decoded : null,
          recovered: null
        };
      } catch { /* wrong key or not sealed to this recipient */ }
    }
    return { payload: null, recovered: null };
  };
  const text = (value: unknown): string | null =>
    typeof value === 'string' ? value : null;

  /** Add a cell to a workbook's rubric. */
  export async function add(
    workbook: Workbook,
    cell: Rubric.Cell,
    references: Rubric.Cell.Reference[] = []
  ): Promise<Rubric.Unlocked> {
    const rubric = open(workbook, quiet);
    if (!rubric || rubric.locked)
      throw new Error.Invalid('add error, invalid rubric');
    return update(workbook, Rubric.add(rubric, cell, references));
  }

  /** Acknowledge a submitted workbook grade with a receipt. */
  export async function acknowledge(
    workbook: Workbook,
    receipt: string | null = null
  ): Promise<Rubric.Locked> {
    const rubric = open(workbook, quiet);
    if (!rubric || !rubric.locked || !rubric.assignment.submission)
      throw new Error.Submit('acknowledge error');
    return update(workbook, Rubric.acknowledge(rubric, receipt));
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
    if (!rubric || rubric.locked) throw new Error.Invalid('assign error');
    return stale(rubric.assignment, assignment)
      ? update(workbook, await Rubric.assign(rubric, assignment))
      : rubric;
  }

  /**
   * Audits a workbook's rubric, pruning impossible cells and references.
   * Never throws.
   *
   * #### Notes
   * If the rubric is locked, it is left unmodified.
   *
   * Headed workbooks repair missing notebook state when possible: orphaned
   * references are removed, and cells left invalid or unscorable are dropped.
   * Headless workbooks fail immediately. Batch grading cannot recover from
   * a structurally incomplete notebook.
   */
  export function audit(workbook: Workbook, rubric: Rubric | null): Audit {
    if (!rubric) return { ok: false, error: 'null rubric', rubric };
    if (rubric.locked) return { ok: true, rubric };
    const notebook = workbook.context.model.sharedModel;
    const types = Object.fromEntries(
      notebook.cells.map(cell => [cell.id, cell.cell_type])
    );
    const orphaned: string[] = [];
    const dangling: { cell: Rubric.Cell; reason: string; }[] = [];
    const executable = (id: string) =>
      types[id] === 'code' || types[id] === 'raw';
    for (const id in rubric.cells) {
      const cell = rubric.cells[id];
      const { is, payload } = cell;
      const present = is === 'reviewable' ? id in types : executable(id);
      const valid = is === 'answerable' ? !!payload.length : true;
      if (!present || !valid) {
        const reason = id in types ? 'invalid cell' : 'unknown cell';
        dangling.push({ cell: { ...cell }, reason });
        continue;
      }

      const references = Object.values(rubric.references)
        .filter(reference => reference.cell === id);
      orphaned.push(
        ...references
          .filter(reference => !executable(reference.referent))
          .map(reference => reference.referent)
      );
    }
    if (dangling.length || orphaned.length) {
      if (dangling.length)
        console.warn('audit pruned these rubric cells', dangling);
      if (orphaned.length)
        console.warn('audit pruned these references', orphaned);
      if (headless(workbook)) {
        const error = dangling.length ? 'missing cells' : 'missing references';
        return { ok: false, error, rubric };
      }
      const dereferenced = orphaned.reduce(
        (unlocked, referent) => Rubric.dereference(unlocked, referent),
        rubric as Rubric.Unlocked
      );
      const scrubbed = dangling.reduce(
        (unlocked, { cell: { id } }) => Rubric.remove(unlocked, id),
        dereferenced
      );
      return { ok: true, rubric: scrubbed };
    }
    return { ok: true, rubric };
  }

  /** Collect a certified workbook grade. */
  export async function collect(
    workbook: Workbook,
    receipt: string | null = null
  ): Promise<Rubric.Locked> {
    const rubric = open(workbook, quiet);
    if (!rubric || !rubric.locked || !rubric.assignment.certification)
      throw new Error.Certify('collect error');
    return update(workbook, Rubric.collect(rubric, receipt));
  }

  export async function distribute(workbook: Workbook): Promise<Rubric> {
    const rubric = open(workbook, quiet);
    if (!rubric || !rubric.locked || !rubric.assignment.assignee)
      throw new Error.Invalid('distribute error');
    return update(workbook, Rubric.distribute(rubric));
  }

  /**
   * Certify a workbook: correct, lock, and freeze.
   *
   * When `bypass` is true, skip kernel re-execution and build the grade
   * from the existing report scores. Use this when all cells have already
   * been graded and reviewed (e.g. after the last manual intervention).
   */
  export async function certify(
    workbook: Workbook,
    trans: IRenderMime.TranslationBundle,
    bypass = false
  ): Promise<Certified> {
    const rubric = open(workbook, quiet);
    if (!rubric || rubric.locked) throw new Error.Certify('certify error');

    const { interventions } = rubric.assignment.report;
    const pending = Object.values(rubric.cells)
      .filter(({ is }) => is === 'reviewable')
      .some(({ id }) => !interventions[id]);
    if (pending) throw new Error.Certify('certify error: pending review');

    const identifier = Workbook.identifier(workbook);
    if (!Identifier.assigned(identifier))
      throw new Error.Certify('certify error: unassigned');

    let grade: Grade;
    if (bypass) {
      const { report } = rubric.assignment;
      const score = Rubric.Assignment.summary(report);
      const cells = Object.values(rubric.cells);
      const ungraded = cells.some(cell =>
        cell.is !== 'reviewable' &&
        (!report.scores[cell.id] ||
          report.scores[cell.id].status === 'unscored')
      );
      const resolved = !ungraded && score.status !== 'unscored';
      const { path } = workbook.context;
      grade = { path, resolved, score, spec: report.kernel };
    } else {
      grade = await correct(workbook);
    }
    if (!grade.resolved) {
      throw new Error.Certify(
        `certify error: unresolved: (${grade.score.status})`
      );
    }

    const scored = open(workbook, quiet);
    if (!scored || scored.locked) throw new Error.Certify('certify error');
    await update(workbook, Rubric.certify(scored));
    await lock(workbook);
    certificate.render(workbook, grade, trans);
    freeze(workbook);
    return { grade, identifier, workbook };
  }

  /** Convert a plain notebook into a workbook and return its rubric. */
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
        const model = workbook.context.model;
        if (model.nbformatMinor < 5) {
          // Ensure nbformat 4.5 so cell IDs persist on save.
          const notebook = model.toJSON() as INotebookContent;
          notebook.nbformat_minor = 5;
          model.fromJSON(notebook);
        }

        const created = Rubric.create();
        const key = await security.keygen(passphrase, created.id);
        const pair = await security.keypair();
        const armored = await security.encrypt(pair.private, key);
        const keys: Rubric.Assignment.Keys = {
          private: { assignee: null, author: armored },
          public: { assignee: null, author: pair.public }
        };
        const assignment = { ...created.assignment, keys };
        unlocker.store(created.id, key);
        return update(workbook, { ...created, assignment, key });
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
    id: string,
    verbose: true
  ): Promise<Grade.Verbose>;
  export async function correct(
    workbook: Workbook,
    id?: string,
    verbose?: false
  ): Promise<Grade>;
  export async function correct(
    workbook: Workbook,
    id?: string,
    verbose?: boolean
  ): Promise<Grade | Grade.Verbose> {
    const path = workbook.context.path;
    const opened = open(workbook, quiet);
    const empty = new Map() as Rubric.Outputs;
    const expand = (grade: Grade, outputs: Rubric.Outputs) =>
      verbose ? { ...grade, outputs } : grade;
    if (!opened) {
      const score: Rubric.Score =
        { ...Rubric.Score.UNSCORED, code: 'missing-rubric' };
      return expand({ path, resolved: false, score, spec: null }, empty);
    }

    // Re-audit to get the repaired rubric: headed workbooks remove
    // orphaned references and drop impossible cells, headless ones fail.
    const audited = audit(workbook, opened);
    if (!audited.ok) {
      const score = { ...Rubric.Score.UNSCORED, comment: audited.error };
      return expand({ path, resolved: false, score, spec: null }, empty);
    }

    const rubric = audited.rubric;
    const reviewable = ({ is }: Rubric.Cell) => is === 'reviewable';
    const cells = Object.values(rubric.cells);
    const target = id ? Rubric.get(rubric, id) : null;
    const manual = target
      ? target.is === 'reviewable'
      : cells.length > 0 && cells.every(reviewable);
    const result = manual
      ? { spec: null, outputs: new Map() as Rubric.Outputs }
      : await execute(workbook, rubric, id);
    if (!result) {
      const score: Rubric.Score =
        { ...Rubric.Score.UNSCORED, code: 'error-execute' };
      return expand({ path, resolved: false, score, spec: null }, empty);
    }

    const { score, summary } = Rubric.Assignment;
    const { outputs, spec } = result;
    const report = { ...await score(rubric, outputs, id), kernel: spec };
    const scored = Object.entries(report.scores);
    scored.forEach(([id, score]) => state.cache(workbook, id, score));

    const final = id ? report.scores[id] : summary(report);
    const missing = ({ id, is, references }: Rubric.Cell) => {
      if (is === 'reviewable') return false;
      return !outputs.has(id) ||
        ((is === 'comparable' || is === 'correctable')
          && references
          ? references.some(referent => !outputs.has(referent))
          : false);
    };
    const unresolved = (cell: Rubric.Cell) => {
      const { status } = report.scores[cell.id] || {};
      return cell.is !== 'reviewable' && (!status || status === 'unscored');
    };
    const resolved = id
      ? final.status !== 'unscored'
      : !cells.some(missing) && !cells.some(unresolved);
    if (resolved && !rubric.locked)
      await update(workbook, await Rubric.sign(rubric, report));
    return expand({ path, resolved, score: final, spec }, outputs);
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
    if (!rubric || rubric.locked) return null;

    const { report: kept } = rubric.assignment;
    const scores = { ...kept.scores, [id]: { ...kept.scores[id], comment } };
    const signed = await Rubric.sign(rubric, { ...kept, scores });
    return update(workbook, signed);
  }

  /** Decrypts workbook content. */
  export async function decrypt(
    workbook: Workbook,
    rubric: Rubric.Unlocked
  ) {
    const audited = Workbook.audit(workbook, rubric);
    if (!audited.ok)
      throw new Error.Decrypt(`decrypt error: ${audited.error}`);

    const { key, references } = audited.rubric as Rubric.Unlocked;
    const secrets = Object.values(references).filter(({ secret }) => secret);
    const prepared = await Promise.all(
      secrets.map(({ referent }) => Cell.decrypt(workbook, referent, key))
    );
    transact(workbook, prepared);
    defrost(workbook);
    // Keep the original rubric. Decrypt should not persist audit repairs.
    return update(workbook, rubric, { ok: true, rubric });
  }

  /** Remove a single reference from a cell. */
  export function dereference(
    workbook: Workbook,
    referent: string
  ): void {
    const rubric = open(workbook, quiet);
    if (!rubric || rubric.locked)
      throw new Error.Invalid('dereference error, invalid rubric');
    update(workbook, Rubric.dereference(rubric, referent));
  }

  /** Revert a submission to draft, restoring cell editability. */
  export async function draft(workbook: Workbook): Promise<Rubric.Locked> {
    const rubric = open(workbook, quiet);
    if (!rubric?.locked || !rubric.assignment.submission)
      throw new Error.Submit('draft error');
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
        ? Math.max(position(cell.id), ...cell.references.map(position))
        : position(cell.id);
    const cell = id && Rubric.get(rubric, id);
    if (id && !cell) return null;

    const outputs: Rubric.Outputs = new Map();
    const leased = await kernels.lease(workbook);
    if (!leased) return null;

    const [kernel, release] = leased;
    try {
      const spec = await kernel.spec || null;
      for (const index of range(cell ? scan(cell) : cells.length)) {
        const cell = cells.get(index);
        if (!cell || cell.type !== 'code') continue;
        try {
          outputs.set(cell.id, await execute(cell as ICodeCellModel, kernel));
        } catch (error) {
          console.warn('cell execute error', cell, error);
        }
      }
      return { outputs, spec };
    } finally {
      await release();
    }
  }

  export function identifier(workbook: Workbook): Identifier {
    const rubric = open(workbook, quiet);
    if (!rubric) throw new Error.Invalid('identifier error');
    const assignee = rubric.assignment.assignee || null;
    const assignment = rubric.assignment.id;
    const issue = rubric.assignment.issue || null;
    return { assignee, assignment, issue, rubric: rubric.id };
  }

  export async function unstarted(workbook: Workbook): Promise<boolean> {
    const rubric = open(workbook, quiet);
    if (!rubric) return false;
    const notebook = workbook.context.model.sharedModel.toJSON();
    return Rubric.Assignment.unstarted({
      assignment: rubric.assignment,
      notebook,
      rubric
    });
  }

  /** Lock a workbook if its rubric is unlocked. */
  export async function lock(
    workbook: Workbook
  ): Promise<void> {
    const rubric = open(workbook, quiet);
    if (!rubric || rubric.locked) return;

    const audited = audit(workbook, rubric);
    if (!audited.ok) throw new Error.Invalid(`lock error: ${audited.error}`);
    const valid = audited.rubric as Rubric.Unlocked;

    const { key, references } = valid;
    const secrets = Object.values(references).filter(({ secret }) => secret);
    const prepared = await Promise.all(
      secrets.map(({ referent }) => Cell.encrypt(workbook, referent, key))
    );
    transact(workbook, prepared);
    update(workbook, await Rubric.lock(valid));
  }

  /**
   * Intervenes with a manual score for a cell.
   *
   * @param workbook - the workbook to modify the report for.
   * @param id - the id of the cell to intervene on.
   * @param intervention - the manual score intervention.
   *
   * @returns a promise that resolves when the workbook has been updated.
   */
  export async function intervene(
    workbook: Workbook,
    id: string,
    intervention: Rubric.Score | null
  ) {
    const rubric = open(workbook, quiet);
    if (!rubric || rubric.locked) return null;

    const { report: kept } = rubric.assignment;
    const interventions = { ...kept.interventions };
    if (intervention) interventions[id] = intervention;
    else delete interventions[id];

    const report = { ...kept, interventions };
    return update(workbook, await Rubric.sign(rubric, report));
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
      if (quiet) return null;
      throw new Error.Invalid('open error');
    }
    if (get(workbook)) return get(workbook);

    const notebook = workbook.context.model.sharedModel;
    const metadata = notebook.getMetadata('correxit');
    try {
      if (!metadata) throw Correxit.NO_CORREXIT_METADATA;
      const rubric = Rubric.normalize(metadata as Partial<Rubric.Locked>);
      const audit = Workbook.audit(workbook, rubric);
      if (!audit.ok) throw new Error.Invalid(`open error: ${audit.error}`);
      set(workbook, audit.rubric);
      return audit.rubric;
    } catch (error) {
      if (quiet) return null;
      throw error;
    }
  }

  /** @returns provisioned recipient keys for a given workbook. */
  export async function recipients(
    workbook: Workbook,
    passphrase: string | null
  ): Promise<string[]> {
    const rubric = open(workbook, quiet);
    if (!rubric?.locked || !rubric.assignment.assignee)
      throw new Error.Submit('recipients error');

    const { author } = rubric.assignment.keys.public;
    if (!passphrase) return [author];

    const secret = await security.keygen(passphrase, rubric.id);
    const pair = await security.keypair();
    const armored = await security.encrypt(pair.private, secret);
    const keys: Rubric.Assignment.Keys = {
      private: { ...rubric.assignment.keys.private, assignee: armored },
      public: { ...rubric.assignment.keys.public, assignee: pair.public }
    };
    await update(workbook, Rubric.provision(rubric, keys));
    return [author, pair.public];
  }

  /**
   * Attempt to decrypt all encrypted cells in a workbook.
   *
   * Reads the rubric ID and encrypted PGP keys directly from raw
   * notebook metadata (no normalization required). Tries symmetric
   * decryption and, if PGP private keys can be recovered, asymmetric
   * unsealing on every encrypted cell.
   *
   * @returns the number of cells successfully recovered.
   */
  export async function recover(
    workbook: Workbook,
    passphrase: string
  ): Promise<number> {
    const notebook = workbook.context.model.sharedModel;
    const { assignee, id, keys } = forensic(
      notebook.getMetadata('correxit') as unknown
    );
    if (!id) return 0;

    const key = await security.keygen(passphrase, id);
    const recipients: security.PrivateKey[] = [];
    const types = new Set(['code', 'markdown', 'raw']);
    const sanitize = ({ index, payload, replacement }: Recovered) => {
      if (!payload) return [{ index, replacement }];
      if (payload.id !== notebook.cells[index].id) return [];
      if (typeof payload.source !== 'string') return [];
      if (typeof payload.type !== 'string' || !types.has(payload.type))
        return [];
      if (assignee && payload.assignee !== assignee) return [];
      return [{ index, replacement }];
    };
    await rescue(keys?.private?.author, key, recipients);
    await rescue(keys?.private?.assignee, key, recipients);

    const prepared: Recovered[] = [];
    for (const [index, cell] of notebook.cells.entries()) {
      const source = cell.getSource();
      if (!security.encrypted(source)) continue;

      const { payload, recovered } = await reveal(source, key, recipients);
      if (!recovered && !payload) continue;

      const raw = cell.getMetadata('jupyter');
      const jupyter = record(raw) ? { ...raw } : {};
      delete jupyter['source_hidden'];

      const snapshot = cell.toJSON();
      const metadata = { ...snapshot.metadata, jupyter, trusted: true };
      delete (metadata as { editable?: unknown }).editable;

      const cell_type = text(payload?.type) || 'code';
      const unsealed = text(payload?.source) || recovered!;
      const replacement = {
        ...snapshot, cell_type, metadata, source: unsealed
      };
      prepared.push({ index, payload, replacement });
    }

    const sanitized = prepared.flatMap(sanitize);
    transact(workbook, sanitized);
    if (sanitized.length) defrost(workbook);
    return sanitized.length;
  }

  /** Add a reference to an existing comparable or correctable cell. */
  export async function refer(
    workbook: Workbook,
    id: string,
    reference: Rubric.Cell.Reference
  ): Promise<Rubric.Unlocked> {
    const rubric = open(workbook, quiet);
    if (!rubric || rubric.locked)
      throw new Error.Invalid('refer error, invalid rubric');
    return update(workbook, Rubric.refer(rubric, id, reference));
  }

  /** Remove a cell from a workbook's rubric. */
  export function remove(workbook: Workbook, id: string): void {
    const rubric = open(workbook, quiet);
    if (!rubric || rubric.locked)
      throw new Error.Invalid('remove error, invalid rubric');

    update(workbook, Rubric.remove(rubric, id));
  }

  /** Reset a workbook back to a plain Jupyter notebook. */
  export async function reset(workbook: Workbook) {
    update(workbook, null);
  }

  /** Revise a sealed submission: unseal cells and clear submission state. */
  export async function revise(
    workbook: Workbook,
    key: security.PrivateKey | string
  ): Promise<Rubric.Locked> {
    const rubric = open(workbook, quiet);
    if (!rubric?.locked || !rubric.assignment.seal)
      throw new Error.Revise('revise error');

    const { assignee } = rubric.assignment;
    const ids = await verify(workbook, rubric, 'revise');
    const prepared = await Promise.all(
      ids.map(id => Cell.unseal(workbook, id, assignee, key))
    );
    transact(workbook, prepared);
    defrost(workbook);
    return update(workbook, Rubric.unseal(rubric));
  }

  /** Update points for a cell or reference. */
  export async function reweight(
    workbook: Workbook,
    id: string,
    points: number
  ): Promise<Rubric.Unlocked> {
    const rubric = open(workbook, quiet);
    if (!rubric || rubric.locked)
      throw new Error.Invalid('reweight error, invalid rubric');

    const updated = id in rubric.references
      ? Rubric.Reference.reweight(rubric, id, points)
      : Rubric.Cell.reweight(rubric, id, points);
    return update(workbook, updated);
  }

  /**
   * Seal all rubric cells in a workbook, encrypting their sources
   * to the given PGP public key recipients.
   *
   * @returns the seal hash (SHA-256 of concatenated ciphertexts).
   */
  export async function seal(
    workbook: Workbook,
    rubric: Rubric.Locked,
    recipients: string[]
  ): Promise<string> {
    const { assignee } = rubric.assignment;
    const ids = Object.keys(rubric.cells).sort();
    const prepared = await Promise.all(
      ids.map(id => Cell.seal(workbook, id, assignee, recipients))
    );
    transact(workbook, prepared);

    const sources = prepared.map(({ replacement: { source } }) => source);
    const joined = sources.join('\n');
    return security.digest(joined);
  }

  /** Submit an assignment: seal rubric cells, then freeze. */
  export async function submit(
    workbook: Workbook,
    recipients: string[]
  ): Promise<Rubric.Locked> {
    const rubric = open(workbook, quiet);
    if (!rubric?.locked) throw new Error.Submit('submit error');
    if (!recipients.length)
      throw new Error.Submit('submit error: missing seal recipients');

    const hash = await seal(workbook, rubric, recipients);
    const sealed = Rubric.seal(rubric, hash);
    freeze(workbook);
    return update(workbook, Rubric.submit(sealed));
  }

  /** Toggle a workbook reference's `secret` flag. */
  export async function toggle(
    workbook: Workbook,
    referent: string
  ): Promise<Rubric.Unlocked> {
    const rubric = open(workbook, quiet);
    if (!rubric || rubric.locked)
      throw new Error.Invalid('toggle error');
    return update(workbook, Rubric.toggle(rubric, referent));
  }

  /** Unlocks a workbook's rubric and decrypts its contents. */
  export async function unlock(
    workbook: Workbook,
    key: string
  ): Promise<Rubric.Unlocked> {
    const rubric = open(workbook, quiet);
    if (!rubric) throw new Error.Unlock('unlock error');
    if (!rubric.locked) return rubric;

    let unlocked = await Rubric.unlock(rubric, key);
    const { assignment } = rubric;
    if (assignment.seal) {
      const armored = await security.decrypt(
        assignment.keys.private.author, key
      );
      const author = await security.parse(armored);
      const present = await verify(workbook, rubric, 'unlock');

      // Unseal each rubric cell present in the notebook.
      const { assignee } = assignment;
      const prepared = await Promise.all(
        present.map(id => Cell.unseal(workbook, id, assignee, author))
      );
      transact(workbook, prepared);

      // Clear the seal: cells are now plaintext, so the hash would not
      // match on a subsequent unlock after save-and-reopen.
      unlocked = {
        ...unlocked,
        assignment: { ...unlocked.assignment, seal: null }
      };
    }

    return decrypt(workbook, unlocked);
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
  export async function update(workbook: Workbook, rubric: null): Promise<null>;
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
    if (!audited.ok) throw new Error.Invalid(`update error: ${audited.error}`);
    set(workbook, audited.rubric);
    notebook.setMetadata('correxit', await Rubric.lock(audited.rubric));
    return audited.rubric;
  }
}
