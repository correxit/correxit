import { expect, test } from '@jupyterlab/galata';
import * as fs from 'fs';
import * as path from 'path';
import { cd } from './utils';

test.use({ autoGoto: false });

const FIXTURES = path.resolve(
  __dirname,
  '..',
  '..',
  'src',
  '__tests__',
  'fixtures',
  'nbgrader'
);

async function close(page: any): Promise<void> {
  const file = await page
    .evaluate(() => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      const path = panel?.context?.path ?? null;
      return typeof path === 'string' && path.endsWith('.ipynb') ? path : null;
    })
    .catch(() => null);
  await cd(page, '.').catch(() => {});
  try {
    await page.notebook.close(true);
  } catch {
    /* ok */
  }
  if (file) {
    try {
      await page.contents.deleteFile(file);
    } catch {
      /* ok */
    }
  }
  await cd(page, '.').catch(() => {});
  try {
    await page.evaluate(async () => {
      const app = (window as any).jupyterapp;
      await app.serviceManager.sessions.shutdownAll();
    });
  } catch {
    /* ok */
  }
  try {
    await page.evaluate(() => {
      const original = (window as any).__warns_original__;
      if (original) console.warn = original;
      delete (window as any).__warns__;
      delete (window as any).__warns_original__;
    });
  } catch {
    /* ok */
  }
}

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
  await page.evaluate((cells: any[]) => {
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const notebook = panel.context.model.sharedModel;
    while (notebook.cells.length) notebook.deleteCell(0);
    cells.forEach((cell, index) => {
      const metadata = cell.nbgrader ? { nbgrader: cell.nbgrader } : {};
      notebook.insertCell(index, {
        cell_type: cell.type,
        metadata,
        source: cell.source
      });
    });
  }, cells);
}

/**
 * Loads a fixture .ipynb into the current notebook via fromJSON.
 */
async function load(page: any, name: string): Promise<void> {
  const raw = fs.readFileSync(path.join(FIXTURES, name), 'utf-8');
  const notebook = JSON.parse(raw);
  await page.evaluate((notebook: any) => {
    const panel = (window as any).jupyterapp.shell.currentWidget;
    panel.context.model.fromJSON(notebook);
  }, notebook);
}

/**
 * Executes `correxit:convert`.
 *
 * nbgrader notebooks first show a conversion confirm, then the
 * passphrase dialog, then a summary dialog after conversion.
 * This helper steps through that sequence and dismisses the summary.
 */
async function convert(page: any): Promise<string[]> {
  const done = page.evaluate(async () => {
    const app = (window as any).jupyterapp;
    await app.commands.execute('correxit:convert');
  });
  const dialog = page.locator('.jp-Dialog');
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  if ((await dialog.locator('input').count()) === 0) {
    await dialog.locator('.jp-mod-accept').click();
    await dialog.waitFor({ state: 'visible', timeout: 5000 });
  }
  await dialog.locator('input').fill('test-passphrase');
  await dialog.locator('.jp-mod-accept').click();
  await done;

  // Dismiss the post-conversion summary dialog if it appears.
  const summary = page.locator('.jp-Dialog');
  const lines: string[] = [];
  try {
    await summary.waitFor({ state: 'visible', timeout: 2000 });
    const body = await summary.locator('.jp-Dialog-body').textContent();
    if (body) lines.push(...body.split('\n').filter(Boolean));
    await summary.locator('.jp-mod-accept').click();
  } catch {
    /* no summary dialog for plain notebooks */
  }
  return lines;
}

/**
 * Returns the rubric shape: cells in notebook order, total points,
 * and a count of console.warn emissions from the convert command.
 *
 * Each cell is [classification, points, references].
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
        const count = refs.filter((ref: any) => ref.cell === id).length;
        return [cell.is, cell.points, count] as [string, number, number];
      });
    const points = cells.reduce((sum: number, [, p]: any) => sum + p, 0);
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
      if ('nbgrader' in ((json.metadata as any) || {})) metadata = false;
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
async function warnings(page: any): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const original = (window as any).__warns_original__ || console.warn;
    (window as any).__warns_original__ = original;
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
      const original = (window as any).__warns_original__;
      if (original) console.warn = original;
      delete (window as any).__warns__;
      delete (window as any).__warns_original__;
    });
    return captured.filter((w: string) => w.includes('nbgrader convert:'));
  };
}

// ── Synthetic cells ──

const answer = (id: string, source = '') => ({
  type: 'code' as const,
  source,
  nbgrader: {
    grade: false,
    grade_id: id,
    locked: false,
    schema_version: 3,
    solution: true
  }
});

const autotest = (id: string, points: number, source = '') => ({
  type: 'code' as const,
  source,
  nbgrader: {
    grade: true,
    grade_id: id,
    locked: false,
    points,
    schema_version: 3,
    solution: false
  }
});

const support = `def __correxit_autotest__(label, actual, expected):
    if actual != expected:
      raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")`;

const invoke = (expr: string, value: string): string =>
  `__correxit_autotest__(${JSON.stringify(expr)}, (${expr}), ${value})`;

const script = (...pairs: [string, string][]): string =>
  [support, '', ...pairs.map(([expr, value]) => invoke(expr, value))].join(
    '\n'
  );

const manual = (id: string, points: number, source = '') => ({
  type: 'code' as const,
  source,
  nbgrader: {
    grade: true,
    grade_id: id,
    locked: false,
    points,
    schema_version: 3,
    solution: true
  }
});

const essay = (id: string, points: number, source = '') => ({
  type: 'markdown' as const,
  source,
  nbgrader: {
    grade: true,
    grade_id: id,
    locked: false,
    points,
    schema_version: 3,
    solution: true
  }
});

const task = (id: string, points: number) => ({
  type: 'markdown' as const,
  source: `Task: ${id}`,
  nbgrader: {
    grade: false,
    grade_id: id,
    locked: false,
    points,
    schema_version: 3,
    solution: false,
    task: true
  }
});

const readonly = (id: string, source = '') => ({
  type: 'markdown' as const,
  source,
  nbgrader: {
    grade: false,
    grade_id: id,
    locked: true,
    schema_version: 3,
    solution: false
  }
});

const plain = (type: 'code' | 'markdown', source = '') => ({
  type,
  source
});

// ── Tests: synthetic cells ──

test.describe('nbgrader conversion (synthetic)', () => {
  test.afterEach(async ({ page }) => {
    await close(page);
  });

  test('converts answer + tests to correctable', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [
      answer(
        'q1',
        [
          'def squares(n):',
          '    ### BEGIN SOLUTION',
          '    return [i**2 for i in range(1, n+1)]',
          '    ### END SOLUTION'
        ].join('\n')
      ),
      autotest('t1', 1, 'assert squares(2) == [1, 4]'),
      autotest('t2', 1, 'assert squares(1) == [1]')
    ]);
    await convert(page);

    const s = await shape(page);
    expect(s.cells).toEqual([['correctable', 2, 2]]);
    expect(s.points).toBe(2);
  });

  test('summary dialog reports cell counts and points', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [
      answer('q1', 'x = 1'),
      autotest('t1', 1, 'assert x == 1'),
      manual('q2', 3, '# explain')
    ]);
    const summary = await convert(page);

    expect(summary.some(line => /rewritten in place/.test(line))).toBe(true);
    expect(
      summary.some(line => /Keep the original nbgrader notebook/.test(line))
    ).toBe(true);
    expect(summary.some(line => /1 auto-graded/.test(line))).toBe(true);
    expect(summary.some(line => /1 manually graded/.test(line))).toBe(true);
    expect(summary.some(line => /4 total points/.test(line))).toBe(true);
    expect(summary.some(line => /Expand the Correxit sidebar/.test(line))).toBe(
      true
    );
  });

  test('conversion can be canceled before rewrite', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [answer('q1', 'x = 1')]);

    const done = page.evaluate(async () => {
      const app = (window as any).jupyterapp;
      await app.commands.execute('correxit:convert');
    });
    const dialog = page.locator('.jp-Dialog');
    await dialog.waitFor({ state: 'visible', timeout: 5000 });
    await dialog.locator('.jp-mod-reject').click();
    await done;

    const enabled = await page.evaluate(() => {
      const app = (window as any).jupyterapp;
      return app.commands.isEnabled('correxit:convert');
    });
    expect(enabled).toBe(true);

    const c = await clean(page);
    expect(c.metadata).toBe(false);
  });

  test('summary dialog surfaces warnings', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [answer('lonely', 'x = 1')]);
    const summary = await convert(page);

    expect(summary.some(line => /No test cells/.test(line))).toBe(true);
  });

  test('strips solution markers from cell source', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [
      answer(
        'q1',
        [
          'def f():',
          '    ### BEGIN SOLUTION',
          '    return 42',
          '    ### END SOLUTION'
        ].join('\n')
      ),
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

  test('maps manually graded markdown to reviewable', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [essay('e1', 3, 'Explain your reasoning.')]);
    await convert(page);

    const s = await shape(page);
    expect(s.cells).toEqual([['reviewable', 3, 0]]);
  });

  test('maps task + unmarked cell to reviewable', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [task('task1', 4), plain('code', '# student work')]);
    await convert(page);

    const s = await shape(page);
    expect(s.cells).toEqual([['reviewable', 4, 0]]);
  });

  test('recalibrates fractional test points to integers', async ({ page }) => {
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

  test('orphan answer becomes reviewable with warning', async ({ page }) => {
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

  test('orphaned test cell is skipped with warning', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    const captured = await warnings(page);
    await populate(page, [autotest('orphan', 3, 'assert True')]);
    await convert(page);

    const w = await captured();
    expect(w.length).toBeGreaterThan(0);
    expect(w[0]).toContain('no preceding answer');

    const s = await shape(page);
    expect(s.cells).toHaveLength(0);
  });

  test('consecutive answers: first flushed as reviewable', async ({ page }) => {
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
    expect(w.some((w: string) => w.includes('No test cells'))).toBe(true);
  });

  test('task followed by graded cell discards task points', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    const captured = await warnings(page);
    await populate(page, [task('task1', 3), manual('m1', 5, '# show work')]);
    await convert(page);

    const w = await captured();
    expect(w.some((w: string) => w.includes('points discarded'))).toBe(true);

    const s = await shape(page);
    expect(s.cells).toEqual([['reviewable', 5, 0]]);
    expect(s.points).toBe(5);
  });

  test('intervening markdown does not break answer-test linkage', async ({
    page
  }) => {
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

  test('test cell sources are preserved after conversion', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    const test = 'assert squares(2) == [1, 4]';
    await populate(page, [
      answer(
        'q1',
        [
          'def squares(n):',
          '    ### BEGIN SOLUTION',
          '    return [i**2 for i in range(1, n+1)]',
          '    ### END SOLUTION'
        ].join('\n')
      ),
      autotest('t1', 1, test)
    ]);
    await convert(page);

    const sources = await page.evaluate(() => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      const notebook = panel.context.model.sharedModel;
      return notebook.cells.map((cell: any) => cell.getSource());
    });
    // Answer cell: solution markers stripped, code preserved
    expect(sources[0]).toBe(
      'def squares(n):\n    return [i**2 for i in range(1, n+1)]'
    );
    // Test cell: source unchanged
    expect(sources[1]).toBe(test);
  });

  test('plain notebook converts with no rubric cells', async ({ page }) => {
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
      manual(
        'm1',
        2,
        [
          'Explain the concept.',
          '=== BEGIN MARK SCHEME ===',
          'Award 2 points for clarity',
          '=== END MARK SCHEME ==='
        ].join('\n')
      )
    ]);
    await convert(page);

    const c = await clean(page);
    expect(c.sources).toBe(true);
  });

  test('autotest directives are expanded into helper calls', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [
      answer('q1', 'def f(x): return x * 2'),
      autotest('t1', 1, '### AUTOTEST f(1)\n### AUTOTEST f(2)')
    ]);
    await convert(page);

    const sources = await page.evaluate(() => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      const notebook = panel.context.model.sharedModel;
      return notebook.cells.map((cell: any) => cell.getSource());
    });
    expect(sources[1]).toBe(script(['f(1)', '2'], ['f(2)', '4']));

    const s = await shape(page);
    expect(s.cells).toEqual([['correctable', 1, 1]]);
  });

  test('expanded autotests score correctly', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [
      answer(
        'q1',
        [
          'def squares(n):',
          '    ### BEGIN SOLUTION',
          '    return [i**2 for i in range(1, n+1)]',
          '    ### END SOLUTION'
        ].join('\n')
      ),
      autotest('t1', 1, '### AUTOTEST squares(2)'),
      autotest('t2', 1, '### AUTOTEST squares(3)')
    ]);
    await convert(page);

    const result = await score(page);
    expect(result.status).toBe('correct');
    expect(result.points).toBe(2);
    expect(result.possible).toBe(2);
  });

  test('semicolon-separated autotests expand to multiple assertions', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [
      answer('q1', 'x = 42'),
      autotest('t1', 1, '### AUTOTEST x; x + 1')
    ]);
    await convert(page);

    const sources = await page.evaluate(() => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      const notebook = panel.context.model.sharedModel;
      return notebook.cells.map((cell: any) => cell.getSource());
    });
    expect(sources[1]).toBe(script(['x', '42'], ['x + 1', '43']));
  });

  test('non-autotest code in test cell is preserved around expansions', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [
      answer('q1', 'x = 10'),
      autotest('t1', 1, '"""verify x"""\n### AUTOTEST x\nassert x > 0')
    ]);
    await convert(page);

    const sources = await page.evaluate(() => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      const notebook = panel.context.model.sharedModel;
      return notebook.cells.map((cell: any) => cell.getSource());
    });
    expect(sources[1]).toBe(
      ['"""verify x"""', support, '', invoke('x', '10'), 'assert x > 0'].join(
        '\n'
      )
    );
  });

  test('HASHED AUTOTEST directives are expanded', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    await populate(page, [
      answer('q1', 'def f(n): return n ** 2'),
      autotest('t1', 1, '### HASHED AUTOTEST f(5)')
    ]);
    await convert(page);

    const sources = await page.evaluate(() => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      const notebook = panel.context.model.sharedModel;
      return notebook.cells.map((cell: any) => cell.getSource());
    });
    expect(sources[1]).toBe(script(['f(5)', '25']));
  });
});

// ── Tests: real fixture notebooks ──

test.describe('nbgrader conversion (fixtures)', () => {
  test.afterEach(async ({ page }) => {
    await close(page);
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

      const state = await shape(page);
      expect(state.cells).toEqual([
        ['correctable', 2, 2],
        ['correctable', 2, 2],
        ['reviewable', 1, 0],
        ['reviewable', 2, 0]
      ]);
      expect(state.points).toBe(7);

      const notes = await captured();
      expect(notes).toHaveLength(0);

      const cleaned = await clean(page);
      expect(cleaned.metadata).toBe(true);
      expect(cleaned.sources).toBe(true);
    });
  }

  test('test-hidden-tests.ipynb: auto-graded only', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    const captured = await warnings(page);
    await load(page, 'test-hidden-tests.ipynb');
    await convert(page);

    const state = await shape(page);
    expect(state.cells).toEqual([
      ['correctable', 3, 3],
      ['correctable', 3, 3]
    ]);
    expect(state.points).toBe(6);
    expect(await captured()).toHaveLength(0);

    const cleaned = await clean(page);
    expect(cleaned.metadata).toBe(true);
    expect(cleaned.sources).toBe(true);
  });

  test('ps1-problem1.ipynb: trailing task discarded', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    const captured = await warnings(page);
    await load(page, 'ps1-problem1.ipynb');
    await convert(page);

    // Same 4 cells as canonical. The trailing task cell has no
    // following unmarked cell, so it is discarded with a warning.
    const state = await shape(page);
    expect(state.cells).toEqual([
      ['correctable', 2, 2],
      ['correctable', 2, 2],
      ['reviewable', 1, 0],
      ['reviewable', 2, 0]
    ]);
    expect(state.points).toBe(7);

    const notes = await captured();
    expect(notes.length).toBe(1);
    expect(notes[0]).toContain('Trailing task');

    const cleaned = await clean(page);
    expect(cleaned.metadata).toBe(true);
    expect(cleaned.sources).toBe(true);
  });

  test('ps1-autotest-problem1.ipynb: task + autotest', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    const captured = await warnings(page);
    await load(page, 'ps1-autotest-problem1.ipynb');
    await convert(page);

    // 6 cells: 2 correctable, 4 reviewable (incl. task → unmarked).
    // The last correctable has 0 pts (autotest with 0-point test).
    const state = await shape(page);
    expect(state.cells).toEqual([
      ['correctable', 2, 2],
      ['correctable', 2, 2],
      ['reviewable', 1, 0],
      ['reviewable', 2, 0],
      ['reviewable', 4, 0],
      ['correctable', 0, 1]
    ]);
    expect(state.points).toBe(11);
    expect(await captured()).toHaveLength(0);

    // Autotest directives should be expanded into runnable helper calls.
    const sources = await page.evaluate(() => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      const notebook = panel.context.model.sharedModel;
      return notebook.cells.map((cell: any) => cell.getSource());
    });
    const autotests = sources.filter((source: string) =>
      source.includes('__correxit_autotest__(')
    );
    expect(autotests.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source).not.toContain('### AUTOTEST');
      expect(source).not.toContain('### HASHED AUTOTEST');
    }

    const cleaned = await clean(page);
    expect(cleaned.metadata).toBe(true);
    expect(cleaned.sources).toBe(true);
  });

  /**
   * Manual-only assignments (no auto-graded cells).
   */
  for (const name of ['ps1-problem2.ipynb', 'ps1-autotest-problem2.ipynb']) {
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

  test('validation-zero-points.ipynb: zero-point test', async ({ page }) => {
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

  // ── Autotest source notebooks ──

  test('autotest-simple.ipynb: single autotest expansion', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    await load(page, 'autotest-simple.ipynb');
    await convert(page);

    const s = await shape(page);
    expect(s.cells).toEqual([['correctable', 1, 1]]);
    expect(s.points).toBe(1);

    // Directives replaced with concrete assertions.
    const sources = await page.evaluate(() => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      const notebook = panel.context.model.sharedModel;
      return notebook.cells.map((cell: any) => cell.getSource());
    });
    for (const source of sources) {
      expect(source).not.toContain('### AUTOTEST');
    }

    const c = await clean(page);
    expect(c.metadata).toBe(true);
    expect(c.sources).toBe(true);
  });

  test('autotest-hidden.ipynb: hidden split + expansion', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    await load(page, 'autotest-hidden.ipynb');
    await convert(page);

    const s = await shape(page);
    // 1 correctable, 2 refs (visible 1pt + hidden 1pt), 2pt total.
    expect(s.cells).toEqual([['correctable', 2, 2]]);
    expect(s.points).toBe(2);

    const sources = await page.evaluate(() => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      const notebook = panel.context.model.sharedModel;
      return notebook.cells.map((cell: any) => cell.getSource());
    });
    for (const source of sources) {
      expect(source).not.toContain('### AUTOTEST');
      expect(source).not.toContain('BEGIN HIDDEN');
      expect(source).not.toContain('END HIDDEN');
    }

    const c = await clean(page);
    expect(c.metadata).toBe(true);
    expect(c.sources).toBe(true);
  });

  test('autotest-hashed.ipynb: hashed autotest expansion', async ({ page }) => {
    await page.goto();
    await page.notebook.createNew();
    await load(page, 'autotest-hashed.ipynb');
    await convert(page);

    const s = await shape(page);
    expect(s.cells).toEqual([['correctable', 1, 1]]);
    expect(s.points).toBe(1);

    const sources = await page.evaluate(() => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      const notebook = panel.context.model.sharedModel;
      return notebook.cells.map((cell: any) => cell.getSource());
    });
    for (const source of sources) {
      expect(source).not.toContain('### AUTOTEST');
      expect(source).not.toContain('### HASHED AUTOTEST');
    }

    const c = await clean(page);
    expect(c.metadata).toBe(true);
    expect(c.sources).toBe(true);
  });

  test('autotest-multi.ipynb: multiple test cells + expansion', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await load(page, 'autotest-multi.ipynb');
    await convert(page);

    const s = await shape(page);
    expect(s.cells).toEqual([['correctable', 4, 4]]);
    expect(s.points).toBe(4);

    const sources = await page.evaluate(() => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      const notebook = panel.context.model.sharedModel;
      return notebook.cells.map((cell: any) => cell.getSource());
    });
    for (const source of sources) {
      expect(source).not.toContain('### AUTOTEST');
      expect(source).not.toContain('### HASHED AUTOTEST');
    }

    const c = await clean(page);
    expect(c.metadata).toBe(true);
    expect(c.sources).toBe(true);
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
  page: any,
  index: number,
  source: string
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
    await close(page);
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

  test('partial credit: one test passes, one fails', async ({ page }) => {
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
      answer(
        'q1',
        [
          'def squares(n):',
          '    ### BEGIN SOLUTION',
          '    return [i**2 for i in range(1, n+1)]',
          '    ### END SOLUTION'
        ].join('\n')
      ),
      autotest('t1', 1, 'assert squares(3) == [1, 4, 9]'),
      autotest('t2', 1, 'assert squares(1) == [1]')
    ]);
    await convert(page);

    // After conversion, solution markers are stripped but the code
    // remains. Simulate a student writing their own implementation.
    await rewrite(
      page,
      0,
      ['def squares(n):', '    return [i**2 for i in range(1, n+1)]'].join('\n')
    );

    const result = await score(page);
    expect(result.status).toBe('correct');
    expect(result.points).toBe(2);
  });

  test('mixed: auto-graded correct + reviewable unscored', async ({ page }) => {
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

// ── Tests: scoring real fixture notebooks ──

test.describe('nbgrader scoring (fixtures)', () => {
  test.afterEach(async ({ page }) => {
    await close(page);
  });

  /**
   * Source notebooks with correct solutions baked into answer cells
   * (inside ### BEGIN SOLUTION markers). After conversion the markers
   * are stripped but the code survives, so every auto-graded reference
   * should pass.
   *
   * All four encode the same logical assignment:
   *   squares (2 pts, 2 test refs) + sum_of_squares (2 pts, 2 test refs)
   *   + 2 reviewable cells (3 pts, unscored by correct())
   */
  for (const name of [
    'test.ipynb',
    'test-v1.ipynb',
    'test-v2.ipynb',
    'test-with-output.ipynb'
  ]) {
    test(`${name}: correct solutions score full auto marks`, async ({
      page
    }) => {
      await page.goto();
      await page.notebook.createNew();
      await load(page, name);
      await convert(page);

      const result = await score(page);
      expect(result.possible).toBe(7);
      expect(result.points).toBe(4);
    });
  }

  test('submitted-changed.ipynb: correct student answer passes all tests', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await load(page, 'submitted-changed.ipynb');
    await convert(page);

    const result = await score(page);
    // Correctable: set_a with a=1. Tests: assert a==1.
    // Passes -> 2/2 auto pts. Reviewables (5 pts) are unscored.
    expect(result.possible).toBe(7);
    expect(result.points).toBe(2);
  });

  test('submitted-unchanged.ipynb: placeholder answer earns partial credit', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await load(page, 'submitted-unchanged.ipynb');
    await convert(page);

    const result = await score(page);
    // Answer cell raises NotImplementedError, so `a` is never defined.
    // Test "foo" (print) passes (no dependency on a). Test "bar"
    // (assert a == 1) fails with NameError. -> 1/2 auto pts.
    expect(result.possible).toBe(7);
    expect(result.points).toBe(1);
  });

  test('test-hidden-tests.ipynb: incomplete solutions fail hidden references', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await load(page, 'test-hidden-tests.ipynb');
    await convert(page);

    const result = await score(page);
    // Solutions hardcode squares(1), squares(2), squares(10) but not
    // squares(11). The hidden references check squares(11) and
    // sum_of_squares(11), which both return None -> fail.
    // Non-hidden refs (invalid_input, uses_squares, visible) pass.
    // -> 4/6 pts.
    expect(result.possible).toBe(6);
    expect(result.points).toBe(4);
  });

  // ── Autotest source notebooks (baked-in solutions) ──

  test('autotest-simple.ipynb: correct solution scores full marks', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await load(page, 'autotest-simple.ipynb');
    await convert(page);

    const result = await score(page);
    expect(result.possible).toBe(1);
    expect(result.points).toBe(1);
    expect(result.status).toBe('correct');
  });

  test('autotest-hidden.ipynb: correct solution passes visible and hidden', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await load(page, 'autotest-hidden.ipynb');
    await convert(page);

    const result = await score(page);
    expect(result.possible).toBe(2);
    expect(result.points).toBe(2);
    expect(result.status).toBe('correct');
  });

  test('autotest-hashed.ipynb: correct solution scores full marks', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await load(page, 'autotest-hashed.ipynb');
    await convert(page);

    const result = await score(page);
    expect(result.possible).toBe(1);
    expect(result.points).toBe(1);
    expect(result.status).toBe('correct');
  });

  test('autotest-multi.ipynb: correct solution scores full marks', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await load(page, 'autotest-multi.ipynb');
    await convert(page);

    const result = await score(page);
    expect(result.possible).toBe(4);
    expect(result.points).toBe(4);
    expect(result.status).toBe('correct');
  });

  // ── Autotest submission notebooks ──

  test('autotest-simple-changed.ipynb: correct answer scores full marks', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await load(page, 'autotest-simple-changed.ipynb');
    await convert(page);

    const result = await score(page);
    expect(result.possible).toBe(1);
    expect(result.points).toBe(1);
  });

  test('autotest-simple-unchanged.ipynb: placeholder scores zero', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await load(page, 'autotest-simple-unchanged.ipynb');
    await convert(page);

    const result = await score(page);
    expect(result.possible).toBe(1);
    expect(result.points).toBe(0);
  });

  test('autotest-hidden-changed-right.ipynb: correct types score full visible marks', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await load(page, 'autotest-hidden-changed-right.ipynb');
    await convert(page);

    // Submission has only visible type-check assertions (no hidden).
    const result = await score(page);
    expect(result.possible).toBe(1);
    expect(result.points).toBe(1);
  });

  test('autotest-hidden-changed-wrong.ipynb: correct types but wrong values still scores', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await load(page, 'autotest-hidden-changed-wrong.ipynb');
    await convert(page);

    // Wrong values but correct types. Submission only has visible
    // type-check assertions, so all pass.
    const result = await score(page);
    expect(result.possible).toBe(1);
    expect(result.points).toBe(1);
  });

  test('autotest-hidden-unchanged.ipynb: placeholder scores zero', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await load(page, 'autotest-hidden-unchanged.ipynb');
    await convert(page);

    const result = await score(page);
    expect(result.possible).toBe(1);
    expect(result.points).toBe(0);
  });

  test('autotest-hashed-changed.ipynb: correct answer scores full marks', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await load(page, 'autotest-hashed-changed.ipynb');
    await convert(page);

    const result = await score(page);
    expect(result.possible).toBe(1);
    expect(result.points).toBe(1);
  });

  test('autotest-hashed-unchanged.ipynb: placeholder scores zero', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await load(page, 'autotest-hashed-unchanged.ipynb');
    await convert(page);

    const result = await score(page);
    expect(result.possible).toBe(1);
    expect(result.points).toBe(0);
  });

  test('autotest-multi-changed.ipynb: partial answer earns 3 of 4', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await load(page, 'autotest-multi-changed.ipynb');
    await convert(page);

    const result = await score(page);
    // a, b, c correct (cells 1, 2 pass); d, e, f wrong (cell 3 fails).
    // fun() correct (cell 4 passes).
    expect(result.possible).toBe(4);
    expect(result.points).toBe(3);
  });

  test('autotest-multi-unchanged.ipynb: placeholder scores zero', async ({
    page
  }) => {
    await page.goto();
    await page.notebook.createNew();
    await load(page, 'autotest-multi-unchanged.ipynb');
    await convert(page);

    const result = await score(page);
    expect(result.possible).toBe(4);
    expect(result.points).toBe(0);
  });
});
