import { expect, test } from '@jupyterlab/galata';

// Reuse the real JupyterLab runtime instead of mocking notebook internals.
test.use({ autoGoto: false });

type CellInput = { id: string; source: string };

async function setupNotebook(page: any, cells: CellInput[]) {
  await page.goto();
  const name = await page.notebook.createNew();
  expect(name).toBeTruthy();

  await page.evaluate(
    ({ cells }: { cells: CellInput[] }) => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      const { sharedModel } = panel.context.model;
      while (sharedModel.cells.length) {
        sharedModel.deleteCell(0);
      }
      cells.forEach((cell, index) => {
        sharedModel.insertCell(index, {
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

test('audits and prunes invalid rubric cells in a live notebook', async ({
  page
}) => {
  const { dispose } = await setupNotebook(page, [{ id: 'known', source: '' }]);

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
      prunedLength: audit.ok ? audit.pruned.length : 0,
      hasMissing: audit.ok ? Rubric.has(audit.rubric, 'missing-ref') : null
    };
  });

  expect(result.ok).toBe(true);
  expect(result.prunedLength).toBe(1);
  expect(result.hasMissing).toBe(false);

  await dispose();
});

test('locks an unlocked rubric and writes notebook metadata', async ({
  page
}) => {
  const { dispose } = await setupNotebook(page, []);
  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const workbook = { content: panel.content, context: panel.context };
    const rubric = { ...Rubric.create(), key: 'secret' } as any;
    const updated = await Workbook.update(workbook, rubric);
    const metadata = panel.context.model.sharedModel.getMetadata('correxit');
    return {
      updatedLocked: updated?.locked ?? null,
      metadataLocked: metadata?.locked ?? null,
      metadataKey: metadata?.key ?? null
    };
  });

  expect(result.updatedLocked).toBe(false);
  expect(result.metadataLocked).toBe(true);
  expect(result.metadataKey).toBeNull();
  await dispose();
});

test('locks then unlocks a comparable cell round-trip', async ({ page }) => {
  const { dispose } = await setupNotebook(page, [
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

    const sharedModel = panel.context.model.sharedModel;
    const lockedCell = sharedModel.cells[0];
    const lockedSnapshot = {
      cellType: lockedCell.cell_type,
      jupyter: lockedCell.getMetadata('jupyter'),
      editable: lockedCell.getMetadata('editable')
    };

    await Workbook.unlock(workbook, rubric.key);

    const decrypted = sharedModel.cells[0];
    const unlockedSnapshot = {
      cellType: decrypted.cell_type,
      source: decrypted.getSource(),
      jupyter: decrypted.getMetadata('jupyter'),
      editable: decrypted.getMetadata('editable')
    };

    return { lockedSnapshot, unlockedSnapshot };
  });

  expect(result.lockedSnapshot.cellType).toBe('raw');
  expect((result.lockedSnapshot.jupyter as any).source_hidden).toBe(true);
  expect(result.lockedSnapshot.editable).toBe(false);

  expect(result.unlockedSnapshot.cellType).toBe('code');
  expect(result.unlockedSnapshot.source).toBe('answer');
  expect(
    (result.unlockedSnapshot.jupyter as any)?.source_hidden
  ).toBeUndefined();
  expect(result.unlockedSnapshot.editable).toBeUndefined();

  await dispose();
});
