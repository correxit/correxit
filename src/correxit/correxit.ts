import { Token } from '@lumino/coreutils';
import { AttachedProperty } from '@lumino/properties';
import * as description from './description';
import { Rubric as RUBRIC } from './rubric';
import { keygen } from './security';
import { Workbook as WORKBOOK } from './workbook';

export namespace Correxit {
  export namespace CommandIDs {
    export const add = 'correxit:add';
    export const convert = 'correxit:convert';
    export const correct = 'correxit:correct';
    export const lock = 'correxit:lock';
    export const remove = 'correxit:remove';
    export const replace = 'correxit:replace';
    export const reset = 'correxit:reset';
    export const toggle = 'correxit:toggle';
    export const unlock = 'correxit:unlock';
  }

  export import Rubric = RUBRIC;

  export import Workbook = WORKBOOK;

  export type Source = AsyncIterable<{ payload: Workbook | null }>;

  export const NO_CORREXIT_METADATA = new TypeError('no correxit metadata');

  export const SIDEBAR = 'correxit:sidebar';

  export const SOURCE = 'correxit:source';

  export const TOOLBARS = 'correxit:toolbars';

  export const Source = new Token<Source>(SOURCE);

  export const DESCRIPTION = {
    SIDEBAR: description.SIDEBAR,
    SOURCE: description.SOURCE,
    TOOLBARS: description.TOOLBARS
  };

  export async function add(
    workbook: Workbook,
    cell: Workbook.Cell
  ): Promise<Rubric<'unlocked'>> {
    const rubric = open(workbook, { quiet: true });
    if (!rubric || rubric.locked || Rubric.has(rubric, cell.id)) {
      throw new Error('add error');
    }
    const section = rubric[cell.shared ? 'shared' : 'secret'];
    section.cells[cell.id] = { ...cell, shared: !!cell.shared };
    return Encrypted.metadata(workbook, rubric);
  }

  /**
   * Convert a plain notebook into a workbook and return its rubric.
   */
  export async function convert(workbook: Workbook, passphrase: string) {
    try {
      const opened = open(workbook)!;
      const key = await keygen(passphrase, opened.id);
      const rubric = opened.locked ? await Rubric.unlock(opened, key) : opened;
      return Encrypted.metadata(workbook, rubric);
    } catch (error) {
      if (error === NO_CORREXIT_METADATA) {
        const created = Rubric.create();
        const key = await keygen(passphrase, created.id);
        return Encrypted.metadata(workbook, { ...created, key });
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
   * @returns a score for the cell or the whole workbook.
   */
  export async function correct(
    workbook: Workbook,
    id?: Workbook.Cell['id']
  ): Promise<Rubric.Score> {
    const { sum, UNSCORED } = Rubric;
    const { score } = Workbook.Cell;
    const rubric = open(workbook, { quiet: true });
    if (!rubric) {
      return UNSCORED;
    }

    const outputs = await Workbook.execute(workbook, id);
    if (!outputs) {
      return UNSCORED;
    }
    if (id) {
      return score(workbook, id, outputs);
    }

    const initial = Promise.resolve([0, 0] as Rubric.Score);
    return Object.keys(outputs).reduce(async (total, id) =>
      sum(await total, await score(workbook, id, outputs)), initial);
  }

  export async function lock(workbook: Workbook): Promise<void> {
    const rubric = open(workbook, { quiet: true });
    if (rubric && !rubric.locked) {
      await Encrypted.content(workbook, rubric);
    }
  }

  /**
   * Opens a workbook's rubric.
   *
   * @param workbook - The current workbook. May be `null`.
   * @param options.quiet - Whether to return `null` instead of rejecting.
   * @returns a promise that resolves to a rubric for a workbook.
   *
   * #### Notes
   * If `quiet` is set to true, the promise resolves with `null` instead of
   * rejecting. By default the promise either resolves with a rubric or rejects.
   */
  export function open(
    workbook: Workbook | null,
    { quiet }: { quiet?: boolean } = {}
  ): Rubric<'locked'> | Rubric<'unlocked'> | null {
    if (!workbook || !workbook.content.model) {
      if (quiet) {
        return null;
      }
      throw new Error('workbook or content model is null');
    }
    if (Private.rubric.get(workbook)) {
      return Private.rubric.get(workbook);
    }

    const rubric = workbook.content.model.sharedModel.getMetadata('correxit');
    if (!rubric) {
      if (quiet) {
        return null;
      }
      throw NO_CORREXIT_METADATA;
    }
    try {
      return Rubric.normalize(rubric as Partial<Rubric>);
    } catch (error) {
      if (quiet) {
        return null;
      }
      throw error;
    }
  }

  export async function remove(workbook: Workbook, id: string) {
    const rubric = open(workbook, { quiet: true });
    if (!rubric || rubric.locked) {
      throw new Error('remove error');
    }
    delete rubric.secret.cells[id];
    delete rubric.shared.cells[id];
    return Encrypted.metadata(workbook, rubric);
  }

  export async function reset(workbook: Workbook) {
    Private.rubric.set(workbook, null);
    const model = workbook.content.model!;
    model.deleteMetadata('correxit');
  }

  export async function toggle(
    workbook: Workbook,
    id: Workbook.Cell['id']
  ): Promise<Rubric<'unlocked'>> {
    const opened = open(workbook, { quiet: true });
    if (!opened || opened.locked || !Rubric.has(opened, id)) {
      throw new Error('cannot toggle');
    }
    const rubric = Rubric.toggle(opened, id);
    return Encrypted.metadata(workbook, rubric);
  }

  export async function unlock(
    workbook: Workbook,
    key: string
  ): Promise<Rubric<'unlocked'>> {
    const opened = open(workbook)!;
    if (!opened.locked) {
      return opened;
    }
    const unlocked = await Rubric.unlock(opened, key);
    return Decrypted.content(workbook, unlocked);
  }
}

namespace Decrypted {
  /**
   * Decrypts all encrypted correxit raw cells and returns updated rubric.
   */
  export async function content(
    workbook: Correxit.Workbook,
    rubric: Correxit.Rubric<'unlocked'>
  ): Promise<Correxit.Rubric<'unlocked'>> {
    const { decrypt } = Correxit.Workbook.Cell;
    const { key } = rubric;
    for (const id in rubric.secret.cells) {
      const { is, shared, payload, reference } = rubric.secret.cells[id];
      if (is === 'comparable' || is === 'correctable') {
        rubric.secret.cells[id] = {
          id, is, payload, shared,
          reference: await decrypt(workbook, reference, key)
        };
      }
    };
    return Encrypted.metadata(workbook, rubric);
  }
}

namespace Encrypted {
  const { Workbook: { Cell }, Rubric } = Correxit;

  /**
   * Saves encrypted workbook metadata.
   */
  export async function metadata(
    workbook: Correxit.Workbook,
    rubric: Correxit.Rubric<'unlocked'>,
    lock = false
  ): Promise<Correxit.Rubric<'unlocked'>> {
    const { sharedModel } = workbook.content.model!;
    const locked = await Rubric.lock(rubric);
    const unlocked = await Rubric.unlock(locked, rubric.key);
    Private.rubric.set(workbook, lock ? locked : unlocked);
    sharedModel.setMetadata('correxit', locked);
    return unlocked;
  }

  /**
   * Encrypts the workbook cell content, updates rubric, and saves metadata.
   */
  export async function content(
    workbook: Correxit.Workbook,
    rubric: Correxit.Rubric<'unlocked'>
  ): Promise<void> {
    const { key } = rubric;
    for (const id in rubric.secret.cells) {
      const cell = rubric.secret.cells[id];
      if (cell.is === 'comparable' || cell.is === 'correctable') {
        const reference = await Cell.encrypt(workbook, cell.reference, key);
        rubric.secret.cells[id] = { ...cell, reference };
      }
    };
    await metadata(workbook, rubric, true);
  }
}

namespace Private {
  export const rubric = new AttachedProperty<
    Correxit.Workbook,
    Correxit.Rubric<'locked'> | Correxit.Rubric<'unlocked'> | null
  >({ name: 'rubric', create: _ => null });
}
