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
      bridge?.kernels?.drain?.();
      await sessions.shutdownAll();
      await kernels.refreshRunning().catch(() => {});

      const running = Array.from(kernels.running()) as Array<{ id: string }>;
      await Promise.all(
        running.map(({ id }) => kernels.shutdown(id).catch(() => {}))
      );
    })
    .catch(() => {});
}

export async function notebook(page: any): Promise<string> {
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
    await kernel.waitFor({ state: 'visible', timeout: 4000 });
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

  const name = await notebook(page);
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

/** PGP author fixture; the private key is encrypted with password 'secret'. */
export const keys = {
  private: {
    assignee: null,
    author: `-----BEGIN PGP MESSAGE-----

wy4ECQMITnq1Mhlbifjg9mIyY8Cb+2TDG4Q1VUqA71isIG+ZDMMsSG23Suwc
sUqN0sLPAR1aHTYwJj+Ogq+N4iLiahtQ+3p7WOD1PR8g87Ac+dIOzvLieo8m
aqOaA5qgVWhUYAfKKiDZ2iKo8RacR7cYcL7Nj8ALmX8jnZ3DdPzXs3UyxDOP
zfG50RihYMWLZEzVbBa7fhYDbU0tViYy/9tq+f82Eiz2BZs17L6O1wEkrRP9
rccoAruPoEW81wT6aH3RHYehVt0v2P+Tp2vkGdGkxGs4qxzkX5fvsQeYMt7S
D14Uu7PyZpDj8sveFxj+VjI4Iv62npiKcKQGLy6rczaTrYDsWzG/MPtk1wGV
Pr52l+2cuiOUtJngGqCZ0+3FzD5ZrnK0lrOlG7IJMkkyNfQrvKENrIlA00gI
JPFGS8gPpMJNo5WUkVK3PKJBDsNUdSAvixaa5ng81nxt/UFYP/0cQ/1G/y06
dcQs5Iki9xXOakRI6C8ZlNfup+UE8nPWIG1IDO9tGt+pBn9U8gE2YNnXzz4p
Tgwbt6ZubSXeVI4WgFzbKh7nVC0l5s+PnQwStgJaPfoqJz2NP298eu5syfV/
f6ZlCtyz7Tnxoog/L2bKpHKe3F01DWpPfCcQwZYSad5m8rUHBg71Xs0XkQW7
6hY0TT1N698s1w26xpIfUimEExCTy72yhVyy5BX1hi+DnIQLkiUUWImtmnDK
OtQ+m00R3OwaHEXgJ7v62eeNvD5Q255TASgBuob/4xHNOA5JSQQ9BvIKKYNh
W5z59A89cTutA0eaOeisLqY/cAUjtB6DVXJAafA4d5veb30Jy77dcsjY4TBM
NKa1HDDezfw92TYhxIO8/FuCNsL69+8dU/ObdHtIRZcMBwE11Dx+l4S8IwbI
WioDRoOkbEK55Iwt31q93TTjuDOjkjwFWgVtQqQpAg5Q/HTh/VM1MF7IewWH
Z3P2C28hbTqbH237K6IWhaz2bzBNTNk7LX4T0MsOjtnSQ/1JSa0gdTCLFd11
U2k922Jf5NeHTMNHCNWfIlzL+tVMSbu7Kx+sgCjimisXGPbGpppXgZ8FC7U0
TnJuOzyFecsSAk/xtv1U8q3XqgvEhGLiuLnR5F86qaL5OizB2WKuLkeLWKWw
kYifZ4mMv1+oYJVt/9P4ECm6r/pTPd5pOTMOebRPHtdl607yIH9EOdwEN12Z
jp5keD8PPQjgEGR3INfevHQOzBj7zcyOk4aIoNyH5PZYDcux2Cs7ydpb/5PG
X+veFeTd8zfZiCG9mbvttdI=
=1w3y
-----END PGP MESSAGE-----`
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
