import { find } from '@lumino/algorithm';
import * as security from './security';
import { Workbook } from './workbook';

export type Rubric = Rubric.Locked | Rubric.Unlocked;

export namespace Rubric {
  export type Locked = {
    readonly accessed: number;
    readonly id: string;
    readonly key: null;
    readonly locked: true;
    readonly secret: string;
    readonly shared: Section;
  };

  export type Unlocked = {
    readonly accessed: number;
    readonly id: string;
    readonly key: string;
    readonly locked: false;
    readonly secret: Section;
    readonly shared: Section;
  };

  export type Score = readonly [numerator: number, denominator: number];

  export type Section = { readonly cells: { [id: string]: Workbook.Cell; }; };

  export const CORRECT: Score = Object.freeze([1, 1]);

  export const INCORRECT: Score = Object.freeze([0, 1]);

  export const UNSCORED: Score = Object.freeze([
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY
  ]);

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
  export function get(
    rubric: Rubric,
    id: Workbook.Cell['id']
  ): Workbook.Cell | null {
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
  export function has(
    rubric: Rubric,
    id: Workbook.Cell['id'],
    deep = false
  ): boolean {
    const references = ({ cells }: Section, reference: string) =>
      find(Object.keys(cells), key => cells[key].reference === reference);
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
  export function toggle(rubric: Unlocked, id: Workbook.Cell['id']): Unlocked {
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
  export async function unlock(
    rubric: Rubric.Locked,
    key: string
  ): Promise<Rubric.Unlocked> {
    return {
      accessed: Date.now(),
      id: rubric.id,
      key,
      locked: false,
      secret: JSON.parse(await security.decrypt(rubric.secret as string, key)),
      shared: rubric.shared
    };
  }
}
