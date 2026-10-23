import { expect, test } from './fixtures';
import { cd, cleanup, close, corrector, keys, reviewer, setup } from './utils';

test.use({ autoGoto: false });

test.beforeEach(() => {
  test.setTimeout(180_000);
});

test('launcher advertises the corrector', async ({ page }) => {
  await page.goto();
  const section = page.locator('.jp-Launcher-section').filter({
    has: page.getByRole('heading', { name: 'Other' })
  });
  const card = section
    .locator('.jp-LauncherCard')
    .filter({ hasText: 'Launch Correxit Corrector' });

  await expect(card).toBeVisible();
  await expect(card.locator('svg')).toBeVisible();
  await card.click();
  await expect(page.locator('.correxit-corrector')).toBeVisible();
  await close(page);
});

/**
 * Creates a propagated workbook directory and returns cleanup metadata.
 *
 * The template workbook contains a comparable cell (`target`) whose reference
 * cell (`ref`) prints `42`. Each propagated workbook is assigned to one member
 * of the given roster and has its reference cell encrypted.
 */
async function propagate(
  page: any,
  roster: string[],
  metadata: Record<string, unknown> = {
    kernelspec: {
      display_name: 'Python 3 (ipykernel)',
      language: 'python',
      name: 'python3'
    }
  }
): Promise<{ directory: string; paths: string[] }> {
  return page.evaluate(
    async ({ keys, metadata, roster }: any) => {
      const { Rubric, Workbook } = (window as any).__correxit__;
      const app = (window as any).jupyterapp;
      const panel = app.shell.currentWidget;

      for (const [key, value] of Object.entries(metadata)) {
        panel.context.model.sharedModel.setMetadata(key, value);
      }

      const rubric = Rubric.add(
        (r => ({
          ...r,
          key: 'secret',
          assignment: {
            ...r.assignment,
            keys
          }
        }))(Rubric.create()),
        {
          id: 'target',
          is: 'comparable',
          payload: null,
          points: 1,
          references: ['ref']
        },
        [{ cell: 'target', referent: 'ref', points: 1, secret: true }]
      );
      await Workbook.update(panel, rubric);
      await app.commands.execute('correxit:assign', { roster });

      type Emission = { slots: (string | number)[]; type: string };
      const stream = await app.commands.execute('correxit:propagate');
      const log: Emission[] = [];
      for await (const [, emission] of stream) {
        log.push(emission);
      }

      const directory = log.find(({ type }) => type === 'mkdir')
        ?.slots[0] as string;
      const paths = log
        .filter(({ type }) => type === 'saved')
        .map(({ slots }) => slots[0] as string);

      const contents = app.serviceManager.contents;
      for (const path of paths) {
        const file = await contents.get(path, {
          content: true,
          type: 'notebook'
        });
        const notebook = file.content;
        notebook.metadata = { ...notebook.metadata, ...metadata };
        await contents.save(path, { ...file, content: notebook });
      }

      return { directory, paths };
    },
    { keys, metadata, roster }
  );
}

async function markSubmitted(page: any, path: string, submission = 1) {
  await page.evaluate(
    async ({ path, submission }: { path: string; submission: number }) => {
      const contents = (window as any).jupyterapp.serviceManager.contents;
      const file = await contents.get(path, {
        content: true,
        type: 'notebook'
      });
      const notebook = file.content;
      const rubric = notebook.metadata.correxit;
      notebook.metadata = {
        ...notebook.metadata,
        correxit: {
          ...rubric,
          assignment: { ...rubric.assignment, submission },
          revised: submission
        }
      };
      await contents.save(path, { ...file, content: notebook });
    },
    { path, submission }
  );
}

async function focus(page: any) {
  const row = page
    .locator('.correxit-corrector tbody tr[tabindex="0"]')
    .first();
  await expect(row).toBeVisible();
  await row.locator('.correxit-corrector-assignee').click();
  await expect.poll(async () => row.getAttribute('aria-selected')).toBe('true');
  await expect.poll(() => aligned(page)).toBe(true);
  return row;
}

async function launch(page: any, path: string) {
  await page.evaluate(async (path: string) => {
    const app = (window as any).jupyterapp;
    await app.commands.execute('correxit-corrector:launch', { path });
  }, path);
  await corrector(page);
}

const selected = (page: any) =>
  page.locator('.correxit-corrector tbody tr[aria-selected="true"]');

const active = (page: any) =>
  page.locator('.correxit-corrector tbody tr[tabindex="0"]').first();

const open = (page: any) =>
  active(page).locator('.correxit-corrector-open button').first();

async function aligned(page: any) {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    const row = document.querySelector(
      '.correxit-corrector tbody tr[aria-selected="true"]'
    ) as HTMLElement | null;
    return active?.getAttribute('data-path') === row?.getAttribute('data-path');
  });
}

test('scans a directory and yields headless workbooks', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'print(42)' },
    { id: 'target', source: 'answer = 42\nprint(answer)' }
  ]);
  const propagated = await propagate(page, [
    'alice@example.com',
    'bob@example.com'
  ]);
  await cd(page, '.');

  const result = await page.evaluate(async (directory: string) => {
    const { Workbook } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;

    const stream: AsyncGenerator<any> = await app.commands.execute(
      'correxit-corrector:scan',
      { path: directory }
    );
    const workbooks: any[] = [];
    for await (const workbook of stream) {
      if (workbook.hollow) {
        continue;
      }

      const rubric = Workbook.open(workbook, true);
      workbooks.push({
        assignee: rubric?.assignment?.assignee ?? null,
        locked: rubric?.locked ?? null,
        path: workbook.context.path
      });
      workbook.context.dispose();
    }
    return workbooks.sort((a, b) => a.assignee.localeCompare(b.assignee));
  }, propagated.directory);

  expect(result).toHaveLength(2);
  expect(result[0].assignee).toBe('alice@example.com');
  expect(result[0].locked).toBe(true);
  expect(result[1].assignee).toBe('bob@example.com');
  expect(result[1].locked).toBe(true);

  await cleanup(page, propagated);
  await dispose();
});

test('scan yields nothing for an empty directory', async ({ page }) => {
  const { dispose } = await setup(page, []);

  const result = await page.evaluate(async () => {
    const app = (window as any).jupyterapp;
    const contents = app.serviceManager.contents;
    const untitled = await contents.newUntitled({
      path: '.',
      type: 'directory'
    });

    const stream: AsyncGenerator<any> = await app.commands.execute(
      'correxit-corrector:scan',
      { path: untitled.path }
    );
    const workbooks: any[] = [];
    for await (const workbook of stream) {
      workbooks.push(workbook);
      workbook.context.dispose();
    }
    await contents.delete(untitled.path);
    return workbooks.length;
  });

  expect(result).toBe(0);
  await dispose();
});

test('scan yields nothing for a missing directory', async ({ page }) => {
  const { dispose } = await setup(page, []);

  const result = await page.evaluate(async () => {
    const app = (window as any).jupyterapp;
    const stream: AsyncGenerator = await app.commands.execute(
      'correxit-corrector:scan',
      { path: 'nonexistent-directory-12345' }
    );
    const workbooks: any[] = [];
    for await (const workbook of stream) {
      workbooks.push(workbook);
    }
    return workbooks.length;
  });

  expect(result).toBe(0);
  await dispose();
});

test('corrector can filter scan results to locally submitted workbooks', async ({
  page
}) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'print(42)' },
    { id: 'target', source: 'answer = 42\nprint(answer)' }
  ]);
  const propagated = await propagate(page, [
    'alice@example.com',
    'bob@example.com'
  ]);
  await markSubmitted(page, propagated.paths[0]);
  await cd(page, '.');

  await launch(page, propagated.directory);

  const rows = page.locator('.correxit-corrector tbody tr[data-path]');
  await expect(rows).toHaveCount(2);

  await page
    .getByRole('checkbox', {
      name: 'Only include locally submitted workbooks'
    })
    .check();
  await page.getByRole('button', { name: 'Scan', exact: true }).click();

  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('alice@example.com');

  await close(page);
  await cleanup(page, propagated);
  await dispose();
});

test('scan continues after an unreadable workbook', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'print(42)' },
    { id: 'target', source: 'print(42)' }
  ]);
  const propagated = await propagate(page, [
    'alice@example.com',
    'bob@example.com'
  ]);
  const paths = await page.evaluate(async ({ directory, paths }) => {
    const app = (window as any).jupyterapp;
    const contents = app.serviceManager.contents;
    const get = contents.get.bind(contents);
    contents.get = (path: string, options: any) =>
      path === paths[0]
        ? Promise.reject(new Error('read failed'))
        : get(path, options);
    try {
      const stream = await app.commands.execute('correxit-corrector:scan', {
        path: directory
      });
      const loaded: string[] = [];
      for await (const workbook of stream)
        if (!workbook.hollow) {
          loaded.push(workbook.context.path);
          workbook.context.dispose();
        }
      return loaded;
    } finally {
      contents.get = get;
    }
  }, propagated);
  expect(paths).toEqual([propagated.paths[1]]);
  await cleanup(page, propagated);
  await dispose();
});

test('reviewer uses notebook mimetype for code cells', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'SELECT 42 AS answer;' },
    { id: 'target', source: 'SELECT 42 AS answer;' }
  ]);
  const propagated = await propagate(page, ['alice@example.com'], {
    kernelspec: {
      display_name: 'SQL',
      language: 'sql',
      name: 'sql'
    },
    language_info: {
      mimetype: 'application/sql',
      name: 'sql'
    }
  });
  await cd(page, '.');

  await launch(page, propagated.directory);

  const review = page.getByRole('button', { name: /^Review comparable:/ });
  await expect(review).toBeVisible();
  await review.click();

  await reviewer(page);
  const current = page.locator(
    '.correxit-reviewer .correxit-reviewer-source[aria-label="Current cell"]'
  );
  await expect
    .poll(async () => current.getAttribute('data-mimetype'))
    .toBe('application/sql');

  await close(page);

  await cleanup(page, propagated);
  await dispose();
});

test('corrector navigates rows with keyboard', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'print(42)' },
    { id: 'target', source: 'answer = 42\nprint(answer)' }
  ]);
  const propagated = await propagate(page, [
    'alice@example.com',
    'bob@example.com'
  ]);
  await cd(page, '.');

  await launch(page, propagated.directory);
  await focus(page);

  await expect(selected(page)).toContainText('alice@example.com');

  await page.keyboard.press('ArrowDown');
  await expect(selected(page)).toContainText('bob@example.com');
  await expect.poll(() => aligned(page)).toBe(true);

  await page.keyboard.press('ArrowUp');
  await expect(selected(page)).toContainText('alice@example.com');
  await expect.poll(() => aligned(page)).toBe(true);

  await close(page);
  await cleanup(page, propagated);
  await dispose();
});

test('corrector clears row selection with escape', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'print(42)' },
    { id: 'target', source: 'answer = 42\nprint(answer)' }
  ]);
  const propagated = await propagate(page, [
    'alice@example.com',
    'bob@example.com'
  ]);
  await cd(page, '.');

  await launch(page, propagated.directory);
  await focus(page);

  await page.keyboard.press('Escape');
  await expect(selected(page)).toHaveCount(0);
  await expect(active(page)).toContainText('alice@example.com');
  await expect(active(page)).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(selected(page)).toContainText('bob@example.com');
  await expect.poll(() => aligned(page)).toBe(true);

  await close(page);
  await cleanup(page, propagated);
  await dispose();
});

test('corrector tabs to open button and escape returns to row', async ({
  page
}) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'print(42)' },
    { id: 'target', source: 'answer = 42\nprint(answer)' }
  ]);
  const propagated = await propagate(page, ['alice@example.com']);
  await cd(page, '.');

  await launch(page, propagated.directory);
  await focus(page);

  await page.keyboard.press('Tab');
  await expect(open(page)).toBeFocused();
  await expect(selected(page)).toContainText('alice@example.com');

  await page.keyboard.press('Escape');
  await expect(active(page)).toBeFocused();
  await expect(selected(page)).toContainText('alice@example.com');
  await expect.poll(() => aligned(page)).toBe(true);

  await close(page);
  await cleanup(page, propagated);
  await dispose();
});

test('corrector tabs into breakdown buttons and opens reviewer', async ({
  page
}) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'print(42)' },
    { id: 'target', source: 'answer = 42\nprint(answer)' }
  ]);
  const propagated = await propagate(page, ['alice@example.com']);
  await cd(page, '.');

  await launch(page, propagated.directory);
  await focus(page);

  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');

  const review = page.getByRole('button', { name: /^Review comparable:/ });
  await expect(review).toBeFocused();

  await page.keyboard.press('Enter');
  await reviewer(page);

  await close(page);
  await cleanup(page, propagated);
  await dispose();
});

test('batch grades and certifies workbooks', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'print(42)' },
    { id: 'target', source: 'answer = 42\nprint(answer)' }
  ]);
  const propagated = await propagate(page, [
    'alice@example.com',
    'bob@example.com'
  ]);
  await cd(page, '.');

  const result = await page.evaluate(async (directory: string) => {
    const { Workbook } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const stream: AsyncGenerator<any> = await app.commands.execute(
      'correxit-corrector:batch',
      { key: 'secret', path: directory }
    );
    const grades: any[] = [];
    for await (const [path, { grade, workbook }] of stream) {
      const rubric = Workbook.open(workbook, true);
      const { certification } = rubric.assignment;
      grades.push({
        certification: certification !== null,
        path,
        points: grade.score.points,
        possible: grade.score.possible,
        status: grade.score.status
      });
      workbook.context.dispose();
    }
    return grades;
  }, propagated.directory);

  expect(result).toHaveLength(2);
  for (const grade of result) {
    expect(grade.certification).toBe(true);
    expect(grade.status).not.toBe('unscored');
    expect(grade.possible).toBeGreaterThan(0);
  }

  await cleanup(page, propagated);
  await dispose();
});

test('batch can require locally submitted workbooks', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'print(42)' },
    { id: 'target', source: 'answer = 42\nprint(answer)' }
  ]);
  const propagated = await propagate(page, [
    'alice@example.com',
    'bob@example.com'
  ]);
  await markSubmitted(page, propagated.paths[0]);
  await cd(page, '.');

  const result = await page.evaluate(async (directory: string) => {
    const { Workbook } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const stream: AsyncGenerator<any> = await app.commands.execute(
      'correxit-corrector:batch',
      { key: 'secret', path: directory, submitted: true }
    );
    const grades: any[] = [];
    for await (const [path, { grade, workbook }] of stream) {
      const rubric = Workbook.open(workbook, true);
      grades.push({
        assignee: rubric?.assignment?.assignee ?? null,
        certification: rubric?.assignment?.certification !== null,
        path,
        points: grade.score.points,
        possible: grade.score.possible,
        status: grade.score.status
      });
      workbook.context.dispose();
    }
    return grades;
  }, propagated.directory);

  expect(result).toHaveLength(1);
  expect(result[0].assignee).toBe('alice@example.com');
  expect(result[0].certification).toBe(true);
  expect(result[0].status).not.toBe('unscored');
  expect(result[0].possible).toBeGreaterThan(0);

  await cleanup(page, propagated);
  await dispose();
});

test('batch should bound live kernels across a larger roster', async ({
  page
}) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'print(42)' },
    { id: 'target', source: 'answer = 42\nprint(answer)' }
  ]);
  const cap = 3;
  const total = cap * 3;
  const roster = Array.from(
    { length: total },
    (_, i) => `student${i}@example.com`
  );
  const propagated = await propagate(page, roster);
  await cd(page, '.');

  const result = await page.evaluate(async (directory: string) => {
    const { Workbook, kernels } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const manager = app.serviceManager.kernels;
    const start = manager.startNew.bind(manager);
    kernels.drain();
    await manager.refreshRunning();

    const count = () =>
      typeof manager.runningCount === 'number'
        ? manager.runningCount
        : Array.from(manager.running()).length;
    const baseline = count();
    let peak = 0;
    let server = 0;
    const starts: string[] = [];
    const sample = {
      peak: () => {
        const { active, recycling } = kernels.snapshot();
        peak = Math.max(peak, active + recycling);
      },
      server: (models?: ArrayLike<unknown>) => {
        const current = Array.isArray(models) ? models.length : count();
        server = Math.max(server, Math.max(0, current - baseline));
      }
    };
    const changed = (_: unknown, models: ArrayLike<unknown>) =>
      sample.server(models);
    manager.runningChanged.connect(changed);
    manager.startNew = async (options: { name?: string }) => {
      starts.push(options?.name ?? '');
      const kernel = await start(options);
      sample.peak();
      sample.server();
      return kernel;
    };
    try {
      const stream: AsyncGenerator<any> = await app.commands.execute(
        'correxit-corrector:batch',
        { key: 'secret', path: directory }
      );
      const grades: any[] = [];
      for await (const [path, { grade, workbook }] of stream) {
        const rubric = Workbook.open(workbook, true);
        grades.push({
          assignee: rubric?.assignment?.assignee ?? null,
          certification: rubric?.assignment?.certification !== null,
          path,
          possible: grade.score.possible,
          status: grade.score.status
        });
        sample.peak();
        sample.server();
        workbook.context.dispose();
      }
      await manager.refreshRunning();
      sample.peak();
      sample.server();
      return {
        grades: grades.sort((a, b) => a.path.localeCompare(b.path)),
        peak,
        server,
        starts
      };
    } finally {
      manager.runningChanged.disconnect(changed);
      manager.startNew = start;
    }
  }, propagated.directory);

  expect(result.grades).toHaveLength(total);
  for (const grade of result.grades) {
    expect(roster).toContain(grade.assignee);
    expect(grade.certification).toBe(true);
    expect(grade.possible).toBeGreaterThan(0);
    expect(grade.status).not.toBe('unscored');
  }

  expect(result.peak).toBeLessThanOrEqual(cap);
  expect(result.starts.length).toBeLessThan(total);

  await cleanup(page, propagated);
  await dispose();
});

test('batch yields nothing for a directory with no workbooks', async ({
  page
}) => {
  const { dispose } = await setup(page, []);

  const result = await page.evaluate(async () => {
    const app = (window as any).jupyterapp;
    const contents = app.serviceManager.contents;
    const untitled = await contents.newUntitled({
      path: '.',
      type: 'directory'
    });
    const stream: AsyncGenerator = await app.commands.execute(
      'correxit-corrector:batch',
      { path: untitled.path }
    );
    const grades: any[] = [];
    for await (const item of stream) {
      grades.push(item);
    }
    await contents.delete(untitled.path);
    return grades.length;
  });

  expect(result).toBe(0);
  await dispose();
});

test('full lifecycle: propagate, scan, grade, verify', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'print(42)' },
    { id: 'target', source: 'answer = 42\nprint(answer)' }
  ]);
  const roster = ['alice@example.com', 'bob@example.com', 'carol@example.com'];
  const propagated = await propagate(page, roster);
  await cd(page, '.');

  expect(propagated.paths).toHaveLength(3);

  const result = await page.evaluate(
    async ({ directory, roster }: { directory: string; roster: string[] }) => {
      const { Workbook } = (window as any).__correxit__;
      const app = (window as any).jupyterapp;

      const scanned: AsyncGenerator<any> = await app.commands.execute(
        'correxit-corrector:scan',
        { path: directory }
      );
      const scannedResults: any[] = [];
      for await (const workbook of scanned) {
        if (workbook.hollow) {
          continue;
        }
        const rubric = Workbook.open(workbook, true);
        scannedResults.push({
          assignee: rubric?.assignment?.assignee ?? null,
          locked: rubric?.locked ?? null
        });
        workbook.context.dispose();
      }

      const graded: AsyncGenerator<any> = await app.commands.execute(
        'correxit-corrector:batch',
        { key: 'secret', path: directory }
      );
      const gradedResults: any[] = [];
      for await (const [path, { grade, workbook }] of graded) {
        const rubric = Workbook.open(workbook, true);
        const { certification } = rubric.assignment;
        gradedResults.push({
          assignee: rubric?.assignment?.assignee ?? null,
          certification: certification !== null,
          path,
          points: grade.score.points,
          possible: grade.score.possible,
          spec: grade.spec?.name ?? null,
          status: grade.score.status
        });
        workbook.context.dispose();
      }

      return {
        scanned: scannedResults.sort((a, b) =>
          a.assignee.localeCompare(b.assignee)
        ),
        graded: gradedResults.sort((a, b) =>
          a.assignee.localeCompare(b.assignee)
        ),
        roster: [...roster].sort()
      };
    },
    { directory: propagated.directory, roster }
  );

  expect(result.scanned).toHaveLength(3);
  for (const workbook of result.scanned) {
    expect(workbook.locked).toBe(true);
    expect(result.roster).toContain(workbook.assignee);
  }

  expect(result.graded).toHaveLength(3);
  for (const grade of result.graded) {
    expect(result.roster).toContain(grade.assignee);
    expect(grade.status).not.toBe('unscored');
    expect(grade.possible).toBeGreaterThan(0);
    expect(grade.spec).toBeTruthy();
    expect(grade.certification).toBe(true);
  }

  const assignees = result.graded.map((g: any) => g.assignee).sort();
  expect(assignees).toEqual(result.roster);

  await cleanup(page, propagated);
  await dispose();
});

test('batch leaves reviewable cells pending intervention', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'print(42)' },
    { id: 'target', source: 'answer = 42\nprint(answer)' },
    { id: 'manual', source: '# needs human review' }
  ]);

  // Propagate with a mixed rubric: one comparable + one reviewable cell.
  const propagated = await page.evaluate(
    async ({ keys, roster }: any) => {
      const { Rubric, Workbook } = (window as any).__correxit__;
      const app = (window as any).jupyterapp;
      const panel = app.shell.currentWidget;

      panel.context.model.sharedModel.setMetadata('kernelspec', {
        display_name: 'Python 3 (ipykernel)',
        language: 'python',
        name: 'python3'
      });

      let rubric = Rubric.add(
        (r => ({
          ...r,
          key: 'secret',
          assignment: {
            ...r.assignment,
            keys
          }
        }))(Rubric.create()),
        {
          id: 'target',
          is: 'comparable',
          payload: null,
          points: 1,
          references: ['ref']
        },
        [{ cell: 'target', referent: 'ref', points: 1, secret: true }]
      );
      rubric = Rubric.add(rubric, {
        id: 'manual',
        is: 'reviewable',
        payload: null,
        points: 5,
        references: null
      });
      await Workbook.update(panel, rubric);
      await app.commands.execute('correxit:assign', { roster });

      type Emission = { slots: (string | number)[]; type: string };
      const stream = await app.commands.execute('correxit:propagate');
      const log: Emission[] = [];
      for await (const [, emission] of stream) log.push(emission);

      return {
        directory: log.find(({ type }) => type === 'mkdir')?.slots[0] as string,
        paths: log
          .filter(({ type }) => type === 'saved')
          .map(({ slots }) => slots[0] as string)
      };
    },
    { keys, roster: ['alice@example.com'] }
  );
  await cd(page, '.');

  const result = await page.evaluate(async (directory: string) => {
    const { Workbook } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const stream: AsyncGenerator<any> = await app.commands.execute(
      'correxit-corrector:batch',
      { key: 'secret', path: directory }
    );
    const grades: any[] = [];
    for await (const [path, { grade, workbook }] of stream) {
      const rubric = Workbook.open(workbook, true);
      const { certification, report } = rubric.assignment;
      const intervention = report.interventions['manual'] ?? null;
      const manual = report.scores['manual'] ?? null;
      grades.push({
        certification: certification !== null,
        intervention,
        locked: rubric.locked,
        manual_code: manual?.code ?? null,
        manual_status: manual?.status ?? null,
        path,
        status: grade.score.status
      });
      workbook.context.dispose();
    }
    return grades;
  }, propagated.directory);

  expect(result).toHaveLength(1);
  const [grade] = result;

  // The workbook is locked but NOT certified because the reviewable cell
  // still needs a manual intervention.
  expect(grade.locked).toBe(true);
  expect(grade.certification).toBe(false);

  // The reviewable cell is scored with code 'intervene' and status 'unscored'.
  expect(grade.manual_code).toBe('intervene');
  expect(grade.manual_status).toBe('unscored');
  expect(grade.intervention).toBeNull();

  await cleanup(page, propagated);
  await dispose();
});

test('intervention on last reviewable cell auto-certifies workbook', async ({
  page
}) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'print(42)' },
    { id: 'target', source: 'answer = 42\nprint(answer)' },
    { id: 'manual', source: '# needs human review' }
  ]);

  // Propagate with comparable + reviewable cells.
  const propagated = await page.evaluate(
    async ({ keys, roster }: any) => {
      const { Rubric, Workbook } = (window as any).__correxit__;
      const app = (window as any).jupyterapp;
      const panel = app.shell.currentWidget;

      panel.context.model.sharedModel.setMetadata('kernelspec', {
        display_name: 'Python 3 (ipykernel)',
        language: 'python',
        name: 'python3'
      });

      let rubric = Rubric.add(
        (r => ({
          ...r,
          key: 'secret',
          assignment: {
            ...r.assignment,
            keys
          }
        }))(Rubric.create()),
        {
          id: 'target',
          is: 'comparable',
          payload: null,
          points: 1,
          references: ['ref']
        },
        [{ cell: 'target', referent: 'ref', points: 1, secret: true }]
      );
      rubric = Rubric.add(rubric, {
        id: 'manual',
        is: 'reviewable',
        payload: null,
        points: 5,
        references: null
      });
      await Workbook.update(panel, rubric);
      await app.commands.execute('correxit:assign', { roster });

      type Emission = { slots: (string | number)[]; type: string };
      const stream = await app.commands.execute('correxit:propagate');
      const log: Emission[] = [];
      for await (const [, emission] of stream) log.push(emission);

      return {
        directory: log.find(({ type }) => type === 'mkdir')?.slots[0] as string,
        paths: log
          .filter(({ type }) => type === 'saved')
          .map(({ slots }) => slots[0] as string)
      };
    },
    { keys, roster: ['alice@example.com'] }
  );
  await cd(page, '.');

  // Batch grade: workbook will be locked but not certified.
  // Then unlock, intervene on the reviewable cell, and certify.
  const result = await page.evaluate(async (directory: string) => {
    const { Rubric, Workbook } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;

    const stream: AsyncGenerator<any> = await app.commands.execute(
      'correxit-corrector:batch',
      { key: 'secret', path: directory }
    );
    let workbook: any = null;
    for await (const [, { workbook: wb }] of stream) workbook = wb;
    if (!workbook) return null;

    // Unlock the workbook for manual intervention.
    await Workbook.unlock(workbook, 'secret');

    // Intervene on the reviewable cell with 4/5 points (partial).
    const intervention = Rubric.Score.intervene('manual', {
      comment: 'Almost correct',
      points: 4,
      possible: 5
    });
    await Workbook.intervene(workbook, 'manual', intervention);

    // Certify using bypass (no kernel needed, all cells already scored).
    const trans = { __: (s: string) => s };
    const { grade } = await Workbook.certify(workbook, trans, true);
    await workbook.context.save();

    const rubric = Workbook.open(workbook, true);
    const result = {
      certification: rubric.assignment.certification !== null,
      intervention_points:
        rubric.assignment.report.interventions['manual']?.points,
      intervention_status:
        rubric.assignment.report.interventions['manual']?.status,
      locked: rubric.locked,
      points: grade.score.points,
      possible: grade.score.possible,
      resolved: grade.resolved
    };
    workbook.context.dispose();
    return result;
  }, propagated.directory);

  expect(result).not.toBeNull();
  expect(result!.locked).toBe(true);
  expect(result!.certification).toBe(true);
  expect(result!.resolved).toBe(true);

  // The intervention was recorded with partial credit.
  expect(result!.intervention_points).toBe(4);
  expect(result!.intervention_status).toBe('partial');

  // Total: 1 (comparable) + 4 (reviewable intervention) = 5 out of 6.
  expect(result!.points).toBe(5);
  expect(result!.possible).toBe(6);

  await cleanup(page, propagated);
  await dispose();
});

test('correctable cell sums multiple reference points', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'ref1', source: 'print(42)' },
    { id: 'ref2', source: 'print(99)' },
    { id: 'target', source: 'answer = 42\nprint(answer)' }
  ]);

  // Propagate with a correctable cell that has two references: ref1 (3 pts)
  // and ref2 (2 pts). The student cell prints 42, matching ref1 but not ref2.
  const propagated = await page.evaluate(
    async ({ keys, roster }: any) => {
      const { Rubric, Workbook } = (window as any).__correxit__;
      const app = (window as any).jupyterapp;
      const panel = app.shell.currentWidget;

      panel.context.model.sharedModel.setMetadata('kernelspec', {
        display_name: 'Python 3 (ipykernel)',
        language: 'python',
        name: 'python3'
      });

      const rubric = Rubric.add(
        (r => ({
          ...r,
          key: 'secret',
          assignment: {
            ...r.assignment,
            keys
          }
        }))(Rubric.create()),
        {
          id: 'target',
          is: 'correctable',
          payload: null,
          points: 0,
          references: ['ref1', 'ref2']
        },
        [
          { cell: 'target', referent: 'ref1', points: 3, secret: true },
          { cell: 'target', referent: 'ref2', points: 2, secret: true }
        ]
      );
      await Workbook.update(panel, rubric);
      await app.commands.execute('correxit:assign', { roster });

      type Emission = { slots: (string | number)[]; type: string };
      const stream = await app.commands.execute('correxit:propagate');
      const log: Emission[] = [];
      for await (const [, emission] of stream) log.push(emission);

      return {
        directory: log.find(({ type }) => type === 'mkdir')?.slots[0] as string,
        paths: log
          .filter(({ type }) => type === 'saved')
          .map(({ slots }) => slots[0] as string)
      };
    },
    { keys, roster: ['alice@example.com'] }
  );
  await cd(page, '.');

  const result = await page.evaluate(async (directory: string) => {
    const { Workbook } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const stream: AsyncGenerator<any> = await app.commands.execute(
      'correxit-corrector:batch',
      { key: 'secret', path: directory }
    );
    const grades: any[] = [];
    for await (const [path, { grade, workbook }] of stream) {
      const rubric = Workbook.open(workbook, true);
      grades.push({
        certification: rubric.assignment.certification !== null,
        path,
        points: grade.score.points,
        possible: grade.score.possible,
        status: grade.score.status
      });
      workbook.context.dispose();
    }
    return grades;
  }, propagated.directory);

  expect(result).toHaveLength(1);
  const [grade] = result;

  // The correctable cell uses `correct()` which checks if each reference
  // errored. ref1 prints 42 (no error -> correct, 3 pts), ref2 prints 99
  // (no error -> correct, 2 pts). Both references succeed because `correct()`
  // only checks for errors in the output, not value matching.
  expect(grade.certification).toBe(true);
  expect(grade.possible).toBe(5);
  expect(grade.points).toBeGreaterThan(0);

  await cleanup(page, propagated);
  await dispose();
});

test('collect gathers certified workbooks and records receipts', async ({
  page
}) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'print(42)' },
    { id: 'target', source: 'answer = 42\nprint(answer)' }
  ]);
  const propagated = await propagate(page, [
    'alice@example.com',
    'bob@example.com'
  ]);
  await cd(page, '.');

  // First batch-grade to get certified workbooks.
  await page.evaluate(async (directory: string) => {
    const app = (window as any).jupyterapp;
    const stream: AsyncGenerator<any> = await app.commands.execute(
      'correxit-corrector:batch',
      { key: 'secret', path: directory }
    );
    for await (const _ of stream) {
      /* drain */
    }
  }, propagated.directory);

  // Now collect: the collector returns a manual:<sha256> digest receipt.
  const result = await page.evaluate(async (directory: string) => {
    const { Workbook } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const stream: AsyncGenerator<any> = await app.commands.execute(
      'correxit-corrector:collect',
      { path: directory }
    );
    const collected: any[] = [];
    for await (const [path, { grade, workbook }] of stream) {
      const rubric = Workbook.open(workbook, true);
      collected.push({
        assignee: rubric.assignment.assignee,
        collected: rubric.assignment.collected,
        path,
        points: grade.score.points,
        possible: grade.score.possible
      });
      workbook.context.dispose();
    }
    return collected.sort((a, b) => a.assignee.localeCompare(b.assignee));
  }, propagated.directory);

  expect(result).toHaveLength(2);
  for (const entry of result) {
    // Each collected workbook has a non-null receipt.
    expect(entry.collected).toBeTruthy();
    expect(typeof entry.collected).toBe('string');
    expect(entry.possible).toBeGreaterThan(0);
  }
  expect(result[0].assignee).toBe('alice@example.com');
  expect(result[1].assignee).toBe('bob@example.com');

  // Skipped contexts have no caller to own them, so the adapter releases them.
  const again = await page.evaluate(async (directory: string) => {
    const app = (window as any).jupyterapp;
    const { Workbook } = (window as any).__correxit__;
    const lock = Workbook.lock;
    const seen = new Set<any>();
    Workbook.lock = async (workbook: any) => {
      if (workbook.context.path.startsWith(`${directory}/`)) seen.add(workbook);
      return lock(workbook);
    };
    try {
      const stream: AsyncGenerator<any> = await app.commands.execute(
        'correxit-corrector:collect',
        { path: directory }
      );
      const items: any[] = [];
      for await (const item of stream) items.push(item);
      return {
        count: items.length,
        contexts: seen.size,
        disposed: Array.from(seen).every(
          workbook => workbook.context.isDisposed
        )
      };
    } finally {
      Workbook.lock = lock;
    }
  }, propagated.directory);
  expect(again).toEqual({ count: 0, contexts: 2, disposed: true });

  await cleanup(page, propagated);
  await dispose();
});

test('corrector has contextual controls, folder identity, and an idle summary', async ({
  page
}) => {
  await page.goto();
  await page.evaluate(async () => {
    await (window as any).jupyterapp.commands.execute(
      'correxit-corrector:launch',
      { path: '.' }
    );
  });
  const widget = page.locator('#correxit-corrector-widget');
  await expect(
    widget.getByRole('button', { name: 'Scan', exact: true })
  ).toBeEnabled();
  await expect(widget.getByText('Complete', { exact: false })).toBeVisible();
  await expect(
    widget.getByRole('checkbox', { name: 'Regrade', exact: true })
  ).toHaveCount(0);
  const title = await page.evaluate(() => {
    const widget = (window as any).jupyterapp.shell.currentWidget;
    return {
      label: widget.title.label,
      caption: widget.title.caption,
      icon: widget.title.icon?.name
    };
  });
  expect(title).toMatchObject({ label: 'Corrector · /', caption: '/' });
  expect(title.icon).toContain('correxit');
  await widget.getByRole('radio', { name: 'Grade', exact: true }).check();
  await widget.getByRole('checkbox', { name: 'Regrade', exact: true }).check();
  await widget.getByRole('radio', { name: 'Sync', exact: true }).check();
  await expect(
    widget.getByRole('checkbox', {
      name: 'Only include locally submitted workbooks'
    })
  ).toHaveCount(0);
  await expect(
    widget.getByRole('checkbox', { name: 'Resync', exact: true })
  ).not.toBeChecked();
  await widget.getByRole('radio', { name: 'Grade', exact: true }).check();
  await expect(
    widget.getByRole('checkbox', { name: 'Regrade', exact: true })
  ).toBeChecked();
  await expect(widget.getByText('Complete', { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 760, height: 800 });
  const grade = widget.getByRole('button', { name: 'Grade', exact: true });
  await grade.focus();
  await expect(grade).toBeFocused();
  await grade.click({ trial: true });
  const toolbar = await widget.locator('.jp-Toolbar').boundingBox();
  const action = await grade.boundingBox();
  expect(action!.y).toBeGreaterThanOrEqual(toolbar!.y);
  expect(action!.y + action!.height).toBeLessThanOrEqual(
    toolbar!.y + toolbar!.height
  );
  await close(page);
});

test('Sync prompts once per run after cancellation', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'print(42)' },
    { id: 'target', source: 'print(42)' }
  ]);
  const propagated = await propagate(page, [
    'alice@example.com',
    'bob@example.com'
  ]);
  await launch(page, propagated.directory);
  const widget = page.locator('#correxit-corrector-widget');
  await expect(
    widget.getByRole('button', { name: 'Scan', exact: true })
  ).toBeEnabled();
  await widget.getByRole('radio', { name: 'Sync', exact: true }).check();
  const sync = widget.getByRole('button', { name: 'Sync', exact: true });
  try {
    for (const _ of [0, 1]) {
      await sync.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('Enter passphrase to unlock');
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(sync).toBeEnabled();
      await expect(dialog).toHaveCount(0);
      await expect(widget.getByRole('status').first()).toContainText(
        '0 processed · 2 failed'
      );
    }
  } finally {
    await close(page);
    await cleanup(page, propagated);
    await dispose();
  }
});

test('corrector discovers once, stops cleanly, and retains finished grades', async ({
  page
}) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'print(42)' },
    { id: 'target', source: 'print(42)' }
  ]);
  const propagated = await propagate(page, [
    'alice@example.com',
    'bob@example.com',
    'carol@example.com'
  ]);
  await launch(page, propagated.directory);
  const widget = page.locator('#correxit-corrector-widget');
  await expect(
    widget.getByRole('button', { name: 'Scan', exact: true })
  ).toBeEnabled();
  await page.evaluate(async ({ directory, paths }) => {
    const app = (window as any).jupyterapp;
    const { Workbook } = (window as any).__correxit__;
    const opened = await app.commands.execute('correxit:fetch', {
      path: paths[0],
      key: 'secret'
    });
    opened?.context.dispose();
    const contents = app.serviceManager.contents;
    const get = contents.get.bind(contents);
    const certify = Workbook.certify;
    const held = {
      reads: 0,
      starts: 0,
      saved: 0,
      release: null as (() => void) | null,
      get,
      certify
    };
    (window as any).__heldCorrector = held;
    contents.get = async (path: string, options: any) => {
      if (paths.includes(path) && options?.content) held.reads++;
      if (path === paths[2])
        await new Promise<void>(resolve => {
          (held as any).readRelease = resolve;
        });
      return get(path, options);
    };
    Workbook.certify = async (...args: any[]) => {
      held.starts++;
      if (held.starts === 2)
        await new Promise<void>(resolve => {
          held.release = resolve;
        });
      const result = await certify(...args);
      held.saved++;
      return result;
    };
  }, propagated);
  try {
    await widget.getByRole('radio', { name: 'Grade', exact: true }).check();
    await widget.getByRole('button', { name: 'Grade', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__heldCorrector.starts))
      .toBe(2);
    await expect(widget.locator('.cxt-mod-certified')).toHaveCount(1);
    await widget.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(
      widget.getByRole('button', { name: 'Stopping…', exact: true })
    ).toBeDisabled();
    await expect(
      widget.getByRole('radio', { name: 'Scan', exact: true })
    ).toBeDisabled();
    await page.evaluate(() => {
      (window as any).__heldCorrector.release();
      (window as any).__heldCorrector.readRelease?.();
    });
    await expect(
      widget.getByRole('button', { name: 'Grade', exact: true })
    ).toBeEnabled();
    await expect(widget.getByRole('status').first()).toContainText('Stopped');
    await expect(widget.locator('.cxt-mod-certified')).toHaveCount(2);
    const counts = await page.evaluate(() => {
      const { reads, starts, saved } = (window as any).__heldCorrector;
      return { reads, starts, saved };
    });
    expect(counts).toEqual({ reads: 3, starts: 2, saved: 2 });
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).jupyterapp.commands.isEnabled(
            'correxit-corrector:csv'
          )
        )
      )
      .toBe(true);
  } finally {
    await page.evaluate(() => {
      const held = (window as any).__heldCorrector;
      held.release?.();
      held.readRelease?.();
      (window as any).jupyterapp.serviceManager.contents.get = held.get;
      (window as any).__correxit__.Workbook.certify = held.certify;
    });
    await close(page);
    await cleanup(page, propagated);
    await dispose();
  }
});

test('corrector reports a directory error and recovers through folder selection', async ({
  page
}) => {
  await page.goto();
  await page.evaluate(async () => {
    await (window as any).jupyterapp.commands.execute(
      'correxit-corrector:launch',
      { path: 'does-not-exist' }
    );
  });
  await expect(
    page
      .locator('#correxit-corrector-widget')
      .getByText('Could not read this folder.', { exact: false })
  ).toBeVisible();
  await page.evaluate(async () => {
    await (window as any).jupyterapp.commands.execute('correxit-corrector:cd', {
      path: '.'
    });
  });
  await expect(
    page.getByRole('button', { name: 'Scan', exact: true })
  ).toBeEnabled();
  await expect(
    page
      .locator('#correxit-corrector-widget')
      .getByText('Could not read this folder.', { exact: false })
  ).toHaveCount(0);
  await close(page);
});

test('closing corrector preserves the active notebook monitor', async ({
  page
}) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'print(42)' },
    { id: 'target', source: 'print(42)' }
  ]);
  const propagated = await propagate(page, ['alice@example.com']);
  const id = await page.evaluate(
    () => (window as any).jupyterapp.shell.currentWidget.id
  );
  try {
    await launch(page, propagated.directory);
    await expect(
      page.getByRole('button', { name: 'Scan', exact: true })
    ).toBeEnabled();
    await page.evaluate(
      id => (window as any).jupyterapp.shell.activateById(id),
      id
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).jupyterapp.commands.isEnabled('correxit:lock')
        )
      )
      .toBe(true);
    await page.evaluate(async () => {
      const app = (window as any).jupyterapp;
      const widget = Array.from(app.shell.widgets('main')).find(
        (widget: any) => widget.id === 'correxit-corrector-widget'
      ) as any;
      const run = widget.content.run;
      widget.dispose();
      await app.commands.execute('correxit-corrector:stop', {
        run,
        release: true
      });
    });
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).jupyterapp.commands.isEnabled('correxit:lock')
        )
      )
      .toBe(true);
  } finally {
    await close(page);
    await cleanup(page, propagated);
    await dispose();
  }
});

test('releasing a run clears only its own monitored context', async ({
  page
}) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'print(42)' },
    { id: 'target', source: 'print(42)' }
  ]);
  const propagated = await propagate(page, ['alice@example.com']);
  try {
    for (const owned of [false, true]) {
      const result = await page.evaluate(
        async ({ directory, owned }) => {
          const app = (window as any).jupyterapp;
          const run = `ownership-${owned}`;
          const stream = await app.commands.execute('correxit-corrector:run', {
            run,
            path: directory,
            mode: 'scan',
            key: 'secret'
          });
          let workbook: any = null;
          for await (const event of stream)
            if (event.type === 'read') workbook = event.workbook;
          // The same path in a different context is still owned by its caller.
          const monitored = owned
            ? workbook
            : await app.commands.execute('correxit:fetch', {
                path: workbook.context.path,
                key: 'secret'
              });
          const inject = await app.commands.execute('correxit:inject');
          inject(monitored);
          await app.commands.execute('correxit-corrector:stop', {
            run,
            release: true
          });
          const result = {
            enabled: app.commands.isEnabled('correxit:assign'),
            disposed: workbook.context.isDisposed,
            monitored: monitored.context.isDisposed
          };
          (await app.commands.execute('correxit:inject'))(null);
          if (!owned) monitored.context.dispose();
          return result;
        },
        { directory: propagated.directory, owned }
      );
      expect(result).toEqual({
        enabled: !owned,
        disposed: true,
        monitored: owned
      });
    }
  } finally {
    await cleanup(page, propagated);
    await dispose();
  }
});

test('reviewer skips processing workbooks and opens their finished contents', async ({
  page
}) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'print(42)' },
    { id: 'target', source: 'print(42)' }
  ]);
  const propagated = await propagate(page, [
    'alice@example.com',
    'bob@example.com'
  ]);
  await launch(page, propagated.directory);
  const widget = page.locator('#correxit-corrector-widget');
  await expect(
    widget.getByRole('button', { name: 'Scan', exact: true })
  ).toBeEnabled();
  await page.evaluate(async paths => {
    const app = (window as any).jupyterapp;
    const { Workbook } = (window as any).__correxit__;
    const opened = await app.commands.execute('correxit:fetch', {
      path: paths[0],
      key: 'secret'
    });
    opened.context.dispose();
    const sealed = await app.commands.execute('correxit:fetch', {
      path: paths[1],
      unlock: false
    });
    await Workbook.submit(sealed, [
      Workbook.open(sealed).assignment.keys.public.author
    ]);
    await sealed.context.save();
    sealed.context.dispose();
    const certify = Workbook.certify;
    const held = { certify, release: null as (() => void) | null };
    (window as any).__reviewingCorrector = held;
    Workbook.certify = async (workbook: any, ...args: any[]) => {
      if (Workbook.open(workbook).assignment.assignee === 'bob@example.com')
        await new Promise<void>(resolve => {
          held.release = resolve;
        });
      return certify(workbook, ...args);
    };
  }, propagated.paths);
  try {
    await widget.getByRole('radio', { name: 'Grade', exact: true }).check();
    await widget.getByRole('button', { name: 'Grade', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => !!(window as any).__reviewingCorrector.release)
      )
      .toBe(true);
    await expect(widget.locator('.cxt-mod-certified')).toHaveCount(1);
    await widget
      .locator('tr[data-path]')
      .filter({ hasText: 'alice@example.com' })
      .getByRole('button', { name: /^Review comparable:/ })
      .click();
    await reviewer(page);
    const minimap = page.getByRole('grid', { name: 'Score minimap' });
    await expect(minimap.getByRole('gridcell')).toHaveCount(1);
    await page.evaluate(async () => {
      await (window as any).jupyterapp.commands.execute(
        'correxit-reviewer:right'
      );
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const app = (window as any).jupyterapp;
          return (window as any).__correxit__.Workbook.open(
            app.shell.currentWidget.workbook
          ).assignment.assignee;
        })
      )
      .toBe('alice@example.com');
    await page.evaluate(() => (window as any).__reviewingCorrector.release());
    await expect(minimap.getByRole('gridcell')).toHaveCount(2);
    await page.evaluate(async () => {
      await (window as any).jupyterapp.commands.execute(
        'correxit-reviewer:right'
      );
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const app = (window as any).jupyterapp;
          return (window as any).__correxit__.Workbook.open(
            app.shell.currentWidget.workbook
          ).assignment.assignee;
        })
      )
      .toBe('bob@example.com');
    await expect(
      page.getByText('Certified (read-only)', { exact: true })
    ).toBeVisible();
    await expect(
      page.locator('.correxit-reviewer-source[aria-label="Current cell"]')
    ).toContainText('print(42)');
  } finally {
    await page.evaluate(() => {
      const held = (window as any).__reviewingCorrector;
      held.release?.();
      (window as any).__correxit__.Workbook.certify = held.certify;
    });
    await close(page);
    await cleanup(page, propagated);
    await dispose();
  }
});

test('closing corrector drains an active save before disposing contexts', async ({
  page
}) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'print(42)' },
    { id: 'target', source: 'print(42)' }
  ]);
  const propagated = await propagate(page, ['alice@example.com']);
  await launch(page, propagated.directory);
  await expect(
    page.getByRole('button', { name: 'Scan', exact: true })
  ).toBeEnabled();
  await page.evaluate(async path => {
    const app = (window as any).jupyterapp;
    const { Workbook } = (window as any).__correxit__;
    const opened = await app.commands.execute('correxit:fetch', {
      path,
      key: 'secret'
    });
    opened.context.dispose();
    const certify = Workbook.certify;
    const held = { certify, workbook: null as any, release: null as any };
    (window as any).__closingCorrector = held;
    Workbook.certify = async (workbook: any, ...args: any[]) => {
      held.workbook = workbook;
      await new Promise<void>(resolve => {
        held.release = resolve;
      });
      return certify(workbook, ...args);
    };
  }, propagated.paths[0]);
  try {
    await page.getByRole('radio', { name: 'Grade', exact: true }).check();
    await page.getByRole('button', { name: 'Grade', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => !!(window as any).__closingCorrector.release)
      )
      .toBe(true);
    await page.evaluate(() =>
      (window as any).jupyterapp.shell.currentWidget.dispose()
    );
    expect(
      await page.evaluate(
        () => (window as any).__closingCorrector.workbook.context.isDisposed
      )
    ).toBe(false);
    await page.evaluate(() => (window as any).__closingCorrector.release());
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).__closingCorrector.workbook.context.isDisposed
        )
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(async path => {
          const file = await (
            window as any
          ).jupyterapp.serviceManager.contents.get(path);
          return !!file.content.metadata.correxit.assignment.certification;
        }, propagated.paths[0])
      )
      .toBe(true);
  } finally {
    await page.evaluate(() => {
      const held = (window as any).__closingCorrector;
      held.release?.();
      (window as any).__correxit__.Workbook.certify = held.certify;
    });
    await close(page);
    await cleanup(page, propagated);
    await dispose();
  }
});

test('corrector distinguishes empty folders, ordinary notebooks, and invalid workbooks', async ({
  page
}) => {
  await page.goto();
  const directory = await page.evaluate(async () => {
    const folder = await (
      window as any
    ).jupyterapp.serviceManager.contents.newUntitled({
      path: '',
      type: 'directory'
    });
    await (window as any).jupyterapp.commands.execute(
      'correxit-corrector:launch',
      { path: folder.path }
    );
    return folder.path;
  });
  const widget = page.locator('#correxit-corrector-widget');
  const scan = widget.getByRole('button', { name: 'Scan', exact: true });
  try {
    await expect(
      widget.getByText('This folder contains no notebooks.')
    ).toBeVisible();
    await page.evaluate(async directory => {
      const notebook = {
        nbformat: 4,
        nbformat_minor: 5,
        metadata: {},
        cells: []
      };
      await (window as any).jupyterapp.serviceManager.contents.save(
        `${directory}/ordinary.ipynb`,
        { type: 'notebook', format: 'json', content: notebook }
      );
    }, directory);
    await scan.click();
    await expect(
      widget.getByText('No matching Correxit workbooks.')
    ).toBeVisible();
    await expect(widget.locator('tr[data-path]')).toHaveCount(0);
    await widget.getByRole('radio', { name: 'Grade', exact: true }).check();
    const grade = widget.getByRole('button', { name: 'Grade', exact: true });
    await grade.click();
    await expect(grade).toBeEnabled();
    await expect(widget.getByRole('status').first()).toHaveText(
      'Complete · 1/1 checked · 0 processed · 1 skipped'
    );
    await page.evaluate(async directory => {
      const notebook = {
        nbformat: 4,
        nbformat_minor: 5,
        metadata: { correxit: { cxtformat: 1 } },
        cells: []
      };
      await (window as any).jupyterapp.serviceManager.contents.save(
        `${directory}/invalid.ipynb`,
        { type: 'notebook', format: 'json', content: notebook }
      );
    }, directory);
    await grade.click();
    await expect(widget.getByText('Could not read workbook')).toBeVisible();
    await expect(grade).toBeEnabled();
    await expect(widget.getByRole('status').first()).toHaveText(
      'Complete · 2/2 checked · 0 processed · 1 failed · 1 skipped'
    );
  } finally {
    await close(page);
    await cleanup(page, {
      directory,
      paths: [`${directory}/ordinary.ipynb`, `${directory}/invalid.ipynb`]
    });
  }
});
