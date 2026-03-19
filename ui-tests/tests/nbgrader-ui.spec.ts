import { expect, test } from '@jupyterlab/galata';
import * as fs from 'fs';
import * as path from 'path';

test.use({ autoGoto: false });

const FIXTURES = path.resolve(
  __dirname, '..', '..', 'src', '__tests__', 'fixtures', 'nbgrader'
);

// ── Helpers ──

/**
 * Inserts nbgrader-formatted cells into the current notebook.
 */
async function populate(
  page: any,
  cells: {
    type: 'code' | 'markdown';
    source: string;
    nbgrader?: Record<string, any>;
  }[]
): Promise<void> {
  await page.evaluate(
    (cells: any[]) => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      const notebook = panel.context.model.sharedModel;
      while (notebook.cells.length) notebook.deleteCell(0);
      cells.forEach((cell, index) => {
        const metadata = cell.nbgrader
          ? { nbgrader: cell.nbgrader }
          : {};
        notebook.insertCell(index, {
          cell_type: cell.type, metadata, source: cell.source
        });
      });
    },
    cells
  );
}

/**
 * Loads a fixture .ipynb into the current notebook via fromJSON.
 */
async function load(page: any, name: string): Promise<void> {
  const raw = fs.readFileSync(path.join(FIXTURES, name), 'utf-8');
  const notebook = JSON.parse(raw);
  await page.evaluate(
    (notebook: any) => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      panel.context.model.fromJSON(notebook);
    },
    notebook
  );
}

/**
 * Executes `correxit:convert` and fills the passphrase dialog.
 */
async function convert(page: any): Promise<void> {
  const done = page.evaluate(async () => {
    const app = (window as any).jupyterapp;
    await app.commands.execute('correxit:convert');
  });
  const dialog = page.locator('.jp-Dialog');
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  await dialog.locator('input').fill('test-passphrase');
  await dialog.locator('.jp-mod-accept').click();
  await done;
}

/**
 * Returns the rubric shape: cells in notebook order, total points,
 * and a count of console.warn emissions from the convert command.
 *
 * Each cell is [classification, points, number_of_references].
 */
async function shape(page: any): Promise<{
  cells: [string, number, number][];
  points: number;
}> {
  return page.evaluate(() => {
    const { Workbook } = (window as any).__correxit__;
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const notebook = panel.context.model.sharedModel;
    const rubric = Workbook.open(panel, true);
    const order = notebook.cells.map((cell: any) => cell.id);
    const refs = Object.values(rubric.references) as any[];
    const cells = order
      .filter((id: string) => id in rubric.cells)
      .map((id: string) => {
        const cell = rubric.cells[id];
        const count = refs.filter(
          (ref: any) => ref.cell === id
        ).length;
        return [cell.is, cell.points, count] as [string, number, number];
      });
    const points = cells.reduce(
      (sum: number, [, p]: any) => sum + p, 0
    );
    return { cells, points };
  });
}

/**
 * Returns true if no notebook cell carries nbgrader metadata and
 * no cell source contains solution/mark-scheme markers.
 */
async function clean(page: any): Promise<{
  metadata: boolean;
  sources: boolean;
}> {
  return page.evaluate(() => {
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const notebook = panel.context.model.sharedModel;
    let metadata = true;
    let sources = true;
    for (const cell of notebook.cells) {
      const json = cell.toJSON();
      if ('nbgrader' in (json.metadata as any || {}))
        metadata = false;
      const source = cell.getSource();
      if (/###\s*BEGIN SOLUTION/.test(source)) sources = false;
      if (/###\s*END SOLUTION/.test(source)) sources = false;
      if (/===\s*BEGIN MARK SCHEME/.test(source)) sources = false;
      if (/===\s*END MARK SCHEME/.test(source)) sources = false;
    }
    return { metadata, sources };
  });
}

/**
 * Installs a console.warn interceptor and returns a function to
 * retrieve captured warnings matching a prefix.
 */
async function warnings(
  page: any
): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const original = console.warn;
    (window as any).__warns__ = [];
    console.warn = (...args: any[]) => {
      (window as any).__warns__.push(args.join(' '));
      original.apply(console, args);
    };
  });
  return async () => {
    const captured = await page.evaluate(
      () => (window as any).__warns__ as string[]
    );
    await page.evaluate(() => {
      delete (window as any).__warns__;
    });
    return captured.filter(
      (w: string) => w.includes('nbgrader convert:')
    );
  };
}

// ── Synthetic cells ──

const answer = (id: string, source = '') => ({
  type: 'code' as const, source,
  nbgrader: {
    grade: false, grade_id: id, locked: false,
    schema_version: 3, solution: true
  }
});

const autotest = (id: string, points: number, source = '') => ({
  type: 'code' as const, source,
  nbgrader: {
    grade: true, grade_id: id, locked: false, points,
    schema_version: 3, solution: false
  }
});

const manual = (id: string, points: number, source = '') => ({
  type: 'code' as const, source,
  nbgrader: {
    grade: true, grade_id: id, locked: false, points,
    schema_version: 3, solution: true
  }
});

const essay = (id: string, points: number, source = '') => ({
  type: 'markdown' as const, source,
  nbgrader: {
    grade: true, grade_id: id, locked: false, points,
    schema_version: 3, solution: true
  }
});

const task = (id: string, points: number) => ({
  type: 'markdown' as const, source: `Task: ${id}`,
  nbgrader: {
    grade: false, grade_id: id, locked: false, points,
    schema_version: 3, solution: false, task: true
  }
});

const readonly = (id: string, source = '') => ({
  type: 'markdown' as const, source,
  nbgrader: {
    grade: false, grade_id: id, locked: true,
    schema_version: 3, solution: false
  }
});

const plain = (type: 'code' | 'markdown', source = '') => ({
  type, source
});

// ── Tests: synthetic cells ──

test.describe('nbgrader conversion (synthetic)', () => {
  test.afterEach(async ({ page }) => {
    try { await page.notebook.close(true); } catch { /* ok */ }
  });

  test('converts answer + tests to correctable', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [
      answer('q1', [
        'def squares(n):',
        '    ### BEGIN SOLUTION',
        '    return [i**2 for i in range(1, n+1)]',
        '    ### END SOLUTION'
      ].join('\n')),
      autotest('t1', 1, 'assert squares(2) == [1, 4]'),
      autotest('t2', 1, 'assert squares(1) == [1]')
    ]);
    await convert(page);

    const s = await shape(page);
    expect(s.cells).toEqual([['correctable', 2, 2]]);
    expect(s.points).toBe(2);
  });

  test('strips solution markers from cell source', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [
      answer('q1', [
        'def f():',
        '    ### BEGIN SOLUTION',
        '    return 42',
        '    ### END SOLUTION'
      ].join('\n')),
      autotest('t1', 1, 'assert f() == 42')
    ]);
    await convert(page);

    const c = await clean(page);
    expect(c.metadata).toBe(true);
    expect(c.sources).toBe(true);
  });

  test('maps manually graded code to reviewable', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [manual('m1', 5, '# show your work')]);
    await convert(page);

    const s = await shape(page);
    expect(s.cells).toEqual([['reviewable', 5, 0]]);
  });

  test('maps manually graded markdown to reviewable', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [
      essay('e1', 3, 'Explain your reasoning.')
    ]);
    await convert(page);

    const s = await shape(page);
    expect(s.cells).toEqual([['reviewable', 3, 0]]);
  });

  test('maps task + unmarked cell to reviewable', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [
      task('task1', 4),
      plain('code', '# student work')
    ]);
    await convert(page);

    const s = await shape(page);
    expect(s.cells).toEqual([['reviewable', 4, 0]]);
  });

  test('recalibrates fractional test points to integers', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [
      answer('q1', 'x = 1'),
      autotest('t1', 0.5, 'assert x == 1'),
      autotest('t2', 0.5, 'assert x > 0')
    ]);
    await convert(page);

    const s = await shape(page);
    expect(s.cells).toEqual([['correctable', 2, 2]]);
  });

  test('mixed: answer+tests, manual, task', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [
      readonly('intro', '# Assignment 1'),
      answer('q1', 'def f(): return 1'),
      autotest('t1a', 1, 'assert f() == 1'),
      autotest('t1b', 1, 'assert f() != 0'),
      plain('markdown', '## Part 2'),
      manual('q2', 3, '# explain'),
      task('task1', 2),
      plain('code', '# task work')
    ]);
    await convert(page);

    const s = await shape(page);
    expect(s.cells).toEqual([
      ['correctable', 2, 2],
      ['reviewable', 3, 0],
      ['reviewable', 2, 0]
    ]);
    expect(s.points).toBe(7);
  });

  test('orphan answer becomes reviewable with warning', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    const captured = await warnings(page);
    await populate(page, [answer('lonely', 'x = 1')]);
    await convert(page);

    const w = await captured();
    expect(w.length).toBeGreaterThan(0);
    expect(w[0]).toContain('No test cells');

    const s = await shape(page);
    expect(s.cells).toEqual([['reviewable', 1, 0]]);
  });

  test('orphaned test cell is skipped with warning', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    const captured = await warnings(page);
    await populate(page, [
      autotest('orphan', 3, 'assert True')
    ]);
    await convert(page);

    const w = await captured();
    expect(w.length).toBeGreaterThan(0);
    expect(w[0]).toContain('no preceding answer');

    const s = await shape(page);
    expect(s.cells).toHaveLength(0);
  });

  test('consecutive answers: first flushed as reviewable', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    const captured = await warnings(page);
    await populate(page, [
      answer('q1', 'x = 1'),
      answer('q2', 'y = 2'),
      autotest('t2', 1, 'assert y == 2')
    ]);
    await convert(page);

    const s = await shape(page);
    expect(s.cells).toEqual([
      ['reviewable', 1, 0],
      ['correctable', 1, 1]
    ]);

    const w = await captured();
    expect(w.some(
      (w: string) => w.includes('No test cells')
    )).toBe(true);
  });

  test('task followed by graded cell discards task points', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    const captured = await warnings(page);
    await populate(page, [
      task('task1', 3),
      manual('m1', 5, '# show work')
    ]);
    await convert(page);

    const w = await captured();
    expect(w.some(
      (w: string) => w.includes('points discarded')
    )).toBe(true);

    const s = await shape(page);
    expect(s.cells).toEqual([['reviewable', 5, 0]]);
    expect(s.points).toBe(5);
  });

  test('intervening markdown does not break answer-test linkage',
    async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [
      answer('q1', 'def f(): return 1'),
      plain('markdown', 'Check your answer below:'),
      readonly('hint', 'Make sure f() returns an integer.'),
      autotest('t1', 2, 'assert f() == 1')
    ]);
    await convert(page);

    const s = await shape(page);
    expect(s.cells).toEqual([['correctable', 2, 1]]);
  });

  test('test cell sources are preserved after conversion', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    const test_source = 'assert squares(2) == [1, 4]';
    await populate(page, [
      answer('q1', [
        'def squares(n):',
        '    ### BEGIN SOLUTION',
        '    return [i**2 for i in range(1, n+1)]',
        '    ### END SOLUTION'
      ].join('\n')),
      autotest('t1', 1, test_source)
    ]);
    await convert(page);

    const sources = await page.evaluate(() => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      const notebook = panel.context.model.sharedModel;
      return notebook.cells.map(
        (cell: any) => cell.getSource()
      );
    });
    // Answer cell: solution markers stripped, code preserved
    expect(sources[0]).toBe(
      'def squares(n):\n    return [i**2 for i in range(1, n+1)]'
    );
    // Test cell: source unchanged
    expect(sources[1]).toBe(test_source);
  });

  test('plain notebook converts with no rubric cells', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [
      plain('code', 'print("hello")'),
      plain('markdown', '# notes')
    ]);
    await convert(page);

    const s = await shape(page);
    expect(s.cells).toHaveLength(0);
  });

  test('mark scheme regions are stripped', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [
      manual('m1', 2, [
        'Explain the concept.',
        '=== BEGIN MARK SCHEME ===',
        'Award 2 points for clarity',
        '=== END MARK SCHEME ==='
      ].join('\n'))
    ]);
    await convert(page);

    const c = await clean(page);
    expect(c.sources).toBe(true);
  });
});

// ── Tests: real fixture notebooks ──

test.describe('nbgrader conversion (fixtures)', () => {
  test.afterEach(async ({ page }) => {
    try { await page.notebook.close(true); } catch { /* ok */ }
  });

  /**
   * Canonical assignment across schema versions (v1, v2, v3, output).
   *
   * All four notebooks encode the same logical assignment:
   *   squares:                answer + 2 tests (1+1 pts)
   *   sum_of_squares:         answer + 2 tests (0.5+0.5, recalibrated)
   *   sum_of_squares_equation:  manual markdown (1 pt)
   *   sum_of_squares_application: manual code (2 pts)
   *
   * Expected: 4 cells, 7 total points, 0 warnings.
   */
  for (const name of [
    'test.ipynb',
    'test-v1.ipynb',
    'test-v2.ipynb',
    'test-with-output.ipynb'
  ]) {
    test(`${name}: canonical shape`, async ({ page }) => {
      await page.goto();
      await page.notebook.createNew();
      const captured = await warnings(page);
      await load(page, name);
      await convert(page);

      const s = await shape(page);
      expect(s.cells).toEqual([
        ['correctable', 2, 2],
        ['correctable', 2, 2],
        ['reviewable', 1, 0],
        ['reviewable', 2, 0]
      ]);
      expect(s.points).toBe(7);

      const w = await captured();
      expect(w).toHaveLength(0);

      const c = await clean(page);
      expect(c.metadata).toBe(true);
      expect(c.sources).toBe(true);
    });
  }

  test('test-hidden-tests.ipynb: auto-graded only', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    const captured = await warnings(page);
    await load(page, 'test-hidden-tests.ipynb');
    await convert(page);

    const s = await shape(page);
    expect(s.cells).toEqual([
      ['correctable', 2, 2],
      ['correctable', 2, 2]
    ]);
    expect(s.points).toBe(4);
    expect(await captured()).toHaveLength(0);

    const c = await clean(page);
    expect(c.metadata).toBe(true);
    expect(c.sources).toBe(true);
  });

  test('ps1-problem1.ipynb: trailing task discarded', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    const captured = await warnings(page);
    await load(page, 'ps1-problem1.ipynb');
    await convert(page);

    // Same 4 cells as canonical. The trailing task cell has no
    // following unmarked cell, so it is discarded with a warning.
    const s = await shape(page);
    expect(s.cells).toEqual([
      ['correctable', 2, 2],
      ['correctable', 2, 2],
      ['reviewable', 1, 0],
      ['reviewable', 2, 0]
    ]);
    expect(s.points).toBe(7);

    const w = await captured();
    expect(w.length).toBe(1);
    expect(w[0]).toContain('Trailing task');

    const c = await clean(page);
    expect(c.metadata).toBe(true);
    expect(c.sources).toBe(true);
  });

  test('ps1-autotest-problem1.ipynb: task + autotest', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    const captured = await warnings(page);
    await load(page, 'ps1-autotest-problem1.ipynb');
    await convert(page);

    // 6 cells: 2 correctable, 4 reviewable (incl. task → unmarked).
    // The last correctable has 0 pts (autotest with 0-point test).
    const s = await shape(page);
    expect(s.cells).toEqual([
      ['correctable', 2, 2],
      ['correctable', 2, 2],
      ['reviewable', 1, 0],
      ['reviewable', 2, 0],
      ['reviewable', 4, 0],
      ['correctable', 0, 1]
    ]);
    expect(s.points).toBe(11);
    expect(await captured()).toHaveLength(0);

    const c = await clean(page);
    expect(c.metadata).toBe(true);
    expect(c.sources).toBe(true);
  });

  /**
   * Manual-only assignments (no auto-graded cells).
   */
  for (const name of [
    'ps1-problem2.ipynb',
    'ps1-autotest-problem2.ipynb'
  ]) {
    test(`${name}: manual only`, async ({ page }) => {
      await page.goto();
      await page.notebook.createNew();
      await load(page, name);
      await convert(page);

      const s = await shape(page);
      expect(s.cells).toEqual([
        ['reviewable', 1, 0],
        ['reviewable', 2, 0]
      ]);
      expect(s.points).toBe(3);

      const c = await clean(page);
      expect(c.metadata).toBe(true);
    });
  }

  test('validation-zero-points.ipynb: zero-point test', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await load(page, 'validation-zero-points.ipynb');
    await convert(page);

    const s = await shape(page);
    expect(s.cells).toEqual([['correctable', 0, 1]]);
    expect(s.points).toBe(0);

    const c = await clean(page);
    expect(c.metadata).toBe(true);
  });
});

// ── Helpers: scoring ──

/**
 * Scores the active workbook and returns the summary.
 * Runs `Workbook.correct()` which executes all cells in kernel
 * order and evaluates test references.
 */
async function score(page: any): Promise<{
  points: number;
  possible: number;
  status: string;
}> {
  return page.evaluate(async () => {
    const { Workbook } = (window as any).__correxit__;
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const { score } = await Workbook.correct(panel);
    return {
      points: score.points,
      possible: score.possible,
      status: score.status
    };
  });
}

/**
 * Overwrites the source of the cell at `index` (0-based).
 */
async function rewrite(
  page: any, index: number, source: string
): Promise<void> {
  await page.evaluate(
    ({ index, source }: { index: number; source: string }) => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      const notebook = panel.context.model.sharedModel;
      const cell = notebook.cells[index];
      cell.setSource(source);
    },
    { index, source }
  );
}

// ── Tests: scoring converted notebooks ──

test.describe('nbgrader scoring (synthetic)', () => {
  test.afterEach(async ({ page }) => {
    try { await page.notebook.close(true); } catch { /* ok */ }
  });

  test('correct answer scores full marks', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [
      answer('q1', 'x = 42'),
      autotest('t1', 1, 'assert x == 42'),
      autotest('t2', 1, 'assert isinstance(x, int)')
    ]);
    await convert(page);

    const result = await score(page);
    expect(result.status).toBe('correct');
    expect(result.points).toBe(2);
    expect(result.possible).toBe(2);
  });

  test('wrong answer scores zero', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [
      answer('q1', 'x = 42'),
      autotest('t1', 1, 'assert x == 42'),
      autotest('t2', 1, 'assert isinstance(x, int)')
    ]);
    await convert(page);

    // Student replaces the answer with something wrong.
    await rewrite(page, 0, 'x = "not a number"');

    const result = await score(page);
    expect(result.status).toBe('incorrect');
    expect(result.points).toBe(0);
    expect(result.possible).toBe(2);
  });

  test('partial credit: one test passes, one fails', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [
      answer('q1', 'x = 42'),
      autotest('t1', 1, 'assert x > 0'),
      autotest('t2', 1, 'assert x == 99')
    ]);
    await convert(page);

    const result = await score(page);
    expect(result.status).toBe('partial');
    expect(result.points).toBe(1);
    expect(result.possible).toBe(2);
  });

  test('student modifies answer after conversion', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [
      answer('q1', [
        'def squares(n):',
        '    ### BEGIN SOLUTION',
        '    return [i**2 for i in range(1, n+1)]',
        '    ### END SOLUTION'
      ].join('\n')),
      autotest('t1', 1, 'assert squares(3) == [1, 4, 9]'),
      autotest('t2', 1, 'assert squares(1) == [1]')
    ]);
    await convert(page);

    // After conversion, solution markers are stripped but the code
    // remains. Simulate a student writing their own implementation.
    await rewrite(page, 0, [
      'def squares(n):',
      '    return [i**2 for i in range(1, n+1)]'
    ].join('\n'));

    const result = await score(page);
    expect(result.status).toBe('correct');
    expect(result.points).toBe(2);
  });

  test('mixed: auto-graded correct + reviewable unscored', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [
      answer('q1', 'x = 42'),
      autotest('t1', 2, 'assert x == 42'),
      manual('q2', 3, '# explain something')
    ]);
    await convert(page);

    const result = await score(page);
    // Auto-graded cell passes; manual cell is unscored.
    // Summary reflects both.
    expect(result.possible).toBe(5);
  });
});
