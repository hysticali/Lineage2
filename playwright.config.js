// @ts-check
import { defineConfig, devices } from '@playwright/test';

// Readiness probes must reach the local fixtures even in environments with an
// outbound HTTP proxy. Preserve any existing bypass list.
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(',');
process.env.no_proxy = [process.env.no_proxy, '127.0.0.1', 'localhost'].filter(Boolean).join(',');

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [{
    command: 'python3 -m http.server 4173 --bind 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  }, {
    command: 'node tests/helpers/server.cjs local',
    url: 'http://127.0.0.1:43174/api/health',
    reuseExistingServer: false,
    stdout: 'pipe',
  }, {
    command: 'node tests/helpers/server.cjs private',
    url: 'http://127.0.0.1:43175/api/health',
    reuseExistingServer: false,
    stdout: 'pipe',
  }],
});
