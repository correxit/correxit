import { expect, test } from './fixtures';
import { setup } from './utils';

test.use({ autoGoto: false });

async function open(
  page: any,
  args: { id: string; is: 'comparable' | 'correctable'; taken?: string[] }
) {
  await page.waitForFunction((id: string) => {
    const app = (window as any).jupyterapp;
    const panel = app.shell.currentWidget;
    const notebook = panel?.context?.model?.sharedModel;
    return (
      !!panel?.context?.path?.endsWith('.ipynb') &&
      !panel.context.isDisposed &&
      !!notebook?.cells?.some((cell: { id: string }) => cell.id === id) &&
      app.commands.hasCommand('correxit:configure')
    );
  }, args.id);

  // Both evaluates below use locator.evaluate instead of page.evaluate.
  // Galata wraps the Page object in a proxy that intercepts
  // page.evaluate and waits for JupyterLab to settle afterward.
  // Workbook.update fires metadataChanged (triggering the Monitor),
  // and the configure command blocks on user interaction, so the app
  // may never settle within the test timeout. Locator.evaluate is not
  // intercepted by Galata's proxy, so it resolves normally.
  const body = page.locator('body');

  const status = await body.evaluate(
    async (_: Element, { taken }: { taken: string[] }) => {
      const { Workbook, Rubric } = (window as any).__correxit__;
      const panel = (window as any).jupyterapp.shell.currentWidget;
      if (!panel) return 'no-panel';
      let rubric = (r => ({
        ...r,
        key: 'secret',
        assignment: {
          ...r.assignment,
          keys: {
            private: { assignee: null, author: 'priv' },
            public: { assignee: null, author: 'pub' }
          }
        }
      }))(Rubric.create());
      for (const id of taken) {
        rubric = Rubric.add(rubric, {
          id,
          is: 'reviewable',
          payload: null,
          points: 1,
          references: null
        });
      }
      try {
        await Workbook.update(panel, rubric);
      } catch {
        return 'update-failed';
      }
      const opened = Workbook.open(panel, true);
      if (!opened) return 'open-null';
      if (opened.locked) return 'open-locked';
      return 'ok';
    },
    { taken: args.taken || [] }
  );
  if (status !== 'ok') throw new Error(`open: rubric setup: ${status}`);

  // Fire the configure command. The command blocks on user interaction,
  // so it must be scheduled in a later task and left unawaited.
  // Locator.evaluate is still used (rather than page.evaluate) because
  // Galata's page proxy does not intercept it.
  await body.evaluate(
    (_: Element, { id, is }: { id: string; is: string }) => {
      window.setTimeout(() => {
        (window as any).jupyterapp.commands
          .execute('correxit:configure', { id, is })
          .catch((e: Error) => console.error('correxit:configure', e));
      }, 0);
    },
    { id: args.id, is: args.is }
  );

  await page.locator('.correxit-overlay').waitFor({ state: 'visible' });
}

test('selects a reference cell from the keyboard for comparison', async ({
  page
}) => {
  const { dispose } = await setup(page, [
    { id: 'source', source: 'source code' },
    { id: 'note', source: 'note', type: 'markdown' },
    { id: 'taken', source: 'taken code' },
    { id: 'target', source: 'target code' },
    { id: 'extra', source: 'extra code' }
  ]);

  await open(page, { id: 'source', is: 'comparable', taken: ['taken'] });

  const overlay = page.locator('.correxit-overlay');
  const cells = page.locator('.jp-Cell');
  const target = cells.nth(3);
  const extra = cells.nth(4);

  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('Choose a reference cell');
  await expect(overlay).toContainText('Cell 4 selected.');
  await expect(target).toHaveClass(/correxit-target-cell/);

  await page.keyboard.press('ArrowDown');
  await expect(overlay).toContainText('Cell 5 selected.');
  await expect(target).not.toHaveClass(/correxit-target-cell/);
  await expect(extra).toHaveClass(/correxit-target-cell/);

  await page.keyboard.press('ArrowUp');
  await expect(overlay).toContainText('Cell 4 selected.');
  await expect(target).toHaveClass(/correxit-target-cell/);

  await page.keyboard.press('End');
  await expect(overlay).toContainText('Cell 5 selected.');
  await expect(extra).toHaveClass(/correxit-target-cell/);

  await page.keyboard.press('Home');
  await expect(overlay).toContainText('Cell 4 selected.');
  await expect(target).toHaveClass(/correxit-target-cell/);

  await page.keyboard.press('Enter');

  await expect(overlay).toBeHidden();

  await page.waitForFunction(() => {
    const panel = (window as any).jupyterapp.shell.currentWidget;
    const metadata = panel.context.model.sharedModel.getMetadata('correxit');
    return metadata?.cells?.['source']?.references?.[0] === 'target';
  });

  await dispose();
});

test('cancels keyboard selection without changing metadata', async ({
  page
}) => {
  const { dispose } = await setup(page, [
    { id: 'source', source: 'source code' },
    { id: 'target', source: 'target code' }
  ]);

  await open(page, { id: 'source', is: 'comparable' });

  const overlay = page.locator('.correxit-overlay');
  await expect(overlay).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(overlay).toBeHidden();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const panel = (window as any).jupyterapp.shell.currentWidget;
        const metadata =
          panel.context.model.sharedModel.getMetadata('correxit');
        return metadata?.cells?.source || null;
      })
    )
    .toBeNull();

  await dispose();
});

test('keeps pointer selection and rejects invalid targets for correction', async ({
  page
}) => {
  const { dispose } = await setup(page, [
    { id: 'source', source: 'source code' },
    { id: 'note', source: 'note', type: 'markdown' },
    { id: 'taken', source: 'taken code' },
    { id: 'target', source: 'target code' }
  ]);

  await open(page, {
    id: 'source',
    is: 'correctable',
    taken: ['taken']
  });

  const overlay = page.locator('.correxit-overlay');
  const cells = page.locator('.jp-Cell');
  const note = cells.nth(1);
  const target = cells.nth(3);

  await expect(overlay).toBeVisible();

  const noteBox = await note.boundingBox();
  expect(noteBox).toBeTruthy();

  if (noteBox) {
    const x = noteBox.x + noteBox.width / 2;
    const y = noteBox.y + noteBox.height / 2;
    await page.mouse.move(x, y, { steps: 5 });
    await expect(overlay).toContainText('Cell 2 is unavailable.');
    await expect(note).toHaveClass(/correxit-target-cell/);
    await expect(note).toHaveClass(/cxt-mod-exclude/);
    await page.mouse.click(x, y);
  }

  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('Cell 2 is unavailable.');
  await expect(note).toHaveClass(/correxit-target-cell/);
  await expect(note).toHaveClass(/cxt-mod-exclude/);
  await expect(target).not.toHaveClass(/correxit-target-cell/);
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const panel = (window as any).jupyterapp.shell.currentWidget;
        const metadata =
          panel.context.model.sharedModel.getMetadata('correxit');
        return metadata?.cells?.source || null;
      })
    )
    .toBeNull();

  const targetBox = await target.boundingBox();
  expect(targetBox).toBeTruthy();

  if (targetBox) {
    const x = targetBox.x + targetBox.width / 2;
    const y = targetBox.y + targetBox.height / 2;
    await page.mouse.move(x, y, { steps: 5 });
    await expect(overlay).toContainText('Cell 4 selected.');
    await expect(target).toHaveClass(/correxit-target-cell/);
    await expect(target).toHaveClass(/cxt-mod-include/);
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
