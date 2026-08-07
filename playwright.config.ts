import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const installedBrowser = [
  process.env['PLAYWRIGHT_EXECUTABLE_PATH'],
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => candidate && existsSync(candidate));

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4197',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /electron[\\/]/,
      use: {
        ...devices['Desktop Chrome'],
        ...(installedBrowser ? { launchOptions: { executablePath: installedBrowser } } : {}),
      },
    },
    {
      name: 'electron',
      testMatch: /electron[\\/].*\.spec\.ts$/,
      use: {},
    },
  ],
  webServer: {
    command: 'node tests/e2e/static-server.mjs',
    url: 'http://127.0.0.1:4197',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
