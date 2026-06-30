import assert from 'node:assert/strict';
import { Assignment, Rubric } from '@quantstack/correxit/node';
import * as openpgp from 'openpgp';

const passphrase = 'correct horse battery staple';

const digest = async text => {
  const encoded = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  const hexadecimal = byte => byte.toString(16).padStart(2, '0');
  return Array.from(new Uint8Array(hash)).map(hexadecimal).join('');
};

const encrypt = async (text, password) => {
  const message = await openpgp.createMessage({ text });
  return openpgp.encrypt({ message, passwords: [password] });
};

const keygen = async (passphrase, salt) => {
  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      hash: 'SHA-256',
      iterations: 600_000,
      name: 'PBKDF2',
      salt: encoder.encode(salt)
    },
    material,
    256
  );
  const hexadecimal = byte => byte.toString(16).padStart(2, '0');
  return Array.from(new Uint8Array(bits)).map(hexadecimal).join('');
};

const keys = async key => {
  const { privateKey, publicKey } = await openpgp.generateKey({
    format: 'armored',
    type: 'curve25519',
    userIDs: [{ name: 'correxit' }]
  });
  return {
    private: {
      assignee: null,
      author: await encrypt(privateKey, key)
    },
    public: { assignee: null, author: publicKey }
  };
};

const workbook = async () => {
  const created = Rubric.create();
  const key = await keygen(passphrase, created.id);
  const assignment = {
    ...created.assignment,
    id: 'course:lesson-one',
    keys: await keys(key),
    name: 'Lesson One',
    roster: ['alice@example.com']
  };
  const configured = Rubric.add(
    { ...created, assignment, key },
    {
      id: 'answer',
      is: 'comparable',
      payload: null,
      points: 1,
      references: ['reference']
    },
    [
      {
        cell: 'answer',
        points: 1,
        referent: 'reference',
        secret: true
      }
    ]
  );
  const locked = await Rubric.lock(configured);
  return {
    cells: [
      {
        cell_type: 'markdown',
        id: 'intro',
        metadata: {},
        source: 'Read this first.'
      },
      {
        cell_type: 'code',
        execution_count: null,
        id: 'answer',
        metadata: { trusted: true },
        outputs: [],
        source: 'print("student")'
      },
      {
        cell_type: 'code',
        execution_count: null,
        id: 'reference',
        metadata: { trusted: true },
        outputs: [],
        source: 'print("secret")'
      }
    ],
    metadata: { correxit: locked },
    nbformat: 4,
    nbformat_minor: 5
  };
};

const notebook = await workbook();
const assigned = await Assignment.assign({
  assignee: 'bob@example.com',
  distribution: 123,
  notebook,
  passphrase
});
const metadata = assigned.notebook.metadata.correxit;
const key = await keygen(passphrase, metadata.id);
const unlocked = await Rubric.unlock(Rubric.normalize(metadata), key);
const reference = assigned.notebook.cells.find(cell => cell.id === 'reference');
const expected = `LessonOne-bob-${(await digest('bob@example.com')).slice(0, 4)}.ipynb`;

assert.equal(assigned.identifier.assignee, 'bob@example.com');
assert.equal(assigned.identifier.assignment, 'course:lesson-one');
assert.equal(assigned.identifier.file, expected);
assert.equal(assigned.identifier.rubric, metadata.id);
assert.ok(assigned.identifier.issue);
assert.deepEqual(assigned.encrypted, ['reference']);
assert.equal(unlocked.assignment.assignee, 'bob@example.com');
assert.deepEqual(unlocked.assignment.roster, [
  'alice@example.com',
  'bob@example.com'
]);
assert.equal(unlocked.assignment.distribution, 123);
assert.equal(reference.cell_type, 'raw');
assert.equal(reference.metadata.editable, false);
assert.equal(reference.metadata.jupyter.source_hidden, true);
assert.match(reference.source, /^-----BEGIN PGP MESSAGE-----/);

console.log('Node runtime assignment smoke test passed');
