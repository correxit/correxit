/** Optional real-kernel benchmark. Build and link Lite before running this config. */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

for (const environment of ['Lab', 'Lite']) {
  test(`${environment}: Chinook cold, warm, and cached runs`, async ({
    page
  }, info) => {
    page.on('pageerror', error =>
      console.log(environment, 'page error', error.message)
    );
    page.on('console', message => {
      if (message.type() === 'error')
        console.log(environment, 'console error', message.text());
    });
    const { Assignment } = await import('../../lib/node.mjs');
    const source = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../examples/chinook.ipynb'),
        'utf8'
      )
    );
    const database = fs
      .readFileSync(path.resolve(__dirname, '../../examples/chinook.db'))
      .toString('base64');
    const fixtures = await Promise.all(
      Array.from({ length: 12 }, async (_, index) => {
        const name = `student-${index + 1}.ipynb`;
        const assigned = await Assignment.assign({
          notebook: source,
          assignee: `student-${index + 1}@example.com`,
          key: null,
          passphrase: 'xsql',
          file: name
        });
        return { name, notebook: assigned.notebook };
      })
    );
    await page.addInitScript(() => {
      (window as any).galata = {};
    });
    if (environment === 'Lite') {
      await page.route('**/api/workspaces/all.json', route =>
        route.fulfill({ json: {} })
      );
      // Test-only app exposure; the deployed site and its headers are unchanged.
      await page.route('**/jupyter-lite.json*', async route => {
        const response = await route.fetch();
        if (!response.ok()) {
          await route.fulfill({ response });
          return;
        }
        const config = await response.json();
        config['jupyter-config-data'].exposeAppInBrowser = 'true';

        await route.fulfill({ response, json: config });
      });
    }
    await page.goto(
      environment === 'Lab'
        ? 'http://localhost:8888/lab'
        : 'http://localhost:8890/lab/'
    );
    await page.waitForFunction(
      () =>
        !!(window as any).jupyterapp?.commands.hasCommand(
          'correxit-corrector:run'
        ),
      null,
      { timeout: 120000 }
    );
    await page.evaluate(async () => {
      const app = (window as any).jupyterapp;
      await Promise.all([app.started, app.restored, app.serviceManager.ready]);
    });
    const results: any[] = [];
    const directories: string[] = [];
    const prefix = `corrector-performance-${Date.now()}`;
    try {
      for (const size of [3, 12]) {
        const directory = `${prefix}-${size}`;
        directories.push(directory);
        await page.evaluate(
          async ({ directory, fixtures, database }) => {
            const app = (window as any).jupyterapp;
            const contents = app.serviceManager.contents;
            await contents.save(directory, { type: 'directory' });
            await contents.save(`${directory}/chinook.db`, {
              type: 'file',
              format: 'base64',
              content: database
            });
            for (const { name, notebook } of fixtures)
              await contents.save(`${directory}/${name}`, {
                type: 'notebook',
                format: 'json',
                content: notebook
              });
            const workbook = await app.commands.execute('correxit:fetch', {
              path: `${directory}/${fixtures[0].name}`,
              passphrase: 'xsql'
            });
            workbook.context.dispose();
          },
          { directory, fixtures: fixtures.slice(0, size), database }
        );
        if (size === 12) {
          await page.evaluate(async () => {
            const app = (window as any).jupyterapp;
            for (const widget of app.shell.widgets('main'))
              if (widget.id === 'correxit-corrector-widget') widget.dispose();
            (window as any).__correxit__?.kernels.drain();
            await app.serviceManager.sessions.shutdownAll();
          });
        }
        await page.waitForFunction(
          () =>
            !!(window as any).jupyterapp?.commands.hasCommand(
              'correxit-corrector:run'
            )
        );
        await page.evaluate(async () => {
          const app = (window as any).jupyterapp;
          await Promise.all([
            app.started,
            app.restored,
            app.serviceManager.ready
          ]);
        });
        await page.evaluate(async directory => {
          const app = (window as any).jupyterapp;
          await app.commands.execute('correxit-corrector:launch', {
            path: directory
          });
          const widget = Array.from(app.shell.widgets('main')).find(
            (widget: any) => widget.id === 'correxit-corrector-widget'
          ) as any;
          app.shell.activateById(widget.id);
          if (widget.path !== directory) widget.path = directory;
        }, directory);
        await page.screenshot({ path: info.outputPath(`initial-${size}.png`) });
        await expect(
          page
            .locator('#correxit-corrector-widget')
            .getByRole('button', { name: 'Scan', exact: true })
        ).toBeEnabled();
        for (const [index, overwrite] of [true, true, false].entries()) {
          const measured = await page.evaluate(
            async ({ directory, overwrite }) => {
              const app = (window as any).jupyterapp;
              const warnings: any[] = [];
              const model = (window as any).__correxit__?.Workbook;
              const originals: any = {};
              if (model)
                for (const name of ['unlock', 'certify', 'correct']) {
                  originals[name] = model[name];
                  model[name] = async (...args: any[]) => {
                    try {
                      return await originals[name](...args);
                    } catch (error) {
                      warnings.push({ method: name, error: String(error) });
                      throw error;
                    }
                  };
                }
              const start = performance.now();
              const marks: Record<string, number | null> = {
                discovery: null,
                firstRead: null,
                firstExecution: null,
                firstResult: null,
                firstVisible: null,
                total: null
              };
              (window as any).__correctorTiming = { marks, start };
              const sessions = app.serviceManager.sessions;
              const startNew = sessions.startNew.bind(sessions);
              let gap = 0,
                last = start,
                results = 0,
                failures = 0;
              const timer = window.setInterval(() => {
                const now = performance.now();
                gap = Math.max(gap, now - last);
                last = now;
              }, 16);
              const instrument = (kernel: any): any => {
                const execute = kernel.requestExecute.bind(kernel);
                const clone = kernel.clone.bind(kernel);
                kernel.requestExecute = (...args: any[]) => {
                  const timing = (window as any).__correctorTiming;
                  if (timing)
                    timing.marks.firstExecution ??=
                      performance.now() - timing.start;
                  return execute(...args);
                };
                kernel.clone = (...args: any[]) => instrument(clone(...args));
                return kernel;
              };
              sessions.startNew = async (...args: any[]) => {
                const session = await startNew(...args);
                if (session.kernel) instrument(session.kernel);
                return session;
              };
              const execute = app.commands.execute.bind(app.commands);
              let complete: () => void = () => {};
              const done = new Promise<void>(resolve => {
                complete = resolve;
              });
              app.commands.execute = (id: string, args: any) => {
                const pending = execute(id, args);
                if (id !== 'correxit-corrector:run' || args.mode !== 'grade')
                  return pending;
                return pending.then((stream: AsyncIterable<any>) =>
                  (async function* () {
                    try {
                      for await (const event of stream) {
                        const elapsed = performance.now() - start;
                        if (event.type === 'listed') marks.discovery = elapsed;
                        if (event.type === 'read' && event.workbook)
                          marks.firstRead ??= elapsed;
                        if (event.type === 'result') {
                          marks.firstResult ??= elapsed;
                          results++;
                        }
                        if (
                          event.type === 'error' ||
                          (event.type === 'read' && event.error)
                        )
                          failures++;
                        yield event;
                      }
                    } finally {
                      marks.total = performance.now() - start;
                      complete();
                    }
                  })()
                );
              };
              const observer = new MutationObserver(() => {
                if (
                  marks.firstResult !== null &&
                  document.querySelector(
                    '.correxit-corrector-chip.cxt-mod-certified'
                  )
                )
                  marks.firstVisible ??= performance.now() - start;
              });
              observer.observe(document.body, {
                subtree: true,
                childList: true,
                attributes: true
              });
              try {
                const widget = Array.from(app.shell.widgets('main')).find(
                  (widget: any) => widget.id === 'correxit-corrector-widget'
                ) as any;
                widget.content.start({
                  mode: 'grade',
                  overwrite,
                  submitted: false
                });
                await done;
                await new Promise<void>(resolve =>
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve())
                  )
                );
                return {
                  ...marks,
                  maxTimerGap: gap,
                  results,
                  failures,
                  warnings
                };
              } finally {
                window.clearInterval(timer);
                observer.disconnect();
                if (model)
                  for (const [name, original] of Object.entries(originals))
                    model[name] = original;
                (window as any).__correctorTiming = null;
                sessions.startNew = startNew;
                app.commands.execute = execute;
              }
            },
            { directory, overwrite }
          );
          console.log(
            'Measured',
            environment,
            size,
            index,
            JSON.stringify(measured)
          );
          expect(measured.failures).toBe(0);
          expect(measured.results).toBe(size);
          expect(measured.firstVisible).not.toBeNull();
          if (overwrite) expect(measured.firstExecution).not.toBeNull();
          else expect(measured.firstExecution).toBeNull();
          results.push({
            environment,
            size,
            run: ['cold kernels', 'warm regrade', 'cached reports'][index],
            ...measured
          });
          console.log(JSON.stringify(results[results.length - 1]));
        }
      }
      await info.attach('timings', {
        body: JSON.stringify(results, null, 2),
        contentType: 'application/json'
      });
    } finally {
      await page
        .evaluate(async directories => {
          const app = (window as any).jupyterapp;
          for (const widget of app.shell.widgets('main'))
            if (widget.id === 'correxit-corrector-widget') widget.dispose();
          await app.serviceManager.sessions.shutdownAll();
          for (const directory of directories) {
            const contents = app.serviceManager.contents;
            const folder = await contents.get(directory).catch(() => null);
            for (const file of folder?.content ?? [])
              await contents.delete(file.path).catch(() => {});
            await contents.delete(directory).catch(() => {});
          }
        }, directories)
        .catch(() => {});
    }
  });
}
