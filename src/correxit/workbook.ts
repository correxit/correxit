import { ICodeCellModel } from '@jupyterlab/cells';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import {
  INotebookModel,
  Notebook,
  NotebookActions
} from '@jupyterlab/notebook';
import { Kernel, KernelMessage } from '@jupyterlab/services';
import { find, findIndex, range, reduce } from '@lumino/algorithm';
import { AttachedProperty } from '@lumino/properties';
import { Correxit } from './correxit';
import { Rubric } from './rubric';
import * as security from './security';

/**
 * `Workbook` as a type is equal to `NotebookPanel`. Conceptually, a notebook
 * panel is only a Correxit workbook if it has Correxit metadata.
 */
export type Workbook = {
  readonly content: Notebook;
  readonly context: DocumentRegistry.IContext<INotebookModel>;
};

export namespace Workbook {
  /**
   * The collection of outputs for every scorable workbook cell.
   */
  export type Outputs = { [id: Cell['id']]: Cell.Output[]; }

  export type Integrity = Integrity.Pass | Integrity.Fail;

  namespace Integrity {
    export type Pass = {
      ok: true;
      pruned: { cell: Cell; reason: string; }[];
      rubric: Rubric;
    };

    export type Fail = { ok: false; error: string; rubric: Rubric | null; };
  }

  /**
   * A workbook cell definition defines how to score a notebook cell.
   */
  export type Cell =  {
    readonly id: string;
    readonly is: 'answerable';
    readonly payload: string[];
    readonly reference: null;
    readonly shared: boolean;
  } | {
    readonly id: string;
    readonly is: 'comparable' | 'correctable';
    readonly payload: null;
    readonly reference: string;
    readonly shared: boolean;
  };

  export namespace Cell {
    /**
     * An output is an `iopub` message of interest.
     */
    export type Output =
      | KernelMessage.IIOPubMessage<'execute_result'>
      | KernelMessage.IIOPubMessage<'display_data'>
      | KernelMessage.IIOPubMessage<'stream'>
      | KernelMessage.IIOPubMessage<'error'>;

    const answer = async (expected: string[], given: Output[]) => {
        const { CORRECT, INCORRECT, UNSCORED } = Rubric;
        if (!given.length) {
          return INCORRECT;
        }

        const message = given.slice(-1)[0];
        if (message.header.msg_type === 'error') {
          return INCORRECT;
        }
        if (message.header.msg_type === 'stream') {
          const { content } = message as KernelMessage.IStreamMsg;
          if (content.name === 'stdout') {
            const value = await security.digest(content.text.trim());
            return value === expected?.[0] ? CORRECT : INCORRECT;
          }
          return INCORRECT;
        }
      return UNSCORED;
    };

    const compare = (expected: Output[], given: Output[]) => {
      const { CORRECT, INCORRECT, UNSCORED } = Rubric;
      if (!expected.length) {
        return UNSCORED;
      }
      if (!given.length) {
        return INCORRECT;
      }

      const keys = (obj: Output['content']) => Object.keys(obj).sort().join('');
      const x = given.slice(-1)[0].content;
      const y = expected.slice(-1)[0].content;
      if (keys(x) !== keys(y)) {
        return INCORRECT;
      }
      if ('data' in x && 'data' in y) {
        const equal = JSON.stringify(x.data) === JSON.stringify(y.data);
        return equal ? CORRECT : INCORRECT;
      }
      if ('name' in x && 'name' in y) {
        return x.name === y.name && x.text === y.text ? CORRECT : INCORRECT;
      }
      return UNSCORED;
    };

    const correct = (expected: Output[]) =>
      expected.some(message => message.header.msg_type === 'error') ?
        Rubric.INCORRECT : Rubric.CORRECT;

    /**
     * Decrypts a workbook cell, modifying its source and changing its cell type
     * from `raw` to `code`. This changes the cell `id`.
     * @returns a promise that resolves with the resulting cell `id`.
     */
    export async function decrypt(
      workbook: Workbook,
      reference: string,
      key: string
    ): Promise<string> {
      const notebook = workbook.content;
      const model = notebook.model;
      if (!key || !model) {
        throw new Error('decrypt error');
      }

      const { widgets } = notebook;
      const index = findIndex(model.cells, cell => cell.id === reference);
      if (index === -1) {
        throw new Error('decrypt error');
      }

      const source = model.cells.get(index).sharedModel.getSource();
      const decrypted = await security.decrypt(source, key);
      const widget = find(widgets, ({ model }) => model.id === reference);
      if (!widget) {
        throw new Error('decrypt error');
      }

      const initial = notebook.activeCellIndex;
      NotebookActions.clearAllOutputs(notebook);
      NotebookActions.deselectAll(notebook);
      notebook.select(widget);
      notebook.activeCellIndex = index;
      widget.inputHidden = false;
      widget.model.sharedModel.deleteMetadata('editable');
      widget.model.sharedModel.setSource(decrypted);
      NotebookActions.changeCellType(notebook, 'code');
      notebook.activeCellIndex = initial;

      const result = model.cells.get(index);
      return result.id;
    }

    /**
     * Encrypts a workbook cell, modifying its source and changing its cell type
     * from `code` to `raw`. This changes the cell `id`.
     * @returns a promise that resolves with the resulting cell `id`.
     */
    export async function encrypt(
      workbook: Workbook,
      reference: string,
      key: string
    ): Promise<string> {
      const notebook = workbook.content;
      const model = notebook.model;
      if (!key || !model) {
        throw new Error('encrypt error');
      }

      const { widgets } = notebook;
      const index = findIndex(model.cells, ({ id }) => id === reference);
      if (index === -1) {
        throw new Error('encrypt error');
      }

      const source = model.cells.get(index).sharedModel.getSource();
      const encrypted = await security.encrypt(source, key);
      const widget = find(widgets, ({ model }) => model.id === reference);
      if (!widget) {
        throw new Error('encrypt error');
      }

      const initial = notebook.activeCellIndex;
      NotebookActions.clearAllOutputs(notebook);
      NotebookActions.deselectAll(notebook);
      notebook.select(widget);
      notebook.activeCellIndex = index;
      widget.inputHidden = true;
      widget.model.sharedModel.setSource(encrypted);
      NotebookActions.changeCellType(notebook, 'raw');
      notebook.activeCellIndex = initial;

      const result = model.cells.get(index);
      result.sharedModel.setMetadata('editable', false);
      return result.id;
    }

    /**
     * Execute one cell's source in a kernel.
     *
     * @param kernel - the kernel to use.
     * @param cell - the model of the cell to execute.
     *
     * @returns an array of of cell outputs.
     */
    export async function execute(
      { sharedModel: { source } }: ICodeCellModel,
      kernel: Kernel.IKernelConnection
    ): Promise<Output[]> {
      const outputs: Output[] = [];
      if (!source) {
        return outputs;
      }
      const future = kernel.requestExecute({ code: source });
      future.onIOPub = (message: KernelMessage.IIOPubMessage) => {
        if (message.header.msg_type === 'execute_result' ||
            message.header.msg_type === 'display_data' ||
            message.header.msg_type === 'stream' ||
            message.header.msg_type === 'error') {
          outputs.push(message as Output);
        }
      };
      await future.done;
      return outputs;
    }

    /**
     * Get the score for a single cell.
     *
     * @param workbook - the workbook that contains the cell.
     * @param id - the id of the cell to score.
     * @param outputs - the outputs of all the executed workbook cells.
     *
     * @returns the score for this cell.
     *
     * #### Notes
     * Currently the score is only 0/1 or 1/1 whether it is correct or not.
     */
    export async function score(
      workbook: Workbook,
      id: Cell['id'],
      outputs: Workbook.Outputs,
    ): Promise<Rubric.Score> {
      const rubric = Correxit.open(workbook, { quiet: true });
      if (!rubric) {
        return Rubric.UNSCORED;
      }

      const cell = Rubric.get(rubric, id);
      const given = outputs[id];
      if (!cell || !given) {
        return Rubric.UNSCORED;
      }
      if (cell.is === 'answerable') {
        return answer(cell.payload, given);
      }

      const expected = cell.reference ? outputs[cell.reference] : null;
      if (!expected) {
        return Rubric.UNSCORED;
      }
      if (cell.is === 'comparable') {
        return compare(expected, given);
      }
      if (cell.is === 'correctable') {
        return correct(expected);
      }
      return Rubric.UNSCORED;
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
      const { key } = rubric;
      for (const id in rubric.secret.cells) {
        const { is, shared, payload, reference } = rubric.secret.cells[id];
        if (is === 'comparable' || is === 'correctable') {
          rubric.secret.cells[id] = {
            id, is, payload, shared,
            reference: await Cell.decrypt(workbook, reference, key)
          };
        }
      };
      return rubric;
    }
  }

  namespace Encrypted {
    /**
     * Returns an integrity report for the rubric of workbook.
     */
    const validate = (
      workbook: Workbook,
      rubric: Rubric
    ): Integrity => {
      const pruned: { cell: Cell; reason: string; }[] = [];
      const known = reduce(workbook.content.model!.cells,
        (known, { id, type }) => ({ ...known, [id]: type === 'code'}),
        Object.create(null) as { [id: string]: boolean; }
      );
      const { locked, secret, shared } = rubric;
      for (const { cells } of locked ? [shared] : [secret, shared]) {
        for (const id in cells) {
          const { is, payload, reference } = cells[id];
          const unknown = !known[id];
          const valid = is === 'answerable' ? payload.length : known[reference];
          if (unknown || !valid) {
            const reason = unknown ? 'unknown cell' : 'invalid cell';
            pruned.push({ cell: cells[id], reason });
            delete cells[id];
          }
        }
      };
      return { ok: true, pruned, rubric: { ...rubric, accessed: Date.now() } };
    }

    /**
     * Saves encrypted workbook metadata.
     */
    export async function metadata(
      workbook: Workbook,
      rubric: Rubric
    ): Promise<Integrity> {
      if (!workbook.content.model) {
        throw new Error('metadata error');
      }

      const { sharedModel } = workbook.content.model;
      const integrity = validate(workbook, rubric);
      Private.rubric.set(workbook, null);
      if (integrity.ok) {
        const { rubric } = integrity;
        Private.rubric.set(workbook, rubric);
        sharedModel.setMetadata('correxit', await Rubric.lock(rubric));
      }
      return integrity;
    }

    /**
     * Encrypts the workbook cell content and returns updated rubric.
     */
    export async function content(
      workbook: Workbook,
      rubric: Rubric.Unlocked
    ): Promise<Rubric.Locked> {
      const { key } = rubric;
      for (const id in rubric.secret.cells) {
        const cell = rubric.secret.cells[id];
        if (cell.is === 'comparable' || cell.is === 'correctable') {
          const reference = await Cell.encrypt(workbook, cell.reference, key);
          rubric.secret.cells[id] = { ...cell, reference };
        }
      };
      return Rubric.lock(rubric);
    }
  }

  export async function decrypt(workbook: Workbook, rubric: Rubric.Unlocked) {
    const decrypted = await Decrypted.content(workbook, rubric);
    return update(workbook, decrypted);
  }

  export function get(workbook: Workbook) {
    return Private.rubric.get(workbook);
  }

  /**
   * Executes the code cells of a workbook.
   *
   * @param workbook - the workbook to run.
   * @param id - the ID of the target cell.
   *
   * @returns a promise that resolves to a collection of executed cell outputs.
   *
   * #### Notes
   * If `id` is not provided, the whole workbook is executed.
   * If `id` is provided and the target cell is 'answerable', the workbook is
   * executed up to this cell.
   * If `id` is provided and the target cell is `comparable` or `correctable`,
   * the workbook is executed up to both target and reference cells.
   */
  export async function execute(
    workbook: Workbook,
    rubric: Rubric,
    id?: Cell['id']
  ): Promise<Outputs | null> {
    if (!rubric || !workbook.content.model) {
      throw new Error('execute error');
    }

    const { context } = workbook;
    const { cells } = workbook.content.model;
    let stop = cells.length;
    if (id) {
      const cell = Correxit.Rubric.get(rubric, id);
      if (!cell) {
        return null;
      }
      stop = Math.max(
        1 + findIndex(cells, ({ id }) => id === cell.id),
        cell.is === 'correctable' || cell.is === 'comparable' ?
          1 + findIndex(cells, ({ id }) => id === cell.reference) :
          Number.NEGATIVE_INFINITY
      );
    }

    const { kernelManager, kernelPreference } = context.sessionContext;
    const { name } = kernelPreference;
    const kernel = await (kernelManager?.startNew({ name }).catch(_ => {}));
    if (!kernel) {
      console.warn('execute error, could not start kernel');
      return null;
    }

    const outputs: Outputs = {};
    for (const index of range(stop)) {
      const model = cells.get(index);
      if (model.type === 'code') {
        outputs[model.id] = await Cell.execute(model as ICodeCellModel, kernel);
      }
    }
    void kernel.shutdown().catch(_ => {});
    return outputs;
  }

  export async function lock(workbook: Workbook): Promise<void> {
    const rubric = get(workbook);
    if (rubric && !rubric.locked) {
      const encrypted = await Encrypted.content(workbook, rubric);
      await update(workbook, encrypted);
    }
  }

  export function open(workbook: Workbook): Rubric | null {
    if (!workbook.content.model) {
      throw new TypeError('open error');
    }
    if (get(workbook)) {
      return get(workbook);
    }

    const metadata = workbook.content.model.sharedModel.getMetadata('correxit');
    if (!metadata) {
      throw Correxit.NO_CORREXIT_METADATA;
    }

    const rubric = {
      ...Rubric.normalize(metadata as Partial<Rubric.Locked>),
      accessed: Date.now()
    };
    Private.rubric.set(workbook, rubric);
    return rubric;
  }

  export async function reset(workbook: Workbook, rubric: Rubric.Unlocked) {
    if (rubric.locked || !workbook.content.model) {
      throw new Error('reset error');
    }
    Private.rubric.set(workbook, null);
    const model = workbook.content.model;
    model.deleteMetadata('correxit');
  }

  export async function update(
    workbook: Workbook,
    rubric: Rubric.Locked
  ): Promise<Rubric.Locked>
  export async function update(
    workbook: Workbook,
    rubric: Rubric.Unlocked
  ): Promise<Rubric.Unlocked>
  export async function update(
    workbook: Workbook,
    rubric: Rubric
  ): Promise<Rubric> {
      const integrity = await Encrypted.metadata(workbook, rubric);
      if (integrity.ok) {
        return integrity.rubric;
      }
      throw new Error(integrity.error);
  }
}

namespace Private {
  export const rubric = new AttachedProperty<
    Correxit.Workbook,
    Correxit.Rubric | null
  >({ name: 'rubric', create: _ => null });
}
