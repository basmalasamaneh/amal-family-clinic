import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Attach only to an already-running DEV preview: shellDemo is the existing,
// visibly-labelled presentation fixture, not authentication verification.
export default defineConfig({
  testDir: './tests',
  testMatch: 'ui-1-evidence.spec.ts',
  outputDir: '../../generated-artifacts/ui-1-evidence',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  projects: (['ar', 'en'] as const).flatMap(locale =>
    (['light', 'dark'] as const).map(colorScheme => ({
      name: `${locale}-${colorScheme}`, use: { locale, colorScheme },
    })),
  ),
  use: {
    baseURL: process.env.UI_1_BASE_URL ?? (process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:80'),
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    launchOptions: existsSync('/repl/tools/bin/chromium') ? { executablePath: '/repl/tools/bin/chromium' } : {},
  },
});
