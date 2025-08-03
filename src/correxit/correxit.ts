import { Token } from '@lumino/coreutils';
import * as description from './description';
import { Rubric as RUBRIC } from './rubric';
import { keygen } from './security';
import { Workbook, Workbook as WORKBOOK } from './workbook';

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
  ): Promise<Rubric.Unlocked> {
    const rubric = open(workbook, { quiet: true });
    if (!rubric || rubric.locked || Rubric.has(rubric, cell.id)) {
      throw new Error('add error');
    }
    const section = rubric[cell.shared ? 'shared' : 'secret'];
    section.cells[cell.id] = { ...cell, shared: !!cell.shared };
    return Workbook.update(workbook, rubric);
  }

  /**
   * Convert a plain notebook into a workbook and return its rubric.
   */
  export async function convert(workbook: Workbook, passphrase: string) {
    try {
      const opened = open(workbook)!;
      const key = await keygen(passphrase, opened.id);
      const rubric = opened.locked ? await Rubric.unlock(opened, key) : opened;
      return Workbook.update(workbook, rubric);
    } catch (error) {
      if (error !== NO_CORREXIT_METADATA) {
        throw error;
      }
      const created = Rubric.create();
      const key = await keygen(passphrase, created.id);
      return Workbook.update(workbook, { ...created, key });
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
    return Workbook.lock(workbook);
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
  ): Rubric | null {
    if (!workbook || !workbook.content.model) {
      if (quiet) {
        return null;
      }
      throw new Error('workbook or content model is null');
    }
    if (Workbook.get(workbook)) {
      return Workbook.get(workbook);
    }

    const rubric = workbook.content.model.sharedModel.getMetadata('correxit');
    if (!rubric) {
      if (quiet) {
        return null;
      }
      throw NO_CORREXIT_METADATA;
    }
    try {
      return Rubric.normalize(rubric as Partial<Rubric.Locked>);
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
    return Workbook.update(workbook, rubric);
  }

  export async function reset(workbook: Workbook) {
    const rubric = open(workbook, { quiet: true });
    if (!rubric || rubric.locked) {
      throw new Error('reset error');
    }
    return Workbook.reset(workbook, rubric);
  }

  export async function toggle(
    workbook: Workbook,
    id: Workbook.Cell['id']
  ): Promise<Rubric.Unlocked> {
    const opened = open(workbook, { quiet: true });
    if (!opened || opened.locked || !Rubric.has(opened, id)) {
      throw new Error('cannot toggle');
    }
    const rubric = Rubric.toggle(opened, id);
    return Workbook.update(workbook, rubric);
  }

  export async function unlock(
    workbook: Workbook,
    key: string
  ): Promise<Rubric.Unlocked> {
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
    rubric: Correxit.Rubric.Unlocked
  ): Promise<Correxit.Rubric.Unlocked> {
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
    return Workbook.update(workbook, rubric);
  }
}
