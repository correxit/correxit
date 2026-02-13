import { ICodeCellModel } from '@jupyterlab/cells';
import { Kernel, KernelMessage } from '@jupyterlab/services';
import { find } from '@lumino/algorithm';
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
  export type Assignment = Readonly<{
    assignee: string;
    confirmation: string | null;
    expiration: number | null;
    report: Assignment.Report;
    roster: string[];
    signature: string;
    submission: number | null;
  }>;

  type Base = Readonly<{
    accessed: number;
    assignment: Assignment;
    cells: Readonly<{ [id: string]: Cell }>;
    id: string;
  }>;

  export type Cell = Readonly<{
    id: string;
    is: 'answerable';
    payload: string[];
    points: number;
    reference: null;
    shared: boolean;
  }> | Readonly<{
    id: string;
    is: 'comparable' | 'correctable';
    payload: null;
    points: number;
    reference: string[];
    shared: boolean;
  }>;

  export namespace Cell {
    /**
     * An output is an `iopub` message of interest.
     */
    export type Output =
      | KernelMessage.IIOPubMessage<'execute_result'>
      | KernelMessage.IIOPubMessage<'display_data'>
      | KernelMessage.IIOPubMessage<'stream'>
      | KernelMessage.IIOPubMessage<'error'>;

    namespace Output {
      export const error = ({ header }: Output) =>
        header.msg_type === 'error';

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

    export const types = ['answerable', 'comparable', 'correctable'];

    export async function answer(
      [expected]: string[],
      given: Output[]
    ): Promise<Score> {
      const { error, stdout, stream, text } = Output;
      if (!expected) {
        return { ...Score.UNSCORED, code: 'empty-expected' };
      }
      if (!given.length) {
        return { ...Score.INCORRECT, code: 'empty-given' };
      }
      if (find(given, error)) {
        return { ...Score.INCORRECT, code: 'error-given' };
      }
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
      if (!expected.length) {
        return { ...Score.UNSCORED, code: 'empty-expected' };
      }
      if (!given.length) {
        return { ...Score.INCORRECT, code: 'empty-given' };
      }

      const shape = (content: Output['content']) =>
        Object.keys(content).sort().join('');
      const [{ content: x }] = expected.slice(-1);
      const [{ content: y }] = given.slice(-1);
      if (shape(x) !== shape(y)) {
        return { ...Score.INCORRECT, code: 'mismatch-congruence' };
      }
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

    export async function correct(
      expected: Output[]
    ): Promise<Score> {
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
      if (!code.length) {
        return outputs;
      }

      const dispose = true;
      const future = kernel.requestExecute({ code }, dispose);
      future.onIOPub = (message: KernelMessage.IIOPubMessage) => {
        if (message.header.msg_type === 'execute_result' ||
            message.header.msg_type === 'display_data' ||
            message.header.msg_type === 'stream' ||
            message.header.msg_type === 'error') {
          outputs.push(message as Output);
        }
      };
      await future.done;
      return outputs;
    }

    /**
     * Get the score for a single cell.
     *
     * @param rubric - the rubric that defines the cell being scored.
     * @param id - the id of the cell to score.
     * @param outputs - the outputs of all the executed workbook cells.
     *
     * @returns A promise that resolves to the score for this cell.
     */
    export async function score(
      rubric: Rubric,
      id: string,
      outputs: Outputs
    ): Promise<Score> {
      const cell = get(rubric, id);
      const given = outputs.get(id);
      const reference = cell?.reference?.[0] ?? '';
      const expected = outputs.get(reference);
      if (!cell || !given) {
        return { ...Score.UNSCORED, code: 'missing-cell-given', id };
      }
      if (cell.is === 'answerable') {
        return { ...await answer(cell.payload, given), id };
      }
      if (!expected) {
        return { ...Score.UNSCORED, code: 'missing-reference', id };
      }
      if (cell.is === 'comparable') {
        return { ...await compare(expected, given), id };
      }
      if (cell.is === 'correctable') {
        return { ...await correct(expected), id };
      }
      return { ...Score.UNSCORED, code: 'error-is-unknown', id };
    }
  }

  export type Locked = Base & Readonly<{ key: null; locked: true; }>;

  export type Outputs = Map<string, Cell.Output[]>;

  export type Score = Readonly<{
    code: Score.Code;
    comment: string;
    id: string;
    points: number;
    possible: number;
    status: Score.Status;
  }>;

  export type Unlocked = Base & Readonly<{ key: string; locked: false; }>;

  export namespace Assignment {
    export type Report = Readonly<{
      date: number | null;
      order: string[];
      scores: { [id: string]: Score };
    }>;

    export const EMPTY: Assignment = {
      assignee: '',
      confirmation: null,
      expiration: null,
      report: { date: null, order: [], scores: {} },
      roster: [],
      signature: '',
      submission: null
    };

    /**
     * @param id - if the cell is not specified, all cells are scored.
     * @returns an amended copy of the assignment report with new scores added.
     *
     * #### Notes
     * Because the outputs are provided by the client, instead of scoring every
     * cell contained in the rubric, every cell that exists in the outputs is
     * scored if it exists in the rubric.
     * All scores that already exist from previous scoring remain untouched as
     * long as they exist in the rubric and have not been rescored.
     * The `order` of keys in the outputs (`outputs.keys()`) is preserved.
     */
    export async function score(
      rubric: Rubric,
      outputs: Outputs,
      id?: string
    ): Promise<Assignment.Report> {
      const { assignment: { report } } = rubric;
      const valid = (id: string) => has(rubric, id);
      const subset = (id ? [id] : Array.from(outputs.keys())).filter(valid);
      if (!subset.length) {
        return report;
      }

      const current = Object.entries(report.scores).filter(([id]) => valid(id));
      const pending = subset.map(id => Cell.score(rubric, id, outputs));
      const done = (await Promise.all(pending)).map(score => [score.id, score]);
      const scores = Object.fromEntries([...current, ...done]);
      const filtered = report.order.filter(valid);
      const order = unique(id ? [...filtered, id] : [...subset, ...filtered]);
      return { date: Date.now(), order, scores };
    }

    export async function sign(
      assignment: Omit<Assignment, 'confirmation' | 'signature' | 'submission'>,
      key: string
    ): Promise<string> {
      const { assignee, expiration, report, roster } = assignment;
      const unsigned = { assignee, expiration, report, roster };
      return security.digest(JSON.stringify(unsigned).concat(key));
    }

    export function summary(report: Report): Score {
      const { order, scores } = report;
      const sum = (a: Score, b: Score): Score => {
        if (a.status === 'unscored') {
          return b;
        }
        if (b.status === 'unscored') {
          return a;
        }

        const points = a.points + b.points;
        const possible = a.possible + b.possible;
        const status = 'summary';
        return { code: '', comment: '', id: '', points, possible, status };
      };
      const ordered = order.map(id => scores[id]).filter(Boolean);
      return ordered.reduce(sum, Score.UNSCORED);
    }

    /**
     * @returns whether the current time is after an assignment's expiration.
     */
    export function expired({ expiration }: Pick<Assignment, 'expiration'>) {
      return expiration ? Date.now() > expiration : false;
    }

    export async function validate(
      { assignment, key }: Pick<Unlocked, 'assignment' | 'key'>
    ) {
      const { assignee, roster, signature } = assignment;
      if (assignee && !signature) {
        throw new Error('missing signature for assignee');
      }
      if (assignee && signature !== await sign(assignment, key)) {
        throw new Error('assignee signature mismatch');
      }
      if (assignee && !find(roster, record => record === assignee)) {
        throw new Error('assignee does not exist in roster');
      }
      if (roster.length && !signature) {
        throw new Error('missing signature for roster');
      }
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
      | 'mismatch-congruence'
      | 'mismatch-data'
      | 'missing-given'
      | 'mismatch-digest'
      | 'mismatch-message'
      | 'mismatch-name-text'
      | 'missing-cell-given'
      | 'missing-reference'
      | 'missing-rubric'
      | 'missing-stdout'
      | 'override'
      | '';

    export type Status =
      | 'correct'
      | 'incorrect'
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
  }

  export function add(rubric: Unlocked, cell: Cell): Unlocked {
    if (has(rubric, cell.id, true)) {
      throw new Error(`add error, rubric already has cell id ${cell.id}`);
    }
    return {
      ...rubric,
      cells: { ...rubric.cells, [cell.id]: cell }
    };
  }

  export async function assign(
    { key, ...rubric }: Unlocked,
    {
      assignee = rubric.assignment.assignee,
      confirmation = rubric.assignment.confirmation,
      expiration = rubric.assignment.expiration,
      roster = rubric.assignment.roster,
      submission = rubric.assignment.submission
    }: Partial<Assignment> = {}
  ): Promise<Unlocked> {
    roster = unique(roster);

    const { report } = rubric.assignment;
    const unsigned = { assignee, expiration, report, roster };
    const signature = await Assignment.sign(unsigned, key);
    const assignment = {
      ...unsigned, confirmation, signature, submission
    };
    await Assignment.validate({ assignment, key });
    return { ...rubric, assignment, key };
  }

  /**
   * @returns an unlocked rubric with the `key` field omitted. The client needs
   * to add a `key` field to use the rubric.
   */
  export function create(): Omit<Unlocked, 'key'> {
    const accessed = Date.now();
    const assignment = { ...Assignment.EMPTY };
    const encoded = accessed.toString(36);
    const id = `wb${encoded}${crypto.randomUUID().split('-').shift()}`;
    return { accessed, assignment, cells: {}, id, locked: false };
  }

  export function draft(rubric: Locked): Locked {
    const confirmation = null;
    const submission = null;
    const assignment = { ...rubric.assignment, confirmation, submission };
    return { ...rubric, accessed: Date.now(), assignment };
  }

  /**
   * @returns the rubric cell referenced by the `id` if found, otherwise `null`.
   */
  export function get(rubric: Rubric, id: string): Cell | null {
    return rubric.cells[id] || null;
  }

  /**
   * @param deep also check if given `id` is a `reference`, defaults to `false`.
   * @returns whether a rubric has or references a given id.
   */
  export function has(rubric: Rubric, id: string, deep = false): boolean {
    if (get(rubric, id)) {
      return true;
    }
    if (deep) {
      const reference = id;
      const all = Object.keys(rubric.cells);
      return !!find(all, id => rubric.cells[id].reference?.[0] === reference);
    }
    return false;
  }

  /**
   * @returns a promise that resolves to the given rubric, locked.
   */
  export async function lock(rubric: Rubric): Promise<Locked> {
    if (rubric.locked) {
      return rubric;
    }
    await Assignment.validate(rubric);

    const locked = true;
    const { cells, id, key } = rubric;
    const serialized = JSON.stringify(rubric.assignment.roster);
    const roster = [await security.encrypt(serialized, key)];
    const assignment = { ...rubric.assignment, roster };
    const accessed = Date.now();
    return { accessed, assignment, cells, id, key: null, locked };
  }

  /**
   * @returns a normalized locked rubric or throws an error.
   */
  export function normalize(rubric: Partial<Locked> = {}): Locked {
    const { accessed, cells, id, key, locked } = rubric;
    const assignment = rubric.assignment || { ...Assignment.EMPTY };
    if (!accessed) {
      throw new Error('invalid rubric, missing accessed');
    }
    if (typeof id !== 'string' || !id) {
      throw new Error('invalid rubric, missing id');
    }
    if (key !== null) {
      throw new Error('invalid rubric, missing (null) key');
    }
    if (locked !== true) {
      throw new Error('invalid rubric, must be locked');
    }
    if (!cells || typeof cells !== 'object' || Array.isArray(cells)) {
      throw new Error('invalid rubric, missing cells');
    }
    return { accessed, assignment, cells, id, key, locked };
  }

  /**
   * Remove a cell from a rubric. Report scores are left intact.
   */
  export function remove(rubric: Unlocked, id: string): Unlocked {
    if (!get(rubric, id)) {
      return rubric;
    }

    const { [id]: _, ...cells } = rubric.cells;
    void _; // This is the removed cell.
    return { ...rubric, cells };
  }

  export async function sign(
    rubric: Rubric.Unlocked,
    report: Assignment.Report
  ): Promise<Rubric.Unlocked> {
    const unsigned = { ...rubric.assignment, report };
    const signature = await Assignment.sign(unsigned, rubric.key);
    const assignment = { ...unsigned, signature };
    return { ...rubric, assignment };
  }

  /**
   * @returns the number of cells configured in a rubric.
   */
  export function size(rubric: Rubric): number {
    return Object.keys(rubric.cells).length;
  }

  export function submit(
    rubric: Locked, confirmation: string | null = null
  ): Locked {
    const submission = Date.now();
    const assignment = { ...rubric.assignment, confirmation, submission };
    return { ...rubric, accessed: submission, assignment };
  }

  /**
   * @returns a rubric where given cell's shared flag is toggled.
   */
  export function toggle(rubric: Unlocked, id: string): Unlocked {
    const cell = get(rubric, id);
    if (!cell) {
      throw new Error(`toggle: cell ${id} not found in rubric`);
    }

    const cells = { ...rubric.cells, [id]: { ...cell, shared: !cell.shared } };
    return { ...rubric, cells };
  }

  /**
   * @returns an unlocked rubric after decrypting the roster.
   */
  export async function unlock(rubric: Locked, key: string): Promise<Unlocked> {
    const locked = false;
    const { cells, id, assignment: { roster: [block]} } = rubric;
    const roster = block ? JSON.parse(await security.decrypt(block, key)) : [];
    const assignment = { ...rubric.assignment, roster };
    const accessed = Date.now();
    await Assignment.validate({ assignment, key });
    return { accessed, assignment, cells, id, key, locked };
  }
}

/**
  * @returns a list of strings with no duplicate values.
  */
const unique = (list: string[]): string[] => Array.from(new Set(list));
