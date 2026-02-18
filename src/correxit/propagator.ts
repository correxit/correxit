import { PathExt } from '@jupyterlab/coreutils';
import { INotebookContent } from '@jupyterlab/nbformat';
import { findIndex } from '@lumino/algorithm';
import { Signal, Stream } from '@lumino/signaling';
import { Correxit, Rubric, Workbook } from '.';
import * as security from './security';

/**
 * Kicks off a propagator loop, which in turn invokes the given consumer.
 * @returns a message emitter for tracking loop progress.
 */
export function invoke({ consumer, workbook }: {
  consumer: Correxit.Consumer;
  workbook: Workbook;
}): Correxit.Emitter {
  const rubric = Workbook.open(workbook, true);
  const [emitter, log, end] = logger();
  if (!rubric || rubric.locked) {
    log({ type: 'error', slots: ['invalid rubric'] });
    end();
    return emitter;
  }
  propagate({ consumer, log, rubric, workbook })
    .catch(error => log({ type: 'error', slots: [`${error}`] }))
    .finally(end);
  return emitter;
};

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

function logger(): [
  emitter: Correxit.Emitter,
  log: (emission: Correxit.Emitter.Emission) => void,
  end: () => void
] {
  const emitter = new Stream<null, Correxit.Emitter.Emission>(null);
  const log = (emission: Correxit.Emitter.Emission) =>
    emitter.emit(emission);;
  const end = () => {
    emitter.stop();
    Signal.clearData(emitter);
  };
  return [emitter, log, end];
}

async function propagate({ consumer, log, rubric, workbook }: {
  consumer: Correxit.Consumer;
  log: (emission: Correxit.Emitter.Emission) => void;
  rubric: Rubric.Unlocked;
  workbook: Workbook;
}): Promise<void> {
  const { assignment: { roster }, key } = rubric;
  const original = workbook.context.model.sharedModel.toJSON();
  const path = workbook.context.path;
  async function* loop(
    template: INotebookContent,
    location: { base: string; pwd: string }
  ) {
    const { base, pwd } = location;
    for (const assignee of roster) {
      const notebook: INotebookContent = JSON.parse(JSON.stringify(template));
      const file = `${base}-${encodeURIComponent(assignee)}.ipynb`;
      const path = PathExt.join(pwd, file);
      log({ type: 'separator', slots: [] });

      const identifier = await reassign({ assignee, key, notebook, roster });
      log({ type: 'assigned', slots: [assignee] });
      yield { identifier, notebook, path };
    }
  }
  const stream = async (location: { base: string; pwd: string }) =>
    loop(await template(original, rubric, log), location);
  await consumer({ log, path, rubric, stream });
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
  decrypted: INotebookContent,
  rubric: Rubric.Unlocked,
  log: (emission: Correxit.Emitter.Emission) => void
): Promise<INotebookContent> {
  const encrypted: INotebookContent = JSON.parse(JSON.stringify(decrypted));
  for (const id in rubric.cells) {
    const cell = rubric.cells[id];
    if (cell.shared) {
      continue;
    }
    if (cell.is === 'comparable' || cell.is === 'correctable') {
      const [reference] = cell.reference;
      await encrypt(encrypted, reference, rubric.key);
      log({ type: 'encrypted', slots: [reference] });
    }
  }
  return encrypted;
}
