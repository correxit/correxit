import { ICodeCellModel } from '@jupyterlab/cells';
import { Kernel, KernelMessage } from '@jupyterlab/services';
import { filter, find, reduce } from '@lumino/algorithm';
import * as security from './security';

/**
 * A rubric is the specification that describes how to augment a Jupyter
 * notebook with the functionality of a Correxit workbook, including shared and
 * secret cell correction configuration, assignment metadata, etc.
 *
 * Rubrics are immutable.
 */
export type Rubric = Rubric.Locked | Rubric.Unlocked;

export namespace Rubric {
  export type Assignment = Readonly<{
    assignee: string;
    roster: string[];
    signature: string;
  }>;

  type Base = Readonly<{
    accessed: number;
    assignment: Assignment;
    id: string;
    shared: Section;
  }>;

  export type Cell = Readonly<{
    id: string;
    is: 'answerable';
    payload: string[];
    reference: null;
    shared: boolean;
  }> | Readonly<{
    id: string;
    is: 'comparable' | 'correctable';
    payload: null;
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

    export type Toolbar = { [TOOLBAR]?: boolean; };

    export const TOOLBAR = 'correxit:cell-toolbar';

    export const types = ['answerable', 'comparable', 'correctable'];

    export async function answer(
      [expected]: string[],
      given: Output[]
    ): Promise<[Score, Score.Message]> {
      if (!expected) {
        return [UNSCORED, 'empty-expected'];
      }
      if (!given.length) {
        return [INCORRECT, 'empty-given'];
      }
      if (find(given, ({ header }) => header.msg_type === 'error')) {
        return [INCORRECT, 'error-given'];
      }
      if (find(given, ({ header }) => header.msg_type === 'stream')) {
        const name = (content: Cell.Output['content']) =>
          (content as KernelMessage.IStreamMsg['content']).name;
        const text = (content: Cell.Output['content']) =>
          (content as KernelMessage.IStreamMsg['content']).text;
        const stdout = reduce(
          filter(given, ({ content, header }) =>
            header.msg_type === 'stream' && name(content) === 'stdout'
          ),
          (stdout, { content }) => [...stdout, text(content)],
          [] as string[]
        ).join('').trim();
        if (stdout) {
          const digest = await security.digest(stdout);
          const score = digest === expected ? CORRECT : INCORRECT;
          return [score, score === INCORRECT ? 'mismatch-digest' : 'success'];
        }
        return [INCORRECT, 'missing-stdout'];
      }
      return [UNSCORED, 'mismatch-message'];
    }

    export async function compare(
      expected: Output[],
      given: Output[]
    ): Promise<[Score, Score.Message]> {
      if (!expected.length) {
        return [UNSCORED, 'empty-expected'];
      }
      if (!given.length) {
        return [INCORRECT, 'empty-given'];
      }

      const keys = (content: Output['content']) =>
        Object.keys(content).sort().join('');
      const x = given.slice(-1)[0].content;
      const y = expected.slice(-1)[0].content;
      if (keys(x) !== keys(y)) {
        return [INCORRECT, 'mismatch-congruence'];
      }
      if ('data' in x && 'data' in y) {
        const equal = JSON.stringify(x.data) === JSON.stringify(y.data);
        return equal ? [CORRECT, 'success'] : [INCORRECT, 'mismatch-data'];
      }
      if ('name' in x && 'name' in y) {
        return x.name === y.name && x.text === y.text
          ? [CORRECT, 'success']
          : [INCORRECT, 'mismatch-name-text'];
      }
      return [UNSCORED, 'error-compare'];
    };

    export async function correct(
      expected: Output[]
    ): Promise<[Score, Score.Message]> {
      return expected.some(message => message.header.msg_type === 'error') ?
        [INCORRECT, 'error-correct'] : [CORRECT, 'success'];
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
      { sharedModel }: ICodeCellModel,
      kernel: Kernel.IKernelConnection
    ): Promise<Output[]> {
      const outputs: Output[] = [];
      const code = sharedModel.getSource();
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
  }

  export type Locked = Base &
    Readonly<{ key: null; locked: true; secret: string; }>;

  export type Outputs = { [id: string]: Cell.Output[]; }

  export type Score = Readonly<[numerator: number, denominator: number]>;

  export type Section = Readonly<{
    cells: Readonly<{ [id: string]: Cell; }>;
  }>;

  export type Unlocked = Base &
    Readonly<{ key: string; locked: false; secret: Section; }>;

  export namespace Assignment {
    export const EMPTY: Assignment = {
      assignee: '',
      roster: [],
      signature: ''
    };

    export async function sign(
      { assignee, roster }: Pick<Assignment, 'assignee' | 'roster'>,
      key: string
    ): Promise<string> {
      return security.digest(`${assignee}:${key}${roster.join('|')}`);
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
    export type Message =
      | 'empty-given'
      | 'empty-expected'
      | 'error-compare'
      | 'error-correct'
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
      | 'missing-stdout'
      | 'success';

    export type Report = [Score, Message[]];
  }

  export const CORRECT: Score = Object.freeze([1, 1]);

  export const INCORRECT: Score = Object.freeze([0, 1]);

  export const UNSCORED: Score = Object.freeze([
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY
  ]);

  export function add(rubric: Unlocked, cell: Cell): Unlocked {
    if (has(rubric, cell.id, true)) {
      throw new Error(`add error, rubric already has cell id ${cell.id}`);
    }
    return {
      ...rubric,
      accessed: Date.now(),
      secret: cell.shared
        ? { cells: { ...rubric.secret.cells } }
        : { cells: { ...rubric.secret.cells, [cell.id]: cell  } },
      shared: cell.shared
        ? { cells: { ...rubric.shared.cells, [cell.id]: cell } }
        : { cells: { ...rubric.shared.cells } }
    };
  }

  export async function assign(
    { key, ...rubric }: Unlocked,
    assignee = '',
    roster: string[] = []
  ): Promise<Unlocked> {
    const unique = (list: string[]): string[] =>
      list.reduce<[string[], { [key: string]: true }]>(
        ([unique, keys], key) => (
          [keys[key] ? unique : [...unique, key], { ...keys, [key]: true }]
        ), [[], {}])[0];
    const assignment = { assignee, roster: unique(roster), signature: '' };
    assignment.signature = await Assignment.sign(assignment, key);
    await Assignment.validate({ assignment, key });
    return { ...rubric, accessed: Date.now(), assignment, key };
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
    const secret: Section = { cells: {} };
    const shared: Section = { cells: {} };
    return { accessed, assignment, id, locked: false, secret, shared };
  }

  /**
   * @returns the rubric cell referenced by the `id` if found, otherwise `null`.
   */
  export function get(rubric: Rubric, id: string): Cell | null {
    if (has(rubric, id)) {
      const { locked, secret, shared } = rubric;
      return locked ? shared.cells[id] : secret.cells[id] || shared.cells[id];
    }
    return null;
  }

  /**
   * @param deep also check if given `id` is a `reference`, defaults to `false`.
   * @returns whether a rubric has or references a given id.
   */
  export function has(rubric: Rubric, id: string, deep = false): boolean {
    const references = ({ cells }: Section, reference: string) =>
      find(Object.keys(cells), key => cells[key].reference?.[0] === reference);
    const { locked, secret, shared } = rubric;
    return locked ?
      !!(shared.cells[id] || (deep && references(shared, id))) :
      !!(secret.cells[id] || (deep && references(secret, id))) ||
      !!(shared.cells[id] || (deep && references(shared, id)));
  }

  /**
   * @returns a promise that resolves to the given rubric, locked.
   */
  export async function lock(rubric: Rubric): Promise<Locked> {
    if (rubric.locked) {
      return rubric;
    }

    const locked = true;
    const { id, key, shared } = rubric;
    const { assignee, roster, signature } = rubric.assignment;
    const encrypted = await security.encrypt(JSON.stringify(roster), key);
    const assignment = { assignee, roster: [encrypted], signature };
    const secret = await security.encrypt(JSON.stringify(rubric.secret), key);
    const accessed = Date.now();
    await Assignment.validate(rubric);
    return { accessed, assignment, id, key: null, locked, secret, shared };
  }

  /**
   * @returns a normalized locked rubric or throws an error.
   */
  export function normalize(rubric: Partial<Locked> = {}): Locked {
    const { accessed, id, key, locked, secret, shared } = rubric;
    let { assignment } = rubric;
    if (!accessed) {
      throw new Error('invalid rubric, missing accessed');
    }
    if (!assignment) {
      assignment = { ...Assignment.EMPTY };
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
    if (typeof secret !== 'string' || secret.length === 0) {
      throw new Error('invalid rubric, missing secret section');
    }
    if (!(shared && shared.cells)) {
      throw new Error('invalid rubric, invalid shared section');
    }
    return { accessed, assignment, id, key, locked, secret, shared };
  }

  export function remove(rubric: Unlocked, id: string): Unlocked;
  export function remove(rubric: Locked, id: string): Locked;
  export function remove(rubric: Rubric, id: string): Rubric;
  export function remove(rubric: Rubric, id: string): Rubric {
    const cell = get(rubric, id);
    const drop = (section: Section | string, cell: Cell): Section | string => {
      if (typeof section === 'string') {
        return section;
      }
      const { [cell.id]: _, ...rest } = section.cells;
      void _; // This is the removed cell.
      return { cells: rest };
    };
    if (!cell){
      return rubric;
    }
    const secret = cell.shared ? rubric.secret : drop(rubric.secret, cell);
    const shared = cell.shared ? drop(rubric.shared, cell) : rubric.shared;
    return { ...rubric, accessed: Date.now(), secret, shared } as Rubric;
  }

  /**
   * @returns the number of cells configured in a rubric.
   */
  export function size(rubric: Rubric): number {
    const { locked, secret, shared } = rubric;
    return locked ?
      Object.keys(shared.cells).length :
      Object.keys(secret.cells).length + Object.keys(shared.cells).length;
  }

  /**
   * Get the score for a single cell.
   *
   * @param rubric - the rubric that defines the cell being scored.
   * @param id - the id of the cell to score.
   * @param outputs - the outputs of all the executed workbook cells.
   *
   * @returns A tuple with the score for this cell and any log messages.
   *
   * #### Notes
   * Currently the score is only 0/1 or 1/1 whether it is correct or not.
   */
  export async function score(
    rubric: Rubric,
    id: string,
    outputs: Outputs
  ): Promise<[Score, Score.Message]> {
    const cell = get(rubric, id);
    const given = outputs[id];
    const reference = cell?.reference?.[0] ?? '';
    if (!cell || !given) {
      return [UNSCORED, 'missing-cell-given'];
    }
    if (cell.is === 'answerable') {
      return Cell.answer(cell.payload, given);
    }
    if (!outputs[reference]) {
      return [UNSCORED, 'missing-reference'];
    }
    if (cell.is === 'comparable') {
      return Cell.compare(outputs[reference], given);
    }
    if (cell.is === 'correctable') {
      return Cell.correct(outputs[reference]);
    }
    return [UNSCORED, 'error-is-unknown'];
  }

  /**
   * @returns the sum of two scores.
   */
  export function sum(a: Score, b: Score): Score {
    if (a === UNSCORED) {
      return b;
    }
    if (b === UNSCORED) {
      return a;
    }
    return Object.freeze([a[0] + b[0], a[1] + b[1]]);
  };

  /**
   * @returns a rubric where given cell is toggled between `secret` or `shared`.
   */
  export function toggle(rubric: Unlocked, id: string): Unlocked {
    const cell = get(rubric, id);
    if (!cell) {
      throw new Error('cannot toggle cell unknown in rubric');
    }
    let secret: Section;
    let shared: Section;
    if (cell.shared) {
      const { [id]: referent, ...rest } = rubric.shared.cells;
      secret = {
        cells: {...rubric.secret.cells, [id]: { ...referent, shared: false }}
      };
      shared = { cells: {...rest} };
    } else {
      const { [id]: referent, ...rest } = rubric.secret.cells;
      secret = { cells: { ...rest } };
      shared = {
        cells: { ...rubric.shared.cells, [id]: { ...referent, shared: true } }
      };
    }
    return { ...rubric, accessed: Date.now(), secret, shared };
  }

  /**
   * @returns an unlocked rubric after decrypting secret cells with given key.
   */
  export async function unlock(rubric: Locked, key: string): Promise<Unlocked> {
    const locked = false;
    const { assignment: { roster: [ raw ] }, id } = rubric;
    const roster = raw ? JSON.parse(await security.decrypt(raw, key)) : [];
    const secret = JSON.parse(await security.decrypt(rubric.secret, key));
    const shared = { ...rubric.shared };
    const assignment = { ...rubric.assignment, roster };
    const accessed = Date.now();
    await Assignment.validate({ assignment, key });
    return { accessed, assignment, id, key, locked, secret, shared };
  }
}
