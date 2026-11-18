// Compiled outside the workspace against the packed npm archive by
// test-contracts-api.mjs. No Correxit or JupyterLab implementation imports.
import { Token } from '@lumino/coreutils';
import {
  Collector,
  Distributor,
  Identifier,
  Notebook,
  Registrar,
  Registration,
  Resource,
  Secret,
  Submitter,
  Unlocker
} from '@correxit/contracts';

const identifier: Identifier = {
  assignee: null,
  assignment: null,
  file: null,
  issue: null,
  rubric: 'rubric-id'
};

export function assigned(identifier: Identifier): Identifier.Assigned | null {
  // @ts-expect-error Unassigned identifiers cannot be used as assigned ones.
  const unchecked: Identifier.Assigned = identifier;
  return Identifier.assigned(identifier) ? identifier : null;
}

// Native notebook JSON can omit cell IDs, split source into lines, and carry
// additional fields without pulling in JupyterLab model types.
const notebook: Notebook = {
  nbformat: 4,
  nbformat_minor: 4,
  metadata: {},
  cells: [
    { cell_type: 'markdown', metadata: {}, source: ['# Assignment\n'] },
    {
      cell_type: 'code',
      id: 'cell-id',
      metadata: {},
      source: '1 + 1',
      outputs: [],
      execution_count: null
    }
  ]
};
const resource: Resource = { name: 'data.csv', data: new Uint8Array() };
const registration: Registration = {
  expiration: null,
  id: null,
  name: 'Assignment',
  roster: ['student']
};

export const distributor: Distributor = async payload => {
  const file: string = payload.identifier.file;
  const assignee: string = payload.identifier.assignee;
  const resources: Resource[] = payload.resources ?? [];
  return file.length > 0 && assignee.length > 0 && resources.length === 0;
};
export const collector: Collector = async payload =>
  payload.certification.toFixed();
export const submitter: Submitter = async payload =>
  payload.submission.toFixed();
export const registrar: Registrar = async () => [registration];
export const grouped: Registrar = async () => [
  { assignments: [registration], group: 'Course' } satisfies Registration.Group
];
export const manual: Registrar = async () => null;

export const unlocker: Unlocker = {
  async *request(request) {
    if (request.purpose === 'create') {
      // Creation always supplies the final rubric ID before key custody.
      const rubric: string = request.identifier.rubric;
      if (rubric) yield { key: null, passphrase: 'passphrase' };
    } else if (request.purpose === 'recover') {
      const identifier: Identifier | null = request.identifier;
      if (!identifier) yield null;
    }
  },
  async store(rubric, key) {
    const entry: [string, string] = [rubric, key];
    void entry;
  }
};

// Consumers can pair services with the exported Lumino tokens.
export const tokens: [
  Token<Collector>,
  Token<Distributor>,
  Token<Registrar>,
  Token<Submitter>,
  Token<Unlocker>
] = [Collector, Distributor, Registrar, Submitter, Unlocker];

export const payload: Distributor.Payload = {
  identifier: { ...identifier, assignee: 'student', file: 'assignment.ipynb' },
  notebook,
  overwrite: false,
  path: 'assignments/assignment.ipynb',
  resources: [resource]
};
export const key: Secret = { key: '0'.repeat(64), passphrase: null };
export const passphrase: Secret = { key: null, passphrase: 'passphrase' };
export const create: Unlocker.Request = {
  identifier,
  path: 'assignment.ipynb',
  purpose: 'create',
  silent: true
};
export const recover: Unlocker.Request = {
  ...create,
  identifier: null,
  purpose: 'recover'
};

// @ts-expect-error A secret cannot contain both credential forms.
export const both: Secret = { key: 'key', passphrase: 'passphrase' };
// @ts-expect-error A secret must contain a credential; cancellation is separate.
export const neither: Secret = { key: null, passphrase: null };
// @ts-expect-error Null fields are required, not omitted.
export const omitted: Secret = { key: 'key' };
// @ts-expect-error Creation requires the proposed workbook identity.
export const unidentified: Unlocker.Request = { ...create, identifier: null };
// @ts-expect-error Distribution returns a decision, not a receipt.
export const receipt: Distributor = async () => 'receipt';
// @ts-expect-error Submission returns a receipt or null, not a boolean.
export const submitted: Submitter = async () => true;
// @ts-expect-error Collection returns a receipt or null, not a boolean.
export const collected: Collector = async () => true;
