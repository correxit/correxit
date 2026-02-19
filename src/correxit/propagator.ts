import { PathExt } from '@jupyterlab/coreutils';
import { INotebookContent } from '@jupyterlab/nbformat';
import { findIndex } from '@lumino/algorithm';
import { Correxit, Rubric, Workbook } from '.';
import * as security from './security';

/**
 * Returns an async iterable of emissions for tracking propagation progress.
 */
export function invoke({ consumer, workbook }: {
  consumer: Correxit.Consumer;
  workbook: Workbook;
}): Correxit.Emitter {
  return propagate({ consumer, workbook });
}

async function encrypt(
  notebook: INotebookContent,
  reference: string,
  key: string
): Promise<void> {
  const index = findIndex(notebook.cells, ({ id }) => id === reference);
  if (!key || index === -1) {
    throw new Error('encrypt error');
  }

  const cell = notebook.cells[index];
  const source = Array.isArray(cell.source)
    ? cell.source.join('\n')
    : cell.source;
  const encrypted = await security.encrypt(source, key);
  const jupyter = cell.metadata.jupyter || {};
  cell.cell_type = 'raw';
  cell.metadata.editable = false;
  cell.metadata.jupyter = { ...jupyter, 'source_hidden': true };
  cell.source = encrypted;
  delete cell.metadata.trusted;
}

async function* propagate({ consumer, workbook }: {
  consumer: Correxit.Consumer;
  workbook: Workbook;
}): AsyncGenerator<Correxit.Emitter.Emission> {
  const rubric = Workbook.open(workbook, true);
  if (!rubric || rubric.locked) {
    yield { type: 'error', slots: ['invalid rubric'] };
    return;
  }
  try {
    const { assignment: { roster }, key } = rubric;
    const path = workbook.context.path;
    const { encrypted, notebook: content } = await template(workbook, rubric);
    for (const reference of encrypted) {
      yield { type: 'encrypted', slots: [reference] };
    }

    const loop = async function* (location: { base: string; pwd: string }) {
      const { base, pwd } = location;
      for (const assignee of roster) {
        const notebook: INotebookContent = JSON.parse(JSON.stringify(content));
        const file = `${base}-${encodeURIComponent(assignee)}.ipynb`;
        const path = PathExt.join(pwd, file);
        const identifier = await reassign({ assignee, key, notebook, roster });
        yield { identifier, notebook, path };
      }
    };
    const stream = async (location: { base: string; pwd: string }) =>
      loop(location);
    yield* consumer({ path, rubric, stream });
  } catch (error) {
    yield { type: 'error', slots: [`${error}`] };
  }
}

/**
 * Reassigns a serialized workbook to an assignee using a given unlocked rubric.
 *
 * #### Notes
 * This function explicitly mutates the serialized rubric in the given workbook
 * to overwrite its assignee and signature.
 */
async function reassign({ assignee, key, notebook, roster }: {
  assignee: string;
  key: string;
  notebook: INotebookContent;
  roster: string[];
}): Promise<Workbook.Identifier> {
  const metadata = notebook.metadata['correxit'] as unknown as Rubric.Locked &
    { accessed: number, assignment: Rubric.Assignment };
  const { expiration, roster: encrypted } = metadata.assignment;
  const blank = { order: [], scores: {}, timestamp: null  };
  const lifecycle = { confirmation: null, expiration, submission: null };
  const unsigned = { assignee, ...lifecycle, report: blank, roster };
  const signature = await Rubric.Assignment.sign(unsigned, key);
  metadata.accessed = Date.now();
  metadata.assignment = { ...unsigned, roster: encrypted, signature };
  return { assignee, assignment: metadata.id, signature };
}

async function template(
  workbook: Workbook,
  rubric: Rubric.Unlocked
): Promise<{ encrypted: string[]; notebook: INotebookContent }> {
  const encrypted: string[] = [];
  const notebook = workbook.context.model.sharedModel.toJSON();
  for (const id in rubric.cells) {
    const cell = rubric.cells[id];
    if (cell.shared) {
      continue;
    }
    if (cell.is === 'comparable' || cell.is === 'correctable') {
      const [reference] = cell.reference;
      await encrypt(notebook, reference, rubric.key);
      encrypted.push(reference);
    }
  }
  return { encrypted, notebook };
}
