import { expect, test } from './fixtures';
import { setup, shutdown } from './utils';

test.use({ autoGoto: false });

// Keep real commands and cryptography; pause just the first save at a chosen boundary.
namespace Saves {
  export async function initialize(
    page: any,
    assignment: Record<string, unknown> = {}
  ) {
    await page.evaluate(async (assignment: Record<string, unknown>) => {
      const { Workbook, Rubric } = (window as any).__correxit__;
      const rubric = Rubric.create();
      await Workbook.update(
        (window as any).jupyterapp.shell.currentWidget,
        await Rubric.assign(
          {
            ...rubric,
            key: 'secret',
            assignment: {
              ...rubric.assignment,
              keys: {
                private: { assignee: null, author: 'priv' },
                public: { assignee: null, author: 'pub' }
              }
            }
          },
          assignment
        )
      );
    }, assignment);
  }

  export async function pause(page: any, mode = 'command') {
    await page.evaluate((mode: string) => {
      const context = window as any;
      const { Rubric } = context.__correxit__;
      const { commands } = context.jupyterapp;
      const save = (context.__correxit_save = {
        execute: commands.execute.bind(commands),
        prepare: Rubric.assign,
        encrypt: Rubric.lock,
        calls: 0,
        started: false,
        written: false,
        finished: 0,
        errors: [] as string[],
        timeout: window.setTimeout,
        timer: null as number | null,
        release: null as (() => void) | null
      });
      const wait = () => new Promise<void>(resolve => (save.release = resolve));
      const crypto = mode === 'signing' || mode === 'encryption';
      if (mode === 'debounce') {
        window.setTimeout = ((
          callback: (...args: any[]) => void,
          delay: number,
          ...args: any[]
        ) => {
          if (delay !== 150)
            return save.timeout.call(window, callback, delay, ...args);
          save.timer = save.timeout.call(window, () => {}, 60000);
          save.release = () => {
            window.setTimeout = save.timeout;
            window.clearTimeout(save.timer!);
            callback(...args);
          };
          return save.timer;
        }) as typeof window.setTimeout;
      }
      if (crypto) {
        const method = mode === 'signing' ? 'assign' : 'lock';
        const original = Rubric[method];
        Rubric[method] = async (...args: any[]) => {
          const first = !save.started;
          save.started = true;
          const result = await original(...args);
          if (first) await wait();
          return result;
        };
      }
      commands.execute = async (...args: any[]) => {
        if (args[0] !== 'correxit:assign') return save.execute(...args);
        save.calls++;
        try {
          if (crypto || mode === 'debounce' || save.started)
            return await save.execute(...args);
          save.started = true;
          if (mode === 'receipt') {
            const result = await save.execute(...args);
            save.written = true;
            await wait();
            return result;
          }
          await wait();
          if (mode === 'rejection') throw new Error('Assignment save rejected');
          return await save.execute(...args);
        } catch (error) {
          save.errors.push(String(error));
          throw error;
        } finally {
          save.finished++;
        }
      };
    }, mode);
  }

  export async function restore(page: any) {
    await page
      .evaluate(() => {
        const context = window as any;
        const save = context.__correxit_save;
        if (!save) return;
        save.release?.();
        window.setTimeout = save.timeout;
        if (save.timer !== null) window.clearTimeout(save.timer);
        context.jupyterapp.commands.execute = save.execute;
        context.__correxit__.Rubric.assign = save.prepare;
        context.__correxit__.Rubric.lock = save.encrypt;
        delete context.__correxit_save;
      })
      .catch(() => {});
  }
}

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
  const roster = ['alice@example.com', 'bob@example.com'];
  const { dispose } = await setup(page, [{ id: 'cell', source: 'print(42)' }]);
  try {
    await Saves.initialize(page, { roster });
    await page.getByRole('tab', { name: 'Correxit' }).click();
    const area = page.getByRole('textbox', { name: 'Roster', exact: true });
    await expect(area).toHaveValue(roster.join('\n'));
    await page.evaluate(async () => {
      const { Workbook } = (window as any).__correxit__;
      await Workbook.lock((window as any).jupyterapp.shell.currentWidget);
    });
    // Let the mounted editor observe the encrypted roster before unlocking.
    await expect(page.locator('.correxit-assignment-assignee')).toContainText(
      'Template - unassigned'
    );
    await expect(area).toHaveCount(0);
    await Saves.pause(page);
    await page.evaluate(async () => {
      const { Workbook } = (window as any).__correxit__;
      await Workbook.unlock(
        (window as any).jupyterapp.shell.currentWidget,
        'secret'
      );
    });
    await expect(area).toHaveValue(roster.join('\n'));
    await expect(
      page.locator('select[name="correxit-assignment-assignee"] option')
    ).toHaveText([/Template - unassigned/, ...roster]);
    // Unlocking must not schedule a roster edit after the debounce period.
    await page.waitForTimeout(400);
    const result = await page.evaluate(async () => {
      const { Workbook, Rubric } = (window as any).__correxit__;
      const panel = (window as any).jupyterapp.shell.currentWidget;
      const stored = await Rubric.unlock(
        panel.context.model.sharedModel.getMetadata('correxit'),
        'secret'
      );
      return {
        calls: (window as any).__correxit_save.calls,
        rosters: [
          Workbook.open(panel).assignment.roster,
          stored.assignment.roster
        ]
      };
    });
    expect(result).toEqual({ calls: 0, rosters: [roster, roster] });
  } finally {
    await Saves.restore(page);
    await dispose();
  }
});

test('manual roster editing updates assignee choices live', async ({
  page
}) => {
  const read = () =>
    page.evaluate(() => {
      const { Workbook } = (window as any).__correxit__;
      const app = (window as any).jupyterapp;
      const panel = app.shell.currentWidget as any;
      const rubric = Workbook.open(panel, true);
      return rubric
        ? {
            assignee: rubric.assignment.assignee,
            roster: rubric.assignment.roster
          }
        : null;
    });
  const { dispose } = await setup(page, [{ id: 'cell', source: 'print(42)' }]);

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

  await page.getByRole('tab', { name: 'Correxit' }).click();

  const area = page.locator('textarea[name="correxit-assignment-roster"]');
  await expect(area).toBeVisible();
  await area.fill(
    ' alice@example.com \n bob@example.com \n alice@example.com '
  );

  await expect.poll(read).toEqual({
    assignee: '',
    roster: ['alice@example.com', 'bob@example.com']
  });

  await page.selectOption(
    'select[name="correxit-assignment-assignee"]',
    'bob@example.com'
  );

  await expect.poll(read).toEqual({
    assignee: 'bob@example.com',
    roster: ['alice@example.com', 'bob@example.com']
  });

  await area.fill('alice@example.com');

  await expect.poll(read).toEqual({
    assignee: '',
    roster: ['alice@example.com']
  });
  await expect
    .poll(async () =>
      page.locator('select[name="correxit-assignment-assignee"]').inputValue()
    )
    .toBe('');

  await dispose();
});

[
  'typing',
  'clearing',
  'rejection',
  'external',
  'receipt',
  'signing',
  'encryption'
].forEach(mode => {
  test(`manual roster ${mode} handles an earlier assignment save`, async ({
    page
  }) => {
    const { dispose } = await setup(page, [
      { id: 'cell', source: 'print(42)' }
    ]);
    const errors: string[] = [];
    page.on('console', message => {
      if (/Maximum update depth|Too many re-renders/.test(message.text()))
        errors.push(message.text());
    });
    page.on('pageerror', error => errors.push(error.message));
    const body = page.locator('body');
    const typing = ['typing', 'external', 'signing'].includes(mode);
    const external = ['external', 'receipt', 'signing', 'encryption'].includes(
      mode
    );
    const completed = mode === 'receipt' || mode === 'encryption';

    try {
      await Saves.initialize(page);
      await Saves.pause(page, mode);

      await page.getByRole('tab', { name: 'Correxit' }).click();
      const area = page.getByRole('textbox', { name: 'Roster', exact: true });
      await expect(area).toBeVisible();
      await area.fill('alice@example.com');
      await page.waitForFunction(() => (window as any).__correxit_save.started);
      if (mode === 'receipt') {
        await page.waitForFunction(
          () => (window as any).__correxit_save.written
        );
      }

      if (typing) {
        await area.press('End');
        await area.press('Enter');
        await area.pressSequentially(' bob@example.com ', { delay: 20 });
        await area.press('Enter');
      } else if (mode === 'clearing') await area.fill('');
      const value = typing
        ? 'alice@example.com\n bob@example.com \n'
        : mode === 'clearing'
          ? ''
          : 'alice@example.com';
      await expect(area).toHaveValue(value);
      if (external) {
        await body.evaluate(async () => {
          await (window as any).__correxit_save.execute('correxit:assign', {
            name: 'Updated assignment',
            expiration: 1_900_000_000_000,
            resources: ['data.csv']
          });
        });
        await expect(page.locator('.correxit-assignment-facts')).toContainText(
          'Updated assignment'
        );
        await expect(area).toHaveValue(value);
      }
      // Give another debounce time to expire while the first save is blocked.
      await page.waitForTimeout(300);
      expect(
        await body.evaluate(() => (window as any).__correxit_save.calls)
      ).toBe(1);
      await body.evaluate(() => (window as any).__correxit_save.release());
      await page.waitForFunction(
        () => (window as any).__correxit_save.finished
      );
      await expect(area).toHaveValue(value);
      if (mode === 'rejection') {
        // A failed save must settle without silently retrying the same draft.
        await page.waitForTimeout(300);
        expect(
          await body.evaluate(() => (window as any).__correxit_save.calls)
        ).toBe(1);
        await area.fill('bob@example.com');
      }
      await expect
        .poll(() =>
          body.evaluate(() => {
            const context = window as any;
            return context.__correxit__.Workbook.open(
              context.jupyterapp.shell.currentWidget,
              true
            ).assignment.roster;
          })
        )
        .toEqual(
          typing
            ? ['alice@example.com', 'bob@example.com']
            : mode === 'clearing'
              ? []
              : completed
                ? ['alice@example.com']
                : ['bob@example.com']
        );
      await area.blur();
      await expect(area).toHaveValue(
        typing
          ? 'alice@example.com\nbob@example.com'
          : mode === 'clearing'
            ? ''
            : completed
              ? 'alice@example.com'
              : 'bob@example.com'
      );
      await page.waitForTimeout(300);
      expect(
        await body.evaluate(() => (window as any).__correxit_save.calls)
      ).toBe(completed ? 1 : 2);
      if (external) {
        await expect(page.locator('.correxit-assignment-facts')).toContainText(
          'Updated assignment'
        );
        const assignment = await body.evaluate(() => {
          const context = window as any;
          const { assignment } = context.__correxit__.Workbook.open(
            context.jupyterapp.shell.currentWidget,
            true
          );
          return {
            name: assignment.name,
            expiration: assignment.expiration,
            resources: assignment.resources
          };
        });
        expect(assignment).toEqual({
          name: 'Updated assignment',
          expiration: 1_900_000_000_000,
          resources: ['data.csv']
        });
        const stored = await body.evaluate(() => {
          const { assignment } = (
            window as any
          ).jupyterapp.shell.currentWidget.context.model.sharedModel.getMetadata(
            'correxit'
          );
          return {
            name: assignment.name,
            expiration: assignment.expiration,
            resources: assignment.resources
          };
        });
        expect(stored).toEqual(assignment);
      }
      await body.evaluate(async () => {
        await (window as any).jupyterapp.commands.execute('correxit:assign', {
          roster: ['carol@example.com']
        });
      });
      await expect(area).toHaveValue('carol@example.com');
      expect(errors).toEqual([]);
    } finally {
      await Saves.restore(page);
      await dispose();
    }
  });
});

for (const { mode, edit, assigned, timing } of [
  ['encryption', 'none'],
  ['receipt', 'none'],
  ['encryption', 'blur'],
  ['receipt', 'blur'],
  ['encryption', 'reversion'],
  ['receipt', 'reversion'],
  ['signing', 'reversion'],
  ['encryption', 'deadline'],
  ['encryption', 'assignee'],
  ['receipt', 'assignee'],
  ['encryption', 'assignee', 'before'],
  ['receipt', 'assignee', 'before'],
  ['encryption', 'normalized'],
  ['receipt', 'normalized']
].flatMap(([mode, edit, timing = 'after']) =>
  (edit === 'assignee' || edit === 'normalized' ? [true] : [false, true]).map(
    assigned => ({
      mode,
      edit,
      assigned,
      timing
    })
  )
)) {
  test(`roster${assigned ? ' and assignee' : ''} conflict during ${mode} with queued edit: ${edit}${edit === 'assignee' ? ` ${timing} conflict` : ''}`, async ({
    page
  }) => {
    const { dispose } = await setup(page, [
      { id: 'cell', source: 'print(42)' }
    ]);
    const original = ['carol@example.com'];
    const roster =
      edit === 'reversion' || edit === 'normalized'
        ? original
        : ['bob@example.com'];
    const calls = edit === 'none' || edit === 'blur' ? 1 : 2;
    const assignee =
      edit === 'normalized'
        ? original[0]
        : assigned && edit !== 'reversion' && edit !== 'assignee'
          ? 'bob@example.com'
          : '';
    try {
      await Saves.initialize(page, {
        roster: original,
        assignee: edit === 'normalized' ? original[0] : ''
      });
      await Saves.pause(page, mode);
      await page.getByRole('tab', { name: 'Correxit' }).click();
      const area = page.getByRole('textbox', { name: 'Roster', exact: true });
      const select = page.locator(
        'select[name="correxit-assignment-assignee"]'
      );
      await area.fill(
        edit === 'blur'
          ? ' alice@example.com \n\nalice@example.com\n'
          : 'alice@example.com'
      );
      await page.waitForFunction(
        () => !!(window as any).__correxit_save.release
      );
      const revert = async () => {
        // Explicitly returning to the original unassigned value is still an edit.
        await select.selectOption('alice@example.com');
        await select.selectOption('');
      };
      if (edit === 'assignee' && timing === 'before') await revert();
      if (edit === 'reversion') await area.fill(original.join('\n'));
      if (edit === 'normalized') {
        await area.fill(original.join('\n'));
        await select.selectOption('');
        await select.selectOption(original[0]);
      }
      const deadline = page.locator(
        'input[name="correxit-assignment-expiration"]'
      );
      const before = await page.evaluate(async (assigned: boolean) => {
        const {
          __correxit_save: save,
          __correxit__: { Workbook },
          jupyterapp: app
        } = window as any;
        await save.execute('correxit:assign', {
          roster: ['bob@example.com'],
          assignee: assigned ? 'bob@example.com' : ''
        });
        return Workbook.open(app.shell.currentWidget).assignment.roster;
      }, assigned);
      expect(before).toEqual(['bob@example.com']);
      await expect(select).toHaveValue(
        edit === 'normalized' ? original[0] : ''
      );
      if (edit === 'blur') {
        await area.blur();
        await expect(area).toHaveValue('alice@example.com');
      }
      if (edit === 'assignee' && timing === 'after') await revert();
      if (edit === 'deadline') await deadline.fill('2030-01-01T12:00');
      const expiration = await deadline.evaluate((input: HTMLInputElement) =>
        input.value ? new Date(input.value).getTime() : null
      );
      await page.evaluate(() => (window as any).__correxit_save.release());
      await page.waitForFunction(
        (calls: number) => (window as any).__correxit_save.finished >= calls,
        calls
      );
      // A completed save must not silently resubmit a superseded roster.
      await page.waitForTimeout(400);
      const result = await page.evaluate(async () => {
        const {
          __correxit_save: save,
          __correxit__: { Workbook, Rubric },
          jupyterapp: app
        } = window as any;
        const panel = app.shell.currentWidget;
        const stored = await Rubric.unlock(
          panel.context.model.sharedModel.getMetadata('correxit'),
          'secret'
        );
        return {
          calls: save.calls,
          assignments: [Workbook.open(panel), stored].map(
            ({ assignment: { assignee, roster, expiration } }: any) => ({
              assignee,
              roster,
              expiration
            })
          )
        };
      });
      expect(result).toEqual({
        calls,
        assignments: Array(2).fill({ assignee, roster, expiration })
      });
      await expect(area).toHaveValue(roster.join('\n'));
      if (edit === 'assignee') {
        // Completed edits must not keep overriding subsequent assignments.
        await page.evaluate(async () => {
          await (window as any).__correxit_save.execute('correxit:assign', {
            assignee: 'bob@example.com'
          });
        });
        await expect(select).toHaveValue('bob@example.com');
        await page.waitForTimeout(400);
        expect(
          await page.evaluate(() => (window as any).__correxit_save.calls)
        ).toBe(calls);
      }
    } finally {
      await Saves.restore(page);
      await dispose();
    }
  });
}

for (const { mode, release } of ['debounce', 'signing'].flatMap(mode =>
  ['locked', 'unlocked'].map(release => ({ mode, release }))
)) {
  test(`inactive roster ${mode} resumes while ${release} across a lock cycle`, async ({
    page
  }) => {
    const { dispose } = await setup(page, [
      { id: 'cell', source: 'print(42)' }
    ]);
    try {
      await Saves.initialize(page, { roster: ['carol@example.com'] });
      await page.getByRole('tab', { name: 'Correxit' }).click();
      const area = page.getByRole('textbox', { name: 'Roster', exact: true });
      await expect(area).toHaveValue('carol@example.com');
      await Saves.pause(page, mode);
      await page.evaluate(() => {
        (window as any).__correxit_save.first = (
          window as any
        ).jupyterapp.shell.currentWidget;
      });
      await area.fill('alice@example.com');
      await page.evaluate(
        () =>
          new Promise(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
      );
      await area.blur();
      await expect(area).toHaveValue('alice@example.com');
      await page.waitForFunction(
        () => !!(window as any).__correxit_save.release
      );
      await page.evaluate(async () => {
        const { jupyterapp: app, __correxit_save: held } = window as any;
        await app.commands.execute('docmanager:clone');
        held.second = app.shell.currentWidget;
      });
      await expect(area).toHaveValue('carol@example.com');
      expect(
        await page.evaluate(async () => {
          const {
            __correxit__: { Workbook },
            __correxit_save: held
          } = window as any;
          await Workbook.lock(held.second);
          return (
            held.second !== held.first && Workbook.open(held.second).locked
          );
        })
      ).toBe(true);
      if (release === 'locked') {
        await page.evaluate(() => (window as any).__correxit_save.release());
        if (mode === 'signing')
          await page.waitForFunction(
            () => (window as any).__correxit_save.finished === 1
          );
      }
      await page.evaluate(async () => {
        const {
          __correxit__: { Workbook },
          __correxit_save: held
        } = window as any;
        await Workbook.unlock(held.second, 'secret');
      });
      if (release === 'unlocked') {
        await page.evaluate(() => (window as any).__correxit_save.release());
        if (mode === 'signing')
          await page.waitForFunction(
            () => (window as any).__correxit_save.finished === 1
          );
      }
      const before = await page.evaluate(async () => {
        const {
          jupyterapp: app,
          __correxit__: { Workbook },
          __correxit_save: held
        } = window as any;
        const roster = Workbook.open(app.shell.currentWidget).assignment.roster;
        app.shell.activateById(held.first.id);
        return roster;
      });
      expect(before).toEqual(['carol@example.com']);
      await expect(area).toHaveValue('carol@example.com');
      await page.waitForTimeout(400);
      const after = await page.evaluate(async () => {
        const {
          jupyterapp: app,
          __correxit__: { Workbook, Rubric },
          __correxit_save: held
        } = window as any;
        const panel = app.shell.currentWidget;
        const stored = await Rubric.unlock(
          panel.context.model.sharedModel.getMetadata('correxit'),
          'secret'
        );
        return {
          calls: held.calls,
          errors: held.errors,
          original: panel === held.first,
          rosters: [
            Workbook.open(panel).assignment.roster,
            stored.assignment.roster
          ]
        };
      });
      expect(after).toEqual({
        calls: mode === 'signing' ? 1 : 0,
        errors:
          mode === 'signing' ? [expect.stringContaining('assign error')] : [],
        original: true,
        rosters: Array(2).fill(['carol@example.com'])
      });
    } finally {
      await Saves.restore(page);
      await page.notebook.close(true).catch(() => {});
      await dispose();
    }
  });
}

for (const owner of ['view', 'sidebar']) {
  test(`disposing the ${owner} cancels its queued assignment draft`, async ({
    page
  }) => {
    const { dispose } = await setup(page, [
      { id: 'cell', source: 'print(42)' }
    ]);
    try {
      await Saves.initialize(page, { roster: ['alice@example.com'] });
      await page.getByRole('tab', { name: 'Correxit' }).click();
      const area = page.getByRole('textbox', { name: 'Roster', exact: true });
      await expect(area).toHaveValue('alice@example.com');
      await Saves.pause(page, 'debounce');
      await area.fill('bob@example.com');
      await page.waitForFunction(
        () => !!(window as any).__correxit_save.release
      );
      await page.evaluate((owner: string) => {
        const { jupyterapp: app, __correxit_save: held } = window as any;
        const widget =
          owner === 'view'
            ? app.shell.currentWidget
            : ['left', 'right']
                .flatMap(area => Array.from(app.shell.widgets(area)))
                .find((widget: any) => widget.hasClass('correxit-sidebar'));
        if (!widget) throw new Error('Draft owner not found');
        (widget as any).dispose();
        held.release();
      }, owner);
      await page.waitForTimeout(400);
      expect(
        await page.evaluate(() => (window as any).__correxit_save.calls)
      ).toBe(0);
    } finally {
      await Saves.restore(page);
      await dispose();
    }
  });
}

test('manual roster saves in a second view without repeatedly assigning', async ({
  page
}) => {
  const { dispose } = await setup(page, [{ id: 'cell', source: 'print(42)' }]);
  try {
    await Saves.initialize(page);
    const shared = await page.evaluate(async () => {
      const {
        jupyterapp: app,
        __correxit__: { Workbook }
      } = window as any;
      const first = app.shell.currentWidget;
      await app.commands.execute('docmanager:clone');
      const second = app.shell.currentWidget;
      await Workbook.unlock(second, 'secret');
      return first !== second && first.context === second.context;
    });
    expect(shared).toBe(true);
    await Saves.pause(page);
    await page.getByRole('tab', { name: 'Correxit' }).click();
    const area = page.getByRole('textbox', { name: 'Roster', exact: true });
    await area.fill('alice@example.com');
    await page.waitForFunction(() => !!(window as any).__correxit_save.release);
    await page.evaluate(() => (window as any).__correxit_save.release());
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const {
            jupyterapp: app,
            __correxit__: { Workbook, Rubric }
          } = window as any;
          const panel = app.shell.currentWidget;
          const stored = await Rubric.unlock(
            panel.context.model.sharedModel.getMetadata('correxit'),
            'secret'
          );
          return [
            Workbook.open(panel).assignment.roster,
            stored.assignment.roster
          ];
        })
      )
      .toEqual([['alice@example.com'], ['alice@example.com']]);
    // More than one debounce period must not start another save.
    await page.waitForTimeout(400);
    expect(
      await page.evaluate(() => (window as any).__correxit_save.calls)
    ).toBe(1);
    await expect(area).toHaveValue('alice@example.com');
  } finally {
    await Saves.restore(page);
    await page.notebook.close(true).catch(() => {});
    await dispose();
  }
});

for (const mode of ['signing', 'encryption']) {
  test(`assignment saves preserve changes across views during ${mode}`, async ({
    page
  }) => {
    const { dispose } = await setup(page, [
      { id: 'cell', source: 'print(42)' }
    ]);
    try {
      await Saves.initialize(page);
      const shared = await page.evaluate(async () => {
        const {
          jupyterapp: app,
          __correxit__: { Workbook }
        } = window as any;
        const first = app.shell.currentWidget;
        await app.commands.execute('docmanager:clone');
        const second = app.shell.currentWidget;
        await Workbook.update(second, Workbook.open(first));
        return first !== second && first.context === second.context;
      });
      expect(shared).toBe(true);
      await Saves.pause(page, mode);
      await page.evaluate(() => {
        const { jupyterapp: app, __correxit_save: save } = window as any;
        const second = app.shell.currentWidget;
        const first = Array.from(app.shell.widgets('main')).find(
          (panel: any) => panel !== second && panel.context === second.context
        ) as any;
        save.pending = app.commands.execute('correxit:assign', {
          name: 'From first',
          path: first.context.path,
          view: first.content.id
        });
      });
      await page.waitForFunction(
        () => !!(window as any).__correxit_save.release
      );
      const result = await page.evaluate(async () => {
        const {
          jupyterapp: app,
          __correxit_save: save,
          __correxit__: { Workbook, Rubric }
        } = window as any;
        const second = app.shell.currentWidget;
        await app.commands.execute('correxit:assign', {
          resources: ['new.csv'],
          path: second.context.path,
          view: second.content.id
        });
        save.release();
        await save.pending;
        const stored = await Rubric.unlock(
          second.context.model.sharedModel.getMetadata('correxit'),
          'secret'
        );
        const views = Array.from(app.shell.widgets('main')).filter(
          (panel: any) => panel.context === second.context
        );
        return [...views.map(panel => Workbook.open(panel)), stored].map(
          ({ assignment: { name, resources } }: any) => ({ name, resources })
        );
      });
      expect(result).toEqual(
        Array(3).fill({ name: 'From first', resources: ['new.csv'] })
      );
    } finally {
      await Saves.restore(page);
      await page.notebook.close(true).catch(() => {});
      await dispose();
    }
  });
}

for (const inactive of [false, true]) {
  test(`sidebar edits retain their ${inactive ? 'inactive' : 'active'} headless context`, async ({
    page
  }) => {
    const { dispose } = await setup(page, [
      { id: 'cell', source: 'print(42)' }
    ]);
    try {
      await Saves.initialize(page);
      const initial = await page.evaluate(async () => {
        const { Workbook } = (window as any).__correxit__;
        const app = (window as any).jupyterapp;
        const panel = app.shell.currentWidget;
        await panel.context.save();
        const headless = await app.commands.execute('correxit:fetch', {
          path: panel.context.path
        });
        await Workbook.unlock(headless, 'secret');
        const held = ((window as any).__correxit_headless = {
          panel,
          headless,
          assign: Workbook.assign,
          target: null,
          args: null
        });
        Workbook.assign = async (workbook: any, args: any) => {
          held.target = workbook;
          held.args = args;
          return held.assign(workbook, args);
        };
        const inject = await app.commands.execute('correxit:inject');
        inject(headless);
        return {
          headless: Workbook.headless(headless),
          unlocked: !Workbook.open(headless).locked
        };
      });
      expect(initial).toEqual({ headless: true, unlocked: true });
      await page.getByRole('tab', { name: 'Correxit' }).click();
      await Saves.pause(page, 'debounce');
      await page
        .locator('input[name="correxit-assignment-expiration"]')
        .fill('2030-01-01T12:00');
      await page.waitForFunction(
        () => !!(window as any).__correxit_save.release
      );
      if (inactive) {
        await page.evaluate(async () => {
          const inject = await (window as any).jupyterapp.commands.execute(
            'correxit:inject'
          );
          inject(null);
        });
        await expect(page.locator('.correxit-sidebar')).toContainText(
          'Correxit: idle'
        );
      }
      await page.evaluate(() => (window as any).__correxit_save.release());
      await page.waitForFunction(
        () => (window as any).__correxit_save.finished === 1
      );
      const result = await page.evaluate(async () => {
        const held = (window as any).__correxit_headless;
        const { Workbook } = (window as any).__correxit__;
        const app = (window as any).jupyterapp;
        const same = held.target === held.headless;
        const expiration = Workbook.open(held.headless).assignment.expiration;
        const stored =
          held.headless.context.model.sharedModel.getMetadata('correxit')
            .assignment.expiration;
        const headed = Workbook.open(held.panel).assignment.expiration;
        const args = held.args;
        const error = await (window as any).__correxit_save
          .execute('correxit:assign', {
            path: held.headless.context.path,
            name: 'Path-only edit'
          })
          .then(
            () => null,
            (error: Error) => String(error)
          );
        const fetched =
          held.target !== held.headless && Workbook.open(held.target).locked;
        if (held.target !== held.headless) held.target.context.dispose();
        const unknown = await app.commands.execute('correxit:assign', {
          ...args,
          context: 'missing-context',
          name: 'Wrong'
        });
        held.headless.context.dispose();
        const disposed = await app.commands.execute('correxit:assign', {
          ...args,
          name: 'Wrong'
        });
        return {
          same,
          expiration,
          stored,
          headed,
          fetched,
          error,
          unknown,
          disposed,
          errors: (window as any).__correxit_save.errors
        };
      });
      expect(result).toEqual({
        same: true,
        expiration: expect.any(Number),
        stored: result.expiration,
        headed: null,
        fetched: true,
        error: expect.stringContaining('assign error'),
        unknown: null,
        disposed: null,
        errors: []
      });
    } finally {
      await Saves.restore(page);
      await page
        .evaluate(() => {
          const held = (window as any).__correxit_headless;
          if (!held) return;
          (window as any).__correxit__.Workbook.assign = held.assign;
          if (held.target && held.target !== held.headless)
            held.target.context.dispose();
          held.headless.context.dispose();
          delete (window as any).__correxit_headless;
        })
        .catch(() => {});
      await dispose();
    }
  });
}

for (const outcome of ['success', 'encryption failure', 'metadata failure']) {
  test(`matching assignment waits for persistence and retries failed writes: ${outcome}`, async ({
    page
  }) => {
    const { dispose } = await setup(page, [
      { id: 'cell', source: 'print(42)' }
    ]);
    try {
      await Saves.initialize(page, { name: 'Original' });
      await page.evaluate((outcome: string) => {
        const { Rubric, Workbook } = (window as any).__correxit__;
        const panel = (window as any).jupyterapp.shell.currentWidget;
        const notebook = panel.context.model.sharedModel;
        const held = ((window as any).__correxit_matching = {
          panel,
          assign: Rubric.assign,
          lock: Rubric.lock,
          write: notebook.setMetadata,
          first: true,
          signed: null,
          encrypted: null,
          finished: false
        });
        Rubric.assign = async (...args: any[]) => {
          const first = held.first;
          held.first = false;
          const value = await held.assign(...args);
          if (first)
            await new Promise<void>(resolve => {
              held.signed = resolve;
            });
          return value;
        };
        Rubric.lock = async (...args: any[]) => {
          const value = await held.lock(...args);
          await new Promise<void>(resolve => {
            held.encrypted = resolve;
          });
          if (outcome === 'encryption failure') throw new Error(outcome);
          return value;
        };
        notebook.setMetadata = (...args: any[]) => {
          if (outcome === 'metadata failure' && args[0] === 'correxit')
            throw new Error(outcome);
          return held.write.apply(notebook, args);
        };
        held.older = Workbook.assign(panel, { name: 'Changed' })
          .then(
            () => null,
            (error: Error) => error.message
          )
          .finally(() => {
            held.finished = true;
          });
      }, outcome);
      await page.waitForFunction(
        () => !!(window as any).__correxit_matching.signed
      );
      await page.evaluate(() => {
        const held = (window as any).__correxit_matching;
        held.newer = (window as any).__correxit__.Workbook.assign(held.panel, {
          name: 'Changed'
        }).then(
          () => null,
          (error: Error) => error.message
        );
      });
      await page.waitForFunction(
        () => !!(window as any).__correxit_matching.encrypted
      );
      const result = await page.evaluate(async () => {
        const held = (window as any).__correxit_matching;
        const { Workbook, Rubric } = (window as any).__correxit__;
        const notebook = held.panel.context.model.sharedModel;
        held.signed();
        await new Promise(resolve => setTimeout(resolve, 0));
        const finishedEarly = held.finished;
        held.encrypted();
        const errors = await Promise.all([held.older, held.newer]);
        const before = notebook.getMetadata('correxit').assignment.name;
        Rubric.lock = held.lock;
        notebook.setMetadata = held.write;
        const retried = await Workbook.assign(held.panel, { name: 'Changed' });
        return {
          finishedEarly,
          errors,
          before,
          retried: retried.assignment.name,
          stored: notebook.getMetadata('correxit').assignment.name
        };
      });
      expect(result).toEqual({
        finishedEarly: false,
        errors: outcome === 'success' ? [null, null] : [outcome, outcome],
        before: outcome === 'success' ? 'Changed' : 'Original',
        retried: 'Changed',
        stored: 'Changed'
      });
    } finally {
      await page
        .evaluate(async () => {
          const held = (window as any).__correxit_matching;
          if (!held) return;
          held.signed?.();
          held.encrypted?.();
          await Promise.allSettled([held.older, held.newer]);
          const { Rubric } = (window as any).__correxit__;
          Rubric.assign = held.assign;
          Rubric.lock = held.lock;
          held.panel.context.model.sharedModel.setMetadata = held.write;
          delete (window as any).__correxit_matching;
        })
        .catch(() => {});
      await dispose();
    }
  });
}

for (const { mode, reversion, named } of [
  'notebook',
  'clone',
  'untouched',
  'lock'
].flatMap(mode =>
  [false, true].flatMap(reversion =>
    [false, true].map(named => ({ mode, reversion, named }))
  )
)) {
  const scenario =
    mode === 'untouched'
      ? 'staying on an untouched clone'
      : mode === 'lock'
        ? 'locking and unlocking the active editor'
        : `returning from a ${mode}`;
  test(`${scenario} ${mode === 'lock' ? 'discards' : 'preserves'} its pending ${named ? 'name-only' : 'registered'} assignment${reversion ? ' reversion' : ''}`, async ({
    page
  }) => {
    const { dispose } = await setup(page, [
      { id: 'cell', source: 'print(42)' }
    ]);
    const registrations = ['A', 'B'].map(id => ({
      id: named ? null : id,
      name: `Assignment ${id}`,
      expiration: null,
      roster: [`${id.toLowerCase()}@example.com`]
    }));
    const [a, b] = registrations.map(({ id, name }) => id || name);
    try {
      await page.evaluate(registrations => {
        const app = (window as any).jupyterapp;
        const held = ((window as any).__correxit_registration = {
          panel: app.shell.currentWidget,
          execute: app.commands.execute.bind(app.commands),
          calls: [],
          clone: null
        });
        app.commands.execute = (id: string, args: any) => {
          if (id === 'correxit:enroll') return Promise.resolve(registrations);
          if (id === 'correxit:assign') held.calls.push(args.name);
          return held.execute(id, args);
        };
      }, registrations);
      await Saves.initialize(page, registrations[0]);
      await page.getByRole('tab', { name: 'Correxit' }).click();
      const choices = page.locator('.correxit-assignment select').filter({
        has: page.locator(`option[value="${b}"]`)
      });
      await expect(choices).toHaveValue(a);
      if (mode === 'clone' || mode === 'untouched') {
        await page.evaluate(async () => {
          const { jupyterapp: app, __correxit_registration: held } =
            window as any;
          await app.commands.execute('docmanager:clone');
          held.clone = app.shell.currentWidget;
        });
        await expect(choices).toHaveValue(a);
        await page.evaluate(() => {
          const { jupyterapp: app, __correxit_registration: held } =
            window as any;
          app.shell.activateById(held.panel.id);
        });
      }
      await Saves.pause(
        page,
        mode === 'lock' || mode === 'untouched' ? 'signing' : 'command'
      );
      await choices.selectOption(b);
      await page.waitForFunction(
        () => !!(window as any).__correxit_save.release
      );
      if (reversion) {
        await choices.selectOption('');
        await expect(choices).toHaveValue('');
        await expect(page.locator('.correxit-assignment-facts')).toContainText(
          'No assignment'
        );
        await choices.selectOption(a);
      }
      if (mode === 'clone' || mode === 'untouched') {
        await page.evaluate(() => {
          const { jupyterapp: app, __correxit_registration: held } =
            window as any;
          app.shell.activateById(held.clone.id);
        });
        await expect(choices).toHaveValue(a);
        if (mode === 'clone') {
          // The outgoing clone must not dictate the returning view's selection.
          if (reversion) {
            await choices.selectOption(b);
            await page.waitForFunction(
              () => (window as any).__correxit_save.finished === 1
            );
          }
          await page.evaluate(() => {
            const { jupyterapp: app, __correxit_registration: held } =
              window as any;
            app.shell.activateById(held.panel.id);
          });
        }
      } else if (mode === 'lock') {
        await page.evaluate(async () => {
          const {
            __correxit__: { Workbook },
            __correxit_registration: held
          } = window as any;
          await Workbook.lock(held.panel);
        });
        await expect(page.locator('.correxit-assignment-facts')).toContainText(
          'Assignment A'
        );
        await page.evaluate(async () => {
          const {
            __correxit__: { Workbook },
            __correxit_registration: held
          } = window as any;
          await Workbook.unlock(held.panel, 'secret');
        });
      } else {
        await page.evaluate(async () => {
          const inject = await (window as any).jupyterapp.commands.execute(
            'correxit:inject'
          );
          inject(null);
        });
        await expect(page.locator('.correxit-sidebar')).toContainText(
          'Correxit: idle'
        );
        await page.evaluate(async () => {
          const { jupyterapp: app, __correxit_registration: held } =
            window as any;
          const inject = await app.commands.execute('correxit:inject');
          inject(held.panel);
        });
      }
      const calls =
        mode === 'lock'
          ? ['B']
          : reversion
            ? mode === 'clone'
              ? ['B', 'B', 'A']
              : ['B', 'A']
            : ['B'];
      const expected = registrations[reversion || mode === 'lock' ? 0 : 1];
      await expect(choices).toHaveValue(
        reversion || mode === 'lock' || mode === 'untouched' ? a : b
      );
      await page.evaluate(() => (window as any).__correxit_save.release());
      await expect
        .poll(() =>
          page.evaluate(() => (window as any).__correxit_save.finished)
        )
        .toBe(calls.length);
      // Staying on a clean clone or unlocking must not queue a selection write.
      await page.waitForTimeout(400);
      const result = await page.evaluate(async () => {
        const {
          __correxit_registration: held,
          __correxit__: { Workbook, Rubric }
        } = window as any;
        const fields = ({ expiration, id, name, roster }: any) => ({
          expiration,
          id,
          name,
          roster
        });
        const stored = await Rubric.unlock(
          held.panel.context.model.sharedModel.getMetadata('correxit'),
          'secret'
        );
        return {
          calls: held.calls,
          errors: (window as any).__correxit_save.errors,
          cached: fields(Workbook.open(held.panel).assignment),
          stored: fields(stored.assignment)
        };
      });
      expect(result).toEqual({
        calls: calls.map(id => `Assignment ${id}`),
        errors:
          mode === 'lock'
            ? [expect.stringContaining('assign error: workbook changed')]
            : [],
        cached: expected,
        stored: expected
      });
      await expect(choices).toHaveValue(reversion || mode === 'lock' ? a : b);
    } finally {
      await Saves.restore(page);
      await page
        .evaluate(() => {
          const held = (window as any).__correxit_registration;
          if (!held) return;
          (window as any).jupyterapp.commands.execute = held.execute;
          held.clone?.dispose();
          delete (window as any).__correxit_registration;
        })
        .catch(() => {});
      await dispose();
    }
  });
}

for (const { named, expiration } of [false, true].flatMap(named =>
  [null, 1800000000000].map(expiration => ({ named, expiration }))
)) {
  test(`explicit ${named ? 'name-only' : 'registered'} selection preserves its full registration during competing saves: deadline=${expiration}`, async ({
    page
  }) => {
    const { dispose } = await setup(page, [
      { id: 'cell', source: 'print(42)' }
    ]);
    const registrations = ['A', 'B', 'C'].map(id => ({
      id: named ? null : id,
      name: `Assignment ${id}`,
      expiration: id === 'C' ? 1900000000000 : expiration,
      roster: id === 'C' ? ['carol@example.com'] : ['alice@example.com']
    }));
    const [a, b, c] = registrations.map(({ id, name }) => id || name);
    try {
      await page.evaluate(registrations => {
        const app = (window as any).jupyterapp;
        const held = ((window as any).__correxit_registration = {
          panel: app.shell.currentWidget,
          execute: app.commands.execute.bind(app.commands),
          clone: null
        });
        app.commands.execute = (id: string, args: any) =>
          id === 'correxit:enroll'
            ? Promise.resolve(registrations)
            : held.execute(id, args);
      }, registrations);
      await Saves.initialize(page, registrations[0]);
      await page.getByRole('tab', { name: 'Correxit' }).click();
      const choices = page.locator('#correxit-assignment-registration');
      await expect(choices).toHaveValue(a);
      await page.evaluate(async () => {
        const { jupyterapp: app, __correxit_registration: held } =
          window as any;
        await app.commands.execute('docmanager:clone');
        held.clone = app.shell.currentWidget;
      });
      await expect(choices).toHaveValue(a);
      await page.evaluate(() => {
        const { jupyterapp: app, __correxit_registration: held } =
          window as any;
        app.shell.activateById(held.panel.id);
      });
      await Saves.pause(page, 'signing');
      await choices.selectOption(b);
      await page.waitForFunction(
        () => !!(window as any).__correxit_save.release
      );
      await page.evaluate(() => {
        const { jupyterapp: app, __correxit_registration: held } =
          window as any;
        app.shell.activateById(held.clone.id);
      });
      await expect(choices).toHaveValue(a);
      await choices.selectOption(c);
      await page.waitForFunction(
        () => (window as any).__correxit_save.finished === 1
      );
      // B must rebase its complete selection over C, including unchanged fields.
      await page.evaluate(() => (window as any).__correxit_save.release());
      await page.waitForFunction(
        () => (window as any).__correxit_save.finished === 2
      );
      await expect(choices).toHaveValue(b);
      await page.waitForTimeout(400);
      const result = await page.evaluate(async () => {
        const {
          __correxit_registration: held,
          __correxit_save: save,
          __correxit__: { Workbook, Rubric }
        } = window as any;
        const fields = ({
          expiration,
          id,
          name,
          roster,
          overdue,
          penalty
        }: any) => ({ expiration, id, name, roster, overdue, penalty });
        const stored = await Rubric.unlock(
          held.panel.context.model.sharedModel.getMetadata('correxit'),
          'secret'
        );
        return {
          calls: save.calls,
          errors: save.errors,
          cached: fields(Workbook.open(held.panel).assignment),
          stored: fields(stored.assignment)
        };
      });
      const expected = { ...registrations[1], overdue: null, penalty: null };
      expect(result).toEqual({
        calls: 2,
        errors: [],
        cached: expected,
        stored: expected
      });
    } finally {
      await Saves.restore(page);
      await page
        .evaluate(() => {
          const held = (window as any).__correxit_registration;
          if (!held) return;
          (window as any).jupyterapp.commands.execute = held.execute;
          held.clone?.dispose();
          delete (window as any).__correxit_registration;
        })
        .catch(() => {});
      await dispose();
    }
  });
}

for (const { field, retry } of ['roster', 'assignee'].flatMap(field =>
  [false, true].map(retry => ({ field, retry }))
)) {
  test(`rejected save with a queued ${field} reversion waits for ${retry ? 'explicit retry' : 'new input'}`, async ({
    page
  }) => {
    const { dispose } = await setup(page, [
      { id: 'cell', source: 'print(42)' }
    ]);
    const roster = ['alice@example.com', 'bob@example.com'];
    try {
      await Saves.initialize(page, { roster, assignee: roster[0] });
      await Saves.pause(page, 'debounce');
      await page.getByRole('tab', { name: 'Correxit' }).click();
      const area = page.getByRole('textbox', { name: 'Roster', exact: true });
      const assignee = page.locator(
        'select[name="correxit-assignment-assignee"]'
      );
      if (field === 'roster') {
        await area.fill(roster[0]);
        await area.fill(roster.join('\n'));
        await page
          .locator('input[name="correxit-assignment-expiration"]')
          .fill('2030-01-01T12:00');
      } else {
        await assignee.selectOption(roster[1]);
        await assignee.selectOption(roster[0]);
        await area.fill(roster[0]);
      }
      expect(
        await page.evaluate(() => (window as any).__correxit_save.calls)
      ).toBe(0);
      await page.evaluate(() => {
        (window as any).__correxit__.Rubric.assign = async () => {
          throw new Error('Assignment save rejected');
        };
        (window as any).__correxit_save.release();
      });
      await page.waitForFunction(
        () => (window as any).__correxit_save.finished >= 1
      );
      await page.waitForTimeout(400);
      expect(
        await page.evaluate(() => (window as any).__correxit_save.calls)
      ).toBe(1);
      await expect(area).toHaveValue(
        field === 'roster' ? roster.join('\n') : roster[0]
      );
      await expect(assignee).toHaveValue(roster[0]);
      const notice = page.getByRole('status').filter({
        hasText: 'Assignment changes could not be saved.'
      });
      await expect(notice).toBeVisible();
      // Retry or new input can resume the retained draft after failure is removed.
      await page.evaluate(() => {
        (window as any).__correxit__.Rubric.assign = (
          window as any
        ).__correxit_save.prepare;
      });
      const next = retry
        ? field === 'roster'
          ? roster
          : [roster[0]]
        : [...roster, 'carol@example.com'];
      if (retry)
        await notice
          .getByRole('button', { name: 'Retry', exact: true })
          .click();
      else await area.fill(next.join('\n'));
      await page.waitForFunction(
        () => (window as any).__correxit_save.finished >= 2
      );
      await expect(notice).toHaveCount(0);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const context = window as any;
            return context.__correxit__.Workbook.open(
              context.jupyterapp.shell.currentWidget,
              true
            ).assignment.roster;
          })
        )
        .toEqual(next);
      expect(
        await page.evaluate(() => (window as any).__correxit_save.calls)
      ).toBe(2);
    } finally {
      await Saves.restore(page);
      await dispose();
    }
  });
}

for (const { failure, edit } of ['encryption', 'metadata'].flatMap(failure =>
  ['none', 'continued', 'reversion'].map(edit => ({ failure, edit }))
)) {
  test(`failed ${failure} writes retain ${edit === 'none' ? 'unchanged drafts' : edit === 'continued' ? 'newer edits' : 'queued reversions'} through competing updates`, async ({
    page
  }) => {
    const { dispose } = await setup(page, [
      { id: 'cell', source: 'print(42)' }
    ]);
    const roster = ['alice@example.com', 'bob@example.com'];
    const expected =
      edit === 'none'
        ? [roster[1]]
        : edit === 'continued'
          ? [roster[0]]
          : roster;
    const assigned = edit === 'none' ? '' : roster[0];
    try {
      await Saves.initialize(page, { roster, assignee: roster[0] });
      await Saves.pause(page, 'encryption');
      await page.evaluate(async (failure: string) => {
        const {
          jupyterapp: app,
          __correxit_save: held,
          __correxit__: { Rubric }
        } = window as any;
        held.panel = app.shell.currentWidget;
        await app.commands.execute('docmanager:clone');
        held.clone = app.shell.currentWidget;
        app.shell.activateById(held.panel.id);
        const notebook = held.panel.context.model.sharedModel;
        held.write = notebook.setMetadata;
        if (failure === 'metadata')
          notebook.setMetadata = (...args: any[]) => {
            if (args[0] === 'correxit')
              throw new Error('Metadata write failed');
            return held.write.apply(notebook, args);
          };
        const encrypt = Rubric.lock;
        Rubric.lock = async (...args: any[]) => {
          const result = await encrypt(...args);
          if (failure === 'encryption') throw new Error('Encryption failed');
          return result;
        };
      }, failure);
      await page.getByRole('tab', { name: 'Correxit' }).click();
      const area = page.getByRole('textbox', { name: 'Roster', exact: true });
      const assignee = page.locator(
        'select[name="correxit-assignment-assignee"]'
      );
      await expect(area).toHaveValue(roster.join('\n'));
      await area.fill(roster[1]);
      await page.waitForFunction(
        () => !!(window as any).__correxit_save.release
      );
      if (edit !== 'none') {
        await area.fill(expected.join('\n'));
        await assignee.selectOption(assigned);
      }
      await page.evaluate(() => (window as any).__correxit_save.release());
      const attempts = edit === 'none' ? 1 : 2;
      await page.waitForFunction(
        (attempts: number) =>
          (window as any).__correxit_save.finished >= attempts,
        attempts
      );
      await page.waitForTimeout(400);
      const failed = await page.evaluate(async () => {
        const {
          __correxit_save: held,
          __correxit__: { Rubric }
        } = window as any;
        const stored = await Rubric.unlock(
          held.panel.context.model.sharedModel.getMetadata('correxit'),
          'secret'
        );
        return {
          calls: held.calls,
          errors: held.errors.length,
          roster: stored.assignment.roster
        };
      });
      expect(failed).toEqual({ calls: attempts, errors: attempts, roster });
      await expect(area).toHaveValue(expected.join('\n'));
      await expect(assignee).toHaveValue(assigned);

      // A successful competing write must not acknowledge this failed draft.
      await page.evaluate(async () => {
        const {
          __correxit_save: held,
          __correxit__: { Rubric }
        } = window as any;
        held.panel.context.model.sharedModel.setMetadata = held.write;
        Rubric.lock = held.encrypt;
        await held.execute('correxit:assign', {
          roster: ['carol@example.com'],
          assignee: 'carol@example.com',
          name: 'Competing',
          path: held.clone.context.path,
          view: held.clone.content.id
        });
      });
      await expect(area).toHaveValue(expected.join('\n'));
      await expect(assignee).toHaveValue(assigned);
      await expect(page.locator('.correxit-assignment-facts')).toContainText(
        'Competing'
      );
      await area.fill(`${expected.join('\n')}\n`);
      await area.blur();
      await page.waitForTimeout(400);
      expect(
        await page.evaluate(() => (window as any).__correxit_save.calls)
      ).toBe(attempts);

      // An unrelated new edit retries the retained fields, including reversions.
      await page
        .locator('input[name="correxit-assignment-expiration"]')
        .fill('2030-01-01T12:00');
      await page.waitForFunction(
        (attempts: number) =>
          (window as any).__correxit_save.finished === attempts + 1,
        attempts
      );
      const saved = await page.evaluate(async () => {
        const {
          __correxit_save: held,
          __correxit__: { Rubric, Workbook }
        } = window as any;
        const stored = await Rubric.unlock(
          held.panel.context.model.sharedModel.getMetadata('correxit'),
          'secret'
        );
        return [Workbook.open(held.panel), stored].map(
          ({ assignment }: any) => ({
            roster: assignment.roster,
            assignee: assignment.assignee,
            name: assignment.name
          })
        );
      });
      expect(saved).toEqual(
        Array(2).fill({
          roster: expected,
          assignee: assigned,
          name: 'Competing'
        })
      );
      // Success releases the retained intent so later updates can be adopted.
      await page.evaluate(async () => {
        const { __correxit_save: held } = window as any;
        await held.execute('correxit:assign', {
          roster: ['dave@example.com'],
          assignee: 'dave@example.com',
          path: held.clone.context.path,
          view: held.clone.content.id
        });
      });
      await expect(area).toHaveValue('dave@example.com');
      await expect(assignee).toHaveValue('dave@example.com');
      await page.waitForTimeout(400);
      expect(
        await page.evaluate(() => (window as any).__correxit_save.calls)
      ).toBe(attempts + 1);
    } finally {
      await page
        .evaluate(() => {
          const held = (window as any).__correxit_save;
          if (held?.write)
            held.panel.context.model.sharedModel.setMetadata = held.write;
          held?.clone?.dispose();
        })
        .catch(() => {});
      await Saves.restore(page);
      await dispose();
    }
  });
}

test('manual roster normalization retries after an assignee changes during signing', async ({
  page
}) => {
  const { dispose } = await setup(page, [{ id: 'cell', source: 'print(42)' }]);
  const body = page.locator('body');

  try {
    await Saves.initialize(page, {
      assignee: 'alice@example.com',
      roster: ['alice@example.com', 'bob@example.com']
    });
    await Saves.pause(page, 'signing');

    await page.getByRole('tab', { name: 'Correxit' }).click();
    const area = page.getByRole('textbox', { name: 'Roster', exact: true });
    const assignee = page.locator(
      'select[name="correxit-assignment-assignee"]'
    );
    await expect(assignee).toHaveValue('alice@example.com');
    await area.fill('alice@example.com');
    await page.waitForFunction(() => !!(window as any).__correxit_save.release);

    await body.evaluate(async () => {
      await (window as any).__correxit_save.execute('correxit:assign', {
        assignee: 'bob@example.com'
      });
    });
    // Observe the normalized draft before the roster-only save is rebased.
    await expect(assignee).toHaveValue('');
    await expect(area).toHaveValue('alice@example.com');
    await body.evaluate(() => (window as any).__correxit_save.release());

    const expected = { assignee: '', roster: ['alice@example.com'] };
    await expect
      .poll(() =>
        body.evaluate(() => {
          const context = window as any;
          const { assignment } = context.__correxit__.Workbook.open(
            context.jupyterapp.shell.currentWidget,
            true
          );
          return { assignee: assignment.assignee, roster: assignment.roster };
        })
      )
      .toEqual(expected);
    await page.waitForFunction(
      () => (window as any).__correxit_save.finished === 2
    );
    const stored = await body.evaluate(async () => {
      const context = window as any;
      const metadata =
        context.jupyterapp.shell.currentWidget.context.model.sharedModel.getMetadata(
          'correxit'
        );
      const { assignment } = await context.__correxit__.Rubric.unlock(
        metadata,
        'secret'
      );
      return { assignee: assignment.assignee, roster: assignment.roster };
    });
    expect(stored).toEqual(expected);
    expect(
      await body.evaluate(() => {
        const { calls, errors } = (window as any).__correxit_save;
        return { calls, errors };
      })
    ).toEqual({
      calls: 2,
      errors: [expect.stringContaining('assignee does not exist in roster')]
    });
    await expect(assignee).toHaveValue('');
    await expect(area).toHaveValue('alice@example.com');
  } finally {
    await Saves.restore(page);
    await dispose();
  }
});

['switching', 'returning', 'replacement'].forEach(mode => {
  test(`assignment ${mode} isolates an earlier save`, async ({ page }) => {
    const { dispose } = await setup(page, [
      { id: 'cell', source: 'print(42)' }
    ]);
    const body = page.locator('body');
    const first = await body.evaluate(
      () => (window as any).jupyterapp.shell.currentWidget.context.path
    );
    let second: string | null = null;
    try {
      await Saves.initialize(page);
      await Saves.pause(page);
      await page.getByRole('tab', { name: 'Correxit' }).click();
      const area = page.getByRole('textbox', { name: 'Roster', exact: true });
      await area.fill('alice@example.com');
      await page.waitForFunction(() => (window as any).__correxit_save.started);
      await area.fill('alice@example.com\nbob@example.com');
      await page.waitForTimeout(300);

      if (mode !== 'replacement') {
        const path: string = await body.evaluate(async () => {
          const app = (window as any).jupyterapp;
          const file = await app.serviceManager.contents.newUntitled({
            path: '.',
            type: 'notebook'
          });
          await app.commands.execute('docmanager:open', {
            path: file.path,
            kernel: { name: app.serviceManager.kernelspecs.specs.default }
          });
          return file.path;
        });
        second = path;
        await page.waitForFunction(
          (path: string) =>
            (window as any).jupyterapp.shell.currentWidget?.context?.path ===
            path,
          path
        );
        await body.evaluate(async () => {
          await (window as any).jupyterapp.shell.currentWidget.context.ready;
        });
      }
      await Saves.initialize(page, { roster: ['carol@example.com'] });
      await expect(area).toHaveValue('carol@example.com');
      if (mode === 'returning') {
        await body.evaluate(async (_: Element, path: string) => {
          await (window as any).jupyterapp.commands.execute('docmanager:open', {
            path
          });
        }, first);
        await expect(area).toHaveValue('alice@example.com\nbob@example.com');
      }
      await body.evaluate(() => (window as any).__correxit_save.release());
      await page.waitForFunction(
        () => (window as any).__correxit_save.finished
      );
      await expect
        .poll(() =>
          body.evaluate((_: Element, path: string) => {
            const context = window as any;
            const panel = Array.from(
              context.jupyterapp.shell.widgets('main')
            ).find((panel: any) => panel.context?.path === path);
            return context.__correxit__.Workbook.open(panel, true).assignment
              .roster;
          }, first)
        )
        .toEqual(
          mode === 'replacement'
            ? ['carol@example.com']
            : ['alice@example.com', 'bob@example.com']
        );
      await expect(area).toHaveValue(
        mode === 'returning'
          ? 'alice@example.com\nbob@example.com'
          : 'carol@example.com'
      );
    } finally {
      await Saves.restore(page);
      if (second) {
        await body
          .evaluate(async (_: Element, path: string) => {
            await (window as any).jupyterapp.commands.execute(
              'docmanager:open',
              {
                path
              }
            );
          }, second)
          .catch(() => {});
        await page.notebook.close(true).catch(() => {});
        await page.contents.deleteFile(second).catch(() => {});
        await body
          .evaluate(async (_: Element, path: string) => {
            await (window as any).jupyterapp.commands.execute(
              'docmanager:open',
              { path }
            );
          }, first)
          .catch(() => {});
      }
      await dispose();
    }
  });
});

for (const { mode, save, reversion } of ['penalty', 'policy'].flatMap(mode =>
  ['signing', 'encryption', 'receipt'].map(save => ({
    mode,
    save,
    reversion: save !== 'signing'
  }))
)) {
  test(`manual overdue ${mode}${reversion ? ' reversion' : ''} stays paired during ${save}`, async ({
    page
  }) => {
    const { dispose } = await setup(page, [
      { id: 'cell', source: 'print(42)' }
    ]);
    const body = page.locator('body');
    const expected =
      mode === 'penalty'
        ? { overdue: 'dock', penalty: reversion ? 10 : 20 }
        : { overdue: reversion ? 'accept' : 'reject', penalty: null };

    try {
      await Saves.initialize(page, {
        expiration: 1_900_000_000_000,
        overdue: mode === 'penalty' ? 'dock' : 'accept',
        penalty: mode === 'penalty' ? 10 : null
      });
      await Saves.pause(page, save);

      await page.getByRole('tab', { name: 'Correxit' }).click();
      if (reversion) {
        await page
          .getByRole('textbox', { name: 'Roster', exact: true })
          .fill('alice@example.com');
        await page.waitForFunction(
          () => !!(window as any).__correxit_save.release
        );
      }
      const policy = page.getByRole('combobox', {
        name: 'Overdue',
        exact: true
      });
      const penalty = page.getByRole('spinbutton', {
        name: 'Penalty',
        exact: true
      });
      if (mode === 'penalty') await penalty.fill('20');
      else await policy.selectOption('reject');
      if (reversion) {
        if (mode === 'penalty') await penalty.fill('10');
        else await policy.selectOption('accept');
      }
      await page.waitForFunction(
        () => !!(window as any).__correxit_save.release
      );
      await body.evaluate(async (_: Element, mode: string) => {
        await (window as any).jupyterapp.commands.execute('correxit:assign', {
          name: 'Updated assignment',
          overdue: mode === 'penalty' ? 'accept' : 'dock',
          penalty: mode === 'penalty' ? null : 10
        });
      }, mode);
      await expect(policy).toHaveValue(expected.overdue);
      if (mode === 'penalty')
        await expect(penalty).toHaveValue(String(expected.penalty));
      else await expect(penalty).toBeHidden();
      await body.evaluate(() => (window as any).__correxit_save.release());

      await expect
        .poll(() =>
          body.evaluate(() => {
            const context = window as any;
            const panel = context.jupyterapp.shell.currentWidget;
            return [
              context.__correxit__.Workbook.open(panel, true).assignment,
              panel.context.model.sharedModel.getMetadata('correxit').assignment
            ].map(({ name, overdue, penalty }) => ({ name, overdue, penalty }));
          })
        )
        .toEqual([
          { name: 'Updated assignment', ...expected },
          { name: 'Updated assignment', ...expected }
        ]);
      expect(
        await page.evaluate(() => (window as any).__correxit_save.errors)
      ).toEqual([]);
    } finally {
      await Saves.restore(page);
      await dispose();
    }
  });
}

for (const { mode, policy } of [
  ...['command', 'encryption', 'receipt', 'debounce'].map(mode => ({
    mode,
    policy: true
  })),
  { mode: 'debounce', policy: false }
]) {
  test(`clearing a deadline keeps its late policy cleared during ${mode}${policy ? '' : ' when already applied'}`, async ({
    page
  }) => {
    const { dispose } = await setup(page, [
      { id: 'cell', source: 'print(42)' }
    ]);
    const calls = mode === 'debounce' ? 1 : 2;
    try {
      await Saves.initialize(page, { expiration: 1_900_000_000_000 });
      await Saves.pause(page, mode);
      await page.getByRole('tab', { name: 'Correxit' }).click();
      if (mode !== 'debounce') {
        await page
          .getByRole('textbox', { name: 'Roster', exact: true })
          .fill('alice@example.com');
        await page.waitForFunction(
          () => !!(window as any).__correxit_save.release
        );
      }
      const deadline = page.locator(
        'input[name="correxit-assignment-expiration"]'
      );
      await deadline.fill('');
      await page.waitForFunction(
        () => !!(window as any).__correxit_save.release
      );
      expect(
        await page.evaluate(() => (window as any).__correxit_save.calls)
      ).toBe(calls - 1);
      await page.evaluate(
        async ({ mode, policy }: { mode: string; policy: boolean }) => {
          // Also cover losing the stored deadline before the competing policy update.
          if (mode !== 'command')
            await (window as any).__correxit_save.execute('correxit:assign', {
              expiration: null
            });
          if (policy)
            await (window as any).__correxit_save.execute('correxit:assign', {
              overdue: 'dock',
              penalty: 10
            });
          (window as any).__correxit_save.release();
        },
        { mode, policy }
      );
      await page.waitForFunction(
        (calls: number) => (window as any).__correxit_save.finished >= calls,
        calls
      );
      const cleared = await page.evaluate(() => {
        const {
          __correxit__: { Workbook },
          jupyterapp: app
        } = window as any;
        const panel = app.shell.currentWidget;
        return [
          Workbook.open(panel),
          panel.context.model.sharedModel.getMetadata('correxit')
        ].map(({ assignment: { expiration, overdue, penalty } }: any) => ({
          expiration,
          overdue,
          penalty
        }));
      });
      expect(cleared).toEqual(
        Array(2).fill({ expiration: null, overdue: null, penalty: null })
      );
      await deadline.fill('2030-01-01T12:00');
      await expect(
        page.getByRole('combobox', { name: 'Overdue', exact: true })
      ).toHaveValue('accept');
      await page.waitForFunction(
        (calls: number) =>
          (window as any).__correxit_save.finished >= calls + 1,
        calls
      );
      const stored = await page.evaluate(() => {
        const panel = (window as any).jupyterapp.shell.currentWidget;
        const { expiration, overdue, penalty } =
          panel.context.model.sharedModel.getMetadata('correxit').assignment;
        return { expiration, overdue, penalty };
      });
      expect(stored).toEqual({
        expiration: expect.any(Number),
        overdue: null,
        penalty: null
      });
      // A completed reset must allow later policy edits without resubmitting it.
      await page.evaluate(async () => {
        await (window as any).__correxit_save.execute('correxit:assign', {
          overdue: 'dock',
          penalty: 10
        });
      });
      await expect(
        page.getByRole('combobox', { name: 'Overdue', exact: true })
      ).toHaveValue('dock');
      await page.waitForTimeout(400);
      expect(
        await page.evaluate(() => (window as any).__correxit_save.calls)
      ).toBe(calls + 1);
    } finally {
      await Saves.restore(page);
      await dispose();
    }
  });
}

test('manual overdue policy editing updates assignment metadata', async ({
  page
}) => {
  const { dispose } = await setup(page, [{ id: 'cell', source: 'print(42)' }]);

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

  await page.getByRole('tab', { name: 'Correxit' }).click();
  const deadline = page.locator('input[name="correxit-assignment-expiration"]');
  await expect(deadline).toBeVisible();
  await deadline.fill('2026-04-21T12:00');

  const overdue = page.locator('select[name="correxit-assignment-overdue"]');
  await expect(overdue).toBeVisible();
  await overdue.selectOption('dock');

  const penalty = page.locator('input[name="correxit-assignment-penalty"]');
  await expect(penalty).toBeVisible();

  await penalty.fill('1.9');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const { Workbook } = (window as any).__correxit__;
        const app = (window as any).jupyterapp;
        const panel = app.shell.currentWidget as any;
        const rubric = Workbook.open(panel, true);
        return rubric?.assignment.penalty ?? null;
      })
    )
    .toBe(10);

  await penalty.fill('25');

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const { Workbook } = (window as any).__correxit__;
        const app = (window as any).jupyterapp;
        const panel = app.shell.currentWidget as any;
        const rubric = Workbook.open(panel, true);
        return rubric
          ? {
              expiration: rubric.assignment.expiration !== null,
              overdue: rubric.assignment.overdue,
              penalty: rubric.assignment.penalty
            }
          : null;
      })
    )
    .toEqual({ expiration: true, overdue: 'dock', penalty: 25 });

  await deadline.fill('');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const { Workbook } = (window as any).__correxit__;
        const app = (window as any).jupyterapp;
        const panel = app.shell.currentWidget as any;
        const rubric = Workbook.open(panel, true);
        return rubric
          ? {
              expiration: rubric.assignment.expiration,
              overdue: rubric.assignment.overdue,
              penalty: rubric.assignment.penalty
            }
          : null;
      })
    )
    .toEqual({ expiration: null, overdue: null, penalty: null });

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
    if (file) {
      await page.notebook.close(true).catch(() => {});
      await page.contents.deleteFile(file).catch(() => {});
    }
    await shutdown(page);
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

test('rejects an overdue submission before sealing', async ({ page }) => {
  const { dispose } = await setup(page, [{ id: 'cell', source: 'print(42)' }]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const workbook = { content: panel.content, context: panel.context };

    const unlocker = {
      store: async () => {},
      unlock: async () => null
    };
    const converted = await Workbook.convert(workbook, 'secret', unlocker);

    const rubric = await Rubric.assign(
      Rubric.add(converted, {
        id: 'cell',
        is: 'reviewable',
        payload: null,
        points: 1,
        references: null
      }),
      {
        assignee: 'student@example.com',
        expiration: 1,
        overdue: 'reject',
        roster: ['student@example.com']
      }
    );
    await Workbook.update(workbook, rubric);
    await Workbook.lock(workbook);

    const now = Date.now;
    Date.now = () => 2;
    try {
      await Workbook.submit(workbook, ['pub']);
      return { error: null };
    } catch (error) {
      const opened = Workbook.open(workbook, true);
      return {
        error: String(error),
        frozen: panel.context.model.sharedModel.cells.map((cell: any) =>
          cell.getMetadata('editable')
        ),
        submission: opened?.assignment.submission ?? null
      };
    } finally {
      Date.now = now;
    }
  });

  expect(result.error).toContain('overdue rejected');
  expect(result.submission).toBeNull();
  expect(result.frozen).toEqual([undefined]);
  await dispose();
});

test('submit reuses the checked timestamp when reject is active', async ({
  page
}) => {
  const { dispose } = await setup(page, [{ id: 'cell', source: 'print(42)' }]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const workbook = { content: panel.content, context: panel.context };

    const unlocker = {
      store: async () => {},
      unlock: async () => null
    };
    const converted = await Workbook.convert(workbook, 'secret', unlocker);

    const rubric = await Rubric.assign(
      Rubric.add(converted, {
        id: 'cell',
        is: 'reviewable',
        payload: null,
        points: 1,
        references: null
      }),
      {
        assignee: 'student@example.com',
        expiration: 2000,
        overdue: 'reject',
        roster: ['student@example.com']
      }
    );
    await Workbook.update(workbook, rubric);
    await Workbook.lock(workbook);
    const locked = Workbook.open(workbook);
    const author = locked.assignment.keys.public.author;

    const checked = 1000;
    const late = 3000;
    let calls = 0;
    const now = Date.now;
    Date.now = () => (calls++ ? late : checked);
    try {
      const submitted = await Workbook.submit(workbook, [author]);
      const opened = Workbook.open(workbook, true);
      return {
        calls,
        checked,
        error: null,
        stored: opened?.assignment.submission ?? null,
        submission: submitted.assignment.submission
      };
    } catch (error) {
      return {
        calls,
        checked,
        error: String(error),
        stored: null,
        submission: null
      };
    } finally {
      Date.now = now;
    }
  });

  expect(result.error).toBeNull();
  expect(result.calls).toBeGreaterThan(1);
  expect(result.submission).toBe(result.checked);
  expect(result.stored).toBe(result.checked);
  await dispose();
});

test('certify docks a late workbook by penalty percentage', async ({
  page
}) => {
  const { dispose } = await setup(page, [{ id: 'cell', source: 'print(42)' }]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const workbook = { content: panel.content, context: panel.context };

    const base = await Rubric.assign(
      Rubric.add(
        (r => ({
          ...r,
          key: 'secret',
          contents: [{ id: 'cell', type: 'code', digest: null }],
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
          points: 10,
          references: null
        }
      ),
      {
        assignee: 'student@example.com',
        expiration: 1,
        overdue: 'dock',
        penalty: 25,
        roster: ['student@example.com']
      }
    );
    const report = {
      interventions: {
        cell: Rubric.Score.intervene('cell', {
          comment: '',
          points: 10,
          possible: 10
        })
      },
      kernel: null,
      scores: {}
    };
    const signed = await Rubric.sign(base, report);
    const submitted = {
      ...signed,
      assignment: { ...signed.assignment, submission: 2 }
    };
    await Workbook.update(workbook, submitted);

    const trans = { __: (message: string) => message } as any;
    const certified = await Workbook.certify(workbook, trans, true);
    const opened = Workbook.open(workbook, true);
    return {
      certification: opened?.assignment.certification !== null,
      locked: opened?.locked ?? null,
      points: certified.grade.score.points,
      possible: certified.grade.score.possible
    };
  });

  expect(result.locked).toBe(true);
  expect(result.certification).toBe(true);
  expect(result.points).toBe(7);
  expect(result.possible).toBe(10);
  await dispose();
});

test('unlock removes the old score report before recertification', async ({
  page
}) => {
  const { dispose } = await setup(page, [{ id: 'cell', source: 'print(42)' }]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const workbook = { content: panel.content, context: panel.context };
    const notebook = panel.context.model.sharedModel;
    const reports = () =>
      notebook.cells
        .filter((cell: any) => cell.id === 'correxit-workbook-certificate')
        .map((cell: any) => cell.getSource());

    const rubric = await Rubric.assign(
      Rubric.add(
        (r => ({
          ...r,
          key: 'secret',
          contents: [{ id: 'cell', type: 'code', digest: null }],
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
          points: 2,
          references: null
        }
      ),
      {
        assignee: 'student@example.com',
        roster: ['student@example.com']
      }
    );
    await Workbook.update(workbook, rubric);
    await Workbook.intervene(
      workbook,
      'cell',
      Rubric.Score.intervene('cell', {
        comment: 'Original feedback',
        points: 2,
        possible: 2
      })
    );

    const trans = { __: (message: string) => message } as any;
    await Workbook.certify(workbook, trans, true);
    const original = reports();

    await Workbook.unlock(workbook, 'secret');
    const cleared = reports();
    await Workbook.intervene(
      workbook,
      'cell',
      Rubric.Score.intervene('cell', {
        comment: 'Revised feedback',
        points: 1,
        possible: 2
      })
    );
    await Workbook.certify(workbook, trans, true);
    return { original, cleared, revised: reports() };
  });

  expect(result.original).toHaveLength(1);
  expect(result.original[0]).toContain('Original feedback');
  expect(result.original[0]).toContain('2 / 2');
  expect(result.cleared).toHaveLength(0);
  expect(result.revised).toHaveLength(1);
  expect(result.revised[0]).toContain('Revised feedback');
  expect(result.revised[0]).toContain('1 / 2');
  expect(result.revised[0]).not.toContain('Original feedback');
  await dispose();
});

test('certify rejects an overdue rejected workbook', async ({ page }) => {
  const { dispose } = await setup(page, [{ id: 'cell', source: 'print(42)' }]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const workbook = { content: panel.content, context: panel.context };

    const base = await Rubric.assign(
      Rubric.add(
        (r => ({
          ...r,
          key: 'secret',
          contents: [{ id: 'cell', type: 'code', digest: null }],
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
          points: 10,
          references: null
        }
      ),
      {
        assignee: 'student@example.com',
        expiration: 1,
        overdue: 'reject',
        roster: ['student@example.com']
      }
    );
    const report = {
      interventions: {
        cell: Rubric.Score.intervene('cell', {
          comment: '',
          points: 10,
          possible: 10
        })
      },
      kernel: null,
      scores: {}
    };
    const signed = await Rubric.sign(base, report);
    const submitted = {
      ...signed,
      assignment: { ...signed.assignment, submission: 2 }
    };
    await Workbook.update(workbook, submitted);

    const trans = { __: (message: string) => message } as any;
    try {
      await Workbook.certify(workbook, trans, true);
      return { error: null };
    } catch (error) {
      const opened = Workbook.open(workbook, true);
      return {
        certification: opened?.assignment.certification ?? null,
        error: String(error),
        locked: opened?.locked ?? null
      };
    }
  });

  expect(result.error).toContain('overdue rejected');
  expect(result.locked).toBe(false);
  expect(result.certification).toBeNull();
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

test('headed unlock rejects missing issued cells without writing decrypted answers', async ({
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

    const unlocker = {
      store: async () => {},
      unlock: async () => null
    };
    let rubric = await Workbook.convert(workbook, 'secret', unlocker);
    rubric = Rubric.add(rubric, {
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
    rubric = {
      ...rubric,
      contents: [
        { id: 'a', type: 'code', digest: null },
        { id: 'b', type: 'code', digest: null }
      ]
    };
    await Workbook.update(workbook, rubric);
    await Workbook.assign(workbook, {
      assignee: 'student@example.com',
      roster: ['student@example.com']
    });
    await Workbook.lock(workbook);

    const locked = Workbook.open(workbook);
    const author = locked.assignment.keys.public.author;
    const key = rubric.key;
    await Workbook.submit(workbook, [author]);

    const notebook = panel.context.model.sharedModel;
    notebook.deleteCell(1);

    const before = JSON.stringify(notebook.toJSON());
    let message = '';
    try {
      await Workbook.unlock(workbook, key);
    } catch (error) {
      message = String(error);
    }
    return {
      message,
      unchanged: before === JSON.stringify(notebook.toJSON()),
      locked: Workbook.open(workbook).locked
    };
  });

  expect(result.message).toContain('contents mismatch');
  expect(result.unchanged).toBe(true);
  expect(result.locked).toBe(true);
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
    // Clear the cached rubric before loading the damaged metadata.
    await Workbook.update(workbook, null);
    delete metadata.assignment.report;
    notebook.setMetadata('correxit', metadata);

    // open() should now fail.
    const broken = Workbook.open(workbook, true);

    // Recover with the original passphrase.
    const count = await Workbook.recover(workbook, passphrase);

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
    // Clear the cached rubric before loading the damaged metadata.
    await Workbook.update(workbook, null);
    delete metadata.assignment.report;
    notebook.setMetadata('correxit', metadata);

    // Try to recover with the wrong passphrase.
    const count = await Workbook.recover(workbook, 'wrong');

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
    // Clear the cached rubric before loading the damaged metadata.
    await Workbook.update(workbook, null);
    delete metadata.assignment.report;
    notebook.setMetadata('correxit', metadata);

    const count = await Workbook.recover(workbook, 'secret');

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
    // Clear the cached rubric before loading the damaged metadata.
    await Workbook.update(workbook, null);
    const id = metadata.id;
    const keys = metadata.assignment.keys;

    // Corrupt metadata: delete cells dict so normalize() throws,
    // but keep id and keys (realistic: git merge broke structure,
    // but keys survived).
    notebook.setMetadata('correxit', {
      id,
      assignment: { keys }
    });

    // Confirm open() fails.
    const broken = Workbook.open(workbook, true);

    // Recover: should unseal the PGP-encrypted cells.
    const count = await Workbook.recover(workbook, passphrase);

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
    // Clear the cached rubric before loading the damaged metadata.
    await Workbook.update(workbook, null);
    notebook.setMetadata('correxit', {
      id: metadata.id,
      assignment: {
        keys: metadata.assignment.keys,
        assignee: 'student@example.com'
      }
    });

    const count = await Workbook.recover(workbook, passphrase);
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
