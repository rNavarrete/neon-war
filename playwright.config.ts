import { defineConfig, devices } from '@playwright/test';

// Browser tests drive the built game and assert on the read-only test hook (src/testHook.ts),
// never on pixels. Screenshots they save land in test-results/screens/ for PR review.
const PORT = 4173;

export default defineConfig({
  testDir: 'tests/browser',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results/playwright',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 720 },
    trace: 'off',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
  ],
  webServer: {
    // Called by path: check.mjs runs steps without node_modules/.bin on PATH.
    command: `node node_modules/vite/bin/vite.js build --logLevel warn && node node_modules/vite/bin/vite.js preview --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
