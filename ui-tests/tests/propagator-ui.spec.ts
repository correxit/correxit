import { expect, test } from './fixtures';
import { cd, keys, setup } from './utils';

test.use({ autoGoto: false });

test('propagates assignment to individual notebooks', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'answer = 42' },
    { id: 'target', source: 'print(answer)' }
  ]);

  const result = await page.evaluate(async keys => {
    const { Rubric, Workbook } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const panel = app.shell.currentWidget;

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
        id: 'target',
        is: 'comparable',
        points: 1,
        references: ['ref'],
        payload: null
      },
      [{ cell: 'target', referent: 'ref', points: 1, secret: true }]
    );
    rubric.assignment.keys.private.author = keys.private.author;
    rubric.assignment.keys.public.author = keys.public.author;
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
        distribution: assignment.distribution,
        issue: assignment.issue,
        issuer: assignment.issuer,
        locked: metadata.locked,
        mac: assignment.mac,
        roster: assignment.roster,
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
  }, keys);

  expect(result.saved.length).toBe(2);
  expect(result.assigned).toEqual(['alice@example.com', 'bob@example.com']);
  expect(result.encrypted).toBe(1);
  expect(result.checks).toHaveLength(2);

  for (const check of result.checks) {
    expect(result.assigned).toContain(check.assignee);
    expect(check.distribution).toEqual(expect.any(Number));
    expect(typeof check.issue).toBe('string');
    expect(check.issue.length).toBeGreaterThan(0);
    expect(typeof check.issuer).toBe('string');
    expect(check.issuer.length).toBeGreaterThan(0);
    expect(check.locked).toBe(true);
    expect(typeof check.mac).toBe('string');
    expect(check.mac.length).toBeGreaterThan(0);
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

test('distribute validates issued notebooks before distributing', async ({
  page
}) => {
  const { dispose } = await setup(page, [
    { id: 'ref', source: 'answer = 42' },
    { id: 'target', source: 'print(answer)' }
  ]);

  const result = await page.evaluate(async keys => {
    const { Rubric, Workbook } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const panel = app.shell.currentWidget;

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
        id: 'target',
        is: 'comparable',
        points: 1,
        references: ['ref'],
        payload: null
      },
      [{ cell: 'target', referent: 'ref', points: 1, secret: true }]
    );
    rubric.assignment.keys.private.author = keys.private.author;
    rubric.assignment.keys.public.author = keys.public.author;
    await Workbook.update(panel, rubric);
    await app.commands.execute('correxit:assign', {
      roster: ['alice@example.com']
    });

    const stream = await app.commands.execute('correxit:propagate');
    let path = '';
    for await (const [, emission] of stream) {
      if (emission.type === 'saved') path = emission.slots[0] as string;
    }

    const contents = app.serviceManager.contents;
    const file = await contents.get(path, { content: true, type: 'notebook' });
    const notebook = file.content;
    notebook.metadata.correxit.assignment.distribution = null;
    notebook.cells[1].source = 'print(answer + 1)';
    await contents.save(path, { ...file, content: notebook });

    const ok = await app.commands.execute('correxit:distribute', {
      path,
      quiet: true,
      silent: true
    });
    const distribution = (
      await contents.get(path, { content: true, type: 'notebook' })
    ).content.metadata.correxit.assignment.distribution;

    await contents.delete(path).catch(() => {});
    return { distribution, ok };
  }, keys);

  expect(result.ok).toBe(false);
  expect(result.distribution).toBeNull();
  await cd(page, '.');
  await dispose();
});

test('propagate copies resources for local retry delivery', async ({
  page
}) => {
  const { dispose } = await setup(page, [{ id: 'cell', source: 'x = 1' }]);

  const result = await page.evaluate(async keys => {
    const { Rubric, Workbook } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const contents = app.serviceManager.contents;
    const panel = app.shell.currentWidget;

    await contents.save('data.csv', {
      content: 'a,b\n1,2\n',
      format: 'text',
      type: 'file'
    });

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
    }))(Rubric.create());
    rubric.assignment.keys.private.author = keys.private.author;
    rubric.assignment.keys.public.author = keys.public.author;
    await Workbook.update(panel, rubric);
    await app.commands.execute('correxit:assign', {
      roster: ['alice@example.com']
    });
    await app.commands.execute('correxit:resource', {
      resources: ['data.csv']
    });

    const stream = await app.commands.execute('correxit:propagate');
    let directory = '';
    let path = '';
    for await (const [, emission] of stream) {
      if (emission.type === 'mkdir') directory = emission.slots[0] as string;
      if (emission.type === 'saved') path = emission.slots[0] as string;
    }

    const resource = await contents.get(`${directory}/data.csv`, {
      content: true,
      format: 'text',
      type: 'file'
    });
    const file = await contents.get(path, { content: true, type: 'notebook' });
    file.content.metadata.correxit.assignment.distribution = null;
    await contents.save(path, { ...file, content: file.content });
    const retried = await app.commands.execute('correxit:distribute', {
      path,
      quiet: true,
      silent: true
    });

    return {
      directory,
      path,
      resource: resource.content,
      retried
    };
  }, keys);

  expect(result.resource).toBe('a,b\n1,2\n');
  expect(result.retried).toBe(true);

  await page.evaluate(
    async ({ directory, path }: { directory: string; path: string }) => {
      const contents = (window as any).jupyterapp.serviceManager.contents;
      await contents.delete(path).catch(() => {});
      await contents.delete(`${directory}/data.csv`).catch(() => {});
      await contents.delete(directory).catch(() => {});
      await contents.delete('data.csv').catch(() => {});
    },
    result
  );

  await cd(page, '.');
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
    await Workbook.update(
      panel,
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
      }))(Rubric.create())
    );
    await app.commands.execute('correxit:assign', {
      assignee: 'alice@example.com',
      roster: ['alice@example.com']
    });

    return app.commands.isEnabled('correxit:propagate');
  });

  expect(result).toBe(false);
  await dispose();
});

test('track archives retry output before clearing retry state', async ({
  page
}) => {
  const { dispose } = await setup(page, []);

  await page.evaluate(() => {
    const { Rubric, Workbook } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const panel = app.shell.currentWidget;
    return Workbook.update(
      panel,
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
      }))(Rubric.create())
    );
  });
  await page.evaluate(() => {
    const app = (window as any).jupyterapp;
    return app.commands.execute('correxit:assign', {
      roster: ['alice@example.com']
    });
  });
  await page.evaluate(() => {
    const app = (window as any).jupyterapp;
    const execute = app.commands.execute.bind(app.commands);
    const emit = async function* (items: any[]) {
      for (const item of items) yield item;
    };
    (window as any).__correxitRestore = () => {
      app.commands.execute = execute;
    };
    app.commands.execute = async (id: string, args: any) => {
      if (id === 'correxit:propagate') {
        return emit([
          ['Created directory fake', { type: 'mkdir', slots: ['fake'] }],
          ['------------', { type: 'separator', slots: [] }],
          [
            'Distribute ERROR alice@example.com (TypeError: Failed to fetch)',
            {
              type: 'distribute-error',
              slots: [
                'alice@example.com',
                'fake/alice.ipynb',
                'TypeError: Failed to fetch'
              ]
            }
          ],
          [
            'Assigned to alice@example.com',
            {
              type: 'assigned',
              slots: ['alice@example.com']
            }
          ],
          [
            'Saved fake/alice.ipynb',
            {
              type: 'saved',
              slots: ['fake/alice.ipynb']
            }
          ],
          ['1 of 1', { type: 'progress', slots: [1, 1] }],
          ['Finished! (roster: 1)', { type: 'success', slots: [1] }]
        ]);
      }
      if (id === 'correxit:redistribute') {
        return emit([
          ['------------', { type: 'separator', slots: [] }],
          [
            'Distributed alice@example.com',
            {
              type: 'distributed',
              slots: ['alice@example.com', 'fake/alice.ipynb']
            }
          ],
          ['1 of 1', { type: 'progress', slots: [1, 1] }],
          ['Finished retrying 1', { type: 'retried', slots: [1] }]
        ]);
      }
      return execute(id, args);
    };
  });

  await page.evaluate(() => {
    const app = (window as any).jupyterapp;
    return app.commands.execute('correxit:track');
  });

  const widget = page.locator('.correxit-propagator');
  await widget.waitFor({ state: 'visible', timeout: 12000 });
  const retry = widget.locator('.correxit-propagator-retry');
  await expect(retry).toHaveText('Retry 1 failed');
  await retry.click();
  await expect(widget.locator('pre')).toContainText('Finished retrying 1');
  await expect(widget.locator('pre')).toContainText(
    'Distributed alice@example.com'
  );
  await expect(retry).toHaveCount(0);

  await page.evaluate(() => {
    (window as any).__correxitRestore?.();
    delete (window as any).__correxitRestore;
  });
  await dispose();
});

test('propagate with overwrite false distributes all on first run', async ({
  page
}) => {
  const { dispose } = await setup(page, [{ id: 'cell', source: 'x = 1' }]);

  const result = await page.evaluate(async keys => {
    const { Rubric, Workbook } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const panel = app.shell.currentWidget;

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
    }))(Rubric.create());
    rubric.assignment.keys.private.author = keys.private.author;
    rubric.assignment.keys.public.author = keys.public.author;
    await Workbook.update(panel, rubric);
    await app.commands.execute('correxit:assign', {
      roster: ['alice@example.com', 'bob@example.com']
    });

    const stream = await app.commands.execute('correxit:propagate', {
      overwrite: false
    });
    const types: string[] = [];
    const saved: string[] = [];
    let directory: string | null = null;
    for await (const [, emission] of stream) {
      types.push(emission.type);
      if (emission.type === 'saved') saved.push(emission.slots[0] as string);
      if (emission.type === 'mkdir') directory = emission.slots[0] as string;
    }

    const contents = app.serviceManager.contents;
    for (const path of saved) await contents.delete(path).catch(() => {});
    if (directory) await contents.delete(directory).catch(() => {});

    return { types };
  }, keys);

  expect(result.types).not.toContain('skipped');
  expect(result.types.filter(t => t === 'distributed')).toHaveLength(2);
  expect(result.types).toContain('success');

  await cd(page, '.');
  await dispose();
});
