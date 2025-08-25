import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 1,
  workers: 4,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'playwright-report/report.json' }]
  ],
  // default "use" untuk semua project
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'jr',
      testDir: 'playwright/tests/jr',
      use: {
        baseURL: 'https://wbs.jasaraharja.co.id',
        ...devices['Desktop Chrome'],
        viewport: { width: 1366, height: 768 }, // 👈 override viewport di sini
      },
    },
    {
      name: 'spjr',
      testDir: 'playwright/tests/spjr',
      use: {
        baseURL: 'https://sp-jasaraharja.id',
        ...devices['Desktop Chrome'],
        viewport: { width: 1366, height: 768 }, // 👈 override viewport di sini
      },
    }
  ],
});
