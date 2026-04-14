import { expect, test } from '@jupyterlab/galata';
import { cd, setup } from './utils';

test.use({ autoGoto: false });

type Page = any;
type Output = Record<string, unknown>;
type Cellular = {
  id: string;
  outputs?: Output[];
  points?: number;
};
type Keys = typeof keys;
type Prepared = { directory: string; paths: string[] };

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

async function cleanup(page: Page, { directory, paths }: Prepared) {
  await cd(page, '.');
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

async function close(page: Page) {
  await page.evaluate(() => {
    const app = (window as any).jupyterapp;
    const widgets = Array.from(app.shell.widgets('main')) as Array<{
      dispose: () => void;
      id: string;
    }>;
    for (const widget of widgets) {
      if (widget.id === 'correxit-corrector-widget') widget.dispose();
      if (widget.id === 'correxit-reviewer-widget') widget.dispose();
    }
  });
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
        (rubric: any, { id, points = 5 }) =>
          Rubric.add(rubric, {
            id,
            is: 'reviewable',
            payload: null,
            points,
            references: null
          }),
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

async function active(page: Page) {
  return page.locator('.correxit-reviewer-minimap-cell.cxt-mod-active');
}

async function badge(page: Page) {
  return page.locator('.correxit-reviewer-info');
}

async function comment(page: Page) {
  return page.getByLabel('Reviewer comment');
}

async function focus(page: Page) {
  const cell = await active(page);
  await expect(cell).toBeVisible();
  await cell.focus();
  return cell;
}

async function score(page: Page) {
  return page.getByRole('spinbutton', { name: 'Score' });
}

async function saved(page: any, path: string) {
  return page.evaluate(async (path: string) => {
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
        ? ((notebook as { metadata?: { correxit?: any } }).metadata?.correxit ??
          null)
        : null;
    const score = rubric
      ? Rubric.Score.resolve(rubric.assignment.report, 'manual')
      : null;
    const result = {
      certification: rubric?.assignment.certification !== null,
      comment: score?.comment ?? null,
      locked: rubric?.locked ?? null,
      points: score?.points ?? null,
      status: score?.status ?? null
    };
    return result;
  }, path);
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
  await (await score(page)).fill('4');
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

test('reviewer clears stored outputs when rerun result is empty', async ({
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

  await page.locator('.correxit-reviewer-btn-correct').click();
  await expect(page.getByLabel('Cell outputs')).toHaveCount(0);

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
  await expect(await badge(page)).toContainText('Cell 1 of 2');

  await page.keyboard.press('ArrowDown');
  await expect(await badge(page)).toContainText('Cell 2 of 2');

  await page.keyboard.press('K');
  await expect(await badge(page)).toContainText('Cell 1 of 2');

  await page.keyboard.press('J');
  await expect(await badge(page)).toContainText('Cell 2 of 2');

  await page.keyboard.press('L');
  await expect(await active(page)).toHaveAttribute('aria-label', /bob/);

  await page.keyboard.press('H');
  await expect(await active(page)).toHaveAttribute('aria-label', /alice/);

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

  await (await comment(page)).click();
  await page.keyboard.type('jklp');
  await expect(await badge(page)).toContainText('Cell 1 of 2');
  await expect(await comment(page)).toHaveValue('jklp');
  await expect(await score(page)).toHaveValue('');

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

  const input = await score(page);
  await input.fill('2');
  await input.focus();

  await page.keyboard.press('ArrowDown');
  await expect(await badge(page)).toContainText('Cell 1 of 2');
  await expect(input).toHaveValue('1');

  await page.keyboard.press('F');
  await expect(await badge(page)).toContainText('Cell 1 of 2');
  await expect(input).toHaveValue('1');

  await close(page);
  await cleanup(page, propagated);
  await dispose();
});
