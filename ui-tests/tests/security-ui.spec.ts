import type { IJupyterLabPageFixture } from '@jupyterlab/galata';
import type { Request } from '@playwright/test';
import { expect, test } from './fixtures';
import { cd, cleanup, close, setup } from './utils';

test.use({ autoGoto: false });
const key = 'ac'.repeat(32);

/** Issue with real encrypted author credentials and seal the student's wrong answer. */
async function issue(page: any, secret = true, review: string | null = null) {
  return page.evaluate(
    async ({ key, secret, review }: any) => {
      const { Rubric, Workbook } = (window as any).__correxit__;
      const app = (window as any).jupyterapp;
      const panel = app.shell.currentWidget;
      panel.context.model.sharedModel.setMetadata('kernelspec', {
        display_name: 'Python 3 (ipykernel)',
        language: 'python',
        name: 'python3'
      });
      const created = await Workbook.convert(
        panel,
        { key, passphrase: null },
        {
          store: async () => {}
        }
      );
      await Workbook.update(
        panel,
        Rubric.add(
          review
            ? Rubric.add(created, {
                id: review,
                is: 'reviewable',
                payload: null,
                points: 1,
                references: null
              })
            : created,
          {
            id: 'answer',
            is: 'correctable',
            payload: null,
            points: 1,
            references: ['test', 'other']
          },
          [
            { cell: 'answer', referent: 'test', points: 1, secret },
            { cell: 'answer', referent: 'other', points: 0, secret }
          ]
        )
      );
      await Workbook.assign(panel, {
        name: 'Integrity fixture',
        roster: ['student@example.com']
      });
      const stream = await app.commands.execute('correxit:propagate');
      const log: any[] = [];
      for await (const [, emission] of stream) log.push(emission);
      const directory = log.find(({ type }) => type === 'mkdir')
        .slots[0] as string;
      const paths = log
        .filter(({ type }) => type === 'saved')
        .map(({ slots }) => slots[0] as string);
      const path = paths[0];
      const contents = app.serviceManager.contents;
      const file = await contents.get(path, {
        type: 'notebook',
        content: true
      });
      file.content.cells.find((cell: any) => cell.id === 'answer').source =
        'answer = 0';
      await contents.save(path, { ...file, content: file.content });
      const workbook = await app.commands.execute('correxit:fetch', {
        path,
        unlock: false
      });
      await Workbook.submit(workbook, [
        Workbook.open(workbook).assignment.keys.public.author
      ]);
      await workbook.context.save();
      workbook.context.dispose();
      return { directory, paths };
    },
    { key, secret, review }
  );
}

async function batch(page: any, directory: string) {
  return page.evaluate(
    async ({ directory, key }: any) => {
      const { Workbook } = (window as any).__correxit__;
      const app = (window as any).jupyterapp;
      const stream = await app.commands.execute('correxit-corrector:batch', {
        path: directory,
        key
      });
      const grades: any[] = [];
      for await (const [, { grade, workbook }] of stream) {
        grades.push({
          ...grade,
          certification: Workbook.open(workbook).assignment.certification
        });
        workbook.context.dispose();
      }
      return grades;
    },
    { directory, key }
  );
}

async function rerun(page: IJupyterLabPageFixture, directory: string) {
  await page.evaluate(() => (window as any).__correxit__.kernels.drain());
  let starts = 0;
  const count = (request: Request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname.endsWith('/api/sessions')
    )
      starts++;
  };
  page.on('request', count);
  try {
    const grades = await batch(page, directory);
    return { grades, starts };
  } finally {
    page.off('request', count);
  }
}

async function collect(page: any, directory: string) {
  return page.evaluate(
    async ({ directory, key }: any) => {
      const app = (window as any).jupyterapp;
      const stream = await app.commands.execute('correxit-corrector:collect', {
        path: directory,
        key
      });
      let count = 0;
      for await (const [, { workbook }] of stream) {
        count++;
        workbook.context.dispose();
      }
      return count;
    },
    { directory, key }
  );
}

async function exported(page: any, directory: string) {
  await page.evaluate(async (path: string) => {
    await (window as any).jupyterapp.commands.execute(
      'correxit-corrector:launch',
      { path }
    );
  }, directory);
  await expect(
    page
      .locator('.correxit-corrector-assignee')
      .filter({ hasText: 'student@example.com' })
  ).toBeVisible();
  return page.evaluate(async (directory: string) => {
    const app = (window as any).jupyterapp;
    await app.commands.execute('correxit-corrector:csv');
    const files = (
      await app.serviceManager.contents.get(directory, { content: true })
    ).content;
    const exported = files.find((file: any) => file.name.endsWith('.csv'));
    const file = await app.serviceManager.contents.get(exported.path, {
      content: true,
      format: 'text'
    });
    await app.serviceManager.contents.delete(exported.path);
    return file.content as string;
  }, directory);
}

const cells = [
  { id: 'setup', source: 'threshold = 42' },
  { id: 'answer', source: 'answer = 42' },
  { id: 'test', source: 'assert answer == threshold' },
  { id: 'other', source: 'pass' }
];

test('rejects draft-format metadata without rewriting the notebook', async ({
  page
}) => {
  const fixture = await setup(page, [{ id: 'answer', source: 'answer = 42' }]);
  try {
    const result = await page.evaluate(async (key: string) => {
      const { Workbook } = (window as any).__correxit__;
      const panel = (window as any).jupyterapp.shell.currentWidget;
      await Workbook.convert(
        panel,
        { key, passphrase: null },
        { store: async () => {} }
      );
      await Workbook.lock(panel);
      const notebook = panel.context.model.sharedModel;
      const { contents, ...metadata } = notebook.getMetadata('correxit');
      // Clear the cached rubric before loading the damaged metadata.
      await Workbook.update(panel, null);
      notebook.setMetadata('correxit', { ...metadata, cxtformat: 1 });
      const opened = Workbook.open(panel, true);
      const before = JSON.stringify(notebook.toJSON());
      let rejected = false;
      try {
        await Workbook.unlock(panel, key);
      } catch {
        rejected = true;
      }
      return {
        opened,
        rejected,
        unchanged: before === JSON.stringify(notebook.toJSON())
      };
    }, key);
    expect(result).toEqual({
      opened: null,
      rejected: true,
      unchanged: true
    });
  } finally {
    await fixture.dispose();
  }
});

test('grading rechecks current sources after an authenticated unlock', async ({
  page
}) => {
  const fixture = await setup(page, cells);
  const issued = await issue(page);
  try {
    await cd(page, '.');
    const result = await page.evaluate(
      async ({ path, key }: any) => {
        const { Workbook } = (window as any).__correxit__;
        const workbook = await (window as any).jupyterapp.commands.execute(
          'correxit:fetch',
          { path, unlock: false }
        );
        await Workbook.unlock(workbook, key);
        workbook.context.model.sharedModel.cells
          .find((cell: any) => cell.id === 'setup')
          .setSource('threshold = 0');
        const rejected: string[] = [];
        for (const [name, operation] of [
          ['unlock', () => Workbook.unlock(workbook, key)],
          ['correct', () => Workbook.correct(workbook)],
          [
            'certify',
            () =>
              Workbook.certify(
                workbook,
                { __: (message: string) => message },
                true
              )
          ]
        ] as const) {
          try {
            await operation();
          } catch {
            rejected.push(name);
          }
        }
        const certification = Workbook.open(workbook).assignment.certification;
        workbook.context.dispose();
        return { rejected, certification };
      },
      { path: issued.paths[0], key }
    );
    expect(result).toEqual({
      rejected: ['unlock', 'correct', 'certify'],
      certification: null
    });
  } finally {
    await cleanup(page, issued);
    await fixture.dispose();
  }
});

test('Corrector does not retry rejected credentials or expose authentication errors', async ({
  page
}) => {
  const fixture = await setup(page, cells);
  const issued = await issue(page);
  try {
    await cd(page, '.');
    const result = await page.evaluate(
      async ({ directory, key }) => {
        const app = (window as any).jupyterapp;
        const { Correxit, Workbook } = (window as any).__correxit__;
        const unlocker = await app.resolveRequiredService(Correxit.Unlocker);
        const previous = unlocker.request;
        const results = [];
        try {
          for (const mode of ['grade', 'collect']) {
            for (const failure of ['cancelled', 'mismatch']) {
              let attempts = 0;
              unlocker.request = async function* () {
                attempts++;
                if (failure === 'cancelled') return;
                throw new Correxit.Error.Mismatch(
                  'private credential or notebook source'
                );
              };
              const run = `${mode}-${failure}`;
              const stream = await app.commands.execute(
                'correxit-corrector:run',
                {
                  run,
                  path: directory,
                  mode
                }
              );
              const events = [];
              try {
                for await (const event of stream) {
                  if (event.type === 'read' && event.workbook) {
                    events.push({
                      type: 'read',
                      certification: Workbook.open(event.workbook).assignment
                        .certification
                    });
                  } else {
                    events.push(event);
                  }
                }
                results.push({ mode, failure, attempts, events });
              } finally {
                await stream.return(undefined);
                await app.commands.execute('correxit-corrector:stop', {
                  run,
                  release: true
                });
              }
            }
          }
        } finally {
          unlocker.request = previous;
        }
        return results;
      },
      { directory: issued.directory, key }
    );
    expect(result).toHaveLength(4);
    for (const { attempts, events } of result) {
      expect(attempts).toBe(1);
      expect(events).toContainEqual({ type: 'read', certification: null });
      expect(events).toContainEqual({
        type: 'error',
        path: issued.paths[0],
        message: 'authenticate'
      });
      expect(events.some(event => event.type === 'result')).toBe(false);
      expect(events[events.length - 1]).toEqual({
        type: 'done',
        stopped: false
      });
    }
    expect(JSON.stringify(result)).not.toContain('private');
  } finally {
    await cleanup(page, issued);
    await fixture.dispose();
  }
});

test('delivery retries require a currently sealed submission', async ({
  page
}) => {
  const fixture = await setup(page, cells);
  const issued = await issue(page);
  try {
    const result = await page.evaluate(
      async ({ path, key }) => {
        const { Workbook } = (window as any).__correxit__;
        const app = (window as any).jupyterapp;
        const workbook = app.shell.currentWidget;
        const file = await app.serviceManager.contents.get(path);
        Workbook.restore(workbook, file.content);
        await app.commands.execute('correxit:submit');
        const receipt = Workbook.open(workbook).assignment.submitted;

        // Start from the same pending delivery, then open it for grading.
        Workbook.restore(workbook, file.content);
        await Workbook.unlock(workbook, key);
        await Workbook.lock(workbook);
        const enabled = app.commands.isEnabled('correxit:submit');
        await app.commands.execute('correxit:submit');
        return {
          receipt,
          enabled,
          after: Workbook.open(workbook).assignment.submitted
        };
      },
      { path: issued.paths[0], key }
    );
    expect(result.receipt).toMatch(/^manual:/);
    expect(result.enabled).toBe(false);
    expect(result.after).toBeNull();
    const dialog = page.locator('.jp-Dialog');
    await expect(dialog).toContainText('missing seal');
    await dialog.getByRole('button', { name: 'Close' }).click();
  } finally {
    await cleanup(page, issued);
    await fixture.dispose();
  }
});

test('late submission receipts cannot acknowledge a new seal or erase an accepted receipt', async ({
  page
}) => {
  const fixture = await setup(page, cells);
  const issued = await issue(page);
  try {
    const result = await page.evaluate(
      async ({ path, key }) => {
        const { Workbook } = (window as any).__correxit__;
        const app = (window as any).jupyterapp;
        const workbook = await app.commands.execute('correxit:fetch', { path });
        try {
          const original = Workbook.open(workbook);
          const stale = await Workbook.deliver(workbook, original, async () => {
            await Workbook.unlock(workbook, key);
            await Workbook.lock(workbook);
            await Workbook.draft(workbook);
            await Workbook.submit(workbook, [
              original.assignment.keys.public.author
            ]);
            return 'old receipt';
          });
          const next = Workbook.open(workbook);
          const snapshot = workbook.context.model.toJSON();
          const reloaded = await Workbook.deliver(workbook, next, async () => {
            await workbook.context.revert();
            return 'receipt from before reload';
          });
          const disk =
            workbook.context.model.sharedModel.getMetadata('correxit');
          const restored = Workbook.restore(workbook, snapshot);
          const declined = await Workbook.deliver(
            workbook,
            restored,
            async () => {
              await Workbook.deliver(
                workbook,
                restored,
                async () => 'accepted'
              );
              return null;
            }
          );
          return {
            stale,
            resealed: original.assignment.seal !== next.assignment.seal,
            pending: next.assignment.submitted,
            reloaded,
            keptOriginal:
              disk.assignment.seal === original.assignment.seal &&
              disk.assignment.submitted === null,
            declined,
            receipt: Workbook.open(workbook).assignment.submitted
          };
        } finally {
          workbook.context.dispose();
        }
      },
      { path: issued.paths[0], key }
    );
    expect(result).toEqual({
      stale: false,
      resealed: true,
      pending: null,
      reloaded: false,
      keptOriginal: true,
      declined: false,
      receipt: 'accepted'
    });
  } finally {
    await cleanup(page, issued);
    await fixture.dispose();
  }
});

test('locking preserves a workbook restored while encryption is pending', async ({
  page
}) => {
  const fixture = await setup(page, cells);
  const issued = await issue(page);
  try {
    const result = await page.evaluate(
      async ({ path, key }) => {
        const { Workbook } = (window as any).__correxit__;
        const app = (window as any).jupyterapp;
        const file = await app.serviceManager.contents.get(path);
        const workbook = await app.commands.execute('correxit:fetch', {
          path,
          key
        });
        try {
          const locking = Workbook.lock(workbook);
          Workbook.restore(workbook, file.content);
          const snapshot = workbook.context.model.toJSON();
          const error = await locking.then(
            () => null,
            (error: Error) => error.message
          );
          return { error, snapshot, after: workbook.context.model.toJSON() };
        } finally {
          workbook.context.dispose();
        }
      },
      { path: issued.paths[0], key }
    );
    expect(result.error).toContain('workbook changed');
    expect(result.after).toEqual(result.snapshot);
  } finally {
    await cleanup(page, issued);
    await fixture.dispose();
  }
});

test('a late collection receipt cannot mark a recertified grade collected', async ({
  page
}) => {
  const fixture = await setup(page, cells);
  const issued = await issue(page);
  try {
    await cd(page, '.');
    await batch(page, issued.directory);
    const result = await page.evaluate(
      async ({ path, key }) => {
        const { Workbook } = (window as any).__correxit__;
        const app = (window as any).jupyterapp;
        const workbook = await app.commands.execute('correxit:fetch', {
          path,
          key
        });
        const trans = { __: (message: string) => message };
        try {
          const first = await Workbook.certify(workbook, trans, true);
          let next;
          const stale = await Workbook.record(first, async () => {
            await Workbook.unlock(workbook, key);
            next = await Workbook.certify(workbook, trans, true);
            return 'old grade';
          });
          const pending = Workbook.open(workbook).assignment.collected;
          let calls = 0;
          const retried = await Workbook.record(first, async () => {
            calls++;
            return 'obsolete grade';
          });
          const accepted = await Workbook.record(next, async () => 'new grade');
          const acceptedReceipt = Workbook.open(workbook).assignment.collected;
          await Workbook.unlock(workbook, key);
          const annotated = await Workbook.certify(workbook, trans, true);
          const changed = await Workbook.record(annotated, async () => {
            workbook.context.model.sharedModel.setMetadata(
              'review-note',
              'updated'
            );
            return 'receipt from before edit';
          });
          return {
            stale,
            pending,
            retried,
            calls,
            accepted,
            acceptedReceipt,
            changed,
            receipt: Workbook.open(workbook).assignment.collected
          };
        } finally {
          workbook.context.dispose();
        }
      },
      { path: issued.paths[0], key }
    );
    expect(result).toEqual({
      stale: false,
      pending: null,
      retried: false,
      calls: 0,
      accepted: true,
      acceptedReceipt: 'new grade',
      changed: false,
      receipt: null
    });
  } finally {
    await cleanup(page, issued);
    await fixture.dispose();
  }
});

test('a headless fetch rejects failed key storage and disposes its document', async ({
  page
}) => {
  const fixture = await setup(page, cells);
  const issued = await issue(page);
  try {
    const result = await page.evaluate(
      async ({ path, key }) => {
        const { Correxit, Workbook } = (window as any).__correxit__;
        const app = (window as any).jupyterapp;
        const unlocker = await app.resolveRequiredService(Correxit.Unlocker);
        const { request, store } = unlocker;
        const unlock = Workbook.unlock;
        let context: any;
        let attempts = 0;
        let error = null;
        try {
          Workbook.unlock = (workbook: any, key: string) => {
            context = workbook.context;
            return unlock(workbook, key);
          };
          unlocker.store = async () => {
            attempts++;
            throw new Error('Key storage unavailable');
          };
          try {
            await app.commands.execute('correxit:fetch', { path, key });
          } catch (reason) {
            error = (reason as Error).message;
          }
          const disposed = context?.isDisposed;
          unlocker.request = async function* () {};
          const cancelled = await app.commands.execute('correxit:fetch', {
            path,
            unlock: true,
            silent: true
          });
          try {
            return {
              error,
              disposed,
              attempts,
              locked: Workbook.open(cancelled).locked
            };
          } finally {
            cancelled.context.dispose();
          }
        } finally {
          context?.dispose();
          Workbook.unlock = unlock;
          unlocker.store = store;
          unlocker.request = request;
        }
      },
      { path: issued.paths[0], key }
    );
    expect(result).toEqual({
      error: 'Key storage unavailable',
      disposed: true,
      attempts: 1,
      locked: true
    });
  } finally {
    await cleanup(page, issued);
    await fixture.dispose();
  }
});

test('authentic submissions grade and collect; authenticated cached reports skip execution', async ({
  page
}) => {
  const fixture = await setup(page, cells);
  const issued = await issue(page);
  try {
    await cd(page, '.');
    const grades = await batch(page, issued.directory);
    expect(grades).toHaveLength(1);
    expect(grades[0]).toMatchObject({
      verified: true,
      resolved: true,
      score: { points: 0, possible: 1 }
    });
    expect(grades[0].certification).not.toBeNull();
    expect(await rerun(page, issued.directory)).toEqual({ grades, starts: 0 });
    expect(await collect(page, issued.directory)).toBe(1);
  } finally {
    await cleanup(page, issued);
    await fixture.dispose();
  }
});

for (const extra of [
  'missing-given',
  'missing-reference',
  'earned score',
  'intervention'
]) {
  test(`regrades a certified report with an extra ${extra}`, async ({
    page
  }) => {
    const fixture = await setup(page, cells);
    const issued = await issue(page);
    const [path] = issued.paths;
    try {
      await cd(page, '.');
      const [initial] = await batch(page, issued.directory);
      expect(initial.certification).not.toBeNull();
      await page.evaluate(
        async ({ path, key, extra }) => {
          const { Rubric } = (window as any).__correxit__;
          const contents = (window as any).jupyterapp.serviceManager.contents;
          const file = await contents.get(path);
          const rubric = await Rubric.unlock(
            file.content.metadata.correxit,
            key
          );
          const { report } = rubric.assignment;
          const field = extra === 'intervention' ? 'interventions' : 'scores';
          const score = extra.startsWith('missing-')
            ? { ...report.scores.answer, code: extra }
            : {
                ...Rubric.Score.CORRECT,
                code: field === 'interventions' ? 'intervene' : ''
              };
          const obsolete = { ...score, id: 'obsolete' };
          const signed = await Rubric.sign(rubric, {
            ...report,
            [field]: { ...report[field], obsolete }
          });
          file.content.metadata.correxit = await Rubric.lock(signed);
          await contents.save(path, file);
        },
        { path, key, extra }
      );

      expect(await collect(page, issued.directory)).toBe(0);
      const { grades, starts } = await rerun(page, issued.directory);
      expect(starts).toBeGreaterThan(0);
      expect(grades).toMatchObject([
        { verified: true, resolved: true, score: initial.score }
      ]);
      expect(grades[0].certification).toBeGreaterThan(initial.certification);
      const saved = await page.evaluate(async path => {
        const { contents } = (window as any).jupyterapp.serviceManager;
        const { content } = await contents.get(path);
        const { report } = content.metadata.correxit.assignment;
        return {
          scores: Object.keys(report.scores),
          interventions: Object.keys(report.interventions),
          reports: content.cells
            .filter((cell: any) => cell.id === 'correxit-workbook-certificate')
            .map((cell: any) => cell.source),
          frozen: content.cells.every(
            (cell: any) => cell.metadata.editable === false
          )
        };
      }, path);
      expect(saved).toMatchObject({
        scores: ['answer'],
        interventions: [],
        frozen: true
      });
      expect(saved.reports).toHaveLength(1);
      expect(JSON.stringify(saved.reports[0])).toContain('0 / 1');
    } finally {
      await cleanup(page, issued);
      await fixture.dispose();
    }
  });
}

test('collects and reuses a certification with an intervention-only reviewable cell', async ({
  page
}) => {
  const fixture = await setup(page, [
    ...cells,
    { id: 'manual', type: 'markdown', source: 'Explain the answer.' }
  ]);
  const issued = await issue(page, true, 'manual');
  try {
    await cd(page, '.');
    const certified = await page.evaluate(
      async ({ path, key }) => {
        const { Rubric, Workbook } = (window as any).__correxit__;
        const app = (window as any).jupyterapp;
        const workbook = await app.commands.execute('correxit:fetch', {
          path,
          unlock: false
        });
        try {
          await Workbook.unlock(workbook, key);
          await Workbook.correct(workbook, 'answer');
          const review = Rubric.Score.intervene('manual', {
            points: 1,
            possible: 1,
            comment: 'Reviewed'
          });
          await Workbook.intervene(workbook, 'manual', review);
          const { grade, rubric } = await Workbook.certify(
            workbook,
            { __: (text: string) => text },
            true
          );
          await workbook.context.save();
          const { certification, report } = rubric.assignment;
          return {
            grade: { ...grade, certification },
            scores: Object.keys(report.scores)
          };
        } finally {
          workbook.context.dispose();
        }
      },
      { path: issued.paths[0], key }
    );
    expect(certified.scores).toEqual(['answer']);
    expect(certified.grade.score).toMatchObject({ points: 1, possible: 2 });
    expect(await collect(page, issued.directory)).toBe(1);
    expect(await rerun(page, issued.directory)).toEqual({
      grades: [certified.grade],
      starts: 0
    });
  } finally {
    await cleanup(page, issued);
    await fixture.dispose();
  }
});

test('reuses automated scores while manual review is pending', async ({
  page
}) => {
  const fixture = await setup(page, [
    ...cells,
    { id: 'manual', type: 'markdown', source: 'Explain the answer.' }
  ]);
  const issued = await issue(page, true, 'manual');
  try {
    await cd(page, '.');
    const grades = await batch(page, issued.directory);
    expect(grades).toMatchObject([
      {
        verified: true,
        resolved: true,
        certification: null,
        score: { points: 0, possible: 2 }
      }
    ]);
    expect(await rerun(page, issued.directory)).toEqual({ grades, starts: 0 });
    const saved = await page.evaluate(async path => {
      const { contents } = (window as any).jupyterapp.serviceManager;
      const { content } = await contents.get(path);
      const { certification, report } = content.metadata.correxit.assignment;
      return {
        certification,
        scores: report.scores,
        interventions: report.interventions
      };
    }, issued.paths[0]);
    expect(saved).toMatchObject({
      certification: null,
      scores: {
        answer: { points: 0, possible: 1 },
        manual: { code: 'intervene', status: 'unscored' }
      }
    });
    expect(saved.interventions).toEqual({});
  } finally {
    await cleanup(page, issued);
    await fixture.dispose();
  }
});

for (const id of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
  test(`authenticates fixed cell ${id} before grading and cached-report reuse`, async ({
    page
  }) => {
    const fixture = await setup(
      page,
      cells.map(cell => (cell.id === 'setup' ? { ...cell, id } : cell))
    );
    const issued = await issue(page);
    try {
      await cd(page, '.');
      const digest = await page.evaluate(
        async ({ path, id }: any) => {
          const contents = (window as any).jupyterapp.serviceManager.contents;
          const file = await contents.get(path, {
            type: 'notebook',
            content: true
          });
          return file.content.metadata.correxit.contents.find(
            (entry: any) => entry.id === id
          ).digest;
        },
        { path: issued.paths[0], id }
      );
      expect(digest).toMatch(/^[a-f0-9]{64}$/);
      const authentic = await batch(page, issued.directory);
      expect(authentic).toHaveLength(1);
      expect(authentic[0]).toMatchObject({
        verified: true,
        resolved: true,
        score: { points: 0, possible: 1 }
      });
      expect(authentic[0].certification).not.toBeNull();

      await page.evaluate(
        async ({ path, id }: any) => {
          const contents = (window as any).jupyterapp.serviceManager.contents;
          const file = await contents.get(path, {
            type: 'notebook',
            content: true
          });
          file.content.cells.find((cell: any) => cell.id === id).source =
            'threshold = 0';
          await contents.save(path, { ...file, content: file.content });
        },
        { path: issued.paths[0], id }
      );
      const tampered = await batch(page, issued.directory);
      expect(tampered).toHaveLength(1);
      expect(tampered[0]).toMatchObject({
        verified: false,
        resolved: false,
        score: { status: 'unscored' }
      });
      expect(await collect(page, issued.directory)).toBe(0);
    } finally {
      await cleanup(page, issued);
      await fixture.dispose();
    }
  });
}

test('rejects __proto__ as a rubric cell before writing notebook metadata', async ({
  page
}) => {
  const fixture = await setup(page, [
    ...cells,
    {
      id: '__proto__',
      type: 'markdown',
      source: 'An explanation needing manual review.'
    }
  ]);
  try {
    await expect(issue(page, true, '__proto__')).rejects.toThrow(
      'unsupported id __proto__'
    );
    expect(
      await page.evaluate(() => {
        const workbook = (window as any).jupyterapp.shell.currentWidget;
        return Object.keys(
          workbook.context.model.sharedModel.getMetadata('correxit').cells
        );
      })
    ).toEqual([]);
  } finally {
    await fixture.dispose();
  }
});

for (const id of ['constructor', 'toString', 'hasOwnProperty']) {
  test(`requires a real intervention before certifying or collecting cell ${id}`, async ({
    page
  }) => {
    const fixture = await setup(page, [
      ...cells,
      { id, type: 'markdown', source: 'An explanation needing manual review.' }
    ]);
    const issued = await issue(page, true, id);
    try {
      await cd(page, '.');
      const partial = await page.evaluate(
        async ({ path, key, id }: any) => {
          const { Rubric, Workbook } = (window as any).__correxit__;
          const app = (window as any).jupyterapp;
          const workbook = await app.commands.execute('correxit:fetch', {
            path,
            unlock: false
          });
          try {
            await Workbook.unlock(workbook, key);
            await Workbook.correct(workbook, 'answer');
            const rubric = Workbook.open(workbook);
            const pending = Rubric.pending(rubric);
            const scored = Object.prototype.hasOwnProperty.call(
              rubric.assignment.report.scores,
              id
            );
            let error = '';
            try {
              await Workbook.certify(
                workbook,
                { __: (text: string) => text },
                true
              );
            } catch (caught) {
              error = String(caught);
            }
            await Workbook.lock(workbook);
            await workbook.context.save();
            return { pending, scored, error };
          } finally {
            workbook.context.dispose();
          }
        },
        { path: issued.paths[0], key, id }
      );
      expect(partial.pending).toBe(true);
      expect(partial.scored).toBe(false);
      expect(partial.error).toContain('pending review');

      // A student can change this unsigned marker, but cannot create a review.
      await page.evaluate(async (path: string) => {
        const contents = (window as any).jupyterapp.serviceManager.contents;
        const file = await contents.get(path, {
          type: 'notebook',
          content: true
        });
        file.content.metadata.correxit.assignment.certification = Date.now();
        await contents.save(path, { ...file, content: file.content });
      }, issued.paths[0]);
      const grades = await batch(page, issued.directory);
      expect(grades).toHaveLength(1);
      expect(grades[0]).toMatchObject({
        verified: true,
        score: { points: 0, possible: 2 }
      });
      expect(await collect(page, issued.directory)).toBe(0);

      const reviewed = await page.evaluate(
        async ({ path, key, id }: any) => {
          const { Rubric, Workbook } = (window as any).__correxit__;
          const app = (window as any).jupyterapp;
          const workbook = await app.commands.execute('correxit:fetch', {
            path,
            unlock: false
          });
          try {
            await Workbook.unlock(workbook, key);
            const before = Workbook.open(workbook);
            const pending = Rubric.pending(before);
            const score = Rubric.Score.get(before.assignment.report.scores, id);
            const intervention = Rubric.Score.intervene(id, {
              comment: 'Reviewed',
              points: 1,
              possible: 1
            });
            await Workbook.intervene(workbook, id, intervention);
            await Workbook.comment(workbook, id, 'Feedback');
            const certified = await Workbook.certify(
              workbook,
              { __: (text: string) => text },
              true
            );
            await workbook.context.save();
            return { pending, score, grade: certified.grade };
          } finally {
            workbook.context.dispose();
          }
        },
        { path: issued.paths[0], key, id }
      );
      expect(reviewed.pending).toBe(true);
      expect(reviewed.score).toMatchObject({
        id,
        status: 'unscored',
        possible: 1
      });
      expect(reviewed.grade).toMatchObject({
        verified: true,
        resolved: true,
        score: { points: 1, possible: 2 }
      });
      const intervention = await page.evaluate(
        async ({ path, id }: any) => {
          const contents = (window as any).jupyterapp.serviceManager.contents;
          const file = await contents.get(path, {
            type: 'notebook',
            content: true
          });
          const interventions =
            file.content.metadata.correxit.assignment.report.interventions;
          return Object.prototype.hasOwnProperty.call(interventions, id)
            ? interventions[id]
            : null;
        },
        { path: issued.paths[0], id }
      );
      expect(intervention).toMatchObject({
        id,
        points: 1,
        possible: 1,
        comment: 'Reviewed'
      });
      expect(await collect(page, issued.directory)).toBe(1);
    } finally {
      await cleanup(page, issued);
      await fixture.dispose();
    }
  });
}

for (const attack of [
  'plaintext',
  'ciphertext',
  'malformed',
  'visible',
  'order',
  'scaffolding',
  'missing'
]) {
  test(`rejects ${attack} tampering before unsealing or accepting a grade`, async ({
    page
  }) => {
    const fixture = await setup(page, cells);
    const issued = await issue(page, attack !== 'visible');
    try {
      await cd(page, '.');
      const result = await page.evaluate(
        async ({ issued, attack, key }: any) => {
          const { Workbook } = (window as any).__correxit__;
          const app = (window as any).jupyterapp;
          const contents = app.serviceManager.contents;
          const path = issued.paths[0];
          const file = await contents.get(path, {
            type: 'notebook',
            content: true
          });
          const notebook = file.content;
          const cell = (id: string) =>
            notebook.cells.find((cell: any) => cell.id === id);
          if (attack === 'plaintext' || attack === 'visible')
            cell('test').source = 'pass';
          if (attack === 'ciphertext')
            cell('test').source = cell('other').source;
          if (attack === 'malformed')
            cell('test').source = '-----BEGIN PGP MESSAGE-----\ncorrupt';
          if (attack === 'order') notebook.cells.reverse();
          if (attack === 'scaffolding') cell('setup').source = 'threshold = 0';
          if (attack === 'missing')
            notebook.cells = notebook.cells.filter(
              (cell: any) => cell.id !== 'test'
            );
          await contents.save(path, { ...file, content: notebook });
          const workbook = await app.commands.execute('correxit:fetch', {
            path,
            unlock: false
          });
          const before = JSON.stringify(
            workbook.context.model.sharedModel.toJSON()
          );
          let rejected = false;
          try {
            await Workbook.unlock(workbook, key);
          } catch {
            rejected = true;
          }
          const unchanged =
            before ===
            JSON.stringify(workbook.context.model.sharedModel.toJSON());
          workbook.context.dispose();
          return { rejected, unchanged };
        },
        { issued, attack, key }
      );
      expect(result).toEqual({ rejected: true, unchanged: true });
      const grades = await batch(page, issued.directory);
      expect(grades).toHaveLength(1);
      expect(grades[0]).toMatchObject({
        verified: false,
        resolved: false,
        certification: null,
        score: { status: 'unscored' }
      });
      expect(await collect(page, issued.directory)).toBe(0);
    } finally {
      await cleanup(page, issued);
      await fixture.dispose();
    }
  });
}

test('forged certification and reports cannot skip grading, collect, or produce CSV scores', async ({
  page
}) => {
  const fixture = await setup(page, cells);
  const issued = await issue(page);
  try {
    await cd(page, '.');
    await page.evaluate(async (path: string) => {
      const { Rubric } = (window as any).__correxit__;
      const contents = (window as any).jupyterapp.serviceManager.contents;
      const file = await contents.get(path, {
        type: 'notebook',
        content: true
      });
      const assignment = file.content.metadata.correxit.assignment;
      assignment.certification = Date.now();
      assignment.report.scores.answer = {
        ...Rubric.Score.CORRECT,
        id: 'answer',
        points: 1,
        possible: 1
      };
      await contents.save(path, { ...file, content: file.content });
    }, issued.paths[0]);
    const grades = await batch(page, issued.directory);
    expect(grades[0]).toMatchObject({
      verified: false,
      resolved: false,
      score: { status: 'unscored' }
    });
    expect(await collect(page, issued.directory)).toBe(0);
    const csv = await exported(page, issued.directory);
    expect(csv.split('\r\n')[1]).toContain(',,,,');
    expect(csv.split('\r\n')[1]).not.toContain(',1,1,');
    await expect(
      page.locator('.correxit-corrector-breakdown')
    ).not.toContainText('1/1');
  } finally {
    await close(page);
    await cleanup(page, issued);
    await fixture.dispose();
  }
});

test('an unsigned certification marker cannot skip an authentic ungraded submission', async ({
  page
}) => {
  const fixture = await setup(page, cells);
  const issued = await issue(page);
  try {
    await cd(page, '.');
    await page.evaluate(async (path: string) => {
      const contents = (window as any).jupyterapp.serviceManager.contents;
      const file = await contents.get(path, {
        type: 'notebook',
        content: true
      });
      file.content.metadata.correxit.assignment.certification = Date.now();
      await contents.save(path, { ...file, content: file.content });
    }, issued.paths[0]);
    const grades = await batch(page, issued.directory);
    expect(grades[0]).toMatchObject({
      verified: true,
      resolved: true,
      score: { points: 0, possible: 1 }
    });
  } finally {
    await cleanup(page, issued);
    await fixture.dispose();
  }
});
