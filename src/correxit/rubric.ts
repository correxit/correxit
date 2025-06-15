import { UUID } from '@lumino/coreutils';
import { decrypt, encrypt } from './security';
import { Workbook } from './workbook';

export type Rubric<Secure = 'locked' | 'unlocked'> = {
  readonly id: string;

  readonly key: Secure extends 'locked' ? null : string;

  readonly locked: Secure extends 'locked' ? true : false;

  readonly secret: Secure extends 'locked' ? string : Rubric.Section;

  readonly shared: Rubric.Section;
};

export namespace Rubric {

  export type Section = { cells: { [id: string]: Workbook.Cell; }; };

  export function create(key: string): Rubric<'unlocked'> {
    return {
      id: `wb-${UUID.uuid4()}`, key,
      locked: false,
      secret: { cells: {} },
      shared: { cells: {} }
    };
  }

  export function has(
    rubric: Rubric<'locked'> | Rubric<'unlocked'>,
    cell: string
  ): boolean {
    if (rubric.locked) {
      return !!rubric.shared.cells[cell];
    }
    return !!(rubric.secret.cells[cell] || rubric.shared.cells[cell]);
  }

  export async function lock(
    rubric: Rubric<'unlocked'>
  ): Promise<Rubric<'locked'>> {
    const { id, key, secret, shared } = rubric;
    return {
      id, key: null,
      locked: true,
      secret: await encrypt(JSON.stringify(secret), key),
      shared
    };
  }

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

  export async function unlock(
    rubric: Rubric<'locked'>,
    key: string
  ): Promise<Rubric<'unlocked'>> {
    return {
      id: rubric.id,
      key,
      locked: false,
      secret: JSON.parse(await decrypt(rubric.secret as string, key)),
      shared: rubric.shared
    };
  }
}
