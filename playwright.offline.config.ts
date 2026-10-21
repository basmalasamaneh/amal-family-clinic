import { defineConfig } from '@playwright/test';
import booking from './artifacts/amal-network/playwright.booking.config';

// Playwright's automatic error context otherwise includes a full private DOM.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
if (process.env.AMAL_OFFLINE_E2E !== '1' || process.env.AMAL_BOOKING_DISPOSABLE !== '1')
  throw new Error('Requires AMAL_OFFLINE_E2E=1 AMAL_BOOKING_DISPOSABLE=1 and development prerequisites; never skipped');

export default defineConfig({
  ...booking,
  testDir: './tests/offline',
  testMatch: 'journey.spec.ts',
  timeout: 120_000,
  globalTimeout: 600_000,
  expect: { timeout: 20_000 },
  outputDir: 'generated-artifacts/offline-live/results',
  reporter: [['list'], ['json', { outputFile: 'generated-artifacts/offline-live/results.json' }]],
  use: { ...booking.use, baseURL: 'http://127.0.0.1:4189', serviceWorkers: 'allow' },
  webServer: {
    command: 'NODE_ENV=production PORT=4189 BASE_PATH=/ PWA_VERIFY=1 pnpm --filter @workspace/amal-network build && NODE_ENV=development AUTH_ALLOWED_ORIGINS=http://127.0.0.1:4189 pnpm exec tsx tests/offline/server.ts',
    url: 'http://127.0.0.1:4189',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
