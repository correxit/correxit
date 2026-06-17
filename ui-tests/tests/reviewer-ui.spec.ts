import { expect, test } from './fixtures';
import { cd, cleanup, close, keys, setup } from './utils';

test.use({ autoGoto: false });

test.beforeEach(() => {
  test.setTimeout(180_000);
});

type Page = any;
type Output = Record<string, unknown>;
type Cellular = {
  id: string;
  is?: 'correctable' | 'reviewable';
  outputs?: Output[];
  points?: number;
  references?:
    | {
        points: number;
        referent: string;
        secret?: boolean;
      }[]
    | null;
};
type Keys = typeof keys;
type Prepared = { directory: string; paths: string[] };

async function batch(page: Page, path: string) {
  await page.evaluate(async (path: string) => {
    const app = (window as any).jupyterapp;
    const stream: AsyncGenerator<any> = await app.commands.execute(
      'correxit-corrector:batch',
      { key: 'secret', path }
    );
    for await (const _ of stream) {
      /* drain */
    }
  }, path);
}

async function launch(page: Page, path: string) {
  await page.evaluate(async (path: string) => {
    const app = (window as any).jupyterapp;
    await app.commands.execute('correxit-corrector:launch', { path });
  }, path);

  const review = page
    .getByRole('button', { name: /^Review reviewable: needs review/ })
    .first();
  await expect(review).toBeVisible();
  await review.click();
  await expect(page.locator('.correxit-reviewer')).toBeVisible();
}

async function prepare(
  page: Page,
  {
    cells = [{ id: 'manual' }],
    roster = ['alice@example.com']
  }: {
    cells?: Cellular[];
    roster?: string[];
  } = {}
): Promise<Prepared> {
  return page.evaluate(
    async ({
      cells,
      keys,
      roster
    }: {
      cells: Cellular[];
      keys: Keys;
      roster: string[];
    }) => {
      const { Rubric, Workbook } = (window as any).__correxit__;
      const app = (window as any).jupyterapp;
      const panel = app.shell.currentWidget;
      const notebook = panel.context.model.sharedModel;

      notebook.setMetadata('kernelspec', {
        display_name: 'Python 3 (ipykernel)',
        language: 'python',
        name: 'python3'
      });

      for (const spec of cells) {
        const cell = notebook.cells.find((cell: any) => cell.id === spec.id);
        if (cell?.cell_type === 'code' && spec.outputs?.length)
          cell.setOutputs(spec.outputs);
      }

      const rubric = cells.reduce(
        (
          rubric: any,
          { id, is = 'reviewable', points = 5, references = null }
        ) =>
          Rubric.add(
            rubric,
            {
              id,
              is,
              payload: null,
              points,
              references:
                references?.map(({ referent }: any) => referent) ?? null
            },
            references?.map(({ points, referent, secret = false }: any) => ({
              cell: id,
              points,
              referent,
              secret
            })) ?? []
          ),
        (base => ({
          ...base,
          key: 'secret',
          assignment: {
            ...base.assignment,
            keys
          }
        }))(Rubric.create())
      );
      await Workbook.update(panel, rubric);
      await app.commands.execute('correxit:assign', {
        roster
      });

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
    { cells, keys, roster }
  );
}

function active(page: Page) {
  return page.locator('.correxit-reviewer-minimap-cell.cxt-mod-active');
}

function badge(page: Page) {
  return page.locator('.correxit-reviewer-info');
}

function comment(page: Page) {
  return page.getByLabel('Reviewer comment');
}

async function focus(page: Page) {
  const cell = active(page);
  await expect(cell).toBeVisible();
  await cell.focus();
  return cell;
}

function score(page: Page) {
  return page.getByRole('spinbutton', { name: 'Score' });
}

async function saved(page: any, path: string, id = 'manual') {
  return page.evaluate(
    async ({ id, path }: { id: string; path: string }) => {
      const { Rubric } = (window as any).__correxit__;
      const app = (window as any).jupyterapp;
      let file: any = null;
      try {
        file = await app.serviceManager.contents.get(path, { content: true });
      } catch {
        return null;
      }
      const notebook = file.type === 'notebook' ? file.content : null;
      const rubric =
        notebook && typeof notebook === 'object'
          ? ((notebook as { metadata?: { correxit?: any } }).metadata
              ?.correxit ?? null)
          : null;
      const score = rubric
        ? Rubric.Score.resolve(rubric.assignment.report, id)
        : null;
      const result = {
        certification: rubric?.assignment.certification !== null,
        comment: score?.comment ?? null,
        locked: rubric?.locked ?? null,
        points: score?.points ?? null,
        status: score?.status ?? null
      };
      return result;
    },
    { id, path }
  );
}

async function status(page: Page, id: string) {
  return page.evaluate((id: string) => {
    const { Rubric, Workbook } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const reviewer = Array.from(app.shell.widgets('main')).find(
      (widget: any) => widget.id === 'correxit-reviewer-widget'
    ) as { workbook?: any } | undefined;
    const workbook = reviewer?.workbook ?? null;
    const rubric = Workbook.open(workbook, true);
    return rubric
      ? (Rubric.Score.resolve(rubric.assignment.report, id)?.status ?? null)
      : null;
  }, id);
}

test('reviewer saves intervention and auto-certifies via UI', async ({
  page
}) => {
  const { dispose } = await setup(page, [{ id: 'manual', source: 'pass' }]);
  const propagated = await prepare(page);
  await cd(page, '.');
  await batch(page, propagated.directory);
  await launch(page, propagated.directory);

  await page.getByLabel('Reviewer comment').fill('Almost correct');
  await score(page).fill('4');
  await page.getByTitle('Pass and advance to next cell').click();

  await expect
    .poll(() => saved(page, propagated.paths[0]))
    .toEqual({
      certification: true,
      comment: 'Almost correct',
      locked: true,
      points: 4,
      status: 'partial'
    });

  await close(page);
  await cleanup(page, propagated);
  await dispose();
});

test('reviewer clears stored outputs when run result is empty', async ({
  page
}) => {
  const { dispose } = await setup(page, [{ id: 'manual', source: 'pass' }]);
  const propagated = await prepare(page, {
    cells: [
      {
        id: 'manual',
        outputs: [
          {
            output_type: 'stream',
            name: 'stdout',
            text: 'stale output\n'
          }
        ]
      }
    ]
  });
  await cd(page, '.');
  await batch(page, propagated.directory);
  await launch(page, propagated.directory);

  const outputs = page.getByLabel('Cell outputs');
  await expect(outputs).toContainText('stale output');

  await page.locator('.correxit-reviewer-btn-run').click();
  await expect(page.getByLabel('Cell outputs')).toHaveCount(0);

  await close(page);
  await cleanup(page, propagated);
  await dispose();
});

test('reviewer run previews outputs without regrading correctable cells', async ({
  page
}) => {
  const { dispose } = await setup(page, [
    { id: 'target', source: 'print("fresh output")' },
    { id: 'ref', source: 'print("fresh output")' },
    { id: 'manual-a', source: 'pass' },
    { id: 'manual-b', source: 'pass' }
  ]);
  const propagated = await prepare(page, {
    cells: [
      {
        id: 'target',
        is: 'correctable',
        points: 5,
        references: [{ points: 5, referent: 'ref', secret: true }]
      },
      { id: 'manual-a' },
      { id: 'manual-b' }
    ]
  });
  await cd(page, '.');
  await batch(page, propagated.directory);
  await launch(page, propagated.directory);

  await page.evaluate(async () => {
    const app = (window as any).jupyterapp;
    await app.commands.execute('correxit-reviewer:pass');
  });
  await expect.poll(() => status(page, 'manual-a')).toBe('correct');

  await page.evaluate(async () => {
    const { Rubric, Workbook } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const reviewer = Array.from(app.shell.widgets('main')).find(
      (widget: any) => widget.id === 'correxit-reviewer-widget'
    ) as { workbook?: any } | undefined;
    const workbook = reviewer?.workbook ?? null;
    const rubric = Workbook.open(workbook, true);
    if (!workbook || !rubric) return;

    const report = {
      ...rubric.assignment.report,
      scores: {
        ...rubric.assignment.report.scores,
        target: { ...Rubric.Score.UNSCORED }
      }
    };
    const updated = await Rubric.sign(rubric, report);
    await Workbook.update(workbook, updated);

    const target = workbook.context.model.sharedModel.cells.find(
      (cell: any) => cell.id === 'target'
    );
    target?.setOutputs?.([
      {
        output_type: 'stream',
        name: 'stdout',
        text: 'stale output\n'
      }
    ]);
  });

  await focus(page);
  await page.keyboard.press('ArrowUp');
  await expect(page.getByLabel('Cell outputs')).toContainText('stale output');
  await expect.poll(() => status(page, 'target')).toBe('unscored');

  await page.locator('.correxit-reviewer-btn-run').click();
  await expect(page.getByLabel('Cell outputs')).toContainText('fresh output');
  await expect(page.getByLabel('Cell outputs')).not.toContainText(
    'stale output'
  );
  await expect.poll(() => status(page, 'target')).toBe('unscored');

  await close(page);
  await cleanup(page, propagated);
  await dispose();
});

test('reviewer navigates with reviewer keyboard bindings', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'alpha', source: 'pass' },
    { id: 'beta', source: 'pass' }
  ]);
  const propagated = await prepare(page, {
    cells: [{ id: 'alpha' }, { id: 'beta' }],
    roster: ['alice@example.com', 'bob@example.com']
  });
  await cd(page, '.');
  await batch(page, propagated.directory);
  await launch(page, propagated.directory);

  await focus(page);
  await expect(badge(page)).toContainText('Cell 1 of 2');

  await page.keyboard.press('ArrowDown');
  await expect(badge(page)).toContainText('Cell 2 of 2');

  await page.keyboard.press('K');
  await expect(badge(page)).toContainText('Cell 1 of 2');

  await page.keyboard.press('J');
  await expect(badge(page)).toContainText('Cell 2 of 2');

  await page.keyboard.press('L');
  await expect(active(page)).toHaveAttribute('aria-label', /bob/);

  const minimap = page.locator('.correxit-reviewer-minimap');
  await expect
    .poll(() =>
      minimap.evaluate(node => {
        const active = node.querySelector(
          '.correxit-reviewer-minimap-cell.cxt-mod-active'
        );
        if (!(active instanceof HTMLElement)) return false;
        const host = node.getBoundingClientRect();
        const cell = active.getBoundingClientRect();
        const center = cell.left + cell.width / 2;
        return center >= host.left && center <= host.right;
      })
    )
    .toBe(true);

  await page.keyboard.press('H');
  await expect(active(page)).toHaveAttribute('aria-label', /alice/);

  await close(page);
  await cleanup(page, propagated);
  await dispose();
});

test('reviewer scores with keyboard shortcuts', async ({ page }) => {
  const { dispose } = await setup(page, [{ id: 'manual', source: 'pass' }]);
  const propagated = await prepare(page);
  await cd(page, '.');
  await batch(page, propagated.directory);
  await launch(page, propagated.directory);

  await focus(page);
  await page.keyboard.press('F');

  await expect
    .poll(() => saved(page, propagated.paths[0]))
    .toEqual({
      certification: true,
      comment: '',
      locked: true,
      points: 0,
      status: 'incorrect'
    });

  await close(page);
  await cleanup(page, propagated);
  await dispose();
});

test('reviewer comment suppresses reviewer keyboard shortcuts', async ({
  page
}) => {
  const { dispose } = await setup(page, [
    { id: 'alpha', source: 'pass' },
    { id: 'beta', source: 'pass' }
  ]);
  const propagated = await prepare(page, {
    cells: [{ id: 'alpha' }, { id: 'beta' }]
  });
  await cd(page, '.');
  await batch(page, propagated.directory);
  await launch(page, propagated.directory);

  await comment(page).click();
  await page.keyboard.type('jklp');
  await expect(badge(page)).toContainText('Cell 1 of 2');
  await expect(comment(page)).toHaveValue('jklp');
  await expect(score(page)).toHaveValue('');

  await close(page);
  await cleanup(page, propagated);
  await dispose();
});

test('reviewer score input suppresses reviewer keyboard shortcuts', async ({
  page
}) => {
  const { dispose } = await setup(page, [
    { id: 'alpha', source: 'pass' },
    { id: 'beta', source: 'pass' }
  ]);
  const propagated = await prepare(page, {
    cells: [{ id: 'alpha' }, { id: 'beta' }]
  });
  await cd(page, '.');
  await batch(page, propagated.directory);
  await launch(page, propagated.directory);

  const input = score(page);
  await input.fill('2');
  await input.focus();

  await page.keyboard.press('ArrowDown');
  await expect(badge(page)).toContainText('Cell 1 of 2');
  await expect(input).toHaveValue('1');

  await page.keyboard.press('F');
  await expect(badge(page)).toContainText('Cell 1 of 2');
  await expect(input).toHaveValue('1');

  await close(page);
  await cleanup(page, propagated);
  await dispose();
});
