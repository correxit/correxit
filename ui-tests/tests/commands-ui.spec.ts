import { expect, test } from './fixtures';
import { Cell, Fixture, notebook, setup } from './utils';

test.use({ autoGoto: false });

const ready = async (page: any) => {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const app = (window as any).jupyterapp;
          return {
            bridge: !!(window as any).__correxit__,
            convert:
              !!app?.commands?.hasCommand &&
              app.commands.hasCommand('correxit:convert'),
            launch:
              !!app?.commands?.hasCommand &&
              app.commands.hasCommand('correxit:launch')
          };
        }),
      { timeout: 30000 }
    )
    .toEqual({ bridge: true, convert: true, launch: true });
};

const prepare = async (page: any, cells: Cell[]): Promise<Fixture> => {
  const fixture = await setup(page, cells);
  await ready(page);
  return fixture;
};

test('commands are disabled without a workbook rubric', async ({ page }) => {
  const { dispose } = await prepare(page, [{ id: 'cell', source: 'x = 1' }]);

  const result = await page.evaluate(() => {
    const app = (window as any).jupyterapp;
    return {
      add: app.commands.isEnabled('correxit:configure', {
        id: 'cell',
        is: 'comparable'
      }),
      assign: app.commands.isEnabled('correxit:assign'),
      convert: app.commands.isEnabled('correxit:convert'),
      launch: app.commands.isEnabled('correxit:launch'),
      lock: app.commands.isEnabled('correxit:lock'),
      propagate: app.commands.isEnabled('correxit:propagate'),
      remove: app.commands.isEnabled('correxit:remove', { id: 'cell' }),
      toggle: app.commands.isEnabled('correxit:share', { id: 'cell' })
    };
  });

  expect(result.add).toBe(false);
  expect(result.assign).toBe(false);
  expect(result.convert).toBe(true);
  expect(result.launch).toBe(true);
  expect(result.lock).toBe(false);
  expect(result.propagate).toBe(false);
  expect(result.remove).toBe(false);
  expect(result.toggle).toBe(false);
  await dispose();
});

test('assignment saves target a view while path commands fetch headlessly', async ({
  page
}) => {
  const { dispose } = await prepare(page, [{ id: 'cell', source: 'x = 1' }]);

  try {
    const result = await page.evaluate(async () => {
      const { Correxit, Rubric, Workbook } = (window as any).__correxit__;
      const app = (window as any).jupyterapp;
      const panel = app.shell.currentWidget;
      const created = Rubric.create();
      await Workbook.update(panel, {
        ...created,
        key: 'secret',
        assignment: {
          ...created.assignment,
          keys: {
            private: { assignee: null, author: 'priv' },
            public: { assignee: null, author: 'pub' }
          }
        }
      });
      const path = panel.context.path;
      const view = panel.content.id;
      await panel.context.rename(`${path}.renamed.ipynb`);
      try {
        await app.commands.execute('correxit:assign', {
          view,
          path,
          rubric: created.id,
          name: 'Open'
        });
      } finally {
        await panel.context.rename(path);
      }
      const name = Workbook.open(panel).assignment.name;
      const missing = await app.commands.execute('correxit:assign', {
        view: 'closed-view',
        path,
        rubric: created.id,
        name: 'Wrong'
      });
      const stale = await app.commands.execute('correxit:assign', {
        view,
        rubric: 'replaced-rubric',
        name: 'Wrong'
      });
      await app.commands.execute('correxit:save');
      const grade = await app.commands.execute('correxit:correct', { path });

      const unlocker = await app.resolveRequiredService(Correxit.Unlocker);
      const previous = unlocker.unlock;
      const workbooks: any[] = [];
      unlocker.unlock = async (workbook: any, credentials: any) => {
        workbooks.push(workbook);
        return Workbook.unlock(workbook, credentials.key);
      };
      try {
        const assignment = await app.commands.execute('correxit:assign', {
          path,
          rubric: created.id,
          key: 'secret',
          name: 'Fetched'
        });
        return {
          name,
          missing,
          stale,
          fetched: assignment.name,
          resolved: grade.resolved,
          live: Workbook.open(panel).assignment.name,
          headless: workbooks.map(workbook => Workbook.headless(workbook))
        };
      } finally {
        unlocker.unlock = previous;
        workbooks.forEach(workbook => workbook.context.dispose());
      }
    });

    expect(result).toEqual({
      name: 'Open',
      missing: null,
      stale: null,
      fetched: 'Fetched',
      resolved: true,
      live: 'Open',
      headless: [true]
    });
  } finally {
    await dispose();
  }
});

for (const change of ['replacement', 'closure']) {
  test(`assignment rejects ${change} during view resolution`, async ({
    page
  }) => {
    const { dispose } = await prepare(page, [{ id: 'cell', source: 'x = 1' }]);
    try {
      const result = await page.evaluate(async (change: string) => {
        const { Rubric, Workbook } = (window as any).__correxit__;
        const app = (window as any).jupyterapp;
        const panel = app.shell.currentWidget;
        const created = Rubric.create();
        const original = {
          ...created,
          key: 'secret',
          assignment: {
            ...created.assignment,
            keys: {
              private: { assignee: null, author: 'priv' },
              public: { assignee: null, author: 'pub' }
            }
          }
        };
        await Workbook.update(panel, original);
        const pending = app.commands.execute('correxit:assign', {
          view: panel.content.id,
          path: panel.context.path,
          rubric: created.id,
          name: 'Stale edit'
        });
        // Change the target while the command awaits reification.
        if (change === 'closure') panel.dispose();
        else
          await Workbook.update(panel, { ...original, id: Rubric.create().id });
        return {
          result: await pending,
          name:
            change === 'closure' ? null : Workbook.open(panel).assignment.name
        };
      }, change);
      expect(result).toEqual({
        result: null,
        name: change === 'closure' ? null : ''
      });
    } finally {
      await dispose();
    }
  });
}

for (const { command, path } of [
  'certify',
  'collect',
  'draft',
  'intervene',
  'lock'
].flatMap(command =>
  (command === 'intervene' ? [false] : [false, true]).map(path => ({
    command,
    path
  }))
)) {
  test(`${command} saves its resolved ${path ? 'headless' : 'open'} workbook after switching tabs`, async ({
    page
  }) => {
    const { dispose } = await prepare(page, [
      { id: 'cell', source: 'print(42)' }
    ]);
    let second: string | null = null;
    try {
      await page.evaluate(async (command: string) => {
        const { Rubric, Workbook } = (window as any).__correxit__;
        const first = (window as any).jupyterapp.shell.currentWidget;
        const created = Rubric.create();
        const rubric = await Rubric.assign(
          Rubric.add(
            {
              ...created,
              key: 'secret',
              contents: [{ id: 'cell', type: 'code', digest: null }],
              assignment: {
                ...created.assignment,
                keys: {
                  private: { assignee: null, author: 'priv' },
                  public: { assignee: null, author: 'pub' }
                }
              }
            },
            {
              id: 'cell',
              is: 'reviewable',
              payload: null,
              points: 1,
              references: null
            }
          ),
          {
            assignee: 'student@example.com',
            roster: ['student@example.com']
          }
        );
        const signed = await Rubric.sign(rubric, {
          interventions: {
            cell: Rubric.Score.intervene('cell', {
              comment: '',
              points: 1,
              possible: 1
            })
          },
          kernel: null,
          scores: {}
        });
        await Workbook.update(
          first,
          command === 'draft'
            ? { ...signed, assignment: { ...signed.assignment, submission: 1 } }
            : signed
        );
        if (command === 'draft') await Workbook.lock(first);
        await first.context.save();
        (window as any).__correxit_followup = {
          first,
          original: Workbook[command],
          command,
          restores: [],
          target: null,
          release: null,
          done: null,
          finished: false,
          saves: [],
          clears: [],
          expected: null
        };
      }, command);
      second = await notebook(page);
      await page.evaluate(() => {
        const app = (window as any).jupyterapp;
        const record = (window as any).__correxit_followup;
        record.second = app.shell.currentWidget;
        app.shell.activateById(record.first.id);
      });
      await expect
        .poll(() =>
          page.evaluate(() =>
            (window as any).jupyterapp.commands.isEnabled('correxit:convert')
          )
        )
        .toBe(false);
      await page.evaluate(
        ({ command, path }: { command: string; path: boolean }) => {
          const { Rubric, Workbook } = (window as any).__correxit__;
          const app = (window as any).jupyterapp;
          const record = (window as any).__correxit_followup;
          const watch = (workbook: any, label: string) => {
            const context = workbook.context;
            const model = context.model.sharedModel;
            const save = context.save;
            const clear = model.clearUndoHistory;
            context.save = async () => {
              record.saves.push(label);
              return save.call(context);
            };
            model.clearUndoHistory = () => {
              record.clears.push(label);
              return clear.call(model);
            };
            record.restores.push(() => {
              context.save = save;
              model.clearUndoHistory = clear;
            });
          };
          watch(record.second, 'other');
          Workbook[command] = async (workbook: any, ...args: any[]) => {
            record.target = workbook;
            watch(workbook, 'source');
            const result = await record.original(workbook, ...args);
            record.expected =
              workbook.context.model.sharedModel.getMetadata('correxit');
            await new Promise<void>(resolve => {
              record.release = resolve;
            });
            return result;
          };
          const args = path
            ? {
                path: record.first.context.path,
                ...(command === 'draft' ? {} : { key: 'secret' })
              }
            : command === 'intervene'
              ? {
                  id: 'cell',
                  intervention: Rubric.Score.intervene('cell', {
                    comment: '',
                    points: 0,
                    possible: 1
                  })
                }
              : {};
          record.done = app.commands
            .execute(`correxit:${command}`, args)
            .finally(() => {
              record.finished = true;
            });
        },
        { command, path }
      );
      if (command === 'draft')
        await page.getByRole('button', { name: 'Revert', exact: true }).click();
      await page.waitForFunction(() => {
        const record = (window as any).__correxit_followup;
        return record.release || record.finished;
      });
      expect(
        await page.evaluate(() => !!(window as any).__correxit_followup.release)
      ).toBe(true);
      await page.evaluate(() => {
        const app = (window as any).jupyterapp;
        app.shell.activateById((window as any).__correxit_followup.second.id);
      });
      await expect
        .poll(() =>
          page.evaluate(() =>
            (window as any).jupyterapp.commands.isEnabled('correxit:convert')
          )
        )
        .toBe(true);
      const result = await page.evaluate(async () => {
        const { Workbook } = (window as any).__correxit__;
        const app = (window as any).jupyterapp;
        const record = (window as any).__correxit_followup;
        record.saves = [];
        record.clears = [];
        record.release();
        await record.done;
        const stored = await app.serviceManager.contents.get(
          record.first.context.path
        );
        return {
          saves: record.saves,
          clears: record.clears,
          headless: Workbook.headless(record.target),
          stored: stored.content.metadata.correxit,
          expected: record.expected
        };
      });
      expect(result.saves).toEqual(['source']);
      expect(result.clears).toEqual(['source']);
      expect(result.headless).toBe(path);
      expect(result.stored).toEqual(result.expected);
    } finally {
      await page
        .evaluate(async () => {
          const { Workbook } = (window as any).__correxit__;
          const app = (window as any).jupyterapp;
          const record = (window as any).__correxit_followup;
          if (!record) return;
          record.release?.();
          if (record.release) await record.done.catch(() => {});
          Workbook[record.command] = record.original;
          record.restores.forEach((restore: () => void) => restore());
          if (Workbook.headless(record.target)) record.target.context.dispose();
          record.second?.dispose();
          app.shell.activateById(record.first.id);
          delete (window as any).__correxit_followup;
        })
        .catch(() => {});
      if (second) await page.contents.deleteFile(second).catch(() => {});
      await dispose();
    }
  });
}

for (const outcome of [
  'success',
  'encryption failure',
  'metadata failure',
  'older encryption failure',
  'both encryption failures'
]) {
  for (const order of ['oldest first', 'newest first']) {
    test(`superseded intervention awaits the latest write: ${outcome}, ${order}`, async ({
      page
    }) => {
      const { dispose } = await prepare(page, [
        { id: 'cell', source: 'print(42)' }
      ]);
      try {
        await page.evaluate(async (outcome: string) => {
          const { Workbook, Rubric } = (window as any).__correxit__;
          const app = (window as any).jupyterapp;
          const panel = app.shell.currentWidget;
          const created = Rubric.create();
          await Workbook.update(
            panel,
            Rubric.add(
              {
                ...created,
                key: 'secret',
                assignment: {
                  ...created.assignment,
                  keys: {
                    private: { assignee: null, author: 'priv' },
                    public: { assignee: null, author: 'pub' }
                  }
                }
              },
              {
                id: 'cell',
                is: 'reviewable',
                payload: null,
                points: 1,
                references: null
              }
            )
          );
          await panel.context.save();
          const notebook = panel.context.model.sharedModel;
          const held = ((window as any).__correxit_write = {
            panel,
            lock: Rubric.lock,
            write: notebook.setMetadata,
            clear: notebook.clearUndoHistory,
            save: panel.context.save,
            releases: [],
            calls: 0,
            clears: 0,
            saves: 0,
            finished: false
          });
          notebook.clearUndoHistory = () => {
            held.clears++;
            return held.clear.call(notebook);
          };
          panel.context.save = () => {
            held.saves++;
            return held.save.call(panel.context);
          };
          notebook.setMetadata = (...args: any[]) => {
            if (outcome === 'metadata failure' && args[0] === 'correxit')
              throw new Error(outcome);
            return held.write.apply(notebook, args);
          };
          Rubric.lock = async (...args: any[]) => {
            const index = held.calls++;
            const value = await held.lock(...args);
            await new Promise<void>(resolve => {
              held.releases[index] = resolve;
            });
            if (
              index === 0 &&
              ['older encryption failure', 'both encryption failures'].includes(
                outcome
              )
            )
              throw new Error('older encryption failure');
            if (
              index === 1 &&
              ['encryption failure', 'both encryption failures'].includes(
                outcome
              )
            )
              throw new Error('encryption failure');
            return value;
          };
          held.intervention = app.commands
            .execute('correxit:intervene', {
              id: 'cell',
              intervention: Rubric.Score.intervene('cell', {
                comment: '',
                points: 1,
                possible: 1
              })
            })
            .then(
              () => null,
              (error: Error) => error.message
            )
            .finally(() => {
              held.finished = true;
            });
        }, outcome);
        await page.waitForFunction(
          () => !!(window as any).__correxit_write.releases[0]
        );
        await page.evaluate(() => {
          (window as any).__correxit_write.comment = (
            window as any
          ).jupyterapp.commands
            .execute('correxit:comment', { id: 'cell', comment: 'New comment' })
            .then(
              () => null,
              (error: Error) => error.message
            );
        });
        await page.waitForFunction(
          () => !!(window as any).__correxit_write.releases[1]
        );
        const early = await page.evaluate(async (order: string) => {
          const held = (window as any).__correxit_write;
          held.releases[order === 'oldest first' ? 0 : 1]();
          if (order === 'newest first') await held.comment;
          // Drain continuations after releasing the already-encrypted result.
          await new Promise(resolve => setTimeout(resolve, 0));
          return {
            finished: held.finished,
            clears: held.clears,
            saves: held.saves
          };
        }, order);
        expect(early).toEqual({ finished: false, clears: 0, saves: 0 });
        const result = await page.evaluate(async (order: string) => {
          const held = (window as any).__correxit_write;
          const app = (window as any).jupyterapp;
          held.releases[order === 'oldest first' ? 1 : 0]();
          const errors = await Promise.all([held.intervention, held.comment]);
          const disk = await app.serviceManager.contents.get(
            held.panel.context.path
          );
          const live =
            held.panel.context.model.sharedModel.getMetadata('correxit');
          const report = (rubric: any) => ({
            points: rubric.assignment.report.interventions.cell?.points ?? null,
            comment: rubric.assignment.report.scores.cell?.comment ?? null
          });
          return {
            errors,
            clears: held.clears,
            saves: held.saves,
            live: report(live),
            disk: report(disk.content.metadata.correxit)
          };
        }, order);
        const success =
          outcome === 'success' || outcome === 'older encryption failure';
        const error =
          outcome === 'both encryption failures'
            ? 'encryption failure'
            : outcome;
        const expected = success
          ? { points: 1, comment: 'New comment' }
          : { points: null, comment: null };
        expect(result).toEqual({
          errors: success ? [null, null] : [error, error],
          clears: success ? 1 : 0,
          saves: success ? 1 : 0,
          live: expected,
          disk: expected
        });
        if (!success) {
          // A failed write must not poison later retries of the cached rubric.
          const retried = await page.evaluate(async () => {
            const held = (window as any).__correxit_write;
            const { Workbook, Rubric } = (window as any).__correxit__;
            const notebook = held.panel.context.model.sharedModel;
            Rubric.lock = held.lock;
            notebook.setMetadata = held.write;
            await Workbook.update(held.panel, Workbook.open(held.panel));
            return notebook.getMetadata('correxit').assignment.report.scores
              .cell.comment;
          });
          expect(retried).toBe('New comment');
        }
      } finally {
        await page
          .evaluate(async () => {
            const held = (window as any).__correxit_write;
            if (!held) return;
            held.releases.forEach((release: () => void) => release());
            await Promise.allSettled([held.intervention, held.comment]);
            (window as any).__correxit__.Rubric.lock = held.lock;
            const notebook = held.panel.context.model.sharedModel;
            notebook.setMetadata = held.write;
            notebook.clearUndoHistory = held.clear;
            held.panel.context.save = held.save;
            delete (window as any).__correxit_write;
          })
          .catch(() => {});
        await dispose();
      }
    });
  }
}

for (const command of ['lock', 'reset', 'remove', 'dereference']) {
  test(`${command} reports a failed metadata write before follow-up saves`, async ({
    page
  }) => {
    const { dispose } = await prepare(page, [
      { id: 'cell', source: 'print(42)' },
      { id: 'ref', source: 'assert True' }
    ]);
    try {
      await page.evaluate(async command => {
        const { Workbook, Rubric } = (window as any).__correxit__;
        const app = (window as any).jupyterapp;
        const panel = app.shell.currentWidget;
        const created = Rubric.create();
        await Workbook.update(
          panel,
          Rubric.add(
            {
              ...created,
              key: 'secret',
              assignment: {
                ...created.assignment,
                keys: {
                  private: { assignee: null, author: 'priv' },
                  public: { assignee: null, author: 'pub' }
                }
              }
            },
            {
              id: 'cell',
              is: 'correctable',
              payload: null,
              points: 1,
              references: ['ref']
            },
            [{ cell: 'cell', referent: 'ref', points: 1, secret: false }]
          )
        );
        const notebook = panel.context.model.sharedModel;
        const held = ((window as any).__correxit_failure = {
          panel,
          lock: Rubric.lock,
          write: notebook.setMetadata,
          remove: notebook.deleteMetadata,
          clear: notebook.clearUndoHistory,
          save: panel.context.save,
          encrypted: Promise.resolve(),
          saves: 0,
          clears: 0,
          failures: 0,
          unhandled: [] as string[],
          rejection: (event: PromiseRejectionEvent) => {
            if (event.reason?.message !== 'Metadata write failed') return;
            held.unhandled.push(event.reason.message);
            event.preventDefault();
          }
        });
        window.addEventListener('unhandledrejection', held.rejection);
        Rubric.lock = (...args: any[]) => (held.encrypted = held.lock(...args));
        const fail = () => {
          held.failures++;
          throw new Error('Metadata write failed');
        };
        notebook.setMetadata = (key: string, value: any) =>
          key === 'correxit' ? fail() : held.write.call(notebook, key, value);
        notebook.deleteMetadata = (key: string) =>
          key === 'correxit' ? fail() : held.remove.call(notebook, key);
        notebook.clearUndoHistory = () => held.clears++;
        panel.context.save = async () => {
          held.saves++;
        };
        (held as any).done = app.commands
          .execute(`correxit:${command}`, { id: 'cell', referent: 'ref' })
          .then(
            () => null,
            (error: Error) => error.message
          );
      }, command);
      if (command === 'reset')
        await page.locator('.jp-Dialog button.jp-mod-accept').click();
      const result = await page.evaluate(async () => {
        const held = (window as any).__correxit_failure;
        const error = await held.done;
        await held.encrypted;
        await new Promise(resolve => window.setTimeout(resolve, 0));
        const { saves, clears, failures, unhandled } = held;
        return { error, saves, clears, failures, unhandled };
      });
      expect(result).toEqual({
        error: command === 'lock' ? null : 'Metadata write failed',
        saves: 0,
        clears: 0,
        failures: 1,
        unhandled: []
      });
      if (command === 'lock') {
        await expect(page.locator('.jp-Dialog')).toContainText(
          'Metadata write failed'
        );
        await page.getByRole('button', { name: 'Close', exact: true }).click();
      }
    } finally {
      await page
        .evaluate(() => {
          const held = (window as any).__correxit_failure;
          if (!held) return;
          const notebook = held.panel.context.model.sharedModel;
          (window as any).__correxit__.Rubric.lock = held.lock;
          notebook.setMetadata = held.write;
          notebook.deleteMetadata = held.remove;
          notebook.clearUndoHistory = held.clear;
          held.panel.context.save = held.save;
          window.removeEventListener('unhandledrejection', held.rejection);
          delete (window as any).__correxit_failure;
        })
        .catch(() => {});
      await dispose();
    }
  });
}

test('correction without a rubric returns an unverified result', async ({
  page
}) => {
  const { dispose } = await prepare(page, [{ id: 'cell', source: 'x = 1' }]);

  try {
    const result = await page.evaluate(async () => {
      const app = (window as any).jupyterapp;
      const notebook = app.shell.currentWidget.context.model.sharedModel;
      const before = JSON.stringify(notebook.toJSON());
      const grade = await app.commands.execute('correxit:correct');
      return { grade, unchanged: JSON.stringify(notebook.toJSON()) === before };
    });

    expect(result.grade).toMatchObject({
      resolved: false,
      score: { status: 'unscored', points: -1, possible: -1 },
      spec: null,
      verified: false
    });
    expect(result.unchanged).toBe(true);
  } finally {
    await dispose();
  }
});

test('toolbar correction without a cell returns an unverified result', async ({
  page
}) => {
  const { dispose } = await prepare(page, [{ id: 'cell', source: 'x = 1' }]);

  try {
    await page.evaluate(async () => {
      const { Workbook, Rubric } = (window as any).__correxit__;
      const panel = (window as any).jupyterapp.shell.currentWidget;
      const rubric = Rubric.create();
      await Workbook.update(panel, {
        ...rubric,
        key: 'secret',
        assignment: {
          ...rubric.assignment,
          keys: {
            private: { assignee: null, author: 'priv' },
            public: { assignee: null, author: 'pub' }
          }
        }
      });
    });
    const result = await page.evaluate(async () => {
      const { Rubric } = (window as any).__correxit__;
      const app = (window as any).jupyterapp;
      const panel = app.shell.currentWidget;
      const notebook = panel.context.model.sharedModel;
      // JupyterLab replaces the last removed cell on the next animation frame.
      while (notebook.cells.length) notebook.deleteCell(0);
      const active = panel.content.activeCell?.model.id ?? null;
      const before = JSON.stringify(notebook.toJSON());
      const grade = await app.commands.execute('correxit:correct', {
        [Rubric.Cell.TOOLBAR]: true
      });
      return {
        active,
        grade,
        unchanged: JSON.stringify(notebook.toJSON()) === before
      };
    });

    expect(result.active).toBeNull();
    expect(result.grade).toMatchObject({
      resolved: true,
      score: { status: 'unscored', points: -1, possible: -1 },
      spec: null,
      verified: false
    });
    expect(result.unchanged).toBe(true);
  } finally {
    await dispose();
  }
});

test('launch expands the Correxit sidebar', async ({ page }) => {
  const { dispose } = await prepare(page, [{ id: 'cell', source: 'x = 1' }]);

  const result = await page.evaluate(async () => {
    const app = (window as any).jupyterapp;
    const shell = app.shell as any;
    shell.collapseRight();
    const before = shell.rightCollapsed;
    await app.commands.execute('correxit:launch');
    return {
      before,
      after: shell.rightCollapsed
    };
  });

  expect(result.before).toBe(true);
  expect(result.after).toBe(false);
  await expect(page.locator('.correxit-sidebar')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Correxit' })).toContainText(
    'Correxit'
  );
  await dispose();
});

test('adds a comparable cell to the rubric', async ({ page }) => {
  const { dispose } = await prepare(page, [
    { id: 'ref', source: 'answer' },
    { id: 'cell', source: 'compare' }
  ]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
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
    await app.commands.execute('correxit:configure', {
      id: 'cell',
      is: 'comparable',
      references: ['ref']
    });

    const metadata = panel.context.model.sharedModel.getMetadata('correxit');
    const cell = metadata?.cells?.['cell'];
    return {
      is: cell?.is ?? null,
      points: cell?.points ?? null,
      references: cell?.references ?? null,
      secret: metadata?.references?.['ref']?.secret ?? null,
      toggled: app.commands.isToggled('correxit:configure', {
        id: 'cell',
        is: 'comparable'
      })
    };
  });

  expect(result.is).toBe('comparable');
  expect(result.points).toBe(1);
  expect(result.references).toEqual(['ref']);
  expect(result.secret).toBe(true);
  expect(result.toggled).toBe(true);
  await dispose();
});

test('adds a correctable cell to the rubric', async ({ page }) => {
  const { dispose } = await prepare(page, [
    { id: 'ref', source: 'answer' },
    { id: 'cell', source: 'attempt' }
  ]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
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
    await app.commands.execute('correxit:configure', {
      id: 'cell',
      is: 'correctable',
      references: ['ref']
    });

    const metadata = panel.context.model.sharedModel.getMetadata('correxit');
    const cell = metadata?.cells?.['cell'];
    return {
      is: cell?.is ?? null,
      references: cell?.references ?? null,
      toggled: app.commands.isToggled('correxit:configure', {
        id: 'cell',
        is: 'correctable'
      })
    };
  });

  expect(result.is).toBe('correctable');
  expect(result.references).toEqual(['ref']);
  expect(result.toggled).toBe(true);
  await dispose();
});

test('removes a cell from the rubric', async ({ page }) => {
  const { dispose } = await prepare(page, [
    { id: 'ref', source: 'answer' },
    { id: 'cell', source: 'compare' }
  ]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
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
        id: 'cell',
        is: 'comparable',
        points: 1,
        references: ['ref'],
        payload: null
      },
      [{ cell: 'cell', referent: 'ref', points: 1, secret: false }]
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

test('toggles secret flag on a rubric cell', async ({ page }) => {
  const { dispose } = await prepare(page, [
    { id: 'ref', source: 'answer' },
    { id: 'cell', source: 'compare' }
  ]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
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
        id: 'cell',
        is: 'comparable',
        points: 1,
        references: ['ref'],
        payload: null
      },
      [{ cell: 'cell', referent: 'ref', points: 1, secret: false }]
    );
    await Workbook.update(panel, rubric);

    const before = Workbook.open(panel)!.references['ref']?.secret;
    await app.commands.execute('correxit:share', { id: 'ref' });

    const after = Workbook.open(panel)!.references['ref']?.secret;
    return { before, after };
  });

  expect(result.before).toBe(false);
  expect(result.after).toBe(true);
  await dispose();
});

test('sets a comment on a rubric cell', async ({ page }) => {
  const { dispose } = await prepare(page, [
    { id: 'ref', source: 'answer' },
    { id: 'cell', source: 'compare' }
  ]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
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
        id: 'cell',
        is: 'comparable',
        points: 1,
        references: ['ref'],
        payload: null
      },
      [{ cell: 'cell', referent: 'ref', points: 1, secret: false }]
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

test('reweights cell points via command', async ({ page }) => {
  const { dispose } = await prepare(page, [{ id: 'cell', source: 'x = 1' }]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
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
    await app.commands.execute('correxit:configure', {
      id: 'cell',
      is: 'reviewable'
    });
    await app.commands.execute('correxit:reweight', {
      id: 'cell',
      points: 9
    });

    const metadata = panel.context.model.sharedModel.getMetadata('correxit');
    return {
      points: metadata?.cells?.['cell']?.points ?? null
    };
  });

  expect(result.points).toBe(9);
  await dispose();
});

test('sets and clears intervention via command', async ({ page }) => {
  const { dispose } = await prepare(page, [{ id: 'cell', source: 'x = 1' }]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
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
    await app.commands.execute('correxit:configure', {
      id: 'cell',
      is: 'reviewable'
    });

    const intervention = Rubric.Score.intervene('cell', {
      comment: 'manual override',
      points: 1,
      possible: 1
    });
    await app.commands.execute('correxit:intervene', {
      id: 'cell',
      intervention
    });

    const first = Workbook.open(panel)?.assignment.report.interventions.cell;
    await app.commands.execute('correxit:intervene', {
      id: 'cell',
      intervention: null
    });
    const second = Workbook.open(panel)?.assignment.report.interventions.cell;

    return {
      cleared: second === undefined,
      code: first?.code ?? null,
      points: first?.points ?? null
    };
  });

  expect(result.code).toBe('intervene');
  expect(result.points).toBe(1);
  expect(result.cleared).toBe(true);
  await dispose();
});

test('locks workbook and encrypts reference cells', async ({ page }) => {
  const { dispose } = await prepare(page, [
    { id: 'ref', source: 'answer' },
    { id: 'cell', source: 'compare' }
  ]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
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
        id: 'cell',
        is: 'comparable',
        points: 1,
        references: ['ref'],
        payload: null
      },
      [{ cell: 'cell', referent: 'ref', points: 1, secret: true }]
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

test('propagate warns about serialized secret reference outputs', async ({
  page
}) => {
  const { dispose } = await prepare(page, [
    { id: 'ref', source: 'answer' },
    { id: 'cell', source: 'compare' }
  ]);

  await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
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
        id: 'cell',
        is: 'comparable',
        points: 1,
        references: ['ref'],
        payload: null
      },
      [{ cell: 'cell', referent: 'ref', points: 1, secret: true }]
    );
    await Workbook.update(panel, rubric);
    await app.commands.execute('correxit:assign', {
      roster: ['student@example.com']
    });

    const notebook = panel.context.model.sharedModel;
    const original = notebook.toJSON.bind(notebook);
    notebook.toJSON = () => {
      const json = original();
      json.cells = json.cells.map((cell: any) =>
        cell.id === 'ref'
          ? {
              ...cell,
              cell_type: 'raw',
              execution_count: 1,
              outputs: [
                { name: 'stdout', output_type: 'stream', text: 'answer\n' }
              ]
            }
          : cell
      );
      return json;
    };
  });

  const kernel = page.locator('.jp-Dialog').filter({
    hasText: 'Select kernel for:'
  });
  try {
    await kernel.waitFor({ state: 'visible', timeout: 4000 });
    await page.keyboard.press('Escape');
    await kernel.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
  } catch {
    /* no kernel dialog */
  }

  const done = page.evaluate(async () => {
    const app = (window as any).jupyterapp;
    const stream = await app.commands.execute('correxit:propagate');
    const log: any[] = [];
    for await (const emission of stream) log.push(emission);
    return log;
  });

  const dialog = page.locator('.jp-Dialog');
  await expect(dialog).toContainText('Secret reference cells have outputs.');
  await expect(dialog).toContainText(
    'Those outputs are not encrypted and will be distributed.'
  );
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(await done).toEqual([]);
  await dispose();
});

test('enabled states reflect locked and unlocked rubric', async ({ page }) => {
  const { dispose } = await prepare(page, [
    { id: 'ref', source: 'answer' },
    { id: 'cell', source: 'compare' }
  ]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
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
        id: 'cell',
        is: 'comparable',
        points: 1,
        references: ['ref'],
        payload: null
      },
      [{ cell: 'cell', referent: 'ref', points: 1, secret: true }]
    );
    await Workbook.update(panel, rubric);

    const unlocked = {
      add: app.commands.isEnabled('correxit:configure', {
        id: 'cell',
        is: 'comparable'
      }),
      lock: app.commands.isEnabled('correxit:lock'),
      remove: app.commands.isEnabled('correxit:remove', { id: 'cell' }),
      toggle: app.commands.isEnabled('correxit:share', { id: 'ref' }),
      unlock: app.commands.isEnabled('correxit:unlock')
    };
    await Workbook.lock(panel);

    const locked = {
      add: app.commands.isEnabled('correxit:configure', {
        id: 'cell',
        is: 'comparable'
      }),
      lock: app.commands.isEnabled('correxit:lock'),
      remove: app.commands.isEnabled('correxit:remove', { id: 'cell' }),
      toggle: app.commands.isEnabled('correxit:share', { id: 'ref' }),
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
  const { dispose } = await prepare(page, []);

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
      assignee: 'student@example.com',
      roster: ['student@example.com']
    });

    const metadata = panel.context.model.sharedModel.getMetadata('correxit');
    return {
      assignee: metadata?.assignment?.assignee ?? null,
      mac: !!metadata?.assignment?.mac
    };
  });

  expect(result.assignee).toBe('student@example.com');
  expect(result.mac).toBe(true);
  await dispose();
});

test('sets and clears resources via command', async ({ page }) => {
  const { dispose } = await prepare(page, [{ id: 'cell', source: 'x = 1' }]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
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

    const enabled = app.commands.isEnabled('correxit:resource');
    await app.commands.execute('correxit:resource', {
      resources: ['chinook.db', 'data.csv']
    });
    const afterSet = panel.context.model.sharedModel.getMetadata('correxit');

    await app.commands.execute('correxit:resource', { resources: null });
    const afterClear = panel.context.model.sharedModel.getMetadata('correxit');

    return {
      enabled,
      resources: afterSet?.assignment?.resources ?? null,
      mac: !!afterSet?.assignment?.mac,
      cleared:
        'resources' in (afterClear?.assignment ?? {})
          ? afterClear.assignment.resources
          : 'absent'
    };
  });

  expect(result.enabled).toBe(true);
  expect(result.resources).toEqual(['chinook.db', 'data.csv']);
  expect(result.mac).toBe(true);
  expect(result.cleared).toBeNull();
  await dispose();
});

test('resource command is disabled when workbook is locked', async ({
  page
}) => {
  const { dispose } = await prepare(page, [
    { id: 'ref', source: 'answer' },
    { id: 'cell', source: 'compare' }
  ]);

  const result = await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
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
        id: 'cell',
        is: 'comparable',
        points: 1,
        references: ['ref'],
        payload: null
      },
      [{ cell: 'cell', referent: 'ref', points: 1, secret: true }]
    );
    await Workbook.update(panel, rubric);
    await Workbook.lock(panel, rubric.key);

    return {
      enabled: app.commands.isEnabled('correxit:resource')
    };
  });

  expect(result.enabled).toBe(false);
  await dispose();
});

test('resource command rejects files outside the workbook directory', async ({
  page
}) => {
  const { dispose } = await prepare(page, [{ id: 'cell', source: 'x = 1' }]);

  await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
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

    await app.commands.execute('correxit:resource', {
      resources: ['subdir/data.csv']
    });
  });

  const dialog = page.locator('.jp-Dialog');
  await expect(dialog).toContainText('Invalid workbook');
  await expect(dialog).toContainText(
    'Files must be in (.). Move or copy them there to select them.'
  );
  await dialog.locator('button').last().click();

  const result = await page.evaluate(() => {
    const app = (window as any).jupyterapp;
    const panel = app.shell.currentWidget;
    const metadata = panel.context.model.sharedModel.getMetadata('correxit');
    return metadata?.assignment?.resources ?? null;
  });

  expect(result).toBeNull();
  await dispose();
});
