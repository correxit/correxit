import { expect } from '@jupyterlab/galata';

export interface Cell {
  id: string;
  source: string;
  type?: 'code' | 'markdown';
}

export interface Fixture {
  dispose: () => Promise<void>;
}

/**
 * Change directory in the file browser.
 *
 * After propagation the file browser points at the propagated directory.
 * If the test deletes that directory without resetting, JupyterLab pops a
 * "Directory not found" dialog that blocks subsequent UI interactions.
 */
export async function cd(page: any, path = '.'): Promise<void> {
  await page.evaluate(async (path: string) => {
    const app = (window as any).jupyterapp;
    if (app.commands.hasCommand('filebrowser:go-to-path')) {
      await app.commands.execute('filebrowser:go-to-path', { path });
    }
  }, path);
}

export async function shutdown(page: any): Promise<void> {
  await page
    .evaluate(async () => {
      const app = (window as any).jupyterapp;
      await app.serviceManager.sessions.shutdownAll();
    })
    .catch(() => {});
}

/**
 * Creates a notebook with the given cells and returns a dispose function.
 */
export async function setup(page: any, cells: Cell[]): Promise<Fixture> {
  await page.goto();
  await cd(page, '.');

  const name = await page.notebook.createNew();
  expect(name).toBeTruthy();
  await page.evaluate(
    ({ cells }: { cells: Cell[] }) => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      const notebook = panel.context.model.sharedModel;
      while (notebook.cells.length) {
        notebook.deleteCell(0);
      }
      cells.forEach((cell, index) => {
        notebook.insertCell(index, {
          cell_type: cell.type || 'code',
          id: cell.id,
          metadata: {},
          source: cell.source
        });
      });
    },
    { cells }
  );

  return {
    async dispose() {
      try {
        await cd(page, '.').catch(() => {});
        await page.notebook.close(true).catch(() => {});
        if (name) {
          await page.contents.deleteFile(name).catch(() => {});
        }
      } finally {
        await shutdown(page);
      }
    }
  };
}

/**
 * Wait until reviewer is interactive (not in idle placeholder state).
 */
export async function reviewer(page: any): Promise<void> {
  await expect(page.locator('.correxit-reviewer')).toBeVisible();
  await expect(page.locator('.correxit-reviewer-idle')).toHaveCount(0);
  await expect(
    page.locator(
      '.correxit-reviewer .correxit-reviewer-source[aria-label="Current cell"]'
    )
  ).toBeVisible();
}

/**
 * Wait until corrector is interactive and has a focusable row.
 */
export async function corrector(page: any): Promise<void> {
  await expect(page.locator('.correxit-corrector')).toBeVisible();
  await expect(
    page.locator('.correxit-corrector tbody tr[tabindex="0"]').first()
  ).toBeVisible();
}
