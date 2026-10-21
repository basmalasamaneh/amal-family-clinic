import { defineConfig } from '@playwright/test';
import booking from './artifacts/amal-network/playwright.booking.config';
import offline from './playwright.offline.config';

// Never emit Playwright's private-DOM error context, authenticated traces or screenshots.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

export default defineConfig({
  ...booking,
  testDir: './tests/performance',
  testMatch: 'journeys.spec.ts',
  globalSetup: './tests/performance/setup.ts',
  projects: [{ name: 'chromium-throttled-en', use: { locale: 'en', colorScheme: 'light' } }],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 300_000,
  globalTimeout: 1_800_000,
  expect: { timeout: 30_000 },
  outputDir: 'generated-artifacts/bug-bash/performance/results',
  reporter: [['list']],
  use: {
    ...booking.use,
    baseURL: 'http://127.0.0.1:4189',
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    timezoneId: 'Asia/Hebron',
    reducedMotion: 'no-preference',
    serviceWorkers: 'block',
    trace: 'off', screenshot: 'off', video: 'off',
  },
  // Build and start once before any measurement; stop with this isolated run.
  webServer: offline.webServer,
});
