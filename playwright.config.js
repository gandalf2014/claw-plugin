// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'unit',
      testMatch: '**/unit/**/*.spec.js',
    },
    {
      name: 'e2e',
      testMatch: '**/e2e/**/*.spec.js',
      fullyParallel: false,
      workers: 1,
      retries: 0,
    },
  ],
});
