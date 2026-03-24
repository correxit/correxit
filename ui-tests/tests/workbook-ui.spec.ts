import { expect, test } from '@jupyterlab/galata';
import { setup } from './utils';

test.use({ autoGoto: false });

test('audits and prunes invalid rubric cells', async ({ page }) => {
  const { dispose } = await setup(page, [{ id: 'known', source: '' }]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const workbook = { content: panel.content, context: panel.context } as any;

    const rubric = Rubric.add(
      (r => ({
        ...r,
        key: 'secret',
        assignment: {
          ...r.assignment,
          keys: {
            private: { assignee: null, author: 'priv' },
            public: { assignee: null, author: 'pub' }
          }
        }
      }))(Rubric.create()),
      {
        id: 'missing-ref',
        is: 'comparable',
        points: 1,
        references: ['nope'],
        payload: null
      },
      [{ cell: 'missing-ref', referent: 'nope', points: 1, secret: true }]
    );

    const audit = Workbook.audit(workbook, rubric);
    return {
      ok: audit.ok,
      pruned: audit.ok ? audit.pruned.length : 0,
      invalid: audit.ok ? Rubric.has(audit.rubric, 'missing-ref') : null
    };
  });

  expect(result.ok).toBe(true);
  expect(result.pruned).toBe(1);
  expect(result.invalid).toBe(false);
  await dispose();
});

test('locks unlocked rubric and writes notebook metadata', async ({ page }) => {
  const { dispose } = await setup(page, []);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const workbook = { content: panel.content, context: panel.context };

    const rubric = (r => ({
      ...r,
      key: 'secret',
      assignment: {
        ...r.assignment,
        keys: {
          private: { assignee: null, author: 'priv' },
          public: { assignee: null, author: 'pub' }
        }
      }
    }))(Rubric.create()) as any;
    const written = await Workbook.update(workbook, rubric);
    const metadata = panel.context.model.sharedModel.getMetadata('correxit');
    return {
      locked: written?.locked ?? null,
      stored: metadata?.locked ?? null,
      key: metadata?.key ?? null
    };
  });

  expect(result.locked).toBe(false);
  expect(result.stored).toBe(true);
  expect(result.key).toBeNull();
  await dispose();
});

test('locks then unlocks a comparable cell round-trip', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'answer' },
    { id: 'cell', source: 'compare' }
  ]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const workbook = { content: panel.content, context: panel.context };

    const rubric = Rubric.add(
      (r => ({
        ...r,
        key: 'secret',
        assignment: {
          ...r.assignment,
          keys: {
            private: { assignee: null, author: 'priv' },
            public: { assignee: null, author: 'pub' }
          }
        }
      }))(Rubric.create()),
      {
        id: 'cell',
        is: 'comparable',
        points: 1,
        references: ['ref'],
        payload: null
      },
      [{ cell: 'cell', referent: 'ref', points: 1, secret: true }]
    );
    await Workbook.update(workbook, rubric);
    await Workbook.lock(workbook);

    const notebook = panel.context.model.sharedModel;
    const cell = notebook.cells[0];
    const locked = {
      type: cell.cell_type,
      jupyter: cell.getMetadata('jupyter'),
      editable: cell.getMetadata('editable')
    };
    await Workbook.unlock(workbook, rubric.key);

    const opened = notebook.cells[0];
    const unlocked = {
      type: opened.cell_type,
      source: opened.getSource(),
      jupyter: opened.getMetadata('jupyter'),
      editable: opened.getMetadata('editable')
    };
    return { locked, unlocked };
  });

  expect(result.locked.type).toBe('raw');
  expect(result.locked.jupyter.source_hidden).toBe(true);
  expect(result.locked.editable).toBe(false);
  expect(result.unlocked.type).toBe('code');
  expect(result.unlocked.source).toBe('answer');
  expect(result.unlocked.jupyter.source_hidden).toBeUndefined();
  expect(result.unlocked.editable).toBeUndefined();
  await dispose();
});

test('assigns workbook and updates metadata', async ({ page }) => {
  const { dispose } = await setup(page, []);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const workbook = { content: panel.content, context: panel.context };

    const initial = (r => ({
      ...r,
      key: 'secret',
      assignment: {
        ...r.assignment,
        keys: {
          private: { assignee: null, author: 'priv' },
          public: { assignee: null, author: 'pub' }
        }
      }
    }))(Rubric.create());
    await Workbook.update(workbook, initial);

    const changes = {
      assignee: 'assignee@example.com',
      roster: ['assignee@example.com']
    };

    const final = await Workbook.assign(workbook, changes);
    const metadata = panel.context.model.sharedModel.getMetadata('correxit');
    return {
      assignee: final.assignment.assignee,
      issue: final.assignment.issue,
      issuer: final.assignment.issuer,
      mac: !!final.assignment.mac,
      stored: metadata?.assignment?.assignee ?? null,
      distribution: final.assignment.distribution
    };
  });

  expect(result.assignee).toBe('assignee@example.com');
  expect(result.distribution).toBeNull();
  expect(result.issue).toBe('');
  expect(result.issuer).toBe('');
  expect(result.mac).toBe(true);
  expect(result.stored).toBe('assignee@example.com');
  await dispose();
});

test('assign short-circuits when no fields changed', async ({ page }) => {
  const { dispose } = await setup(page, []);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const workbook = { content: panel.content, context: panel.context };

    const initial = (r => ({
      ...r,
      key: 'secret',
      assignment: {
        ...r.assignment,
        keys: {
          private: { assignee: null, author: 'priv' },
          public: { assignee: null, author: 'pub' }
        }
      }
    }))(Rubric.create());
    await Workbook.update(workbook, initial);

    const assigned = await Workbook.assign(workbook, {
      assignee: 'test@example.com',
      roster: ['test@example.com']
    });

    const mac = assigned.assignment.mac;
    const unchanged = await Workbook.assign(workbook, {});
    return {
      same: unchanged.assignment.mac === mac,
      assignee: unchanged.assignment.assignee
    };
  });

  expect(result.same).toBe(true);
  expect(result.assignee).toBe('test@example.com');
  await dispose();
});

test('reweights a configured cell', async ({ page }) => {
  const { dispose } = await setup(page, [{ id: 'cell', source: 'x = 1' }]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const workbook = { content: panel.content, context: panel.context };

    const rubric = Rubric.add(
      (r => ({
        ...r,
        key: 'secret',
        assignment: {
          ...r.assignment,
          keys: {
            private: { assignee: null, author: 'priv' },
            public: { assignee: null, author: 'pub' }
          }
        }
      }))(Rubric.create()),
      {
        id: 'cell',
        is: 'reviewable',
        payload: null,
        points: 1,
        references: null
      }
    );
    await Workbook.update(workbook, rubric);
    await Workbook.reweight(workbook, 'cell', 7);

    const opened = Workbook.open(workbook);
    const metadata = panel.context.model.sharedModel.getMetadata('correxit');
    return {
      points: Rubric.get(opened, 'cell')?.points ?? null,
      stored: metadata?.cells?.['cell']?.points ?? null
    };
  });

  expect(result.points).toBe(7);
  expect(result.stored).toBe(7);
  await dispose();
});

test('sets and clears a cell intervention score', async ({ page }) => {
  const { dispose } = await setup(page, [{ id: 'cell', source: 'x = 1' }]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const workbook = { content: panel.content, context: panel.context };

    const rubric = Rubric.add(
      (r => ({
        ...r,
        key: 'secret',
        assignment: {
          ...r.assignment,
          keys: {
            private: { assignee: null, author: 'priv' },
            public: { assignee: null, author: 'pub' }
          }
        }
      }))(Rubric.create()),
      {
        id: 'cell',
        is: 'reviewable',
        payload: null,
        points: 5,
        references: null
      }
    );
    await Workbook.update(workbook, rubric);

    const intervention = Rubric.Score.intervene('cell', {
      comment: 'manual',
      points: 3,
      possible: 5
    });
    await Workbook.intervene(workbook, 'cell', intervention);

    const set = Workbook.open(workbook)?.assignment.report.interventions.cell;
    await Workbook.intervene(workbook, 'cell', null);
    const cleared =
      Workbook.open(workbook)?.assignment.report.interventions.cell;

    return {
      cleared: cleared === undefined,
      comment: set?.comment ?? null,
      points: set?.points ?? null,
      status: set?.status ?? null
    };
  });

  expect(result.points).toBe(3);
  expect(result.comment).toBe('manual');
  expect(result.status).toBe('partial');
  expect(result.cleared).toBe(true);
  await dispose();
});

test('submits a workbook and sets cells to read-only', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'a', source: 'x = 1' },
    { id: 'b', source: 'y = 2' }
  ]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const workbook = { content: panel.content, context: panel.context };

    const rubric = (r => ({
      ...r,
      key: 'secret',
      assignment: {
        ...r.assignment,
        keys: {
          private: { assignee: null, author: 'priv' },
          public: { assignee: null, author: 'pub' }
        }
      }
    }))(Rubric.create()) as any;
    await Workbook.update(workbook, rubric);
    await Workbook.lock(workbook);

    let submitted = await Workbook.submit(workbook, ['pub']);
    submitted = await Workbook.acknowledge(workbook, 'receipt-123');
    const notebook = panel.context.model.sharedModel;
    const metadata = notebook.getMetadata('correxit');
    return {
      locked: submitted.locked,
      submission: submitted.assignment.submission,
      submitted: submitted.assignment.submitted,
      stored: metadata?.assignment?.submission ?? null,
      editable: notebook.cells.map((c: any) => c.getMetadata('editable'))
    };
  });

  expect(result.locked).toBe(true);
  expect(result.submission).toBeGreaterThan(0);
  expect(result.submitted).toBe('receipt-123');
  expect(result.stored).toBeGreaterThan(0);
  expect(result.editable).toEqual([false, false]);
  await dispose();
});

test('revises a submitted workbook, restores editability', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'a', source: 'x = 1' },
    { id: 'b', source: 'y = 2' }
  ]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const workbook = { content: panel.content, context: panel.context };

    const rubric = (r => ({
      ...r,
      key: 'secret',
      assignment: {
        ...r.assignment,
        keys: {
          private: { assignee: null, author: 'priv' },
          public: { assignee: null, author: 'pub' }
        }
      }
    }))(Rubric.create()) as any;
    await Workbook.update(workbook, rubric);
    await Workbook.lock(workbook);
    await Workbook.submit(workbook, ['pub']);

    // Mark one cell as source_hidden to simulate an encrypted cell.
    const notebook = panel.context.model.sharedModel;
    notebook.cells[1].setMetadata('jupyter', { source_hidden: true });

    const revised = await Workbook.revise(workbook, 'unused');
    const metadata = notebook.getMetadata('correxit');
    return {
      locked: revised.locked,
      submission: revised.assignment.submission,
      submitted: revised.assignment.submitted,
      stored: metadata?.assignment?.submission ?? null,
      editable: notebook.cells.map((c: any) => c.getMetadata('editable'))
    };
  });

  expect(result.locked).toBe(true);
  expect(result.submission).toBeNull();
  expect(result.submitted).toBeNull();
  expect(result.stored).toBeNull();
  expect(result.editable[0]).toBeUndefined();
  expect(result.editable[1]).toBe(false);
  await dispose();
});

// ---------------------------------------------------------------------------
// Recovery tests
// ---------------------------------------------------------------------------

test('recovers symmetrically encrypted cells after metadata corruption', async ({
  page
}) => {
  // Scenario: author locks a workbook (encrypting secret reference cells),
  // then metadata is corrupted (e.g. git merge conflict). The passphrase
  // should recover the original cell source despite open() returning null.
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'answer = 42' },
    { id: 'cell', source: 'compare' }
  ]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const workbook = { content: panel.content, context: panel.context };
    const passphrase = 'secret';

    // Use convert to get a properly derived key (PBKDF2).
    const unlocker = {
      store: async () => {},
      unlock: async () => null
    };
    const converted = await Workbook.convert(workbook, passphrase, unlocker);
    const rubric = Rubric.add(
      converted,
      {
        id: 'cell',
        is: 'comparable',
        points: 1,
        references: ['ref'],
        payload: null
      },
      [{ cell: 'cell', referent: 'ref', points: 1, secret: true }]
    );
    await Workbook.update(workbook, rubric);
    await Workbook.lock(workbook);

    const notebook = panel.context.model.sharedModel;

    // Verify the reference cell is now encrypted.
    const encrypted = notebook.cells[0].getSource();
    const sealed = encrypted
      .trimStart()
      .startsWith('-----BEGIN PGP MESSAGE-----');

    // Corrupt metadata: delete `report` so normalize() throws.
    const metadata = notebook.getMetadata('correxit');
    delete metadata.assignment.report;
    notebook.setMetadata('correxit', metadata);

    // Fresh reference bypasses the WeakMap cache (mirrors user
    // reopening the notebook after corruption).
    const fresh = { content: panel.content, context: panel.context };

    // open() should now fail.
    const broken = Workbook.open(fresh, true);

    // Recover with the original passphrase.
    const count = await Workbook.recover(fresh, passphrase);

    const restored = notebook.cells[0].getSource();
    const type = notebook.cells[0].cell_type;
    const jupyter = notebook.cells[0].getMetadata('jupyter');
    const editable = notebook.cells[0].getMetadata('editable');

    return {
      sealed,
      broken,
      count,
      source: restored,
      type,
      hidden: jupyter?.source_hidden,
      editable
    };
  });

  expect(result.sealed).toBe(true);
  expect(result.broken).toBeNull();
  expect(result.count).toBe(1);
  expect(result.source).toBe('answer = 42');
  expect(result.type).toBe('code');
  expect(result.hidden).toBeUndefined();
  expect(result.editable).toBeUndefined();
  await dispose();
});

test('recovers zero cells with wrong passphrase', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'secret stuff' },
    { id: 'cell', source: 'compare' }
  ]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const workbook = { content: panel.content, context: panel.context };

    const unlocker = {
      store: async () => {},
      unlock: async () => null
    };
    const converted = await Workbook.convert(workbook, 'secret', unlocker);
    const rubric = Rubric.add(
      converted,
      {
        id: 'cell',
        is: 'comparable',
        points: 1,
        references: ['ref'],
        payload: null
      },
      [{ cell: 'cell', referent: 'ref', points: 1, secret: true }]
    );
    await Workbook.update(workbook, rubric);
    await Workbook.lock(workbook);

    const notebook = panel.context.model.sharedModel;
    const encrypted = notebook.cells[0].getSource();

    // Corrupt metadata.
    const metadata = notebook.getMetadata('correxit');
    delete metadata.assignment.report;
    notebook.setMetadata('correxit', metadata);

    // Fresh reference bypasses the WeakMap cache.
    const fresh = { content: panel.content, context: panel.context };

    // Try to recover with the wrong passphrase.
    const count = await Workbook.recover(fresh, 'wrong');

    return {
      count,
      source: notebook.cells[0].getSource(),
      unchanged: encrypted === notebook.cells[0].getSource()
    };
  });

  expect(result.count).toBe(0);
  expect(result.unchanged).toBe(true);
  await dispose();
});

test('recovers only encrypted cells, leaves plain cells alone', async ({
  page
}) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'hidden = 99' },
    { id: 'cell', source: 'compare' },
    { id: 'plain', source: 'x = 1' }
  ]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const workbook = { content: panel.content, context: panel.context };

    const unlocker = {
      store: async () => {},
      unlock: async () => null
    };
    const converted = await Workbook.convert(workbook, 'secret', unlocker);
    const rubric = Rubric.add(
      converted,
      {
        id: 'cell',
        is: 'comparable',
        points: 1,
        references: ['ref'],
        payload: null
      },
      [{ cell: 'cell', referent: 'ref', points: 1, secret: true }]
    );
    await Workbook.update(workbook, rubric);
    await Workbook.lock(workbook);

    const notebook = panel.context.model.sharedModel;

    // Corrupt metadata.
    const metadata = notebook.getMetadata('correxit');
    delete metadata.assignment.report;
    notebook.setMetadata('correxit', metadata);

    // Fresh reference bypasses the WeakMap cache.
    const fresh = { content: panel.content, context: panel.context };
    const count = await Workbook.recover(fresh, 'secret');

    return {
      count,
      ref: notebook.cells[0].getSource(),
      cell: notebook.cells[1].getSource(),
      plain: notebook.cells[2].getSource()
    };
  });

  expect(result.count).toBe(1);
  expect(result.ref).toBe('hidden = 99');
  expect(result.cell).toBe('compare');
  expect(result.plain).toBe('x = 1');
  await dispose();
});

test('returns zero when metadata has no rubric id', async ({ page }) => {
  const { dispose } = await setup(page, [{ id: 'cell', source: 'x = 1' }]);

  const result = await page.evaluate(async () => {
    const { Workbook } = (window as any).__correxit__;
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const workbook = { content: panel.content, context: panel.context };
    const notebook = panel.context.model.sharedModel;

    // Set broken metadata with no id.
    notebook.setMetadata('correxit', { locked: true });

    const count = await Workbook.recover(workbook, 'secret');
    return { count };
  });

  expect(result.count).toBe(0);
  await dispose();
});

test('recovers sealed cells using author PGP key from metadata', async ({
  page
}) => {
  // Scenario: student submits (cells sealed with PGP to author's public key).
  // Author opens the workbook but metadata is corrupted. Recovery extracts
  // the encrypted author private key from raw metadata, derives the symmetric
  // key from the passphrase, decrypts the PGP private key, and unseals cells.
  const { dispose } = await setup(page, [
    { id: 'a', source: 'x = 1' },
    { id: 'b', source: 'y = 2' }
  ]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const workbook = { content: panel.content, context: panel.context };
    const passphrase = 'secret';

    // Use convert to get real PGP keys (the only way without direct
    // access to the security module).
    const unlocker = {
      store: async () => {},
      unlock: async () => null
    };
    const converted = await Workbook.convert(workbook, passphrase, unlocker);

    // Add a cell to the rubric and assign.
    const rubric = Rubric.add(
      converted,
      {
        id: 'a',
        is: 'correctable',
        points: 1,
        references: ['b'],
        payload: null
      },
      [{ cell: 'a', referent: 'b', points: 1, secret: false }]
    );
    await Workbook.update(workbook, rubric);
    await Workbook.assign(workbook, {
      assignee: 'student@example.com',
      roster: ['student@example.com']
    });

    // Lock and submit: this seals cells with PGP.
    await Workbook.lock(workbook);
    const locked = Workbook.open(workbook);
    const author = locked.assignment.keys.public.author;
    await Workbook.submit(workbook, [author]);

    const notebook = panel.context.model.sharedModel;

    // Verify at least one cell is PGP-encrypted.
    const source = notebook.cells[0].getSource();
    const sealed = source.trimStart().startsWith('-----BEGIN PGP MESSAGE-----');

    // Save the rubric id and keys before corruption.
    const metadata = notebook.getMetadata('correxit');
    const id = metadata.id;
    const keys = metadata.assignment.keys;

    // Corrupt metadata: delete cells dict so normalize() throws,
    // but keep id and keys (realistic: git merge broke structure,
    // but keys survived).
    notebook.setMetadata('correxit', {
      id,
      assignment: { keys }
    });

    // Fresh reference bypasses the WeakMap cache.
    const fresh = { content: panel.content, context: panel.context };

    // Confirm open() fails.
    const broken = Workbook.open(fresh, true);

    // Recover: should unseal the PGP-encrypted cells.
    const count = await Workbook.recover(fresh, passphrase);

    return {
      sealed,
      broken,
      count,
      sources: [notebook.cells[0].getSource(), notebook.cells[1].getSource()],
      types: [notebook.cells[0].cell_type, notebook.cells[1].cell_type]
    };
  });

  expect(result.sealed).toBe(true);
  expect(result.broken).toBeNull();
  expect(result.count).toBeGreaterThanOrEqual(1);
  expect(result.sources[0]).toBe('x = 1');
  expect(result.sources[1]).toBe('y = 2');
  expect(result.types[0]).toBe('code');
  expect(result.types[1]).toBe('code');
  await dispose();
});
