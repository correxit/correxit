import { expect } from './fixtures';

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
  await page.locator('body').evaluate(async (_: Element, path: string) => {
    const app = (window as any).jupyterapp;
    if (app.commands.hasCommand('filebrowser:go-to-path')) {
      await app.commands.execute('filebrowser:go-to-path', { path });
    }
  }, path);
}

export async function shutdown(page: any): Promise<void> {
  await page
    .locator('body')
    .evaluate(async () => {
      const app = (window as any).jupyterapp;
      const bridge = (window as any).__correxit__;
      const { kernels, sessions } = app.serviceManager;
      await sessions.shutdownAll();
      await kernels.refreshRunning().catch(() => {});
      const running = Array.from(kernels.running()) as Array<{ id: string }>;
      await Promise.all(
        running.map(({ id }) => kernels.shutdown(id).catch(() => {}))
      );
      bridge?.kernels?.drain?.();
    })
    .catch(() => {});
}

export async function createNotebook(page: any): Promise<string> {
  const body = page.locator('body');
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const app = (window as any).jupyterapp;
          return {
            bridge: !!(window as any).__correxit__,
            open:
              !!app?.commands?.hasCommand &&
              app.commands.hasCommand('docmanager:open')
          };
        }),
      { timeout: 30000 }
    )
    .toEqual({ bridge: true, open: true });

  const name = await body.evaluate(async () => {
    const app = (window as any).jupyterapp;
    const { contents } = app.serviceManager;
    const file = await contents.newUntitled({ path: '.', type: 'notebook' });
    await app.commands.execute('docmanager:open', { path: file.path });
    return file.path;
  });
  const kernel = page
    .locator('.jp-Dialog')
    .filter({ hasText: 'Select Kernel' });
  try {
    await kernel.waitFor({ state: 'visible', timeout: 1000 });
    await kernel.getByRole('button', { name: 'Select Kernel' }).click();
  } catch {
    /* no kernel picker */
  }
  await page.waitForFunction((name: string) => {
    const panel = (window as any).jupyterapp.shell.currentWidget;
    return panel?.context?.path === name && !panel.context.isDisposed;
  }, name);
  await body.evaluate(async (_: Element, name: string) => {
    const panel = (window as any).jupyterapp.shell.currentWidget;
    if (!panel || panel.context.path !== name) return;
    const settle = (work: Promise<unknown> | null | undefined, ms = 3000) =>
      work
        ? Promise.race([
            work.catch(() => {}),
            new Promise(resolve => window.setTimeout(resolve, ms))
          ])
        : Promise.resolve();
    await panel.context.ready.catch(() => {});
    await settle(panel.sessionContext?.ready);
    await settle(panel.sessionContext?.session?.kernel?.info);
  }, name);
  return name;
}

/**
 * Creates a notebook with the given cells and returns a dispose function.
 */
export async function setup(page: any, cells: Cell[]): Promise<Fixture> {
  await page.goto();
  await cd(page, '.');

  const name = await createNotebook(page);
  expect(name).toBeTruthy();
  await page.waitForFunction((name: string) => {
    const panel = (window as any).jupyterapp.shell.currentWidget;
    return panel?.context?.path === name && !panel.context.isDisposed;
  }, name);
  await page.locator('body').evaluate(
    (_: Element, { cells }: { cells: Cell[] }) => {
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

/**
 * Deletes propagated workbook files and their parent directory.
 */
export async function cleanup(
  page: any,
  { directory, paths }: { directory: string; paths: string[] }
): Promise<void> {
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

/**
 * Disposes corrector and reviewer widgets, then shuts down all sessions.
 */
export async function close(page: any): Promise<void> {
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
  await shutdown(page);
}

/** PGP key pair for test workbooks. */
export const keys = {
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
