import { Token } from '@lumino/coreutils';
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
    await Encrypted.metadata(workbook, rubric);
    return unlock(workbook, rubric.key);
  }

  /**
   * Convert a plain notebook into a workbook and return its rubric.
   */
  export async function convert(workbook: Workbook, passphrase: string) {
    try {
      const opened = open(workbook)!;
      const key = await keygen(passphrase, opened.id);
      const rubric = opened.locked ? await Rubric.unlock(opened, key) : opened;
      return unlock(workbook, (await Encrypted.metadata(workbook, rubric)).key);
    } catch (error) {
      if (error === NO_CORREXIT_METADATA) {
        const created = Rubric.create();
        const key = await keygen(passphrase, created.id);
        const rubric = await Encrypted.metadata(workbook, { ...created, key });
        return unlock(workbook, rubric.key);
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
    const rubric = open(workbook, { quiet: true });
    if (!rubric) {
      return Rubric.UNSCORED;
    }

    const outputs = await Workbook.execute(workbook, id);
    if (!outputs) {
      return Rubric.UNSCORED;
    }
    if (id) {
      return await Workbook.Cell.score(workbook, id, outputs);
    }

    let total: Rubric.Score = [0, 0];
    for (const id of Object.keys(outputs)) {
      const score = await Workbook.Cell.score(workbook, id, outputs);
      total = Rubric.sum(total, score);
    }
    return total;
  }

  export async function lock(workbook: Workbook): Promise<void> {
    const rubric = open(workbook, { quiet: true });
    if (!rubric || rubric.locked) {
      return;
    }
    const unlocked = await Encrypted.content(workbook, rubric);
    Private.CACHE.set(workbook, await Rubric.lock(unlocked));
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
    if (Private.CACHE.has(workbook)) {
      return Private.CACHE.get(workbook)!;
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
    await Encrypted.metadata(workbook, rubric);
    return unlock(workbook, rubric.key);
  }

  export async function reset(workbook: Workbook) {
    Private.CACHE.delete(workbook);
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
    Private.CACHE.set(workbook, rubric);
    await Encrypted.metadata(workbook, rubric);
    return unlock(workbook, rubric.key);
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
    const rubric = await Decrypted.content(workbook, unlocked);
    Private.CACHE.set(workbook, rubric);
    return rubric;
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
      const { is, reference, ...cell } = rubric.secret.cells[id];
      if (is === 'comparable' || is === 'correctable') {
        rubric.secret.cells[id] = {
          ...cell, is, reference: await decrypt(workbook, reference!, key)
        };
      }
    };
    return Encrypted.metadata(workbook, rubric);
  }
}

namespace Encrypted {
  const { encrypt } = Correxit.Workbook.Cell;
  const { lock, unlock } = Correxit.Rubric;

  /**
   * Saves encrypted workbook metadata.
   */
  export async function metadata(
    workbook: Correxit.Workbook,
    rubric: Correxit.Rubric<'unlocked'>
  ): Promise<Correxit.Rubric<'unlocked'>> {
    const { sharedModel } = workbook.content.model!;
    const metadata = await lock(rubric);
    sharedModel.setMetadata('correxit', metadata);
    return unlock(metadata, rubric.key);
  }

  /**
   * Encrypts the workbook cell content, updates rubric, and saves metadata.
   */
  export async function content(
    workbook: Correxit.Workbook,
    rubric: Correxit.Rubric<'unlocked'>
  ): Promise<Correxit.Rubric<'unlocked'>> {
    const { key } = rubric;
    for (const id in rubric.secret.cells) {
      const cell = rubric.secret.cells[id];
      if (cell.is === 'comparable' || cell.is === 'correctable') {
        const reference = await encrypt(workbook, cell.reference!, key);
        rubric.secret.cells[id] = { ...cell, reference };
      }
    };
    return metadata(workbook, rubric);
  }
}

namespace Private {
  export const CACHE = new WeakMap<
    Correxit.Workbook,
    Correxit.Rubric<'locked'> | Correxit.Rubric<'unlocked'>
  >();
}
