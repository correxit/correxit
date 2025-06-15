import * as description from './description';
import { Rubric as RUBRIC } from './rubric';
import { Workbook as WORKBOOK } from './workbook';

export namespace Correxit {
  export import Rubric = RUBRIC;

  export import Workbook = WORKBOOK;

  export const DESCRIPTION = {
    PLUGIN: description.PLUGIN,
    SIDEBAR: description.SIDEBAR
  };

  export const PLUGIN = 'correxit:plugin';

  export const SIDEBAR = 'correxit:sidebar';

  export async function add(
    workbook: Workbook,
    { cell, section }: {
      cell: Workbook.Cell,
      section: 'secret' | 'shared'
    }
  ) {
    const rubric = open(workbook, { quiet: true });
    if (!rubric || rubric.locked) {
      return new Error('add error');
    }
    rubric[section].cells[cell.id] = cell;
    await Private.write(workbook, rubric);
    return unlock(workbook, rubric.key);
  }

  export async function convert(workbook: Workbook, key: string) {
    if (key.length !== 64) {
      throw new Error('cannot unlock a workbook without a valid key');
    }
    try {
      const opened = open(workbook)!;
      const rubric = opened.locked ? await Rubric.unlock(opened, key) : opened;
      await Private.write(workbook, rubric);
      return unlock(workbook, rubric.key);
    } catch (error) {
      if (error === Private.NO_CORREXIT_METADATA) {
        await Private.write(workbook, Correxit.Rubric.create(key));
        return unlock(workbook, key);
      }
      throw error;
    }
  }

  export function correctable(
    workbook: Workbook | null,
    cell?: string
  ): boolean {
    const rubric = open(workbook, { quiet: true });
    if (!rubric) {
      return false;
    }
    if (cell) {
      return Rubric.has(rubric, cell);
    }
    if (rubric.locked) {
      return !!Object.keys(rubric.shared.cells).length;
    }
    return !!(Object.keys(rubric.secret.cells)).length ||
           !!(Object.keys(rubric.shared.cells)).length;
  }

  export async function lock(workbook: Workbook): Promise<void> {
    const rubric = open(workbook, { quiet: true });
    if (rubric && !rubric.locked) {
      return Private.write(workbook, rubric);
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
    if (Private.CACHE.has(workbook)) {
      return Private.CACHE.get(workbook)!;
    }

    const rubric: Rubric<'locked'> | null =
      workbook.content.model.getMetadata('correxit') || null;
    if (!rubric) {
      if (quiet) {
        return null;
      }
      throw Private.NO_CORREXIT_METADATA;
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

  export async function reset(workbook: Workbook) {
    Private.CACHE.delete(workbook);
    workbook.content.model?.deleteMetadata('correxit');
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
    await Private.write(workbook, rubric);
    Private.CACHE.set(workbook, rubric);
    return rubric;
  }
}

namespace Private {
  export const CACHE = new WeakMap<
    Correxit.Workbook,
    Correxit.Rubric<'locked'> | Correxit.Rubric<'unlocked'>
  >();

  export const NO_CORREXIT_METADATA = new TypeError('no correxit metadata');

  /**
   * Write rubric metadata to workbook.
   * @param workbook
   * @param rubric
   *
   * #### Notes
   * This function always sets the workbook's cached rubric to locked.
   */
  export async function write(
    workbook: Correxit.Workbook,
    rubric: Correxit.Rubric<'unlocked'>
  ): Promise<void> {
    const { content: { model } } = workbook;
    const locked = await Correxit.Rubric.lock(rubric);
    CACHE.set(workbook, locked);
    model?.setMetadata('correxit', locked);
  }
}
