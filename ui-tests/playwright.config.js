/**
 * Configuration for Playwright using default from @jupyterlab/galata
 */
const baseConfig = require('@jupyterlab/galata/lib/playwright-config');

module.exports = {
  ...baseConfig,
  // All spec files share one Jupyter server and its file system, so tests
  // must run sequentially to avoid cross-file interference.
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 120 * 1000,
  use: {
    ...baseConfig.use,
    actionTimeout: 30 * 1000,
    navigationTimeout: 30 * 1000
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: {
    command: 'jlpm start',
    url: 'http://localhost:8888/lab',
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'ignore'
  }
};
