/**
 * Correxit overview demo.
 *
 * This spec records a ~60-second walkthrough for the README.  It is NOT part
 * of the normal test suite; run it with playwright.demo.config.js:
 *
 *   mamba run -n correxit jlpm playwright test \
 *     --config playwright.demo.config.js tests/demo.spec.ts
 *
 * Phases:
 *   1. Create a Statistics Homework notebook.
 *   2. Initialise a Correxit rubric (background).
 *   3. Open the Correxit sidebar.
 *   4. Configure cells:
 *        q1 correctable → pick test cell t1 via overlay
 *        q2 comparable  → pick reference r2 via overlay
 *        q3 reviewable  → no overlay, direct command
 *   5. Assign a ten-student roster and propagate assignments.
 *   6. Open the Corrector and run batch grading.
 *   7. Open the Reviewer and manually pass the essay cell.
 */

import { expect, test } from './fixtures';
import { cd, cleanup, close, keys, reviewer, setup } from './utils';

test.use({ autoGoto: false });

test('Correxit overview', async ({ page }) => {
  // ── Phase 1: Create the template notebook ──────────────────────────────
  const { dispose } = await setup(page, [
    {
      id: 'intro',
      type: 'markdown',
      source: [
        '# Statistics Homework',
        '',
        'Complete each exercise.',
        'Numerical answers are graded automatically;',
        'the reflection question is reviewed manually.'
      ].join('\n')
    },
    {
      id: 'q1p',
      type: 'markdown',
      source: '## Exercise 1: Mean\nCalculate the **mean** of `data` and assign it to `result`.'
    },
    {
      id: 'q1',
      type: 'code',
      source: [
        'data = [4, 7, 2, 9, 3, 8, 1, 6]',
        'result = sum(data) / len(data)',
        'print(result)'
      ].join('\n')
    },
    {
      // Hidden test cell — encrypted in propagated copies.
      id: 't1',
      type: 'code',
      source: 'assert abs(result - 5.0) < 0.01, f"Expected 5.0, got {result}"'
    },
    {
      id: 'q2p',
      type: 'markdown',
      source: '## Exercise 2: Sorting\nSort `data` in ascending order and print the result.'
    },
    { id: 'q2', type: 'code', source: 'print(sorted(data))' },
    {
      // Reference output — encrypted in propagated copies.
      id: 'r2',
      type: 'code',
      source: 'print([1, 2, 3, 4, 6, 7, 8, 9])'
    },
    {
      id: 'q3p',
      type: 'markdown',
      source: '## Exercise 3: Reflection\nWhy might the mean be misleading for highly skewed data?'
    },
    {
      id: 'q3',
      type: 'code',
      source: 'answer = "The mean is pulled toward extreme values."'
    }
  ]);

  // Apply Affocato Arabica dark theme for the demo recording.
  // Fire-and-forget: if the theme is not installed the test continues unharmed.
  page.evaluate(() => {
    (window as any).jupyterapp.commands
      .execute('apputils:change-theme', { theme: 'Affocato Arabica' })
      .catch(() => {});
  });

  // Auto-dismiss every "File Changed" conflict dialog for the rest of the test.
  // These appear when Workbook.update or the kernelspec stamp causes an on-disk
  // change that diverges from JupyterLab's in-memory document state.
  await page.addLocatorHandler(
    page.locator('.jp-Dialog').filter({ hasText: 'File Changed' }),
    async (dialog: any) => {
      await dialog.getByRole('button', { name: 'Overwrite' }).click();
    }
  );

  await page.waitForTimeout(1500);

  // ── Phase 2: Initialise a base Correxit rubric (background) ────────────
  // Use locator.evaluate (body.evaluate) instead of page.evaluate to avoid
  // the Galata proxy timeout caused by Workbook.update firing metadataChanged.
  const body = page.locator('body');
  await body.evaluate(
    async (_el: Element, k: typeof keys) => {
      const { Rubric, Workbook } = (window as any).__correxit__;
      const panel = (window as any).jupyterapp.shell.currentWidget;
      if (!panel) throw new Error('no panel');
      const base = Rubric.create();
      await Workbook.update(panel, {
        ...base,
        key: 'secret',
        assignment: { ...base.assignment, keys: k }
      });
    },
    keys
  );
  await page.waitForTimeout(600);

  // ── Phase 3: Open the Correxit sidebar ─────────────────────────────────
  await page.evaluate(async () => {
    await (window as any).jupyterapp.commands.execute('correxit:launch');
  });
  await expect(page.locator('.correxit-sidebar')).toBeVisible();
  await page.waitForTimeout(1500);

  // ── Phase 4a: Configure q1 as correctable — overlay → click t1 (index 3) ─
  // The configure command blocks waiting for a cell click, so it must be
  // scheduled via setTimeout and left unawaited (same as input-ui.spec.ts).
  await body.evaluate((_el: Element, { id, is }: { id: string; is: string }) => {
    window.setTimeout(
      () =>
        (window as any).jupyterapp.commands
          .execute('correxit:configure', { id, is })
          .catch((e: Error) => console.error('configure', e)),
      0
    );
  }, { id: 'q1', is: 'correctable' });

  const overlay = page.locator('.correxit-overlay');
  await overlay.waitFor({ state: 'visible' });
  await page.waitForTimeout(800);

  // Click the t1 test cell; the overlay intercepts at these coordinates.
  const t1Cell = page.locator('.jp-Cell').nth(3);
  const t1Box = await t1Cell.boundingBox();
  if (!t1Box) throw new Error('t1 cell bounding box missing');
  await page.mouse.move(
    t1Box.x + t1Box.width / 2,
    t1Box.y + t1Box.height / 2,
    { steps: 12 }
  );
  await page.mouse.click(t1Box.x + t1Box.width / 2, t1Box.y + t1Box.height / 2);
  await overlay.waitFor({ state: 'hidden' });
  await page.waitForTimeout(1200);

  // ── Phase 4b: Configure q2 as comparable — overlay → click r2 (index 6) ─
  await body.evaluate((_el: Element, { id, is }: { id: string; is: string }) => {
    window.setTimeout(
      () =>
        (window as any).jupyterapp.commands
          .execute('correxit:configure', { id, is })
          .catch((e: Error) => console.error('configure', e)),
      0
    );
  }, { id: 'q2', is: 'comparable' });

  await overlay.waitFor({ state: 'visible' });
  await page.waitForTimeout(800);

  const r2Cell = page.locator('.jp-Cell').nth(6);
  const r2Box = await r2Cell.boundingBox();
  if (!r2Box) throw new Error('r2 cell bounding box missing');
  await page.mouse.move(
    r2Box.x + r2Box.width / 2,
    r2Box.y + r2Box.height / 2,
    { steps: 12 }
  );
  await page.mouse.click(r2Box.x + r2Box.width / 2, r2Box.y + r2Box.height / 2);
  await overlay.waitFor({ state: 'hidden' });
  await page.waitForTimeout(1200);

  // ── Phase 4c: Configure q3 as reviewable (no overlay) ─────────────────
  // Reviewable cells are added immediately without blocking on user input.
  await page.evaluate(async () => {
    await (window as any).jupyterapp.commands.execute('correxit:configure', {
      id: 'q3',
      is: 'reviewable'
    });
  });
  await page.waitForTimeout(1500);

  // ── Phase 5: Assign a roster and propagate assignments ─────────────────
  // body.evaluate avoids the Galata proxy timeout when Workbook.assign fires
  // metadataChanged. The sidebar re-renders with the full roster first.
  await body.evaluate((_el: Element, roster: string[]) => {
    return (window as any).jupyterapp.commands.execute('correxit:assign', { roster });
  }, [
    'alice@uni.edu', 'bob@uni.edu', 'carol@uni.edu', 'dave@uni.edu',
    'eve@uni.edu', 'frank@uni.edu', 'grace@uni.edu', 'henry@uni.edu',
    'iris@uni.edu', 'jake@uni.edu'
  ]);
  await page.waitForTimeout(1500);

  const propagated: { directory: string; paths: string[] } =
    await page.evaluate(async () => {
      type Emission = { slots: (string | number)[]; type: string };
      const app = (window as any).jupyterapp;
      const stream = await app.commands.execute('correxit:propagate');
      const log: Emission[] = [];
      for await (const [, emission] of stream) log.push(emission);
      return {
        directory: log.find(({ type }) => type === 'mkdir')!.slots[0] as string,
        paths: log
          .filter(({ type }) => type === 'saved')
          .map(({ slots }) => slots[0] as string)
      };
    });

  // Stamp propagated workbooks with the Python 3 kernelspec so the kernel
  // pool can execute them during batch grading.
  await page.evaluate(async (paths: string[]) => {
    const { contents } = (window as any).jupyterapp.serviceManager;
    for (const path of paths) {
      const file = await contents.get(path, { content: true, type: 'notebook' });
      const nb = file.content;
      nb.metadata = {
        ...nb.metadata,
        kernelspec: {
          display_name: 'Python 3 (ipykernel)',
          language: 'python',
          name: 'python3'
        }
      };
      await contents.save(path, { ...file, content: nb });
    }
  }, propagated.paths);

  await page.waitForTimeout(2000);

  // ── Phase 6: Launch the Corrector and run batch grading ────────────────
  await cd(page, '.');
  await page.evaluate(async (path: string) => {
    await (window as any).jupyterapp.commands.execute(
      'correxit-corrector:launch',
      { path }
    );
  }, propagated.directory);
  await expect(page.locator('.correxit-corrector')).toBeVisible();
  await page.waitForTimeout(1500);

  // Drain the batch-grade generator; the corrector table updates as it runs.
  await page.evaluate(async ({ key, path }: { key: string; path: string }) => {
    const stream = await (window as any).jupyterapp.commands.execute(
      'correxit-corrector:batch',
      { key, path }
    );
    for await (const _ of stream) { /* drain */ }
  }, { key: 'secret', path: propagated.directory });

  await page.waitForTimeout(2500);

  // ── Phase 7: Open the Reviewer and manually pass the reflection cell ───
  const reviewBtn = page
    .getByRole('button', { name: /^Review reviewable: needs review/ })
    .first();
  await expect(reviewBtn).toBeVisible();
  await reviewBtn.click();
  await reviewer(page);
  await page.waitForTimeout(600);

  const passBtn = page.getByTitle('Pass and advance to next cell');
  await expect(passBtn).toBeVisible();
  await passBtn.click();

  // Give the reviewer time to process the score and auto-certify.
  await page.waitForTimeout(2500);

  // ── Cleanup ────────────────────────────────────────────────────────────
  await close(page);
  await cleanup(page, propagated);
  await dispose();
});
