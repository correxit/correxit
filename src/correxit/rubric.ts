import { UUID } from '@lumino/coreutils';
import * as security from './security';
import { Workbook } from './workbook';
import { find } from '@lumino/algorithm';

export type Rubric<Secure = 'locked' | 'unlocked'> = {
  readonly id: string;

  readonly key: Secure extends 'locked' ? null : string;

  readonly locked: Secure extends 'locked' ? true : false;

  readonly secret: Secure extends 'locked' ? string : Rubric.Section;

  readonly shared: Rubric.Section;
};

export namespace Rubric {
  export const CORRECT: Score = Object.freeze([1, 1]);

  export const INCORRECT: Score = Object.freeze([0, 1]);

  export const UNSCORED: Score = Object.freeze([
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY
  ]);

  export type Score = readonly [numerator: number, denominator: number];

  export type Section = { readonly cells: { [id: string]: Workbook.Cell; }; };

  const add = (section: Rubric.Section, cell: Workbook.Cell) => {
    return { cells: { ...section.cells, [cell.id]: cell } } as Rubric.Section;
  }

  const references = ({ cells }: Section, reference: string) =>
    find(Object.keys(cells), key => cells[key].reference === reference);

  const remove = (section: Rubric.Section, cell: Workbook.Cell) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [cell.id]: _, ...cells } = section.cells;
    return { cells } as Rubric.Section;
  }

  export function create(key: string): Rubric<'unlocked'> {
    return {
      id: `wb-${UUID.uuid4()}`, key,
      locked: false,
      secret: { cells: {} },
      shared: { cells: {} }
    };
  }

  export function get(
    rubric: Rubric<'locked'> | Rubric<'unlocked'>,
    id: Workbook.Cell['id']
  ): Workbook.Cell | null {
    if (has(rubric, id)) {
      const { locked, secret, shared } = rubric;
      return locked ? shared.cells[id] : secret.cells[id] || shared.cells[id];
    }
    return null;
  }

  /**
   * Whether a rubric has or references a given id.
   */
  export function has(
    rubric: Rubric<'locked'> | Rubric<'unlocked'>,
    id: Workbook.Cell['id'],
    deep = false
  ): boolean {
    const { locked, secret, shared } = rubric;
    return locked ?
      !!(shared.cells[id] || (deep && references(shared, id))) :
      !!(shared.cells[id] || (deep && references(shared, id))) ||
      !!((secret as Section).cells[id] ||
        (deep && references(secret as Section, id)));
  }

  /**
   * Lock a rubric and return a promise that resolves to the locked rubric.
   */
  export async function lock(
    rubric: Rubric<'unlocked'>
  ): Promise<Rubric<'locked'>> {
    const { id, key, secret, shared } = rubric;
    return {
      id, key: null,
      locked: true,
      secret: await security.encrypt(JSON.stringify(secret), key),
      shared
    };
  }

  /**
   * Returns a normalized complete rubric or throws an error.
   */
  export function normalize(
    rubric: Partial<Rubric<'locked'>>
  ): Rubric<'locked'> {
    const { id, key, locked, secret, shared } = rubric || {};
    if (!id) {
      throw new Error('invalid rubric, missing id');
    }
    if (key !== null) {
      throw new Error('invalid rubric, missing null key');
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
    return { id, key, locked, secret, shared };
  }

  /**
   * Returns the number of cells configured in a rubric.
   */
  export function size(rubric: Rubric<'locked'> | Rubric<'unlocked'>): number {
    const { locked, secret, shared } = rubric;
    return locked ?
      Object.keys(shared.cells).length :
      Object.keys(secret.cells).length + Object.keys(shared.cells).length
  }

  /**
   * Return the sum of two scores.
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
   * Returns a rubric where given cell is toggled between `secret` and `shared`.
   */
  export function toggle(
    rubric: Rubric<'unlocked'>,
    id: Workbook.Cell['id']
  ): Rubric<'unlocked'> {
    if (!has(rubric, id)) {
      throw new Error('cannot toggle cell unknown in rubric');
    }
    const cell = get(rubric, id)!;
    return {
      id: rubric.id,
      key: rubric.key,
      locked: rubric.locked,
      secret: cell.shared ?
        add(rubric.secret, { ...cell, shared: false }) :
        remove(rubric.secret, cell),
      shared: cell.shared ?
        remove(rubric.shared, cell) :
        add(rubric.shared, { ...cell, shared: true })
    };
  }

  export async function unlock(
    rubric: Rubric<'locked'>,
    key: string
  ): Promise<Rubric<'unlocked'>> {
    return {
      id: rubric.id,
      key,
      locked: false,
      secret: JSON.parse(await security.decrypt(rubric.secret as string, key)),
      shared: rubric.shared
    };
  }
}
