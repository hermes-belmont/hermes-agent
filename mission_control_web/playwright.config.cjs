const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './playwright',
  testMatch: ['**/*.smoke.cjs', '**/*.spec.cjs', '**/*.spec.js', '**/*.spec.ts'],
  use: {
    baseURL: 'http://127.0.0.1:9120',
    trace: 'retain-on-failure',
  },
});
