import { expect, test } from '@jupyterlab/galata';
import { cd, setup } from './utils';

test.use({ autoGoto: false });

test('propagates assignment to individual notebooks', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'answer = 42' },
    { id: 'target', source: 'print(answer)' }
  ]);

  const result = await page.evaluate(async () => {
    const { Rubric, Workbook } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const panel = app.shell.currentWidget;

    const rubric = Rubric.add(
      { ...Rubric.create(), key: 'secret' },
      {
        id: 'target',
        is: 'comparable',
        points: 1,
        references: ['ref'],
        payload: null
      },
      [{ cell: 'target', referent: 'ref', points: 1, secret: true }]
    );
    await Workbook.update(panel, rubric);
    await app.commands.execute('correxit:assign', {
      roster: ['alice@example.com', 'bob@example.com']
    });

    type Emission = { message: string; slots: string[]; type: string };

    const stream = await app.commands.execute('correxit:propagate');
    const log: Emission[] = [];
    for await (const [message, emission] of stream) {
      log.push({
        message,
        slots: emission.slots as string[],
        type: emission.type
      });
    }

    const saved = log
      .filter(({ type }) => type === 'saved')
      .map(({ slots }) => slots[0]);

    const directory =
      log.find(({ type }) => type === 'mkdir')?.slots[0] || null;

    const files = await Promise.all(
      saved.map((path: string) =>
        app.serviceManager.contents.get(path, {
          content: true,
          type: 'notebook'
        })
      )
    );

    const checks = files.map((file: any) => {
      const notebook = file.content;
      const metadata = notebook.metadata.correxit;
      const assignment = metadata.assignment;
      const cell = notebook.cells.find((c: any) => c.id === 'ref');

      return {
        assignee: assignment.assignee,
        locked: metadata.locked,
        roster: assignment.roster,
        signature: assignment.signature,
        source: cell?.source,
        hidden: cell?.metadata?.jupyter?.source_hidden,
        type: cell?.cell_type
      };
    });
    return {
      assigned: log
        .filter(({ type }) => type === 'assigned')
        .map(x => x.slots[0]),
      directory,
      encrypted: log.filter(({ type }) => type === 'encrypted').length,
      saved,
      checks
    };
  });

  expect(result.saved.length).toBe(2);
  expect(result.assigned).toEqual(['alice@example.com', 'bob@example.com']);
  expect(result.encrypted).toBe(1);
  expect(result.checks).toHaveLength(2);

  for (const check of result.checks) {
    expect(result.assigned).toContain(check.assignee);
    expect(check.locked).toBe(true);
    expect(typeof check.signature).toBe('string');
    expect(check.signature.length).toBeGreaterThan(0);
    expect(Array.isArray(check.roster)).toBe(true);
    expect(check.roster.length).toBe(1);
    expect(check.type).toBe('raw');
    expect(check.hidden).toBe(true);
    expect(typeof check.source).toBe('string');
    expect(check.source).not.toContain('answer = 42');
  }

  await cd(page, '.');
  await page.evaluate(
    async ({
      directory,
      paths
    }: {
      directory: string | null;
      paths: string[];
    }) => {
      const contents = (window as any).jupyterapp.serviceManager.contents;
      for (const path of paths) {
        await contents.delete(path).catch(() => {});
      }
      if (directory) {
        await contents.delete(directory).catch(() => {});
      }
    },
    { directory: result.directory, paths: result.saved }
  );
  await dispose();
});

test('propagate command is disabled for assigned workbooks', async ({
  page
}) => {
  const { dispose } = await setup(page, []);

  const result = await page.evaluate(async () => {
    const { Rubric, Workbook } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const panel = app.shell.currentWidget;
    await Workbook.update(panel, { ...Rubric.create(), key: 'secret' });
    await app.commands.execute('correxit:assign', {
      assignee: 'alice@example.com',
      roster: ['alice@example.com']
    });

    return app.commands.isEnabled('correxit:propagate');
  });

  expect(result).toBe(false);
  await dispose();
});
