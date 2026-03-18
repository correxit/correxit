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
      stored: metadata?.assignment?.assignee ?? null,
      signature: !!final.assignment.signature
    };
  });

  expect(result.assignee).toBe('assignee@example.com');
  expect(result.stored).toBe('assignee@example.com');
  expect(result.signature).toBe(true);
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

    const signature = assigned.assignment.signature;
    const unchanged = await Workbook.assign(workbook, {});
    return {
      same: unchanged.assignment.signature === signature,
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
