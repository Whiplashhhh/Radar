import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 8790);
const DATA = process.env.E2E_DATA ?? 'test-results/e2e-data';

const iphone = { ...devices['iPhone 13'], browserName: 'chromium' as const, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } };

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
  },
  // Captures d'abord (état de démo intact), puis tests fonctionnels qui modifient les données.
  projects: [
    { name: 'capture-iphone', testMatch: /captures\.spec/, use: { ...iphone } },
    { name: 'capture-desktop', testMatch: /captures\.spec/, use: { ...desktop } },
    { name: 'iphone', testMatch: /(app|csp)\.spec/, use: { ...iphone }, dependencies: ['capture-iphone', 'capture-desktop'] },
    { name: 'desktop', testMatch: /(app|csp)\.spec/, use: { ...desktop }, dependencies: ['iphone'] },
  ],
  webServer: {
    command: `npx tsx scripts/demo-seed.ts ${DATA} && node dist/server/index.js`,
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { DATA_DIR: DATA, PORT: String(PORT), DISABLE_SCHEDULER: '1', LOG_LEVEL: 'warn' },
  },
});
