import { expect, test as galataTest } from '@jupyterlab/galata';

/**
 * Extends the Galata test fixtures to disable route mocking for kernels,
 * sessions, and terminals. The default Galata fixtures are not option
 * fixtures, so setting them in `use:` config has no effect. This override
 * replaces the worker fixtures with null values, preventing Galata from
 * intercepting those API routes (which can corrupt responses with
 * SyntaxError: Unexpected end of JSON input on slow CI runners).
 */
export const test = galataTest.extend({
  kernels: async ({}, use) => {
    await use(null);
  },
  sessions: async ({}, use) => {
    await use(null);
  },
  terminals: async ({}, use) => {
    await use(null);
  }
});

export { expect };
