// Playwright config for recording the README demo video.
// Run via: source ui-tests/demo.sh
// Output: ui-tests/demo.webm (upload to GitHub by dragging into any issue or PR text box).
const baseConfig = require('@jupyterlab/galata/lib/playwright-config');

module.exports = {
  ...baseConfig,
  workers: 1,
  retries: 0,
  timeout: 300 * 1000,
  use: {
    ...baseConfig.use,
    actionTimeout: 60 * 1000,
    navigationTimeout: 60 * 1000,
    // Natural-feeling pacing. 200 ms added to every action.
    slowMo: 200,
    video: {
      mode: 'on',
      size: { width: 1280, height: 800 }
    },
    viewport: { width: 1280, height: 800 }
  },
  reporter: [['list']],
  webServer: {
    command: 'jlpm start',
    url: 'http://localhost:8888/lab',
    timeout: 120 * 1000,
    reuseExistingServer: true,
    stdout: 'pipe',
    stderr: 'ignore'
  }
};
