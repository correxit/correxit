import { expect, test } from '@jupyterlab/galata';
import { cd, setup } from './utils';

test.use({ autoGoto: false });

const keys = {
  private: {
    assignee: null,
    author: `-----BEGIN PGP PRIVATE KEY BLOCK-----

xUkEacHOthuPhWm48+9MCY4ZoB5zaJ8TCL0BFAnEwrq2vsC+NTL6EgDjg6P4
JzjqjCIqEGS8Fljrm2FRMpbWiOpUK0TnIETO1g+6zQ1jb3JyZXhpdC10ZXN0
wsAPBBMbCgCFBYJpwc62AwsJBwkQ/+VpzxueGnhFFAAAAAAAHAAgc2FsdEBu
b3RhdGlvbnMub3BlbnBncGpzLm9yZ7aeKcxlxXAmARYftBEDMKuRQYKOg+mi
UNWWvS5pYKcDBRUKCA4MBBYAAgECGQECmwMCHgEWIQRwUHQWg+0lDFYSIKj/
5WnPG54aeAAAwjLPzmdRtiPAQG4qh7YcqTxABlF/i6mcuUNsQvG79Vkcbgud
48ZND/OAA3qRMBHeYvEI2EO0zcY4TvGjusPeGNQFx0kEacHOthmr6un0sKA9
X4aGqEOxqYXCkcUuYSxJoSj3QI47TNOWYwAIuAZB5UGbE5vjq7JFdu682Hnl
jhYm3Vce+dJFbxnudxBqwroEGBsKAHAFgmnBzrYJEP/lac8bnhp4RRQAAAAA
ABwAIHNhbHRAbm90YXRpb25zLm9wZW5wZ3Bqcy5vcmeDvNANjX21V+sInrrh
T7QjHE6/sBEVbi2IVTWRo3ft/wKbDBYhBHBQdBaD7SUMVhIgqP/lac8bnhp4
AADxaOwzJYh0FXQdc4Y5Vj8oSkixYJTh1YKqdnzbdcL9bjoEpwFbocEVhiil
wuHeBt2QJmRrZohWA1uC36BzzqaMqQk=
=3rAl
-----END PGP PRIVATE KEY BLOCK-----`
  },
  public: {
    assignee: null,
    author: `-----BEGIN PGP PUBLIC KEY BLOCK-----

xiYEacHOthuPhWm48+9MCY4ZoB5zaJ8TCL0BFAnEwrq2vsC+NTL6Es0NY29y
cmV4aXQtdGVzdMLADwQTGwoAhQWCacHOtgMLCQcJEP/lac8bnhp4RRQAAAAA
ABwAIHNhbHRAbm90YXRpb25zLm9wZW5wZ3Bqcy5vcme2ninMZcVwJgEWH7QR
AzCrkUGCjoPpolDVlr0uaWCnAwUVCggODAQWAAIBAhkBApsDAh4BFiEEcFB0
FoPtJQxWEiCo/+VpzxueGngAAMIyz85nUbYjwEBuKoe2HKk8QAZRf4upnLlD
bELxu/VZHG4LnePGTQ/zgAN6kTAR3mLxCNhDtM3GOE7xo7rD3hjUBc4mBGnB
zrYZq+rp9LCgPV+GhqhDsamFwpHFLmEsSaEo90COO0zTlmPCugQYGwoAcAWC
acHOtgkQ/+VpzxueGnhFFAAAAAAAHAAgc2FsdEBub3RhdGlvbnMub3BlbnBn
cGpzLm9yZ4O80A2NfbVX6wieuuFPtCMcTr+wERVuLYhVNZGjd+3/ApsMFiEE
cFB0FoPtJQxWEiCo/+VpzxueGngAAPFo7DMliHQVdB1zhjlWPyhKSLFglOHV
gqp2fNt1wv1uOgSnAVuhwRWGKKXC4d4G3ZAmZGtmiFYDW4LfoHPOpoypCQ==
=3+uO
-----END PGP PUBLIC KEY BLOCK-----`
  }
} as const;

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
  return page.evaluate(
    async ({ keys, roster }: any) => {
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

      return { directory, paths };
    },
    { keys, roster }
  );
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

test('correctable cell with multiple references sums per-reference points', async ({
  page
}) => {
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

  // Collecting again without overwrite should yield nothing (already collected).
  const again = await page.evaluate(async (directory: string) => {
    const app = (window as any).jupyterapp;
    const stream: AsyncGenerator<any> = await app.commands.execute(
      'correxit-corrector:collect',
      { path: directory }
    );
    const items: any[] = [];
    for await (const item of stream) items.push(item);
    return items.length;
  }, propagated.directory);

  expect(again).toBe(0);

  await cleanup(page, propagated);
  await dispose();
});
