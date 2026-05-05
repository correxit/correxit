import { expect, test } from '../tests/fixtures';
import { captureGroup, polish, Scene, writeManifest } from './screenshots';
import { cd, cleanup, close, keys, setup } from '../tests/utils';

test.use({
  autoGoto: false,
  viewport: { width: 1600, height: 1080 }
});

const scenes: Scene[] = [
  {
    file: 'manual-overdue-policy.png',
    title: 'Manual overdue policy',
    caption:
      'Backendless assignments can record a local deadline rule without changing what the student got right.'
  },
  {
    file: 'corrector-submitted-filter.png',
    title: 'Corrector submitted filter',
    caption:
      'Corrector can optionally require a local submission timestamp when grading manual or backendless workflows.'
  }
];

writeManifest(scenes);

async function configureManualAssignment(page: any): Promise<void> {
  await page.locator('body').evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const rubric = ((created: any) => ({
      ...created,
      key: 'secret',
      assignment: {
        ...created.assignment,
        name: 'Late policy demo',
        keys: {
          private: { assignee: null, author: 'priv' },
          public: { assignee: null, author: 'pub' }
        }
      }
    }))(Rubric.create());
    await Workbook.update(panel, rubric);
  });
}

async function propagate(
  page: any,
  roster: string[]
): Promise<{ directory: string; paths: string[] }> {
  return page.locator('body').evaluate(
    async (_: Element, { keys, roster }: any) => {
      const { Rubric, Workbook } = (window as any).__correxit__;
      const app = (window as any).jupyterapp;
      const panel = app.shell.currentWidget;

      panel.context.model.sharedModel.setMetadata('kernelspec', {
        display_name: 'Python 3 (ipykernel)',
        language: 'python',
        name: 'python3'
      });

      const rubric = Rubric.add(
        ((created: any) => ({
          ...created,
          key: 'secret',
          assignment: {
            ...created.assignment,
            name: 'Submitted filter demo',
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
      for await (const [, emission] of stream) log.push(emission);

      return {
        directory: log.find(({ type }) => type === 'mkdir')?.slots[0] as string,
        paths: log
          .filter(({ type }) => type === 'saved')
          .map(({ slots }) => slots[0] as string)
      };
    },
    { keys, roster }
  );
}

async function markSubmitted(page: any, path: string): Promise<void> {
  await page.locator('body').evaluate(async (_: Element, path: string) => {
    const contents = (window as any).jupyterapp.serviceManager.contents;
    const file = await contents.get(path, {
      content: true,
      type: 'notebook'
    });
    const notebook = file.content;
    const rubric = notebook.metadata.correxit;
    notebook.metadata = {
      ...notebook.metadata,
      correxit: {
        ...rubric,
        assignment: { ...rubric.assignment, submission: 1 },
        revised: 1
      }
    };
    await contents.save(path, { ...file, content: notebook });
  }, path);
}

async function launch(page: any, path: string): Promise<void> {
  await page.locator('body').evaluate(async (_: Element, path: string) => {
    const app = (window as any).jupyterapp;
    await app.commands.execute('correxit-corrector:launch', { path });
  }, path);
}

test.describe('screenshots', () => {
  test('captures manual overdue policy controls', async ({ page }) => {
    const { dispose } = await setup(page, [
      { id: 'cell', source: 'print(42)' }
    ]);
    await polish(page);
    await configureManualAssignment(page);

    await page.locator('body').evaluate(() => {
      void (window as any).jupyterapp.shell.activateById('correxit-sidebar');
    });
    await expect(page.locator('#correxit-sidebar')).toBeVisible();

    const deadline = page.locator(
      'input[name="correxit-assignment-expiration"]'
    );
    const overdue = page.locator('select[name="correxit-assignment-overdue"]');
    const penalty = page.locator('input[name="correxit-assignment-penalty"]');
    const roster = page.locator('textarea[name="correxit-assignment-roster"]');

    await expect(deadline).toBeVisible();
    await deadline.fill('2026-04-21T12:00');
    await overdue.selectOption('dock');
    await penalty.fill('25');
    await roster.fill('alice@example.com\nbob@example.com');

    await expect
      .poll(async () =>
        page.locator('body').evaluate(() => {
          const { Workbook } = (window as any).__correxit__;
          const panel = (window as any).jupyterapp.shell.currentWidget;
          const rubric = Workbook.open(panel, true);
          return rubric
            ? {
                overdue: rubric.assignment.overdue,
                penalty: rubric.assignment.penalty,
                roster: rubric.assignment.roster
              }
            : null;
        })
      )
      .toEqual({
        overdue: 'dock',
        penalty: 25,
        roster: ['alice@example.com', 'bob@example.com']
      });

    await captureGroup(
      page,
      [
        page.locator('#correxit-sidebar .correxit-sidebar-header'),
        page.locator('#correxit-sidebar .correxit-assignment')
      ],
      scenes[0].file,
      { padding: 8, within: page.locator('#correxit-sidebar') }
    );
    await dispose();
  });

  test('captures corrector submitted filter', async ({ page }) => {
    const { dispose } = await setup(page, [
      { id: 'ref', source: 'print(42)' },
      { id: 'target', source: 'answer = 42\nprint(answer)' }
    ]);
    await polish(page);

    const propagated = await propagate(page, [
      'alice@example.com',
      'bob@example.com'
    ]);
    await markSubmitted(page, propagated.paths[0]);
    await cd(page, '.');
    await launch(page, propagated.directory);

    const rows = page.locator('.correxit-corrector tbody tr[data-path]');
    await expect(rows).toHaveCount(2);

    await page
      .getByRole('checkbox', {
        name: 'Only include locally submitted workbooks'
      })
      .check();
    await page.getByRole('button', { name: 'Execute selected mode' }).click();

    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('alice@example.com');

    await captureGroup(
      page,
      [page.locator('#correxit-corrector-widget .jp-Toolbar'), rows.first()],
      scenes[1].file,
      { padding: 8, within: page.locator('#correxit-corrector-widget') }
    );

    await close(page);
    await cleanup(page, propagated);
    await dispose();
  });
});
