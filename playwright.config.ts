import { defineConfig, devices } from '@playwright/test';

const PORT = 5179;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: { baseURL: `http://localhost:${String(PORT)}`, trace: 'off' },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Dev server so DEV-only debug tooling is available to tests.
  webServer: {
    command: `npx vite --port ${String(PORT)} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env['CI'],
  },
});
