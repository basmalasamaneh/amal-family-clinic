import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

export default defineConfig({
  testDir: './tests',
  testMatch: 'sync-live.spec.ts',
  fullyParallel: false, workers: 1, retries: 0, forbidOnly: true,
  timeout: 120_000,
  outputDir: 'generated-artifacts/sync-live/results',
  reporter: [['list']],
  use: {
    baseURL: process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:80',
    browserName: 'chromium', headless: true, locale: 'en',
    timezoneId: 'Asia/Hebron', viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block', trace: 'off', video: 'off', screenshot: 'off',
    launchOptions: { executablePath: process.env.HARNESS_CHROMIUM_PATH ??
      (existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined) },
  },
});
