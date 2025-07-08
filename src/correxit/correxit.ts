import * as description from './description';
import { Rubric, Rubric as RUBRIC } from './rubric';
import { Workbook as WORKBOOK } from './workbook';

export namespace Correxit {
  export import Rubric = RUBRIC;

  export import Workbook = WORKBOOK;

  export const DESCRIPTION = {
    PLUGIN: description.PLUGIN,
    SIDEBAR: description.SIDEBAR
  };

  export const NO_CORREXIT_METADATA = new TypeError('no correxit metadata');

  export const PLUGIN = 'correxit:plugin';

  export const SIDEBAR = 'correxit:sidebar';

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

  export async function convert(workbook: Workbook, key: string) {
    if (key.length !== 64) {
      throw new Error('cannot unlock a workbook without a valid key');
    }
    try {
      const opened = open(workbook)!;
      const rubric = opened.locked ? await Rubric.unlock(opened, key) : opened;
      await Encrypted.metadata(workbook, rubric);
      return unlock(workbook, rubric.key);
    } catch (error) {
      if (error === NO_CORREXIT_METADATA) {
        await Encrypted.metadata(workbook, Correxit.Rubric.create(key));
        return unlock(workbook, key);
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
    await Encrypted.content(workbook, rubric);
    await Encrypted.metadata(workbook, rubric);
    Private.CACHE.set(workbook, await Rubric.lock(rubric));
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

    const rubric = workbook.content.model.getMetadata('correxit') || null;
    if (!rubric) {
      if (quiet) {
        return null;
      }
      throw NO_CORREXIT_METADATA;
    }
    try {
      return Rubric.normalize(rubric);
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
    for (const cell of model.cells) {
      cell.deleteMetadata('correxit');
    }
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
    return rubric;
  }

  export async function unlock(
    workbook: Workbook,
    key: string
  ): Promise<Rubric<'unlocked'>> {
    const opened = open(workbook)!;
    if (!opened.locked) {
      return opened;
    }
    const rubric = await Rubric.unlock(opened, key);
    Private.CACHE.set(workbook, rubric);
    await Decrypted.content(workbook, rubric);
    await Encrypted.metadata(workbook, rubric);
    return rubric;
  }
}

namespace Decrypted {
  export async function content(
    workbook: Correxit.Workbook,
    rubric: Rubric<'unlocked'>
  ): Promise<void> {
    for (const id in rubric.secret.cells) {
      const cell = rubric.secret.cells[id];
      if (cell.is === 'comparable' || cell.is === 'correctable') {
        await Correxit.Workbook.Cell.decrypt(workbook, cell.reference!);
      }
    };
  }
}

namespace Encrypted {
  export async function metadata(
    workbook: Correxit.Workbook,
    rubric: Correxit.Rubric<'unlocked'>
  ): Promise<void> {
    const notebook = workbook.content;
    const model = notebook.model!;
    const locked = await Correxit.Rubric.lock(rubric);
    model.setMetadata('correxit', locked);
    for (const cell of model.cells) {
      Correxit.Workbook.Cell.id(cell, true);
    }
  }

  export async function content(
    workbook: Correxit.Workbook,
    rubric: Rubric<'unlocked'>
  ): Promise<void> {
    for (const id in rubric.secret.cells) {
      const cell = rubric.secret.cells[id];
      if (cell.is === 'comparable' || cell.is === 'correctable') {
        await Correxit.Workbook.Cell.encrypt(workbook, cell.reference!);
      }
    };
  }
}

namespace Private {
  export const CACHE = new WeakMap<
    Correxit.Workbook,
    Correxit.Rubric<'locked'> | Correxit.Rubric<'unlocked'>
  >();
}
