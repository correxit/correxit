declare const require: any;
jest.mock('../correxit/security', () => require('./mocks/security'));
import { INotebookContent } from '@jupyterlab/nbformat';
import { Assignment } from '../correxit/assignment';
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
      key: null,
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
    expect(assigned.resources).toBeNull();
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
    expect(security.encrypt).not.toHaveBeenCalledWith(
      'print("secret")',
      rubric.key
    );
  });

  describe('issued contents', () => {
    const issued = async (secret = true) => {
      const { notebook, rubric } = await configured();
      if (!secret)
        notebook.metadata.correxit = await Rubric.lock(
          Rubric.toggle(rubric, 'reference')
        );
      const assigned = await Assignment.assign({
        assignee: 'alice@example.com',
        notebook,
        key: rubric.key,
        passphrase: null
      });
      const metadata = assigned.notebook.metadata.correxit as Rubric.Locked;
      return {
        notebook: assigned.notebook,
        rubric: await Rubric.unlock(metadata, rubric.key)
      };
    };

    it.each([undefined, null, '', 42])(
      'rejects invalid template cell IDs (%p) before issuing an assignment',
      async id => {
        const { notebook, rubric } = await configured();
        Object.assign(notebook.cells[0], { id });
        const before = JSON.stringify(notebook);
        jest.clearAllMocks();

        await expect(
          Assignment.assign({
            assignee: 'alice@example.com',
            notebook,
            key: rubric.key,
            passphrase: null
          })
        ).rejects.toThrow('invalid cell id');
        expect(security.sign).not.toHaveBeenCalled();
        expect(JSON.stringify(notebook)).toBe(before);
      }
    );

    it('rejects duplicate cell IDs before issuing an assignment', async () => {
      const { notebook, rubric } = await configured();
      notebook.cells[0].id = 'answer';
      const before = JSON.stringify(notebook);
      jest.clearAllMocks();

      await expect(
        Assignment.assign({
          assignee: 'alice@example.com',
          notebook,
          key: rubric.key,
          passphrase: null
        })
      ).rejects.toThrow('duplicate cell ids');
      expect(security.sign).not.toHaveBeenCalled();
      expect(JSON.stringify(notebook)).toBe(before);
    });

    it('binds cell identities, types, order, and fixed sources without exposing plaintext hashes', async () => {
      const { notebook, rubric } = await issued();
      expect(rubric.cxtformat).toBe(Rubric.CXTFORMAT);
      expect(rubric.contents?.map(({ id, type }) => ({ id, type }))).toEqual([
        { id: 'intro', type: 'markdown' },
        { id: 'answer', type: 'code' },
        { id: 'reference', type: 'code' }
      ]);
      expect(
        rubric.contents?.find(({ id }) => id === 'answer')?.digest
      ).toBeNull();
      expect(
        rubric.contents?.find(({ id }) => id === 'reference')?.digest
      ).toMatch(/^HMAC</);
      await expect(
        Assignment.authenticate(notebook, rubric)
      ).resolves.toBeUndefined();
    });

    it('permits student answers and extra working cells', async () => {
      const { notebook, rubric } = await issued();
      notebook.cells[1].source = 'print("my answer")';
      notebook.cells.splice(1, 0, {
        id: 'scratch',
        cell_type: 'code',
        metadata: {},
        execution_count: null,
        outputs: [],
        source: 'scratch = 1'
      });
      await expect(
        Assignment.authenticate(notebook, rubric)
      ).resolves.toBeUndefined();
    });

    it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__'])(
      'authenticates fixed sources with the cell ID %s',
      async id => {
        const { notebook, rubric } = await configured();
        notebook.cells[0].id = id;
        const assigned = await Assignment.assign({
          assignee: 'alice@example.com',
          notebook,
          key: rubric.key,
          passphrase: null
        });
        const metadata = assigned.notebook.metadata.correxit as Rubric.Locked;
        const unlocked = await Rubric.unlock(metadata, rubric.key);
        expect(
          unlocked.contents?.find(entry => entry.id === id)?.digest
        ).toMatch(/^HMAC</);
        await expect(
          Assignment.authenticate(assigned.notebook, unlocked)
        ).resolves.toBeUndefined();

        assigned.notebook.cells[0].source = 'changed';
        await expect(
          Assignment.authenticate(assigned.notebook, unlocked)
        ).rejects.toThrow('contents mismatch');
      }
    );

    it.each([undefined, null, '', 42])(
      'rejects invalid issued cell IDs (%p) before authenticating sources',
      async id => {
        const { notebook, rubric } = await issued();
        Object.assign(notebook.cells[0], { id });
        jest.clearAllMocks();

        await expect(Assignment.authenticate(notebook, rubric)).rejects.toThrow(
          'invalid cell id'
        );
        expect(security.decrypt).not.toHaveBeenCalled();
      }
    );

    it('rejects missing IDs on extra working cells', async () => {
      const { notebook, rubric } = await issued();
      notebook.cells.push({
        cell_type: 'code',
        metadata: {},
        execution_count: null,
        outputs: [],
        source: 'scratch = 1'
      });

      await expect(Assignment.authenticate(notebook, rubric)).rejects.toThrow(
        'invalid cell id'
      );
    });

    it.each([true, false])(
      'rejects substituted reference sources (secret=%s)',
      async secret => {
        const { notebook, rubric } = await issued(secret);
        notebook.cells[2].source = 'pass';
        await expect(Assignment.authenticate(notebook, rubric)).rejects.toThrow(
          'contents mismatch'
        );
      }
    );

    it('rejects a different valid ciphertext encrypted with the same key', async () => {
      const { notebook, rubric } = await issued();
      notebook.cells[2].source = await security.encrypt('pass', rubric.key);
      await expect(Assignment.authenticate(notebook, rubric)).rejects.toThrow(
        'contents mismatch'
      );
    });

    it('accepts authentic decrypted references after an author-side save', async () => {
      const { notebook, rubric } = await issued();
      notebook.cells[2].source = 'print("secret")';
      notebook.cells[2].cell_type = 'code';
      await expect(
        Assignment.authenticate(notebook, rubric)
      ).resolves.toBeUndefined();
    });

    it('authenticates commitments after notebook writers reorder object properties', async () => {
      const { notebook, rubric } = await issued();
      const contents = rubric.contents!.map(({ id, type, digest }) => ({
        type,
        digest,
        id
      }));
      const reordered = { ...rubric, contents };
      await expect(
        Assignment.authenticate(notebook, reordered)
      ).resolves.toBeUndefined();
      expect(
        await Rubric.Assignment.issue({
          assignment: reordered.assignment,
          notebook,
          rubric: reordered
        })
      ).toBe(
        await Rubric.Assignment.issue({
          assignment: rubric.assignment,
          notebook,
          rubric
        })
      );
    });

    it.each([
      [
        'scaffolding',
        (notebook: INotebookContent) => {
          notebook.cells[0].source = 'changed';
        }
      ],
      [
        'type',
        (notebook: INotebookContent) => {
          notebook.cells[1].cell_type = 'raw';
        }
      ],
      [
        'order',
        (notebook: INotebookContent) => {
          notebook.cells.reverse();
        }
      ],
      [
        'missing cell',
        (notebook: INotebookContent) => {
          notebook.cells.pop();
        }
      ],
      [
        'duplicate id',
        (notebook: INotebookContent) => {
          notebook.cells.push(notebook.cells[1]);
        }
      ]
    ])('rejects altered %s', async (_, mutate) => {
      const { notebook, rubric } = await issued();
      (mutate as (notebook: INotebookContent) => void)(notebook);
      await expect(Assignment.authenticate(notebook, rubric)).rejects.toThrow();
    });

    it('rejects stripped commitments and format downgrades before authenticating sources', async () => {
      const { notebook, rubric } = await issued();
      const stripped = { ...rubric, contents: null };
      const downgraded = { ...rubric, cxtformat: 1 } as any;
      await expect(Assignment.authenticate(notebook, stripped)).rejects.toThrow(
        'mac mismatch'
      );
      await expect(
        Assignment.authenticate(notebook, downgraded)
      ).rejects.toThrow('unsupported cxtformat');
    });

    it('rejects draft-format templates before issuing assignments', async () => {
      const { notebook, rubric } = await configured();
      notebook.metadata.correxit = {
        ...(notebook.metadata.correxit as Rubric.Locked),
        cxtformat: 1
      } as any;
      const draft = JSON.stringify(notebook);
      await expect(
        Assignment.assign({
          assignee: 'alice@example.com',
          notebook,
          key: rubric.key,
          passphrase: null
        })
      ).rejects.toThrow('unsupported cxtformat');
      expect(JSON.stringify(notebook)).toBe(draft);
    });
  });

  it('surfaces resource filenames for the caller to distribute', async () => {
    const rubric = Rubric.add(base(), {
      id: 'answer',
      is: 'reviewable',
      payload: null,
      points: 1,
      references: null
    });
    const withResources = await Rubric.assign(rubric, {
      resources: ['data.csv', 'helper.py'],
      roster: ['alice@example.com']
    });
    const locked = await Rubric.lock(withResources);
    const notebook: INotebookContent = {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: { correxit: locked },
      cells: [
        {
          cell_type: 'markdown',
          id: 'answer',
          metadata: {},
          source: 'Write your answer here.'
        }
      ]
    };

    const assigned = await Assignment.assign({
      assignee: 'bob@example.com',
      key: null,
      notebook,
      passphrase: 'passphrase'
    });

    expect(assigned.resources).toEqual(['data.csv', 'helper.py']);
  });

  it('fails closed when a rubric cell is missing', async () => {
    const { notebook } = await configured();
    notebook.cells = notebook.cells.filter(cell => cell.id !== 'answer');

    await expect(
      Assignment.assign({
        assignee: 'bob@example.com',
        key: null,
        notebook,
        passphrase: 'passphrase'
      })
    ).rejects.toThrow('missing cells');
  });
});
