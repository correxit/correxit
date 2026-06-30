import type { INotebookContent } from '@jupyterlab/nbformat';
import { findIndex } from '@lumino/algorithm';
import type { Workbook } from './workbook';
import * as Error from './error';
import { Rubric } from './rubric';
import * as security from './security';

type Cell = INotebookContent['cells'][number];

export type Assigned = {
  encrypted: string[];
  identifier: Workbook.Identifier.Assigned;
  notebook: INotebookContent;
};

export type Options = {
  assignee: string;
  distribution?: number | null;
  file?: string | null;
  key?: string | null;
  notebook: INotebookContent;
  passphrase?: string | null;
  roster?: string[] | null;
};

export type Prepared = {
  encrypted: string[];
  notebook: INotebookContent;
};

export type Issued = {
  identifier: Workbook.Identifier.Assigned;
  notebook: INotebookContent;
};

type Issue = {
  assignee: string;
  author: string;
  distribution: number | null;
  file: string;
  key: string;
  notebook: INotebookContent;
  roster: string[];
};

/** Assign a serialized workbook to one assignee. */
export async function assign(options: Options): Promise<Assigned> {
  const source = copy(options.notebook);
  const locked = rubric(source);
  const key = await secret(options, locked.id);
  const unlocked = await Rubric.unlock(locked, key);
  const roster = enroll(
    options.roster ?? unlocked.assignment.roster,
    options.assignee
  );
  const { encrypted, notebook } = await prepare(source, unlocked);
  const author = await security.decrypt(
    locked.assignment.keys.private.author,
    key
  );
  const file = options.file ?? await filename(
    unlocked.assignment.name || unlocked.assignment.id || unlocked.id,
    options.assignee
  );
  const issued = await issue({
    assignee: options.assignee,
    author,
    distribution: options.distribution ?? null,
    file,
    key,
    notebook,
    roster
  });
  return { encrypted, ...issued };
}

/** @returns a deterministic filename for an assigned workbook. */
export async function filename(assignment: string, assignee: string) {
  const name = assignment.replace(/[^\w.-]/g, '');
  const local = assignee.split('@')[0].replace(/[^\w.-]/g, '');
  const hash = (await security.digest(assignee)).slice(0, 4);
  return `${name}-${local}-${hash}.ipynb`;
}

/** Issue a prepared serialized workbook to one assignee. */
export async function issue(options: Issue): Promise<Issued> {
  const {
    assignee,
    author,
    distribution,
    file,
    key,
    notebook,
    roster
  } = options;
  const metadata = writable(notebook);
  const {
    expiration,
    id,
    keys,
    name,
    overdue,
    penalty,
    resources
  } = metadata.assignment;
  const report = Rubric.Assignment.Report.empty();
  const fresh = lifecycle(expiration, distribution);
  const unsigned = {
    assignee,
    ...fresh,
    id,
    keys,
    name,
    overdue,
    penalty,
    report,
    resources,
    roster
  };
  const blank: Rubric.Assignment = {
    ...metadata.assignment,
    ...unsigned,
    mac: '',
    seal: null
  };
  const digest = await Rubric.Assignment.issue({
    assignment: blank,
    notebook,
    rubric: metadata
  });
  const issuer = await Rubric.Assignment.issuer(digest, author);
  const assignment = { ...blank, issue: digest, issuer };
  const unlocked: Rubric.Unlocked = {
    assignment,
    cells: metadata.cells,
    id: metadata.id,
    key,
    locked: false,
    references: metadata.references ?? {},
    revised: Date.now()
  };
  const mac = await Rubric.mac(unlocked, key);
  const signed = { ...unlocked, assignment: { ...assignment, mac } };
  await Rubric.validate(signed);
  const encrypted = await security.encrypt(JSON.stringify(roster), key);
  metadata.assignment = {
    ...signed.assignment,
    roster: [encrypted]
  };
  metadata.revised = Date.now();
  return {
    identifier: {
      assignee,
      assignment: id,
      file,
      issue: digest,
      rubric: metadata.id
    },
    notebook
  };
}

/** Prepare a serialized notebook as a reusable assignment template. */
export async function prepare(
  source: INotebookContent,
  rubric: Rubric.Unlocked
): Promise<Prepared> {
  audit(source, rubric);
  const encrypted: string[] = [];
  const notebook = copy(source);
  for (const reference of Object.values(rubric.references)) {
    if (!reference.secret) continue;
    await encrypt(notebook, reference.referent, rubric.key);
    encrypted.push(reference.referent);
  }
  for (const cell of notebook.cells) {
    const id = String(cell.id ?? '');
    if (Rubric.has(rubric, id)) continue;
    cell.metadata = { ...cell.metadata, editable: false };
  }
  return { encrypted, notebook };
}

/** Stamp the distribution timestamp on a serialized notebook. */
export function stamp(
  notebook: INotebookContent,
  distribution: number | null
): void {
  const metadata = writable(notebook);
  metadata.assignment = { ...metadata.assignment, distribution };
  metadata.revised = Date.now();
}

function audit(notebook: INotebookContent, rubric: Rubric.Unlocked): void {
  const types = Object.fromEntries(
    notebook.cells.map(cell => [String(cell.id ?? ''), cell.cell_type])
  );
  const executable = (id: string) => types[id] === 'code' || types[id] === 'raw';
  const missing = Object.values(rubric.cells).filter(cell => {
    if (cell.is === 'reviewable') return !(cell.id in types);
    if (cell.is === 'answerable' && !cell.payload.length) return true;
    return !executable(cell.id);
  });
  if (missing.length)
    throw new Error.Invalid('assign error: missing cells');

  const dangling = Object.values(rubric.references)
    .filter(reference => !executable(reference.referent));
  if (dangling.length)
    throw new Error.Invalid('assign error: missing references');
}

function copy(notebook: INotebookContent): INotebookContent {
  return JSON.parse(JSON.stringify(notebook));
}

async function encrypt(
  notebook: INotebookContent,
  reference: string,
  key: string
): Promise<void> {
  const index = findIndex(notebook.cells, ({ id }) => id === reference);
  if (!key || index === -1) throw new Error.Encrypt('encrypt error');

  const cell = notebook.cells[index];
  const source = text(cell);
  const encrypted = security.encrypted(source)
    ? source
    : await security.encrypt(source, key);
  const jupyter = cell.metadata.jupyter || {};
  cell.cell_type = 'raw';
  cell.metadata = {
    ...cell.metadata,
    editable: false,
    jupyter: { ...jupyter, source_hidden: true }
  };
  cell.source = encrypted;
  delete cell.metadata.trusted;
}

function enroll(roster: string[], assignee: string): string[] {
  return Array.from(new Set([...roster, assignee]));
}

/** @returns initialized lifecycle stages for a propagated assignment. */
function lifecycle(expiration: Rubric.Timestamp, distribution: number | null) {
  return {
    certification: null,
    collected: null,
    distribution,
    expiration,
    issue: '',
    issuer: '',
    submission: null,
    submitted: null
  };
}

async function secret(
  { key, passphrase }: Options,
  id: string
): Promise<string> {
  if (key) return key;
  if (passphrase) return security.keygen(passphrase, id);
  throw new Error.Invalid('assign error: missing key');
}

function text(cell: Cell): string {
  return Array.isArray(cell.source) ? cell.source.join('') : cell.source;
}

function rubric(notebook: INotebookContent): Rubric.Locked {
  const metadata = notebook.metadata['correxit'] as Partial<Rubric.Locked>;
  return Rubric.normalize(metadata);
}

function writable(notebook: INotebookContent) {
  return notebook.metadata['correxit'] as unknown as Rubric.Locked & {
    assignment: Rubric.Assignment;
    revised: number;
  };
}
