import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Separate from fixture-rendered smoke tests: missing opt-in is an error, not a skip.
export default defineConfig({
  forbidOnly: true,
  retries: 0,
  testDir: './tests/booking-live',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  outputDir: '../../generated-artifacts/booking/results',
  reporter: [['list'], ['json', { outputFile: '../../generated-artifacts/booking/results.json' }]],
  projects: ['ar', 'en'].flatMap(locale => (['light', 'dark'] as const).map(colorScheme => ({
    name: `${locale}-${colorScheme}`, use: { locale, colorScheme },
  }))),
  use: {
    browserName: 'chromium',
    headless: true,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    launchOptions: {
      executablePath: process.env.HARNESS_CHROMIUM_PATH ??
        (existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined),
    },
    baseURL: process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:80',
    viewport: { width: 1280, height: 900 },
    timezoneId: 'America/New_York',
    // Raw Playwright traces include cookies/headers. Never record authenticated traces.
    trace: 'off', screenshot: 'off', video: 'off',
  },
});
