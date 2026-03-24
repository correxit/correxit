import { PathExt } from '@jupyterlab/coreutils';
import { INotebookContent } from '@jupyterlab/nbformat';
import { NotebookModelFactory } from '@jupyterlab/notebook';
import { ServiceManager } from '@jupyterlab/services';
import { findIndex } from '@lumino/algorithm';
import { CommandRegistry } from '@lumino/commands';
import { Correxit, Rubric, Workbook } from '.';
import * as io from './io';
import * as security from './security';

export type Emission = { slots: (string | number)[]; type: string; };

export type Emitter = AsyncIterable<Emission>;

export async function* propagate({
  commands,
  distributor,
  factory,
  manager,
  workbook
}: {
  commands: CommandRegistry;
  distributor: Correxit.Distributor;
  factory: NotebookModelFactory;
  manager: ServiceManager.IManager;
  workbook: Workbook;
}): AsyncGenerator<Emission> {
  const rubric = Workbook.open(workbook, true);
  if (!rubric || rubric.locked) {
    yield { type: 'error', slots: ['invalid rubric'] };
    return;
  }
  try {
    const { assignment: { roster }, key } = rubric;
    const path = workbook.context.path;
    const parent = PathExt.dirname(path);
    const base = PathExt.basename(path, '.ipynb');
    const potential = await io.available(manager, parent, base);
    const directory = await io.mkdir(manager, parent, potential);
    const total = roster.length;
    const { encrypted, notebook: content } = await template(workbook, rubric);
    let progress = 0;
    yield { type: 'mkdir', slots: [directory.path] };
    for (const reference of encrypted)
      yield { type: 'encrypted', slots: [reference] };
    for (const assignee of roster) {
      const notebook: INotebookContent = JSON.parse(JSON.stringify(content));
      const file = await io.assigned(base, assignee);
      const path = PathExt.join(directory.path, file);
      const assigned = await reassign({ assignee, key, notebook, roster });
      const issue = await Rubric.Assignment.issue({
        assignment: {
          assignee,
          expiration: rubric.assignment.expiration,
          id: assigned.assignment,
          name: rubric.assignment.name
        },
        notebook,
        rubric
      });
      const author = await security.decrypt(
        rubric.assignment.keys.private.author,
        rubric.key
      );
      const issuer = await Rubric.Assignment.issuer(issue, author);
      const issued = { issue, issuer };
      await reissue({ notebook, roster, ...issued, key });
      const identifier = { ...assigned, issue: issued.issue };
      const propagated = { identifier, notebook, path };
      const created = await io.create({ factory, manager, notebook, path });
      yield { type: 'separator', slots: [] };
      yield { type: 'assigned', slots: [assignee] };
      yield { type: created ? 'saved' : 'create-error', slots: [path] };
      if (!created) {
        yield { type: 'progress', slots: [++progress, total] };
        continue;
      }

      try {
        const found = await distributor(propagated);
        const receipt = distribute(found, issued.issue);
        redistribute({ notebook, receipt });
        await manager.contents.save(path, {
          content: notebook,
          format: 'json',
          type: 'notebook'
        });
        yield { type: 'distributed', slots: [assignee, receipt] };
      } catch (error) {
        yield {
          type: 'distribute-error',
          slots: [assignee, path, `${error}`]
        };
      }

      yield { type: 'progress', slots: [++progress, total] };
    }
    await io.cd(commands, directory.path);
    yield { type: 'success', slots: [total] };
  } catch (error) {
    yield { type: 'error', slots: [`${error}`] };
  }
}

function distribute(receipt: string | null, issue: string): string {
  const normalized = receipt?.trim() || '';
  return normalized || `correxit:${issue}`;
}

async function encrypt(
  notebook: INotebookContent,
  reference: string,
  key: string
): Promise<void> {
  const index = findIndex(notebook.cells, ({ id }) => id === reference);
  if (!key || index === -1) throw new Correxit.Error.Encrypt('encrypt error');

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
function lifecycle(expiration: Rubric.Timestamp) {
  return {
    certification: null,
    collected: null,
    distributed: null,
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
 * to overwrite its assignee and mac.
 */
async function reassign({ assignee, key, notebook, roster }: {
  assignee: string;
  key: string;
  notebook: INotebookContent;
  roster: string[];
}): Promise<Workbook.Identifier.Assigned> {
  const metadata = notebook.metadata['correxit'] as unknown as Rubric.Locked &
    { assignment: Rubric.Assignment, revised: number };
  const { expiration, id, keys, name, roster: encrypted } = metadata.assignment;
  const report = Rubric.Assignment.Report.empty();
  const fresh = lifecycle(expiration);
  const unsigned = {
    assignee,
    ...fresh,
    id,
    issue: '',
    issuer: '',
    keys,
    name,
    report,
    roster
  };
  const mac = await Rubric.Assignment.mac(unsigned, key);
  const seal = null;
  metadata.assignment = { ...unsigned, mac, roster: encrypted, seal };
  metadata.revised = Date.now();
  return {
    assignee,
    assignment: metadata.assignment.id,
    issue: null,
    rubric: metadata.id
  };
}

async function reissue({ issuer, issue, key, notebook, roster }: {
  issuer: string;
  issue: string;
  key: string;
  notebook: INotebookContent;
  roster: string[];
}): Promise<void> {
  const metadata = notebook.metadata['correxit'] as unknown as Rubric.Locked &
    { assignment: Rubric.Assignment, revised: number };
  const { assignee, expiration, id, keys, name, report } =
    metadata.assignment;
  const unsigned = {
    assignee,
    expiration,
    id,
    issue,
    issuer,
    keys,
    name,
    report,
    roster
  };
  const mac = await Rubric.Assignment.mac(unsigned, key);
  metadata.assignment = { ...metadata.assignment, issue, issuer, mac };
  metadata.revised = Date.now();
}

/** Mutate a propagated notebook to add assignee's distributed receipt. */
function redistribute({ notebook, receipt }: {
  notebook: INotebookContent;
  receipt: string;
}): void {
  const metadata = notebook.metadata['correxit'] as unknown as Rubric.Locked &
    { assignment: Rubric.Assignment, revised: number };
  metadata.assignment = { ...metadata.assignment, distributed: receipt };
  metadata.revised = Date.now();
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
  for (const cell of notebook.cells) {
    const id = cell.id as string | undefined || '';
    if (Rubric.has(rubric, id)) continue;
    cell.metadata.editable = false;
  }
  return { encrypted, notebook };
}
