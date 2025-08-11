import { KernelMessage } from '@jupyterlab/services';
import { find } from '@lumino/algorithm';
import * as security from './security';

export type Rubric = Rubric.Locked | Rubric.Unlocked;

export namespace Rubric {
  /**
   * The basic shape of a locked or unlocked rubric.
   */
  interface IRubric {
    accessed: number;
    id: string;
    key: null | string;
    locked: boolean;
    secret: string | Section;
    shared: Section;
  };

  export type Locked = Readonly<IRubric> & {
    readonly key: null;
    readonly locked: true;
    readonly secret: string;
  };

  export type Unlocked = Readonly<IRubric> & {
    readonly key: string;
    readonly locked: false;
    readonly secret: Section;
  };

  export namespace Cell {
    /**
     * An output is an `iopub` message of interest.
     */
    export type Output =
      | KernelMessage.IIOPubMessage<'execute_result'>
      | KernelMessage.IIOPubMessage<'display_data'>
      | KernelMessage.IIOPubMessage<'stream'>
      | KernelMessage.IIOPubMessage<'error'>;
  }

  export type Cell = {
    readonly id: string;
    readonly is: 'answerable';
    readonly payload: string[];
    readonly reference: null;
    readonly shared: boolean;
  } | {
    readonly id: string;
    readonly is: 'comparable' | 'correctable';
    readonly payload: null;
    readonly reference: string[];
    readonly shared: boolean;
  };

  export type Outputs = { [id: string]: Cell.Output[]; }

  export type Score = readonly [numerator: number, denominator: number];

  export type Section = { readonly cells: { [id: string]: Cell; }; };

  export const CORRECT: Score = Object.freeze([1, 1]);

  export const INCORRECT: Score = Object.freeze([0, 1]);

  export const UNSCORED: Score = Object.freeze([
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY
  ]);

  export async function answer(expected: string[], given: Cell.Output[]) {
      if (!given.length) {
        return INCORRECT;
      }

      const message = given.slice(-1)[0];
      if (message.header.msg_type === 'error') {
        return INCORRECT;
      }
      if (message.header.msg_type === 'stream') {
        const { content } = message as KernelMessage.IStreamMsg;
        if (content.name === 'stdout') {
          const value = await security.digest(content.text.trim());
          return value === expected?.[0] ? CORRECT : INCORRECT;
        }
        return INCORRECT;
      }
    return UNSCORED;
  };

  export function compare(expected: Cell.Output[], given: Cell.Output[]) {
    if (!expected.length) {
      return UNSCORED;
    }
    if (!given.length) {
      return INCORRECT;
    }

    const keys = (obj: Cell.Output['content']) =>
      Object.keys(obj).sort().join('');
    const x = given.slice(-1)[0].content;
    const y = expected.slice(-1)[0].content;
    if (keys(x) !== keys(y)) {
      return INCORRECT;
    }
    if ('data' in x && 'data' in y) {
      const equal = JSON.stringify(x.data) === JSON.stringify(y.data);
      return equal ? CORRECT : INCORRECT;
    }
    if ('name' in x && 'name' in y) {
      return x.name === y.name && x.text === y.text ? CORRECT : INCORRECT;
    }
    return UNSCORED;
  };

  export function correct(expected: Cell.Output[]) {
    return expected.some(message => message.header.msg_type === 'error') ?
      INCORRECT : CORRECT;
  }


  /**
   * @returns an unlocked rubric with the `key` field omitted. The client needs
   * to add a `key` field to use the rubric. The automatically generated `id` of
   * the rubric is constructed as follows:
   *
   * `"wb"` + `accessed` timestamp's digits `[0-9]` shifted into ascii chars
   * `[d-m]`, e.g., `"wbekihhlhjdhmld"`.
   */
  export function create(): Omit<Unlocked, 'key'> {
    const accessed = Date.now();
    const id = 'wb' + `${accessed}`.split('')
      .map(i => String.fromCharCode(parseInt(i, 10) + 100)).join('');
    const secret: Section = { cells: {} };
    const shared: Section = { cells: {} };
    return { accessed, id, locked: false, secret, shared };
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
      !!(shared.cells[id] || (deep && references(shared, id))) ||
      !!((secret as Section).cells[id] ||
        (deep && references(secret as Section, id)));
  }

  /**
   * @returns a promise that resolves to the given rubric, locked.
   */
  export async function lock(rubric: Rubric): Promise<Locked> {
    if (rubric.locked) {
      return rubric;
    }

    const { id, key, secret, shared } = rubric;
    return {
      accessed: Date.now(),
      id, key: null,
      locked: true,
      secret: await security.encrypt(JSON.stringify(secret), key),
      shared
    };
  }

  /**
   * @returns a normalized complete rubric or throws an error.
   */
  export function normalize(rubric: Partial<Locked>): Locked {
    const { accessed, id, key, locked, secret, shared } = rubric || {};
    if (!accessed) {
      throw new Error('invalid rubric, missing accessed');
    }
    if (!id) {
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
      throw new Error('invalid rubric, invalid shared section')
    }
    return { accessed, id, key, locked, secret, shared };
  }

  /**
   * @returns the number of cells configured in a rubric.
   */
  export function size(rubric: Rubric): number {
    const { locked, secret, shared } = rubric;
    return locked ?
      Object.keys(shared.cells).length :
      Object.keys(secret.cells).length + Object.keys(shared.cells).length
  }


  /**
   * Get the score for a single cell.
   *
   * @param rubric - the rubric that defines the cell being scored.
   * @param id - the id of the cell to score.
   * @param outputs - the outputs of all the executed workbook cells.
   *
   * @returns the score for this cell.
   *
   * #### Notes
   * Currently the score is only 0/1 or 1/1 whether it is correct or not.
   */
  export async function score(
    rubric: Rubric,
    id: string,
    outputs: Outputs
  ): Promise<Score> {
    const cell = get(rubric, id);
    const given = outputs[id];
    const reference = cell?.reference?.[0] ?? '';
    if (!cell || !given) {
      return UNSCORED;
    }
    if (cell.is === 'answerable') {
      return answer(cell.payload, given);
    }
    if (!outputs[reference]) {
      return UNSCORED;
    }
    if (cell.is === 'comparable') {
      return compare(outputs[reference], given);
    }
    if (cell.is === 'correctable') {
      return correct(outputs[reference]);
    }
    return 'unreachable' as never;
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
    if (!has(rubric, id)) {
      throw new Error('cannot toggle cell unknown in rubric');
    }

    const cell = get(rubric, id)!;
    const secret = { cells: { ...rubric.secret.cells } };
    const shared = { cells: { ...rubric.shared.cells } };
    return {
      ...rubric,
      accessed: Date.now(),
      secret: cell.shared ?
        { cells: { ...secret.cells, [cell.id]: { ...cell, shared: false } } } :
        { cells: { ...(delete secret.cells[cell.id], secret.cells) } },
      shared: cell.shared ?
        { cells: { ...(delete shared.cells[cell.id], shared.cells) } } :
        { cells: { ...shared.cells, [cell.id]: { ...cell, shared: true } } },
    };
  }

  /**
   * @returns an unlocked rubric after decrypting secret cells with given key.
   */
  export async function unlock(rubric: Locked, key: string): Promise<Unlocked> {
    const { id, shared } = rubric;
    const secret = JSON.parse(await security.decrypt(rubric.secret, key));
    return { accessed: Date.now(), id, key, locked: false, secret, shared };
  }
}
