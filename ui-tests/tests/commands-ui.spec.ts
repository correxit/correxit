import { expect, test } from '@jupyterlab/galata';

test.use({ autoGoto: false });

async function setup(page: any, cells: { id: string; source: string }[]) {
  await page.goto();

  const name = await page.notebook.createNew();
  expect(name).toBeTruthy();
  await page.evaluate(
    ({ cells }: { cells: { id: string; source: string }[] }) => {
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

test('commands are disabled without a workbook rubric', async ({ page }) => {
  const { dispose } = await setup(page, [{ id: 'cell', source: 'x = 1' }]);
  const result = await page.evaluate(() => {
    const app = (window as any).jupyterapp;
    return {
      add: app.commands.isEnabled('correxit:add', {
        id: 'cell',
        is: 'comparable'
      }),
      assign: app.commands.isEnabled('correxit:assign'),
      convert: app.commands.isEnabled('correxit:convert'),
      lock: app.commands.isEnabled('correxit:lock'),
      propagate: app.commands.isEnabled('correxit:propagate'),
      remove: app.commands.isEnabled('correxit:remove', { id: 'cell' }),
      toggle: app.commands.isEnabled('correxit:toggle', { id: 'cell' })
    };
  });

  expect(result.add).toBe(false);
  expect(result.assign).toBe(false);
  expect(result.convert).toBe(true);
  expect(result.lock).toBe(false);
  expect(result.propagate).toBe(false);
  expect(result.remove).toBe(false);
  expect(result.toggle).toBe(false);
  await dispose();
});

test('adds a comparable cell to the rubric', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'answer' },
    { id: 'cell', source: 'compare' }
  ]);
  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const panel = app.shell.currentWidget;
    await Workbook.update(panel, { ...Rubric.create(), key: 'secret' });

    await app.commands.execute('correxit:add', {
      id: 'cell',
      is: 'comparable',
      reference: ['ref']
    });

    const metadata = panel.context.model.sharedModel.getMetadata('correxit');
    const cell = metadata?.cells?.['cell'];
    return {
      is: cell?.is ?? null,
      points: cell?.points ?? null,
      reference: cell?.reference ?? null,
      shared: cell?.shared ?? null,
      toggled: app.commands.isToggled('correxit:add', {
        id: 'cell',
        is: 'comparable'
      })
    };
  });

  expect(result.is).toBe('comparable');
  expect(result.points).toBe(1);
  expect(result.reference).toEqual(['ref']);
  expect(result.shared).toBe(false);
  expect(result.toggled).toBe(true);
  await dispose();
});

test('adds a correctable cell to the rubric', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'answer' },
    { id: 'cell', source: 'attempt' }
  ]);
  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const panel = app.shell.currentWidget;
    await Workbook.update(panel, { ...Rubric.create(), key: 'secret' });

    await app.commands.execute('correxit:add', {
      id: 'cell',
      is: 'correctable',
      reference: ['ref']
    });

    const metadata = panel.context.model.sharedModel.getMetadata('correxit');
    const cell = metadata?.cells?.['cell'];
    return {
      is: cell?.is ?? null,
      reference: cell?.reference ?? null,
      toggled: app.commands.isToggled('correxit:add', {
        id: 'cell',
        is: 'correctable'
      })
    };
  });

  expect(result.is).toBe('correctable');
  expect(result.reference).toEqual(['ref']);
  expect(result.toggled).toBe(true);
  await dispose();
});

test('removes a cell from the rubric', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'answer' },
    { id: 'cell', source: 'compare' }
  ]);
  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const panel = app.shell.currentWidget;
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
    await Workbook.update(panel, rubric);

    const before = Rubric.has(Workbook.open(panel)!, 'cell');
    await app.commands.execute('correxit:remove', { id: 'cell' });

    const after = Rubric.has(Workbook.open(panel)!, 'cell');
    return { before, after };
  });

  expect(result.before).toBe(true);
  expect(result.after).toBe(false);
  await dispose();
});

test('toggles shared flag on a rubric cell', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'answer' },
    { id: 'cell', source: 'compare' }
  ]);
  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const panel = app.shell.currentWidget;
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
    await Workbook.update(panel, rubric);

    const before = Rubric.get(Workbook.open(panel)!, 'cell')!.shared;
    await app.commands.execute('correxit:toggle', { id: 'cell' });

    const after = Rubric.get(Workbook.open(panel)!, 'cell')!.shared;
    return { before, after };
  });

  expect(result.before).toBe(false);
  expect(result.after).toBe(true);
  await dispose();
});

test('sets a comment on a rubric cell', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'answer' },
    { id: 'cell', source: 'compare' }
  ]);
  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const panel = app.shell.currentWidget;
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
    await Workbook.update(panel, rubric);
    await app.commands.execute('correxit:comment', {
      id: 'cell',
      comment: 'Good work!'
    });

    const metadata = panel.context.model.sharedModel.getMetadata('correxit');
    return {
      comment: metadata?.assignment?.report?.scores?.['cell']?.comment ?? null
    };
  });

  expect(result.comment).toBe('Good work!');
  await dispose();
});

test('locks workbook and encrypts reference cells', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'answer' },
    { id: 'cell', source: 'compare' }
  ]);
  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const panel = app.shell.currentWidget;
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
    await Workbook.update(panel, rubric);
    await app.commands.execute('correxit:lock');

    const notebook = panel.context.model.sharedModel;
    const refCell = notebook.cells[0];
    const metadata = notebook.getMetadata('correxit');
    return {
      refType: refCell.cell_type,
      refHidden: refCell.getMetadata('jupyter')?.source_hidden ?? null,
      refEditable: refCell.getMetadata('editable') ?? null,
      locked: metadata?.locked ?? null
    };
  });

  expect(result.refType).toBe('raw');
  expect(result.refHidden).toBe(true);
  expect(result.refEditable).toBe(false);
  expect(result.locked).toBe(true);
  await dispose();
});

test('enabled states reflect locked and unlocked rubric', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'answer' },
    { id: 'cell', source: 'compare' }
  ]);
  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const panel = app.shell.currentWidget;
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
    await Workbook.update(panel, rubric);

    const unlocked = {
      add: app.commands.isEnabled('correxit:add', {
        id: 'cell',
        is: 'comparable'
      }),
      lock: app.commands.isEnabled('correxit:lock'),
      remove: app.commands.isEnabled('correxit:remove', { id: 'cell' }),
      toggle: app.commands.isEnabled('correxit:toggle', { id: 'cell' }),
      unlock: app.commands.isEnabled('correxit:unlock')
    };
    await Workbook.lock(panel);

    const locked = {
      add: app.commands.isEnabled('correxit:add', {
        id: 'cell',
        is: 'comparable'
      }),
      lock: app.commands.isEnabled('correxit:lock'),
      remove: app.commands.isEnabled('correxit:remove', { id: 'cell' }),
      toggle: app.commands.isEnabled('correxit:toggle', { id: 'cell' }),
      unlock: app.commands.isEnabled('correxit:unlock')
    };

    return { unlocked, locked };
  });

  expect(result.unlocked.add).toBe(true);
  expect(result.unlocked.lock).toBe(true);
  expect(result.unlocked.remove).toBe(true);
  expect(result.unlocked.toggle).toBe(true);
  expect(result.unlocked.unlock).toBe(false);
  expect(result.locked.add).toBe(false);
  expect(result.locked.lock).toBe(false);
  expect(result.locked.remove).toBe(false);
  expect(result.locked.toggle).toBe(false);
  expect(result.locked.unlock).toBe(true);
  await dispose();
});

test('assigns workbook and updates assignment metadata', async ({ page }) => {
  const { dispose } = await setup(page, []);
  const result = await page.evaluate(async () => {
    const { Rubric, Workbook } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const panel = app.shell.currentWidget;
    await Workbook.update(panel, { ...Rubric.create(), key: 'secret' });

    await app.commands.execute('correxit:assign', {
      assignee: 'student@example.com',
      roster: ['student@example.com']
    });

    const metadata = panel.context.model.sharedModel.getMetadata('correxit');
    return {
      assignee: metadata?.assignment?.assignee ?? null,
      signature: !!metadata?.assignment?.signature
    };
  });

  expect(result.assignee).toBe('student@example.com');
  expect(result.signature).toBe(true);
  await dispose();
});
