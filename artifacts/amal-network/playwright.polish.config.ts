import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const runName = process.env.POLISH_RUN_NAME;
if (runName && !/^[a-z0-9-]+$/.test(runName)) throw new Error('POLISH_RUN_NAME must contain lowercase letters, digits or hyphens');
const evidenceRoot = `../../generated-artifacts/polish${runName ? `/${runName}` : ''}`;

// Attach to an already running preview. Deliberately no webServer or live suites.
export default defineConfig({
  testDir: './tests',
  testMatch: ['polish.spec.ts'],
  forbidOnly: true,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: `${evidenceRoot}/results`,
  reporter: [
    ['list'],
    ['html', { outputFolder: `${evidenceRoot}/report`, open: 'never' }],
    ['json', { outputFile: `${evidenceRoot}/results.json` }],
  ],
  projects: (['ar', 'en'] as const).flatMap(locale =>
    (['light', 'dark'] as const).flatMap(colorScheme =>
      [360, 768, 1024, 1440].map(width => ({
        name: `${locale}-${colorScheme}-${width}`,
        use: { locale, colorScheme, viewport: { width, height: 900 } },
      })),
    ),
  ),
  use: {
    baseURL: process.env.POLISH_BASE_URL ?? (process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:80'),
    browserName: 'chromium',
    headless: true,
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
    timezoneId: 'Asia/Hebron',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: {
      executablePath: process.env.HARNESS_CHROMIUM_PATH ??
        (existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined),
    },
  },
});
