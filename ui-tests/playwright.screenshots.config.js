const config = require('./playwright.config');

module.exports = {
  ...config,
  reporter: [['list']],
  testDir: './scenes'
};
