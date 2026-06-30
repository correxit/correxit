declare const require: any;
jest.mock('../correxit/security', () => require('./mocks/security'));
import { INotebookContent } from '@jupyterlab/nbformat';
import * as Assignment from '../correxit/assignment';
import { Rubric } from '../correxit/rubric';
import * as security from './mocks/security';

describe('Assignment', () => {
  beforeEach(() => jest.clearAllMocks());

  const base = (): Rubric.Unlocked => ({
    ...Rubric.create(),
    id: 'rubric-id',
    assignment: {
      ...Rubric.create().assignment,
      id: 'course:assignment',
      keys: {
        private: {
          assignee: null,
          author: 'ENC[KEY<passphrase:rubric-id>]:PGP_PRIVATE_KEY'
        },
        public: { assignee: null, author: 'PGP_PUBLIC_KEY' }
      },
      name: 'Lesson One'
    },
    key: 'KEY<passphrase:rubric-id>'
  });

  const configured = async () => {
    const reference: Rubric.Cell.Reference = {
      cell: 'answer',
      points: 1,
      referent: 'reference',
      secret: true
    };
    const rubric = Rubric.add(
      base(),
      {
        id: 'answer',
        is: 'comparable',
        payload: null,
        points: 1,
        references: ['reference']
      },
      [reference]
    );
    const assigned = await Rubric.assign(rubric, {
      roster: ['alice@example.com']
    });
    const locked = await Rubric.lock(assigned);
    const notebook: INotebookContent = {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: { correxit: locked },
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
      ]
    };
    return { notebook, rubric: assigned };
  };

  it('assigns one serialized workbook and extends the roster', async () => {
    const { notebook } = await configured();
    const assigned = await Assignment.assign({
      assignee: 'bob@example.com',
      distribution: 123,
      file: 'bob.ipynb',
      notebook,
      passphrase: 'passphrase'
    });
    const metadata = assigned.notebook.metadata.correxit as Rubric.Locked;
    const key = await security.keygen('passphrase', metadata.id);
    const unlocked = await Rubric.unlock(Rubric.normalize(metadata), key);
    const reference = assigned.notebook.cells.find(
      cell => cell.id === 'reference'
    )!;
    const intro = assigned.notebook.cells.find(cell => cell.id === 'intro')!;

    expect(assigned.identifier).toMatchObject({
      assignee: 'bob@example.com',
      assignment: 'course:assignment',
      file: 'bob.ipynb',
      rubric: metadata.id
    });
    expect(assigned.identifier.issue).toMatch(/^DIGEST</);
    expect(assigned.encrypted).toEqual(['reference']);
    expect(unlocked.assignment.assignee).toBe('bob@example.com');
    expect(unlocked.assignment.roster).toEqual([
      'alice@example.com',
      'bob@example.com'
    ]);
    expect(unlocked.assignment.distribution).toBe(123);
    expect(unlocked.assignment.submission).toBeNull();
    expect(unlocked.assignment.certification).toBeNull();
    expect(unlocked.assignment.seal).toBeNull();
    expect(reference.cell_type).toBe('raw');
    expect(reference.source).toContain('print("secret")');
    expect(reference.metadata.editable).toBe(false);
    expect((reference.metadata.jupyter as any).source_hidden).toBe(true);
    expect(intro.metadata.editable).toBe(false);
    expect(notebook.cells[2].cell_type).toBe('code');
  });

  it('does not encrypt an already encrypted reference again', async () => {
    const { notebook, rubric } = await configured();
    notebook.cells[2].cell_type = 'raw';
    notebook.cells[2].source = 'ENC[KEY<passphrase:rubric-id>]:print("secret")';
    jest.clearAllMocks();

    const prepared = await Assignment.prepare(notebook, rubric);

    expect(prepared.notebook.cells[2].source).toBe(
      'ENC[KEY<passphrase:rubric-id>]:print("secret")'
    );
    expect(security.encrypt).not.toHaveBeenCalled();
  });

  it('fails closed when a rubric cell is missing', async () => {
    const { notebook } = await configured();
    notebook.cells = notebook.cells.filter(cell => cell.id !== 'answer');

    await expect(
      Assignment.assign({
        assignee: 'bob@example.com',
        notebook,
        passphrase: 'passphrase'
      })
    ).rejects.toThrow('missing cells');
  });
});
