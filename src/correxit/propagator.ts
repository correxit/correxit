import { PathExt } from '@jupyterlab/coreutils';
import { INotebookContent } from '@jupyterlab/nbformat';
import { findIndex } from '@lumino/algorithm';
import { Correxit, Rubric, Workbook } from '.';
import * as security from './security';

export async function* propagate({ consumer, workbook }: {
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
    for (const reference of encrypted)
      yield { type: 'encrypted', slots: [reference] };

    const loop = async function* (location: { base: string; pwd: string }) {
      const { base, pwd } = location;
      for (const assignee of roster) {
        const notebook: INotebookContent = JSON.parse(JSON.stringify(content));
        const local = assignee.split('@')[0].replace(/[^\w.-]/g, '');
        const hash = (await security.digest(assignee)).slice(0, 6);
        const file = `${base}-${local}-${hash}.ipynb`;
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

async function encrypt(
  notebook: INotebookContent,
  reference: string,
  key: string
): Promise<void> {
  const index = findIndex(notebook.cells, ({ id }) => id === reference);
  if (!key || index === -1) throw new Error('encrypt error');

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

/** @returns initialized lifecycle stages for a propagated assignment. */
function lifecycle(expiration: number | null) {
  return {
    certification: null,
    collected: null,
    expiration,
    submission: null,
    submitted: null
  };
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
}): Promise<Workbook.Identifier.Assigned> {
  const metadata = notebook.metadata['correxit'] as unknown as Rubric.Locked &
    { assignment: Rubric.Assignment, revised: number };
  const { expiration, id, name, roster: encrypted } = metadata.assignment;
  const blank = Rubric.Assignment.Report.empty();
  const fresh = lifecycle(expiration);
  const unsigned = { assignee, ...fresh, id, name, report: blank, roster };
  const signature = await Rubric.Assignment.sign(unsigned, key);
  metadata.assignment = { ...unsigned, roster: encrypted, signature };
  metadata.revised = Date.now();
  return {
    assignee,
    assignment: metadata.assignment.id,
    rubric: metadata.id,
    signature
  };
}

async function template(
  workbook: Workbook,
  rubric: Rubric.Unlocked
): Promise<{ encrypted: string[]; notebook: INotebookContent }> {
  const encrypted: string[] = [];
  const notebook = workbook.context.model.sharedModel.toJSON();
  for (const reference of Object.values(rubric.references)) {
    if (!reference.secret) continue;
    await encrypt(notebook, reference.referent, rubric.key);
    encrypted.push(reference.referent);
  }
  return { encrypted, notebook };
}
