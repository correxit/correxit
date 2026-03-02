import { expect, test } from '@jupyterlab/galata';
import { cd, setup } from './utils';

test.use({ autoGoto: false });

/**
 * Creates a propagated workbook directory and returns cleanup metadata.
 *
 * The template workbook contains a comparable cell (`target`) whose reference
 * cell (`ref`) prints `42`. Each propagated workbook is assigned to one member
 * of the given roster and has its reference cell encrypted.
 */
async function propagate(
  page: any,
  roster: string[]
): Promise<{ directory: string; paths: string[] }> {
  return page.evaluate(async (roster: string[]) => {
    const { Rubric, Workbook } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const panel = app.shell.currentWidget;

    // Galata creates notebooks with an empty kernelspec. Set it explicitly so
    // propagated headless workbooks can start kernels for grading.
    panel.context.model.sharedModel.setMetadata('kernelspec', {
      display_name: 'Python 3 (ipykernel)',
      language: 'python',
      name: 'python3'
    });

    const rubric = Rubric.add(
      { ...Rubric.create(), key: 'secret' },
      {
        id: 'target',
        is: 'comparable',
        payload: null,
        points: 1,
        reference: ['ref'],
        shared: false
      }
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

    return { directory, paths };
  }, roster);
}

/**
 * Deletes the propagated directory and all workbook files.
 */
async function cleanup(
  page: any,
  { directory, paths }: { directory: string; paths: string[] }
) {
  await page.evaluate(
    async ({ directory, paths }: { directory: string; paths: string[] }) => {
      const contents = (window as any).jupyterapp.serviceManager.contents;
      for (const path of paths) {
        await contents.delete(path).catch(() => {});
      }
      await contents.delete(directory).catch(() => {});
    },
    { directory, paths }
  );
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

test('scan does not silence next fetch after first fetch failure', async ({
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

  const silentCalls = await page.evaluate(async (directory: string) => {
    const app = (window as any).jupyterapp;
    const execute = app.commands.execute.bind(app.commands);
    const calls: boolean[] = [];
    let fetches = 0;

    app.commands.execute = async (id: string, args: any) => {
      if (id === 'correxit:fetch') {
        calls.push(!!args?.silent);
        fetches += 1;
        if (fetches === 1) {
          return null;
        }
      }
      return execute(id, args);
    };

    try {
      const stream: AsyncGenerator<any> = await execute(
        'correxit-corrector:scan',
        { path: directory }
      );
      for await (const workbook of stream) {
        if (!workbook.hollow) {
          workbook.context.dispose();
        }
      }
      return calls;
    } finally {
      app.commands.execute = execute;
    }
  }, propagated.directory);

  expect(silentCalls).toEqual([false, false]);

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
