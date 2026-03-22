import { ICodeCellModel } from '@jupyterlab/cells';
import { Kernel, KernelMessage, KernelSpec } from '@jupyterlab/services';
import { find } from '@lumino/algorithm';
import * as Error from './error';
import * as security from './security';

/**
 * A rubric is the specification that describes how to augment a Jupyter
 * notebook with the functionality of a Correxit workbook, including cell
 * correction configuration, assignment metadata, etc.
 *
 * Rubrics are immutable.
 */
export type Rubric = Rubric.Locked | Rubric.Unlocked;

export namespace Rubric {
  /** Assignment integrity, lifecycle, and grading metadata. */
  export type Assignment = Readonly<{
    assignee: string;
    certification: Timestamp;
    collected: string | null;
    expiration: Timestamp;
    id: string | null;
    keys: Assignment.Keys;
    name: string;
    report: Assignment.Report;
    roster: string[];
    seal: string | null;
    signature: string;
    submission: Timestamp;
    submitted: string | null;
  }>;

  type Base = Readonly<{
    assignment: Assignment;
    cells: Readonly<{ [id: string]: Cell }>;
    id: string;
    references: Readonly<{ [referent: string]: Cell.Reference; }>;
    revised: number;
  }>;

  /** Cell grading configuration. */
  export type Cell = Readonly<{
    id: string;
    is: 'answerable';
    payload: string[];
    points: number;
    references: null;
  }> | Readonly<{
    id: string;
    is: 'comparable' | 'correctable';
    payload: null;
    points: number;
    references: string[];
  }> | Readonly<{
    id: string;
    is: 'reviewable';
    payload: null;
    points: number;
    references: null;
  }>;

  export namespace Cell {
    /** A reference cell that serves as an oracle for scoring. */
    export type Reference = Readonly<{
      cell: string;
      points: number;
      referent: string;
      secret: boolean;
    }>;

    /** An output is an `iopub` message of interest. */
    export type Output =
      | KernelMessage.IIOPubMessage<'execute_result'>
      | KernelMessage.IIOPubMessage<'display_data'>
      | KernelMessage.IIOPubMessage<'stream'>
      | KernelMessage.IIOPubMessage<'error'>;

    namespace Output {
      export const error = ({ header }: Output) => header.msg_type === 'error';

      export const stdout = (output: Output) =>
        stream(output) &&
        (output as KernelMessage.IStreamMsg).content.name === 'stdout';

      export const stream = ({ header }: Output) =>
        header.msg_type === 'stream';

      export const text = (output: Output) =>
        (output as KernelMessage.IStreamMsg).content.text;
    }

    export type Toolbar = { [TOOLBAR]?: boolean; };

    export const TOOLBAR = 'correxit:cell-toolbar';

    export const types = Object.freeze(
      ['answerable', 'comparable', 'correctable', 'reviewable']
    );

    export async function answer(
      [expected]: string[],
      given: Output[]
    ): Promise<Score> {
      const { error, stdout, stream, text } = Output;
      if (!expected) return { ...Score.UNSCORED, code: 'empty-expected' };
      if (!given.length) return { ...Score.INCORRECT, code: 'empty-given' };
      if (find(given, error))
        return { ...Score.INCORRECT, code: 'error-given' };
      if (find(given, stream)) {
        const answered = given.filter(stdout).map(text).join('').trim();
        if (answered) {
          const digest = await security.digest(answered);
          const score = digest === expected ? Score.CORRECT : Score.INCORRECT;
          const code = score === Score.INCORRECT ? 'mismatch-digest' : '';
          return { ...score, code };
        }
        return { ...Score.INCORRECT, code: 'missing-stdout' };
      }
      return { ...Score.UNSCORED, code: 'mismatch-message' };
    }

    export async function compare(
      expected: Output[],
      given: Output[]
    ): Promise<Score> {
      if (!expected.length)
        return { ...Score.UNSCORED, code: 'empty-expected' };
      if (!given.length) return { ...Score.INCORRECT, code: 'empty-given' };

      const shape = (content: Output['content']) =>
        Object.keys(content).sort().join('');
      const [{ content: x }] = expected.slice(-1);
      const [{ content: y }] = given.slice(-1);
      if (shape(x) !== shape(y))
        return { ...Score.INCORRECT, code: 'mismatch-congruence' };
      if ('data' in x && 'data' in y) {
        const equal = JSON.stringify(x.data) === JSON.stringify(y.data);
        const error: Score = { ...Score.INCORRECT, code: 'mismatch-data' };
        return equal ? Score.CORRECT : error;
      }
      if ('name' in x && 'name' in y) {
        const error: Score = { ...Score.INCORRECT, code: 'mismatch-name-text' };
        return x.name === y.name && x.text === y.text ? Score.CORRECT : error;
      }
      return { ...Score.UNSCORED, code: 'error-compare' };
    };

    export async function correct(expected: Output[]): Promise<Score> {
      return expected.some(Output.error) ? Score.INCORRECT : Score.CORRECT;
    }

    /**
     * Execute one cell's source in a kernel.
     *
     * @param kernel - the kernel to use.
     * @param cell - the model of the cell to execute.
     *
     * @returns an array of of cell outputs.
     */
    export async function execute(
      { sharedModel: cell }: ICodeCellModel,
      kernel: Kernel.IKernelConnection
    ): Promise<Output[]> {
      const outputs: Output[] = [];
      const code = cell.getSource();
      if (!code.length) return outputs;

      const dispose = true;
      const future = kernel.requestExecute({ code }, dispose);
      future.onIOPub = (message: KernelMessage.IIOPubMessage) => {
        if (message.header.msg_type === 'execute_result' ||
            message.header.msg_type === 'display_data' ||
            message.header.msg_type === 'stream' ||
            message.header.msg_type === 'error')
          outputs.push(message as Output);
      };
      await future.done;
      return outputs;
    }

    export async function review(intervention: Score | null): Promise<Score> {
      return intervention ?? { ...Score.UNSCORED, code: 'intervene' };
    }

    /** @returns a rubric with the possible points for a given cell updated. */
    export function reweight(
      rubric: Unlocked,
      id: string,
      possible: number
    ): Unlocked {
      const cell = get(rubric, id);
      if (!cell)
        throw new Error.Invalid(`reweight error, cell ${id} not in rubric`);

      const assignment = {
        ...rubric.assignment,
        report: Assignment.Report.empty()
      };
      const cells = { ...rubric.cells, [id]: { ...cell, points: possible } };
      return { ...rubric, assignment, cells, revised: Date.now() };
    }

    /**
     * Get the score for a single cell.
     *
     * @param rubric - the rubric that defines the cell being scored.
     * @param id - the id of the cell to score.
     * @param outputs - the outputs of all the executed workbook cells.
     *
     * @returns a promise that resolves to the score for this cell.
     */
    export async function score(
      rubric: Rubric,
      id: string,
      outputs: Outputs
    ): Promise<Score> {
      const cell = get(rubric, id);
      const given = outputs.get(id);
      const intervention = rubric.assignment.report.interventions[id];
      if (!cell)
        return { ...Score.UNSCORED, code: 'missing-cell-given', id };

      const possible = cell.points;
      if (cell.is === 'reviewable') {
        const score = await review(intervention ?? null);
        if (score.status === 'unscored') return { ...score, id, possible };

        const capped = Math.max(0, Math.min(score.points, possible));
        const status: Score.Status =
          capped === possible ? 'correct'
          : capped === 0 ? 'incorrect'
          : 'partial';
        return { ...score, id, points: capped, possible, status };
      }
      if (!given)
        return { ...Score.INCORRECT, code: 'missing-given', id, possible };

      if (cell.is === 'answerable') {
        const points = ({ status }: Score) =>
          status === 'correct' ? possible : 0;
        const score = await answer(cell.payload, given);
        return { ...score, id, points: points(score), possible };
      }

      const references = Object.values(rubric.references)
        .filter(reference => reference.cell === id);
      const visible = rubric.locked
        ? references.filter(reference => !reference.secret)
        : references;

      if (cell.is === 'comparable') {
        const [reference] = visible;
        if (!reference)
          return { ...Score.INCORRECT, code: 'locked', id, possible };
        const expected = outputs.get(reference.referent);
        if (!expected) {
          return {
            ...Score.INCORRECT, code: 'missing-reference', id, possible
          };
        }

        const points = ({ status }: Score) =>
          status === 'correct' ? possible : 0;
        const score = await compare(expected, given);
        return { ...score, id, points: points(score), possible };
      }

      if (cell.is === 'correctable') {
        if (!visible.length)
          return { ...Score.INCORRECT, code: 'locked', id, possible };

        const total = visible.reduce((sum, { points }) => sum + points, 0);
        let earned = 0;
        let missing = false;
        for (const reference of visible) {
          const expected = outputs.get(reference.referent);
          if (!expected) { missing = true; continue; }

          const result = await correct(expected);
          if (result.status === 'correct') earned += reference.points;
        }
        const code = missing ? 'missing-reference' : '';
        const status: Score.Status =
          earned === total ? 'correct' : earned === 0 ? 'incorrect' : 'partial';
        return {
          ...Score.CORRECT, code, id,
          points: earned, possible: total, status
        };
      }

      return { ...Score.UNSCORED, code: 'error-is-unknown', id };
    }
  }

  export type Locked = Base & Readonly<{ key: null; locked: true; }>;

  export namespace Reference {
    /** @returns a rubric with a reference's points updated. */
    export function reweight(
      rubric: Unlocked,
      referent: string,
      points: number
    ): Unlocked {
      const reference = rubric.references[referent];
      if (!reference)
        throw new Error.Invalid(`reweight: reference ${referent} not found`);

      const cell = get(rubric, reference.cell);
      if (!cell || cell.is !== 'correctable')
        throw new Error.Invalid(`reweight: cell ${reference.cell} invalid`);

      const assignment = {
        ...rubric.assignment,
        report: Assignment.Report.empty()
      };
      const updated = { ...reference, points };
      const total = cell.references.reduce(
        (sum, id) =>
          sum + (id === referent ? points : rubric.references[id].points), 0
      );
      const cells = {
        ...rubric.cells,
        [cell.id]: { ...cell, points: total }
      };
      const references = {
        ...rubric.references, [referent]: updated
      };
      return {
        ...rubric, assignment, cells,
        references, revised: Date.now()
      };
    }
  }

  export type Outputs = Map<string, Cell.Output[]>;

  export type Score = Readonly<{
    code: Score.Code;
    comment: string;
    id: string;
    points: number;
    possible: number;
    status: Score.Status;
  }>;

  export type Timestamp = number | null;

  export type Unlocked = Base & Readonly<{ key: string; locked: false; }>;

  export namespace Assignment {
    export type Registration = Pick<
      Assignment,
      'expiration' | 'id' | 'name' | 'roster'
    >;

    export namespace Equal {
      type Course = {
        assignments: Registration[];
        group: string;
      };
      type Registered = Registration[] | Course[] | null;
      const course = (x: Course, y: Course): boolean =>
        x.group === y.group &&
        registrations(x.assignments, y.assignments);
      const normalize = (x: (Registration | Course)[]): Course[] =>
        x.length && 'group' in x[0]
          ? (x as Course[])
          : [{ assignments: x as Registration[], group: '' }];
      const registration = (x: Registration, y: Registration): boolean => (
        x.expiration === y.expiration &&
        x.id === y.id &&
        x.name === y.name &&
        roster(x.roster, y.roster)
      );
      const registrations = (x: Registration[], y: Registration[]): boolean =>
        x.length === y.length &&
        x.every((a, i) => registration(a, y[i]));
      const roster = (x: string[], y: string[]): boolean =>
        x.length === y.length &&
        x.every((record, i) => record === y[i]);

      export function assignment(x: Assignment, y: Assignment): boolean {
        return x.assignee === y.assignee && registration(x, y);
      }

      export function registered(
        x: Registered, y: Registered
      ): boolean {
        if (x === y) return true;
        if (x === null || y === null) return false;
        if (x.length !== y.length) return false;
        if (!x.length) return true;
        const a = normalize(x), b = normalize(y);
        return a.length === b.length &&
          a.every((c, i) => course(c, b[i]));
      }
    }

    /** A score report for an assignment. */
    export type Report = Readonly<{
      interventions: { [id: string]: Score };
      kernel: KernelSpec.ISpecModel | null;
      scores: { [id: string]: Score };
    }>;

    export namespace Report {
      export function empty(): Report {
        return Object.freeze({ interventions: {}, kernel: null, scores: {} });
      }
    }

    /** PGP keypairs for sealed submissions. */
    export type Keys = Readonly<{
      private: Readonly<{ assignee: string | null; author: string }>;
      public: Readonly<{ assignee: string | null; author: string }>;
    }>;

    export namespace Keys {
      /** The author-only subset included in the HMAC signature. */
      export type Author = Readonly<{ private: string; public: string }>;

      export function author(keys: Keys): Author {
        return { private: keys.private.author, public: keys.public.author };
      }

      export function empty(): Keys {
        return Object.freeze({
          private: Object.freeze({ assignee: null, author: '' }),
          public: Object.freeze({ assignee: null, author: '' })
        });
      }
    }

    /** The terms of the assignment that are verified by its signature. */
    export type Terms = Omit<
      Assignment,
      | 'certification'
      | 'collected'
      | 'seal'
      | 'signature'
      | 'submission'
      | 'submitted'
    >;

    export function empty(): Assignment {
      return Object.freeze({
        assignee: '',
        certification: null,
        collected: null,
        expiration: null,
        id: null,
        keys: Keys.empty(),
        name: '',
        report: Report.empty(),
        roster: [],
        seal: null,
        signature: '',
        submission: null,
        submitted: null
      });
    }

    /**
     * @returns an amended copy of the assignment report with new scores added.
     * @param id - if the cell is not specified, all cells are scored.
     *
     * #### Notes
     * If `id` is not provided, every cell in the rubric is scored. Cells that
     * failed to execute (missing from outputs) will be marked as incorrect.
     * All scores that already exist from previous scoring remain untouched as
     * long as they exist in the rubric and have not been rescored.
     */
    export async function score(
      rubric: Rubric,
      outputs: Outputs,
      id?: string
    ): Promise<Assignment.Report> {
      const { assignment: { report } } = rubric;
      const valid = (id: string) => has(rubric, id);
      const subset = (id ? [id] : Array.from(outputs.keys())).filter(valid);
      const unexecuted = (id: string) => !subset.includes(id) && valid(id);
      const missing = id ? [] : Object.keys(rubric.cells).filter(unexecuted);
      const all = [...subset, ...missing];
      if (!all.length) return report;

      const current = Object.entries(report.scores).filter(([id]) => valid(id));
      const pending = all.map(id => Cell.score(rubric, id, outputs));
      const done = (await Promise.all(pending)).map(score => [score.id, score]);
      const scores = Object.fromEntries([...current, ...done]);
      return { ...report, scores };
    }

    export async function sign(terms: Terms, key: string): Promise<string> {
      const { assignee, expiration, id, keys, name, roster } = terms;
      const { interventions: manual, scores: auto } = terms.report;
      const author = Keys.author(keys);
      const report = { interventions: sort(manual), scores: sort(auto) };
      const unsigned = {
        assignee, author, expiration, id,
        name, report, roster
      };
      return security.hmac(JSON.stringify(unsigned), key);
    }

    export function summary(report: Report): Score {
      const { interventions, scores } = { ...Report.empty(), ...report };
      const ids = new Set([
        ...Object.keys(interventions),
        ...Object.keys(scores)
      ]);

      const sentinel = ({ possible, status }: Score) =>
        status === 'unscored' && possible === Score.UNSCORED.possible;
      const points = ({ points, status }: Score) =>
        status === 'unscored' ? 0 : points;
      const sum = (a: Score, b: Score): Score => {
        if (sentinel(a)) return b;
        if (sentinel(b)) return a;
        return {
          code: '', comment: '', id: '',
          points: points(a) + points(b),
          possible: a.possible + b.possible,
          status: 'summary'
        };
      };
      return Array.from(ids)
        .map(id => Score.resolve(report, id) ?? Score.UNSCORED)
        .reduce(sum, Score.UNSCORED);
    }

    export async function validate(
      { assignment, key }: Pick<Unlocked, 'assignment' | 'key'>
    ) {
      const { assignee, keys, roster, seal, signature } = assignment;
      if (!keys.private.author)
        throw new Error.Mismatch('missing author private key');
      if (!keys.public.author)
        throw new Error.Mismatch('missing author public key');
      if (assignee && !signature)
        throw new Error.Mismatch('missing signature for assignee');
      if (assignee && signature !== await sign(assignment, key))
        throw new Error.Mismatch('assignee signature mismatch');
      if (assignee && !find(roster, record => record === assignee))
        throw new Error.Mismatch('assignee does not exist in roster');
      if (roster.length && !signature)
        throw new Error.Mismatch('missing signature for roster');
      if (seal && !keys.public.author)
        throw new Error.Mismatch('sealed assignment missing author public key');
      if (keys.private.assignee && !keys.public.assignee)
        throw new Error.Mismatch('assignee private key without public key');
    }
  }

  export namespace Score {
    export type Code =
      | 'empty-expected'
      | 'empty-given'
      | 'error-compare'
      | 'error-execute'
      | 'error-given'
      | 'error-is-unknown'
      | 'intervene'
      | 'locked'
      | 'mismatch-congruence'
      | 'mismatch-data'
      | 'mismatch-digest'
      | 'mismatch-message'
      | 'mismatch-name-text'
      | 'missing-cell-given'
      | 'missing-cell-notebook'
      | 'missing-given'
      | 'missing-reference'
      | 'missing-rubric'
      | 'missing-stdout'
      | '';

    export type Status =
      | 'correct'
      | 'incorrect'
      | 'partial'
      | 'summary'
      | 'unscored';

    export const CORRECT: Score = Object.freeze({
      code: '',
      comment: '',
      id: '',
      points: 1,
      possible: 1,
      status: 'correct'
    });

    export const INCORRECT: Score = Object.freeze({
      code: '',
      comment: '',
      id: '',
      points: 0,
      possible: 1,
      status: 'incorrect'
    });

    export const UNSCORED: Score = Object.freeze({
      code: '',
      comment: '',
      id: '',
      points: -1,
      possible: -1,
      status: 'unscored'
    });

    /** @returns a copy of a cell's score that has been manually updated. */
    export function intervene(
      id: string,
      score: Pick<Score, 'comment' | 'points' | 'possible'>
    ): Score {
      const { comment, points, possible } = score;
      if (!Number.isInteger(points))
        throw new TypeError('intervene: points invalid');
      if (!Number.isInteger(possible))
        throw new TypeError('intervene: possible invalid');
      if (possible < 1) throw new RangeError('intervene: possible < 1');
      if (points < 0 || points > possible)
        throw new RangeError('intervene: points out of range');

      const status: Status =
        points === possible ? 'correct'
        : points === 0 ? 'incorrect'
        : 'partial';
      return {
        code: 'intervene', comment, id,
        points, possible, status
      };
    }

    /**
     * @returns the effective score for a cell, preferring any manual
     * intervention over the computed score.
     */
    export function resolve(
      report: Partial<Assignment.Report>,
      id: string
    ): Score | null {
      const { Report } = Assignment;
      const { interventions, scores } = { ...Report.empty(), ...report };
      return interventions[id] ?? scores[id] ?? null;
    }
  }

  export function add(
    rubric: Unlocked,
    cell: Cell,
    references: Cell.Reference[] = []
  ): Unlocked {
    if (has(rubric, cell.id) || cell.id in rubric.references)
      throw new Error.Invalid(`add error, cell id ${cell.id} already exists`);
    for (const reference of references) {
      const { cell: target, referent } = reference;
      if (target !== cell.id) {
        throw new Error.Invalid(
          `add error, reference ${referent} has wrong cell`
        );
      }
      if (referent in rubric.references) {
        throw new Error.Invalid(
          `add error, reference ${referent} already exists`
        );
      }
      if (referent in rubric.cells) {
        throw new Error.Invalid(
          `add error, reference ${referent} collides with cell`
        );
      }
    }

    const referents = references.map(({ referent }) => referent);
    if (cell.references === null && references.length)
      throw new Error.Invalid('add error, cell does not accept references');
    if (cell.references !== null) {
      const expected = new Set(cell.references);
      const mismatch = expected.size !== referents.length ||
        !referents.every(id => expected.delete(id));
      if (mismatch)
        throw new Error.Invalid('add error, cell.references mismatch');
    }

    const assignment = {
      ...rubric.assignment,
      report: Assignment.Report.empty()
    };
    const added = Object.fromEntries(
      references.map(reference => [reference.referent, reference])
    );
    const points = cell.is === 'correctable'
      ? references.reduce((sum, reference) => sum + reference.points, 0)
      : cell.points;
    const cells = { ...rubric.cells, [cell.id]: { ...cell, points } };
    return {
      ...rubric, assignment, cells,
      references: { ...rubric.references, ...added },
      revised: Date.now()
    };
  }

  /** @returns a locked rubric with a submitted receipt. */
  export function acknowledge(
    rubric: Locked,
    receipt: string | null = null
  ): Locked {
    if (!rubric.assignment.submission)
      throw new Error.Submit('acknowledge error: not submitted');

    const assignment = { ...rubric.assignment, submitted: receipt };
    return { ...rubric, assignment, revised: Date.now() };
  }

  export async function assign(
    { key, ...rubric }: Unlocked,
    {
      assignee = rubric.assignment.assignee,
      expiration = rubric.assignment.expiration,
      id = rubric.assignment.id,
      name = rubric.assignment.name,
      roster = rubric.assignment.roster
    }: Partial<Assignment> = {}
  ): Promise<Unlocked> {
    roster = unique(roster);

    const stale =
      assignee !== rubric.assignment.assignee ||
      expiration !== rubric.assignment.expiration ||
      id !== rubric.assignment.id ||
      name !== rubric.assignment.name ||
      JSON.stringify(roster) !== JSON.stringify(rubric.assignment.roster);
    const certification = stale ? null : rubric.assignment.certification;
    const collected = stale ? null : rubric.assignment.collected;
    const submission = stale ? null : rubric.assignment.submission;
    const submitted = stale ? null : rubric.assignment.submitted;
    const report = stale ? Assignment.Report.empty() : rubric.assignment.report;
    const keys = rubric.assignment.keys;
    const seal = rubric.assignment.seal;
    const unsigned = { assignee, expiration, id, keys, name, report, roster };
    const lifecycle = {
      certification, collected, seal, submission, submitted
    };
    const signature = await Assignment.sign(unsigned, key);
    const assignment = { ...unsigned, ...lifecycle, signature };
    await Assignment.validate({ assignment, key });
    return { ...rubric, assignment, key, revised: Date.now() };
  }

  /**
   * @returns an unlocked rubric with the `key` field omitted. The client needs
   * to add a `key` field to use the rubric.
   */
  export function create(): Omit<Unlocked, 'key'> {
    const revised = Date.now();
    const assignment = { ...Assignment.empty() };
    const encoded = revised.toString(36);
    const id = `wb${encoded}${crypto.randomUUID().split('-').shift()}`;
    return {
      assignment, cells: {}, id,
      locked: false, references: {}, revised
    };
  }

  /** @returns a locked rubric with lifecycle timestamps nulled. */
  export function draft(rubric: Locked): Locked {
    if (rubric.assignment.seal)
      throw new Error.Submit('draft error: workbook is sealed');
    const assignment = {
      ...rubric.assignment,
      certification: null,
      collected: null,
      submission: null,
      submitted: null
    };
    return { ...rubric, assignment, revised: Date.now() };
  }

  /** @returns an unlocked rubric with a certification timestamp. */
  export function certify(rubric: Unlocked): Unlocked {
    const certification = Date.now();
    const assignment = {
      ...rubric.assignment, certification
    };
    return { ...rubric, assignment, revised: certification };
  }

  /** @returns a locked rubric with a collected receipt. */
  export function collect(
    rubric: Locked,
    receipt: string | null = null
  ): Locked {
    if (!rubric.assignment.certification)
      throw new Error.Certify('collect error: not certified');

    const revised = Date.now();
    const assignment = { ...rubric.assignment, collected: receipt };
    return { ...rubric, assignment, revised };
  }

  /** @returns the cell for `id`, or `null`. */
  export function get(rubric: Rubric, id: string): Cell | null {
    return rubric.cells[id] || null;
  }

  /** @returns whether a rubric has a cell with the given id. */
  export function has(rubric: Rubric, id: string): boolean {
    return !!get(rubric, id);
  }

  /** @returns the given rubric, locked. */
  export async function lock(rubric: Rubric): Promise<Locked> {
    if (rubric.locked) return rubric;
    await Assignment.validate(rubric);

    const locked = true;
    const { cells, id, key, references } = rubric;
    const serialized = JSON.stringify(rubric.assignment.roster);
    const roster = [await security.encrypt(serialized, key)];
    const assignment = { ...rubric.assignment, roster };
    const revised = Date.now();
    return { assignment, cells, id, key: null, locked, references, revised };
  }

  /** @returns a normalized locked rubric or throws. */
  export function normalize(rubric: Partial<Locked> = {}): Locked {
    const { assignment, cells, id, key, locked, revised } = rubric;
    const object = (value: unknown): value is object =>
      typeof value === 'object' && value !== null;
    const record = (value: unknown): value is { [key: string]: unknown } =>
      object(value) && !Array.isArray(value);
    if (!revised) throw new Error.Invalid('invalid rubric, missing revised');
    if (typeof id !== 'string' || !id)
      throw new Error.Invalid('invalid rubric, missing id');
    if (key !== null)
      throw new Error.Invalid('invalid rubric, missing (null) key');
    if (locked !== true)
      throw new Error.Invalid('invalid rubric, must be locked');
    if (!cells || typeof cells !== 'object' || Array.isArray(cells))
      throw new Error.Invalid('invalid rubric, missing cells');
    if (!assignment)
      throw new Error.Invalid('invalid rubric, missing assignment');
    if (!record(assignment.report))
      throw new Error.Invalid('invalid rubric, missing assignment report');

    const { interventions, kernel: spec, scores } = assignment.report;
    const kernel = spec ?? null;
    if (!record(interventions)) {
      throw new Error.Invalid(
        'invalid rubric, missing assignment interventions'
      );
    }
    if (!record(scores))
      throw new Error.Invalid('invalid rubric, missing assignment scores');
    if (kernel !== null && !object(kernel))
      throw new Error.Invalid('invalid rubric, invalid kernel spec');
    const blank = Assignment.Report.empty();
    const report = { ...blank, interventions, kernel, scores };
    const keys = {
      private: {
        ...Assignment.Keys.empty().private,
        ...assignment.keys?.private
      },
      public: {
        ...Assignment.Keys.empty().public,
        ...assignment.keys?.public
      }
    };
    if (!keys.private.author)
      throw new Error.Invalid('invalid rubric, missing author private key');
    if (!keys.public.author)
      throw new Error.Invalid('invalid rubric, missing author public key');

    const seal = assignment.seal ?? null;
    const references = rubric.references ?? {};
    return {
      assignment: { ...Assignment.empty(), ...assignment, keys, report, seal },
      cells, id, key, locked, references, revised
    };
  }

  /** Provision a locked rubric with assignee keys for sealed submission. */
  export function provision(rubric: Locked, keys: Assignment.Keys): Locked {
    const assignment = { ...rubric.assignment, keys };
    return { ...rubric, assignment, revised: Date.now() };
  }

  /** Add a reference to an existing comparable or correctable cell. */
  export function refer(
    rubric: Unlocked,
    id: string,
    reference: Cell.Reference
  ): Unlocked {
    const cell = get(rubric, id);
    if (!cell)
      throw new Error.Invalid(`refer error, cell ${id} not found`);
    if (cell.is !== 'comparable' && cell.is !== 'correctable')
      throw new Error.Invalid(`refer error, cell ${id} is ${cell.is}`);

    const { referent } = reference;
    if (referent in rubric.references) {
      throw new Error.Invalid(
        `refer error, reference ${referent} already exists`
      );
    }
    if (referent in rubric.cells)
      throw new Error.Invalid(`refer error, reference ${referent} collides`);

    const assignment = {
      ...rubric.assignment,
      report: Assignment.Report.empty()
    };
    const bound = { ...reference, cell: id };
    const references = { ...rubric.references, [referent]: bound };
    const local = [...cell.references, referent];
    const points = cell.is === 'correctable'
      ? local.reduce((sum, id) => sum + references[id].points, 0)
      : cell.points;
    const cells = {
      ...rubric.cells,
      [id]: { ...cell, points, references: local }
    };
    return { ...rubric, assignment, cells, references, revised: Date.now() };
  }

  /** Remove a cell from a rubric and invalidate report. */
  export function remove(rubric: Unlocked, id: string): Unlocked {
    if (!get(rubric, id)) return rubric;

    const assignment = {
      ...rubric.assignment,
      report: Assignment.Report.empty()
    };
    const { [id]: _, ...cells } = rubric.cells;
    const references = Object.fromEntries(
      Object.entries(rubric.references)
        .filter(([, reference]) => reference.cell !== id)
    );
    return { ...rubric, assignment, cells, references, revised: Date.now() };
  }

  export async function sign(
    rubric: Rubric.Unlocked,
    report: Assignment.Report
  ): Promise<Rubric.Unlocked> {
    const unsigned = { ...rubric.assignment, report };
    const signature = await Assignment.sign(unsigned, rubric.key);
    const assignment = { ...unsigned, signature };
    return { ...rubric, assignment, revised: Date.now() };
  }

  /** Record the submission timestamp for a locked workbook. */
  export function submit(rubric: Locked): Locked {
    const submission = Date.now();
    const assignment = { ...rubric.assignment, submission };
    return { ...rubric, assignment, revised: submission };
  }

  /** Record a seal hash on a locked rubric. */
  export function seal(rubric: Locked, hash: string): Locked {
    const assignment = { ...rubric.assignment, seal: hash };
    return { ...rubric, assignment, revised: Date.now() };
  }

  /** Clear seal and student keys (for revise). */
  export function unseal(rubric: Locked): Locked {
    const keys: Assignment.Keys = {
      private: { ...rubric.assignment.keys.private, assignee: null },
      public: { ...rubric.assignment.keys.public, assignee: null }
    };
    const assignment = {
      ...rubric.assignment,
      keys,
      seal: null,
      submission: null,
      submitted: null
    };
    return { ...rubric, assignment, revised: Date.now() };
  }

  /** @returns a formatted rendition of a rubric timestamp. */
  export function timestamp(timestamp: Timestamp, empty = ''): string {
    return timestamp !== null ? new Date(timestamp).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    }) : empty;
  }

  /** @returns a rubric with a reference's secret flag toggled. */
  export function toggle(rubric: Unlocked, referent: string): Unlocked {
    const reference = rubric.references[referent];
    if (!reference)
      throw new Error.Invalid(`toggle: reference ${referent} not found`);

    const assignment = {
      ...rubric.assignment,
      report: Assignment.Report.empty()
    };
    const toggled = { ...reference, secret: !reference.secret };
    const references = { ...rubric.references, [referent]: toggled };
    return { ...rubric, assignment, references, revised: Date.now() };
  }

  /** Remove a single reference; removes the cell if none remain. */
  export function dereference(
    rubric: Unlocked,
    referent: string
  ): Unlocked {
    const reference = rubric.references[referent];
    if (!reference) {
      throw new Error.Invalid(
        `dereference error, reference ${referent} not found`
      );
    }

    const cell = get(rubric, reference.cell);
    if (!cell || cell.is === 'answerable' || cell.is === 'reviewable') {
      throw new Error.Invalid(
        `dereference error, cell ${reference.cell} invalid`
      );
    }

    const remaining = cell.references.filter(id => id !== referent);
    if (!remaining.length) return remove(rubric, cell.id);

    const blank = Assignment.Report.empty();
    const assignment = { ...rubric.assignment, report: blank };
    const { [referent]: _, ...references } = rubric.references;
    const points = cell.is === 'correctable'
      ? remaining.reduce((sum, id) => sum + references[id].points, 0)
      : cell.points;
    const cells = {
      ...rubric.cells,
      [cell.id]: { ...cell, points, references: remaining }
    };
    return { ...rubric, assignment, cells, references, revised: Date.now() };
  }

  /** @returns an unlocked rubric after decrypting the roster. */
  export async function unlock(rubric: Locked, key: string): Promise<Unlocked> {
    const locked = false;
    const { cells, id, references, assignment: { roster: [block] } } = rubric;
    const roster = block ? JSON.parse(await security.decrypt(block, key)) : [];
    const assignment = { ...rubric.assignment, roster };
    const revised = Date.now();
    await Assignment.validate({ assignment, key });
    return { assignment, cells, id, key, locked, references, revised };
  }
}

/** @returns a sorted record of scores for deterministic hashing. */
const sort = (scores: { [id: string]: Rubric.Score }) => Object.fromEntries(
  Object.keys(scores).sort().map(id => [id, scores[id]])
);

/** @returns a list of strings with no duplicate values. */
const unique = (list: string[]): string[] => Array.from(new Set(list));
