import { Kernel, KernelMessage } from '@jupyterlab/services';
import { findIndex } from '@lumino/algorithm';
import * as description from './description';
import { Rubric, Rubric as RUBRIC } from './rubric';
import { Workbook as WORKBOOK } from './workbook';
import { digest } from './security';

export namespace Correxit {
  export import Rubric = RUBRIC;

  export import Workbook = WORKBOOK;

  export type CellOutputMessage =
    | KernelMessage.IIOPubMessage<'execute_result'>
    | KernelMessage.IIOPubMessage<'display_data'>
    | KernelMessage.IIOPubMessage<'stream'>
    | KernelMessage.IIOPubMessage<'error'>;

  export type CellOutputs = { [id: string]: CellOutputMessage[] };

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
    if (!rubric || rubric.locked || Rubric.has(rubric, cell.id)) {
      return new Error('add error');
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
   * Execute code in a kernel.
   *
   * @param kernel - the kernel to use.
   * @param source - the code source to execute.
   *
   * @returns an array of IIOPubMessage returned by the code execution.
   */
  export async function runCode(
    kernel: Kernel.IKernelConnection,
    source: string
  ): Promise<CellOutputMessage[]> {
    const outputs: CellOutputMessage[] = [];
    const future = kernel.requestExecute({code: source});
    future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
      if (msg.header.msg_type === 'execute_result' ||
          msg.header.msg_type === 'display_data' ||
          msg.header.msg_type === 'stream' ||
          msg.header.msg_type === 'error') {
        outputs.push(msg as CellOutputMessage);
      }
    };

    await future.done;
    return outputs;
  }

  /**
   * Run the code cells of a workbook.
   *
   * - if the id is not provided, the whole workbook is executed.
   * - if the id is provided, and the target cell is 'answerable', the workbook is
   * executed until this cell.
   * - if the id is provided and the target cell is 'comparable' or 'correctable', the
   * workbook is executed until both target and reference cells.
   *
   *
   * @param kernel - the kernel used to run the code cells.
   * @param workbook - the workbook to run.
   * @param id - the ID of the target cell.
   *
   * @returns a CellOutputs object, containing an array of IIOPubMessage for each
   * cell executed.
   */
  export async function runWorkbook(
    kernel: Kernel.IKernelConnection,
    workbook: Workbook,
    rubric: Rubric<'locked'> | Rubric<'unlocked'>,
    id?: string
  ): Promise<CellOutputs | undefined> {
    const outputs: CellOutputs = {};
    const cells = workbook.content.model!.cells;
    let last = cells.length -1;
    if (id) {
      const correxitCell = !rubric.locked
        ? rubric.secret.cells[id]
        : rubric.shared.cells[id] || null;

      if (!correxitCell) {
        return;
      }
      if (correxitCell.is === 'answerable') {
        last = findIndex(cells, cell => Workbook.Cell.id(cell) === id);
      } else {
        const reference = correxitCell.reference!;
        last = Math.max(
          findIndex(cells, cell => Workbook.Cell.id(cell) === id),
          findIndex(cells, cell => Workbook.Cell.id(cell) === reference)
        );
      }
    }

    for (let i = 0; i <= last; i++) {
      const cell = cells.get(i);
      const cellId = Workbook.Cell.id(cell);
      if (cell.type !== 'code') {
        continue;
      }
      outputs[cellId] = await runCode(kernel, cell.sharedModel.source);
    }
    return outputs;
  }

  /**
   * Get the score for a single cell.
   *
   * @param rubric - the Rubric that contain the cell.
   * @param outputs - the outputs of all the executed cells.
   * @param id - the id of the cell to score.
   *
   * @return the score for this cell.
   *
   * ### NOTES:
   * Currently the score is only 0/1 or 1/1 whether it is correct or not.
   */
  export async function scoreCell(
    rubric: Rubric<'locked'> | Rubric<'unlocked'>,
    outputs: CellOutputs,
    id: string
  ): Promise<Rubric.Score> {
    const cellOutputs = outputs[id];
    if (cellOutputs === undefined) {
      return Rubric.UNSCORED;
    }

    const lastOutput = cellOutputs[cellOutputs.length -1];
    const correxitCell = !rubric.locked ? rubric.secret.cells[id] : rubric.shared.cells[id] || null;
    if (!correxitCell) {
      return Rubric.UNSCORED;
    }
    if (correxitCell.is === 'answerable') {
      // TODO: handle the case when the execution failed.
      if (lastOutput.header.msg_type === 'error') {
        return [0, 1];
      } else if (lastOutput.header.msg_type === 'stream') {
        const content = lastOutput.content as KernelMessage.IStreamMsg['content'];
        if (content.name === 'stdout') {
          const value = await digest(content.text.trim());
          return value === correxitCell.payload?.[0] ? [1, 1] : [0, 1];
        }
        return [0, 1];
      }
    } else {
      const refId = correxitCell.reference!;
      const refOutputs = outputs[refId];
      // TODO: we should probably handle this case, where the reference cell has not
      // been executed.
      if (refOutputs === undefined) {
        return Rubric.UNSCORED;
      }

      if (correxitCell.is === 'comparable') {
        // TODO: handle the case where the reference cell has no output to compare with.
        if (!refOutputs.length) {
          return Rubric.UNSCORED;
        }
        const lastRefOutput = refOutputs[refOutputs.length -1];
        // Compare the execution result content.
        return JSON.stringify(lastOutput.content) === JSON.stringify(lastRefOutput.content)
          ? [1, 1]
          : [0, 1];
      } else if (correxitCell.is === 'correctable') {
        // Ensure the reference cell has no error.
        const errors = refOutputs.filter(value => value.header.msg_type === 'error');
        return errors.length === 0 ? [1, 1] : [0, 0];
      }
    }
    return Rubric.UNSCORED
  }

  /**
   * Correct a cell or a workbook.
   *
   * @param workbook - the workbook to correct.
   * @param id - the id of the cell to correct. The whole workbook is corrected if this
   * is not provided.
   *
   * @returns a score for the cell or the whole workbook.
   */
  export async function correct(
    workbook: Workbook,
    id?: string
  ): Promise<Rubric.Score> {
    const rubric = open(workbook, { quiet: true });
    if (!rubric || !workbook.content.model) {
      return Rubric.UNSCORED;
    }

    // Create a new kernel
    const kernel = await workbook.context.sessionContext.kernelManager?.startNew();
    if (!kernel) {
      console.error('The kernel couldn\'t be started')
      return Rubric.UNSCORED;
    }

    // Run the workbook cells.
    const outputs = await runWorkbook(kernel, workbook, rubric, id);
    await kernel?.shutdown();

    if (outputs === undefined) {
      return Rubric.UNSCORED;
    }

    // Compute the score, only the target cell if the id is provided,
    // the whole workbook otherwise.
    if (id) {
      return await scoreCell(rubric, outputs, id);
    } else {
      let total: Rubric.Score = [0, 0];
      for (const cellId of Object.keys(outputs)) {
        const score = await scoreCell(rubric, outputs, cellId);
        total = Rubric.sumScore(total, score);
      }
      return total;
    }
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

  export async function remove(workbook: Workbook, id: string) {
    const rubric = open(workbook, { quiet: true });
    if (!rubric || rubric.locked) {
      return new Error('remove error');
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
