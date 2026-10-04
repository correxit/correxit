import { expect, test } from './fixtures';
import { cd, cleanup, close, setup } from './utils';

test.use({ autoGoto: false });
const key = 'ac'.repeat(32);

/** Issue with real encrypted author credentials and seal the student's wrong answer. */
async function issue(page: any, secret = true) {
  return page.evaluate(
    async ({ key, secret }: any) => {
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
          created,
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
    { key, secret }
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

test('legacy author templates upgrade; legacy assignments remain readable but cannot be trusted', async ({
  page
}) => {
  const fixture = await setup(page, [{ id: 'answer', source: 'answer = 42' }]);
  try {
    const result = await page.evaluate(async (key: string) => {
      const { Rubric, Workbook } = (window as any).__correxit__;
      const panel = (window as any).jupyterapp.shell.currentWidget;
      const created = await Workbook.convert(
        panel,
        { key, passphrase: null },
        { store: async () => {} }
      );
      const { contents, ...base } = created;
      const legacy = await Rubric.assign(
        { ...base, cxtformat: 1 },
        { roster: ['student@example.com'] }
      );
      await Workbook.update(panel, legacy);
      await Workbook.lock(panel);
      const upgraded = await Workbook.unlock(panel, key);
      const assigned = await Rubric.assign(legacy, {
        assignee: 'student@example.com'
      });
      await Workbook.update(panel, assigned);
      await Workbook.lock(panel);
      const readable = Workbook.open(panel).cxtformat;
      const before = JSON.stringify(panel.context.model.sharedModel.toJSON());
      let rejected = false;
      try {
        await Workbook.unlock(panel, key);
      } catch {
        rejected = true;
      }
      return {
        upgraded: upgraded.cxtformat,
        contents: upgraded.contents,
        readable,
        rejected,
        unchanged:
          before === JSON.stringify(panel.context.model.sharedModel.toJSON())
      };
    }, key);
    expect(result).toEqual({
      upgraded: 2,
      contents: null,
      readable: 1,
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
    const cached = await page.evaluate(
      async ({ directory, key }: any) => {
        const app = (window as any).jupyterapp;
        const { Workbook, kernels } = (window as any).__correxit__;
        kernels.drain();
        const manager = app.serviceManager.kernels;
        const start = manager.startNew;
        let starts = 0;
        manager.startNew = function (...args: any[]) {
          starts++;
          return start.apply(this, args);
        };
        try {
          const stream = await app.commands.execute(
            'correxit-corrector:batch',
            { path: directory, key }
          );
          const grades: any[] = [];
          for await (const [, { grade, workbook }] of stream) {
            grades.push({
              verified: grade.verified,
              points: grade.score.points
            });
            workbook.context.dispose();
          }
          return { starts, grades };
        } finally {
          manager.startNew = start;
        }
      },
      { directory: issued.directory, key }
    );
    expect(cached).toEqual({
      starts: 0,
      grades: [{ verified: true, points: 0 }]
    });
    expect(await collect(page, issued.directory)).toBe(1);
  } finally {
    await cleanup(page, issued);
    await fixture.dispose();
  }
});

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
