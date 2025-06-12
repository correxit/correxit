import { DocumentRegistry } from '@jupyterlab/docregistry';
import { INotebookModel, Notebook } from '@jupyterlab/notebook';
import { UUID } from '@lumino/coreutils';
import { decrypt, encrypt } from './security';

export type Locked = 0 & Record<string, never>;

export type Unlocked = 1 & Record<string, never>;

export type Rubric<T extends Locked | Unlocked> = {
  readonly id: string;

  readonly key: T extends Locked ? null : string;

  readonly locked: T extends Locked ? true : false;

  readonly secret: T extends Locked ? string : Rubric.Section;

  readonly shared: Rubric.Section;
};

export namespace Rubric {
  export type Section = { cells: Record<string, never>; };

  export const clear = (key: Workbook) => Private.rubrics.delete(key);

  export const get = (key: Workbook) => Private.rubrics.get(key);

  export const has = (key: Workbook) => Private.rubrics.has(key);

  export const set = (
    workbook: Workbook,
    rubric: Rubric<Locked | Unlocked>
  ) => Private.rubrics.set(workbook, rubric);

  export function create(key: string): Rubric<Unlocked> {
    return {
      id: `wb-${UUID.uuid4()}`, key,
      locked: false,
      secret: { cells: {} },
      shared: { cells: {} }
    };
  }

  export async function lock(
    rubric: Rubric<Unlocked>
  ): Promise<Rubric<Locked>> {
    const { id, key, secret, shared } = rubric;
    return {
      id, key: null,
      locked: true,
      secret: await encrypt(JSON.stringify(secret), key),
      shared
    };
  }

  export function normalize(
    { id, key, locked, secret, shared }: Partial<Rubric<Locked>>
  ): Rubric<Locked> {
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
    rubric: Rubric<Locked>,
    key: string
  ): Promise<Rubric<Unlocked>> {
    return {
      id: rubric.id,
      key,
      locked: false,
      secret: JSON.parse(await decrypt(rubric.secret as string, key)),
      shared: rubric.shared
    };
  }
}

export type Workbook = {
  readonly content: Notebook;
  readonly context: DocumentRegistry.IContext<INotebookModel>;
};

namespace Private {
  export const rubrics = new WeakMap<Workbook, Rubric<Locked | Unlocked>>();
}
