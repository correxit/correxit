import { expect, test as galataTest } from '@jupyterlab/galata';

/**
 * Extends the Galata test fixtures to disable route mocking for kernels,
 * sessions, and terminals. The default Galata fixtures are not option
 * fixtures, so setting them in `use:` config has no effect. This override
 * replaces the worker fixtures with null values, preventing Galata from
 * intercepting those API routes (which can corrupt responses with
 * SyntaxError: Unexpected end of JSON input on slow CI runners).
 */
export const test = galataTest.extend<{ reset: void }>({
  kernels: async ({}, use) => {
    await use(null);
  },
  sessions: async ({}, use) => {
    await use(null);
  },
  terminals: async ({}, use) => {
    await use(null);
  },
  reset: [
    async ({ page }, use) => {
      await use();
      await page
        .evaluate(async () => {
          const app = (window as any).jupyterapp;
          const bridge = (window as any).__correxit__;
          const { kernels, sessions } = app.serviceManager;
          const settle = (work: Promise<unknown>, ms = 10_000) =>
            Promise.race([
              work.catch(() => {}),
              new Promise(resolve => window.setTimeout(resolve, ms))
            ]);

          await settle(sessions.shutdownAll());
          await kernels.refreshRunning().catch(() => {});
          const running = Array.from(kernels.running()) as Array<{
            id: string;
          }>;
          await Promise.all(
            running.map(({ id }) => kernels.shutdown(id).catch(() => {}))
          );
          bridge?.kernels?.drain?.();
        })
        .catch(() => {});
    },
    { auto: true }
  ]
});

export { expect };
