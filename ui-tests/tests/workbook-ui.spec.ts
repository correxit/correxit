import { expect, test } from '@jupyterlab/galata';
import { setup } from './utils';

test.use({ autoGoto: false });

test('audits and dereferences orphaned references', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'keep', source: 'answer' },
    { id: 'cell', source: 'compare' }
  ]);

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
        id: 'cell',
        is: 'correctable',
        points: 2,
        references: ['keep', 'gone'],
        payload: null
      },
      [
        { cell: 'cell', referent: 'keep', points: 1, secret: true },
        { cell: 'cell', referent: 'gone', points: 1, secret: true }
      ]
    );

    const audit = Workbook.audit(workbook, rubric);
    const cell = audit.ok ? Rubric.get(audit.rubric, 'cell') : null;
    return {
      ok: audit.ok,
      points: cell?.points ?? null,
      present: audit.ok ? Rubric.has(audit.rubric, 'cell') : null,
      references: cell?.references ?? null,
      refCount: audit.ok ? Object.keys(audit.rubric.references).length : null
    };
  });

  expect(result.ok).toBe(true);
  expect(result.present).toBe(true);
  expect(result.points).toBe(1);
  expect(result.references).toEqual(['keep']);
  expect(result.refCount).toBe(1);
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

test('unlock keeps the manual roster plaintext in the sidebar', async ({
  page
}) => {
  const assignee = 'student@example.com';
  const { dispose } = await setup(page, [{ id: 'cell', source: 'print(42)' }]);

  await page.evaluate(async (assignee: string) => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const panel = app.shell.currentWidget as any;

    const base = (r => ({
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
    const rubric = await Rubric.assign(base, {
      assignee,
      roster: [assignee]
    });
    await Workbook.update(panel, rubric);
    await Workbook.lock(panel);
    await Workbook.unlock(panel, rubric.key);
  }, assignee);

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const { Workbook } = (window as any).__correxit__;
        const app = (window as any).jupyterapp;
        const panel = app.shell.currentWidget as any;
        const rubric = Workbook.open(panel, true);
        return rubric?.assignment.roster ?? null;
      })
    )
    .toEqual([assignee]);

  await expect
    .poll(async () =>
      page.evaluate(() =>
        Array.from(
          document.querySelectorAll(
            'select[name="correxit-assignment-assignee"] option'
          )
        ).map(option => (option as HTMLOptionElement).value)
      )
    )
    .toEqual(['', assignee]);

  await expect
    .poll(async () => page.locator('.correxit-sidebar').textContent())
    .not.toContain('ENC[');

  await dispose();
});

test('dropping registrar keeps assigned roster details', async ({ page }) => {
  const assignee = 'student@example.com';
  const id = 'course:assignment';
  const name = 'Assignment 1';
  const read = () =>
    page.evaluate(() => {
      const { Workbook } = (window as any).__correxit__;
      const app = (window as any).jupyterapp;
      const panel = app.shell.currentWidget as any;
      const rubric = Workbook.open(panel, true);
      const { assignment } = rubric || ({} as any);
      return assignment
        ? {
            assignee: assignment.assignee,
            id: assignment.id,
            name: assignment.name,
            roster: assignment.roster
          }
        : null;
    });
  let file: string | null = null;

  try {
    await page.goto();
    await page.evaluate(() => {
      const context = window as any;
      const app = context.jupyterapp;
      context.__correxit_execute = app.commands.execute.bind(app.commands);
      context.__correxit_date = Date.now.bind(Date);
      context.__correxit_now = context.__correxit_date();
      context.__correxit_enroll = null;
      app.commands.execute = (...args: any[]) =>
        args[0] === 'correxit:enroll'
          ? Promise.resolve(context.__correxit_enroll)
          : context.__correxit_execute(...args);
    });

    file = await page.notebook.createNew();
    expect(file).toBeTruthy();
    await page.evaluate(
      ({ assignee, id, name }) => {
        const context = window as any;
        const app = context.jupyterapp;
        const panel = app.shell.currentWidget as any;
        const notebook = panel.context.model.sharedModel;
        while (notebook.cells.length) notebook.deleteCell(0);
        notebook.insertCell(0, {
          cell_type: 'code',
          id: 'cell',
          metadata: {},
          source: 'print(42)'
        });
        context.__correxit_enroll = [
          { expiration: null, id, name, roster: [assignee] }
        ];
      },
      { assignee, id, name }
    );

    await page.evaluate(async () => {
      const { Workbook, Rubric } = (window as any).__correxit__;
      const app = (window as any).jupyterapp;
      const panel = app.shell.currentWidget as any;
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
      await Workbook.update(panel, rubric);
    });

    await expect
      .poll(read)
      .toEqual({ assignee: '', id, name, roster: [assignee] });

    await page.evaluate(async () => {
      const context = window as any;
      const app = context.jupyterapp;
      context.__correxit_now += 20_000;
      Date.now = () => context.__correxit_now;
      context.__correxit_enroll = null;

      const clear = await app.commands.execute('correxit:inject');
      clear(null);
    });

    await expect
      .poll(async () =>
        page.evaluate(
          () => document.querySelector('.correxit-sidebar')?.textContent || ''
        )
      )
      .toContain('Correxit: idle');

    await page.evaluate(async () => {
      const app = (window as any).jupyterapp;
      const panel = app.shell.currentWidget as any;
      const restore = await app.commands.execute('correxit:inject');
      restore(panel);
    });

    await expect
      .poll(read)
      .toEqual({ assignee: '', id, name, roster: [assignee] });

    await page.getByRole('tab', { name: 'Correxit' }).click();
    await expect
      .poll(async () =>
        page.evaluate(() =>
          Array.from(
            document.querySelectorAll(
              'select[name="correxit-assignment-assignee"] option'
            )
          ).map(option => (option as HTMLOptionElement).value)
        )
      )
      .toEqual(['', assignee]);
  } finally {
    await page
      .evaluate(() => {
        const context = window as any;
        const app = context.jupyterapp;
        if (context.__correxit_date) Date.now = context.__correxit_date;
        if (context.__correxit_execute)
          app.commands.execute = context.__correxit_execute;
        delete context.__correxit_date;
        delete context.__correxit_enroll;
        delete context.__correxit_execute;
        delete context.__correxit_now;
      })
      .catch(() => {});
    if (!file) return;
    await page.notebook.close(true).catch(() => {});
    await page.contents.deleteFile(file).catch(() => {});
  }
});

test('keeps configured cell badges when connectors are active', async ({
  page
}) => {
  const { dispose } = await setup(page, [
    { id: 'source', source: 'source' },
    { id: 'target', source: 'target' }
  ]);

  await page.evaluate(async () => {
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
        id: 'source',
        is: 'comparable',
        points: 1,
        references: ['target'],
        payload: null
      },
      [{ cell: 'source', referent: 'target', points: 1, secret: true }]
    );
    await Workbook.update(workbook, rubric);
  });

  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          !!document.querySelector(
            '.jp-Cell.cxt-cell-source.cxt-mod-comparable'
          )
      )
    )
    .toBe(true);

  await page.locator('.jp-Cell').nth(1).click();

  await expect
    .poll(async () =>
      page.evaluate(() =>
        Array.from(
          document.querySelector('.jp-Notebook')?.classList || []
        ).some(name => name.startsWith('cxt-scope-'))
      )
    )
    .toBe(true);

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const cell = document.querySelector('.jp-Cell.cxt-cell-source');
        if (!cell) return false;

        return getComputedStyle(cell, '::after').width !== '0px';
      })
    )
    .toBe(true);

  await dispose();
});

test('draws connectors through inert cells between endpoints', async ({
  page
}) => {
  const { dispose } = await setup(page, [
    { id: 'source', source: 'source' },
    { id: 'note', source: 'Expected output', type: 'markdown' },
    { id: 'target', source: 'target' }
  ]);

  await page.evaluate(async () => {
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
        id: 'source',
        is: 'comparable',
        points: 1,
        references: ['target'],
        payload: null
      },
      [{ cell: 'source', referent: 'target', points: 1, secret: true }]
    );
    await Workbook.update(workbook, rubric);
  });

  await page.locator('.jp-Cell').nth(2).click();

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const cell = document.querySelectorAll('.jp-Cell')[1];
        return cell
          ? getComputedStyle(cell, '::before').width !== '0px'
          : false;
      })
    )
    .toBe(true);

  await dispose();
});

test('locks cleanly when the last referent cell is missing', async ({
  page
}) => {
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

    // Delete the referent cell exactly as a user might (index 0 is 'ref').
    const notebook = panel.context.model.sharedModel;
    notebook.deleteCell(0);

    const error = await (async () => {
      try {
        await Workbook.lock(workbook);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : `${error}`;
      }
    })();

    const audited = Workbook.open(workbook);
    return {
      error,
      present: Rubric.has(audited, 'cell')
    };
  });

  expect(result.error).toBeNull();
  expect(result.present).toBe(false);
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

test('revise rejects tampered sealed cells', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'a', source: 'x = 1' },
    { id: 'b', source: 'y = 2' }
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
    let rubric = Rubric.add(converted, {
      id: 'a',
      is: 'reviewable',
      points: 1,
      references: null,
      payload: null
    });
    rubric = Rubric.add(rubric, {
      id: 'b',
      is: 'reviewable',
      points: 1,
      references: null,
      payload: null
    });
    await Workbook.update(workbook, rubric);
    await Workbook.assign(workbook, {
      assignee: 'student@example.com',
      roster: ['student@example.com']
    });
    await Workbook.lock(workbook);
    const locked = Workbook.open(workbook);
    const author = locked.assignment.keys.public.author;
    await Workbook.submit(workbook, [author]);

    const notebook = panel.context.model.sharedModel;
    notebook.cells[0].setSource('tampered');

    try {
      await Workbook.revise(workbook, 'unused');
      return { message: null };
    } catch (error) {
      return { message: `${error}` };
    }
  });

  expect(result.message).toContain('seal mismatch');
  await dispose();
});

// ---------------------------------------------------------------------------
// Recovery tests
// ---------------------------------------------------------------------------

test('recovers encrypted cells after metadata corruption', async ({ page }) => {
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

test('recovery drops sealed payloads bound to the wrong cell', async ({
  page
}) => {
  const { dispose } = await setup(page, [
    { id: 'a', source: 'x = 1' },
    { id: 'b', source: 'y = 2' }
  ]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const workbook = { content: panel.content, context: panel.context };
    const passphrase = 'secret';
    const unlocker = {
      store: async () => {},
      unlock: async () => null
    };
    const converted = await Workbook.convert(workbook, passphrase, unlocker);
    let rubric = Rubric.add(converted, {
      id: 'a',
      is: 'reviewable',
      points: 1,
      references: null,
      payload: null
    });
    rubric = Rubric.add(rubric, {
      id: 'b',
      is: 'reviewable',
      points: 1,
      references: null,
      payload: null
    });
    await Workbook.update(workbook, rubric);
    await Workbook.assign(workbook, {
      assignee: 'student@example.com',
      roster: ['student@example.com']
    });
    await Workbook.lock(workbook);

    const locked = Workbook.open(workbook);
    const author = locked.assignment.keys.public.author;
    await Workbook.submit(workbook, [author]);

    const notebook = panel.context.model.sharedModel;
    const first = notebook.cells[0].getSource();
    const second = notebook.cells[1].getSource();
    notebook.cells[0].setSource(second);
    notebook.cells[1].setSource(first);

    const metadata = notebook.getMetadata('correxit');
    notebook.setMetadata('correxit', {
      id: metadata.id,
      assignment: {
        keys: metadata.assignment.keys,
        assignee: 'student@example.com'
      }
    });

    const fresh = { content: panel.content, context: panel.context };
    const count = await Workbook.recover(fresh, passphrase);
    return {
      count,
      sources: [notebook.cells[0].getSource(), notebook.cells[1].getSource()],
      types: [notebook.cells[0].cell_type, notebook.cells[1].cell_type]
    };
  });

  expect(result.count).toBe(0);
  expect(result.types).toEqual(['raw', 'raw']);
  expect(result.sources[0]).not.toBe('x = 1');
  expect(result.sources[1]).not.toBe('y = 2');
  await dispose();
});
