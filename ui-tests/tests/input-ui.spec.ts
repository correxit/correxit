import { expect, test } from '@jupyterlab/galata';
import { setup } from './utils';

test.use({ autoGoto: false });

test('selects a reference cell for comparison', async ({ page }) => {
  const { dispose } = await setup(page, [
    { id: 'source', source: 'source code' },
    { id: 'target', source: 'target code' }
  ]);

  await page.evaluate(async () => {
    const { Workbook, Rubric } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const panel = app.shell.currentWidget;
    await Workbook.update(panel, (r => ({
      ...r,
      key: 'secret',
      assignment: {
        ...r.assignment,
        keys: {
          private: { assignee: null, author: 'priv' },
          public: { assignee: null, author: 'pub' }
        }
      }
    }))(Rubric.create()));
    // This command invokes input.cell, so it can not be awaited.
    void app.commands.execute('correxit:configure', {
      id: 'source',
      is: 'comparable'
    });
  });

  const overlay = page.locator('.correxit-overlay');
  await expect(overlay).toBeVisible();

  const target = page.locator('.jp-Cell').nth(1);
  const box = await target.boundingBox();
  expect(box).toBeTruthy();

  if (box) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await expect(target).toHaveClass(/correxit-target-cell/);
    await page.mouse.click(x, y);
  }

  await expect(overlay).toBeHidden();

  await page.waitForFunction(() => {
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const metadata = panel.context.model.sharedModel.getMetadata('correxit');
    return metadata?.cells?.['source']?.references?.[0] === 'target';
  });

  await dispose();
});
