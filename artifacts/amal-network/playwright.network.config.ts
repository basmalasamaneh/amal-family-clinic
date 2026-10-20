import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

export default defineConfig({
  testDir: './tests',
  testMatch: ['network-live.spec.ts', 'network.spec.ts'],
  workers: 1, retries: 0, forbidOnly: true, timeout: 90_000,
  outputDir: '../../generated-artifacts/network/results',
  reporter: [['list'], ['json', { outputFile: '../../generated-artifacts/network/results.json' }]],
  projects: ['ar', 'en'].flatMap(locale => (['light', 'dark'] as const).map(colorScheme => ({
    name: `${locale}-${colorScheme}`, use: { locale, colorScheme },
  }))),
  use: {
    baseURL: process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:80',
    browserName: 'chromium', headless: true, serviceWorkers: 'block',
    reducedMotion: 'reduce', viewport: { width: 1280, height: 900 }, timezoneId: 'America/New_York',
    trace: 'off', screenshot: 'off', video: 'off',
    launchOptions: { executablePath: process.env.HARNESS_CHROMIUM_PATH ??
      (existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined) },
  },
});
