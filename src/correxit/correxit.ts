import { ICodeCellModel } from '@jupyterlab/cells';
import { NotebookActions } from '@jupyterlab/notebook';
import { find, findIndex } from '@lumino/algorithm';
import * as description from './description';
import { Rubric, Rubric as RUBRIC } from './rubric';
import { encrypt } from './security';
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
  ) {
    const rubric = open(workbook, { quiet: true });
    if (!rubric || rubric.locked) {
      return new Error('add error');
    }
    rubric[cell.shared ? 'shared' : 'secret'].cells[cell.id] = cell;
    await Encrypt.metadata(workbook, rubric);
    return unlock(workbook, rubric.key);
  }

  export async function convert(workbook: Workbook, key: string) {
    if (key.length !== 64) {
      throw new Error('cannot unlock a workbook without a valid key');
    }
    try {
      const opened = open(workbook)!;
      const rubric = opened.locked ? await Rubric.unlock(opened, key) : opened;
      await Encrypt.metadata(workbook, rubric);
      return unlock(workbook, rubric.key);
    } catch (error) {
      if (error === NO_CORREXIT_METADATA) {
        await Encrypt.metadata(workbook, Correxit.Rubric.create(key));
        return unlock(workbook, key);
      }
      throw error;
    }
  }

  export async function correct(
    workbook: Workbook,
    id?: string
  ): Promise<Rubric.Score> {
    const rubric = open(workbook, { quiet: true });
    if (!rubric) {
      return Rubric.UNSCORED;
    }
    const model = workbook.content.model!;
    const code = find(model.cells, cell => Workbook.Cell.id(cell) === id);
    if (!code || code.type !== 'code') {
      return Rubric.UNSCORED;
    }
    for (const output of (code as ICodeCellModel).outputs.toJSON()) {
      console.log('output', output);
    }
    return [0, 0];
  }

  export async function lock(workbook: Workbook): Promise<void> {
    const rubric = open(workbook, { quiet: true });
    if (!rubric || rubric.locked) {
      return;
    }
    await Encrypt.metadata(workbook, rubric);
    await Encrypt.content(workbook, rubric);
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

    const rubric: Rubric<'locked'> | null =
      workbook.content.model.getMetadata('correxit') || null;
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

  export async function remove(workbook: Workbook, cell: string) {
    const rubric = open(workbook, { quiet: true });
    if (!rubric || rubric.locked) {
      return new Error('remove error');
    }
    delete rubric.secret.cells[cell];
    delete rubric.shared.cells[cell];
    await Encrypt.metadata(workbook, rubric);
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

  export async function unlock(
    workbook: Workbook,
    key: string
  ): Promise<Rubric<'unlocked'>> {
    const opened = open(workbook)!;
    if (!opened.locked) {
      return opened;
    }
    const rubric = await Rubric.unlock(opened, key);
    await Encrypt.metadata(workbook, rubric);
    Private.CACHE.set(workbook, rubric);
    return rubric;
  }
}

namespace Encrypt {
  /**
   * Write rubric metadata to workbook.
   * @param workbook
   * @param rubric
   *
   * #### Notes
   * This function always sets the workbook's cached rubric to locked.
   */
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
    const { Cell } = Correxit.Workbook;
    const { key, secret } = rubric;
    const notebook = workbook.content;
    NotebookActions.clearAllOutputs(notebook);
    const model = notebook.model!;
    for (const id of Object.keys(secret.cells)) {
      const index = findIndex(model.cells, cell => Cell.id(cell) === id);
      const cell = model.cells.get(index);
      const source = cell.sharedModel.getSource();
      const widget = find(notebook.widgets, ({ model }) => model === cell)!;
      notebook.deselectAll();
      widget.model.sharedModel.setSource(await encrypt(source, key));
      notebook.select(widget);
      NotebookActions.changeCellType(workbook.content, 'raw')
    };
  }
}

namespace Private {
  export const CACHE = new WeakMap<
    Correxit.Workbook,
    Correxit.Rubric<'locked'> | Correxit.Rubric<'unlocked'>
  >();
}
