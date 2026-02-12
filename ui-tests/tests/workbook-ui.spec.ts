import { expect, test } from '@jupyterlab/galata';

type Input = { id: string; source: string };

test.use({ autoGoto: false });

async function setup(page: any, cells: Input[]) {
  await page.goto();

  const name = await page.notebook.createNew();
  expect(name).toBeTruthy();
  await page.evaluate(
    ({ cells }: { cells: Input[] }) => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      const notebook = panel.context.model.sharedModel;
      while (notebook.cells.length) {
        notebook.deleteCell(0);
      }
      cells.forEach((cell, index) => {
        notebook.insertCell(index, {
          cell_type: 'code',
          id: cell.id,
          metadata: {},
          source: cell.source
        });
      });
    },
    { cells }
  );
  return {
    async dispose() {
      await page.notebook.close(true);
      if (name) {
        await page.contents.deleteFile(name);
      }
    }
  };
}

test('audits and prunes invalid rubric cells in a rubric', async ({ page }) => {
  const { dispose } = await setup(page, [{ id: 'known', source: '' }]);
  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const workbook = { content: panel.content, context: panel.context } as any;
    const rubric = Rubric.add(
      { ...Rubric.create(), key: 'secret' },
      {
        id: 'missing-ref',
        is: 'comparable',
        points: 1,
        reference: ['nope'],
        shared: false,
        payload: null
      }
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
    const rubric = { ...Rubric.create(), key: 'secret' } as any;
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
      { ...Rubric.create(), key: 'secret' },
      {
        id: 'cell',
        is: 'comparable',
        points: 1,
        reference: ['ref'],
        shared: false,
        payload: null
      }
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
    const initial = { ...Rubric.create(), key: 'secret' };
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
