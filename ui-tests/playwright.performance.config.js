const channel = process.env.PLAYWRIGHT_CHROMIUM_CHANNEL;

module.exports = {
  testDir: './performance',
  workers: 1,
  timeout: 600000,
  reporter: [['list']],
  outputDir: './test-results/performance',
  use: {
    viewport: { width: 1280, height: 800 },
    ...(channel ? { channel } : {})
  },
  webServer: [
    {
      command: 'jlpm start',
      url: 'http://localhost:8888/lab',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      stdout: 'pipe',
      stderr: 'ignore'
    },
    {
      command: 'python -m http.server 8890 --directory ../lite/_output',
      url: 'http://localhost:8890/lab/',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      stdout: 'pipe',
      stderr: 'ignore'
    }
  ]
};
