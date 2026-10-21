import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Dedicated, synthetic keyboard observations only; never starts/restarts a server.
const run = process.env.ROLE_KEYBOARD_RUN ?? 'focused';
if (!/^[a-z0-9-]+$/.test(run)) throw new Error('Invalid ROLE_KEYBOARD_RUN');
const evidence = `../../generated-artifacts/role-keyboard/${run}`;
export default defineConfig({
  testDir: './tests',
  testMatch: 'audit-role-keyboard.spec.ts',
  forbidOnly: true,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: `${evidence}/results`,
  reporter: [
    ['list'],
    ['json', { outputFile: `${evidence}/results.json` }],
    ['html', { outputFolder: `${evidence}/report`, open: 'never' }],
  ],
  projects: (['ar', 'en'] as const).flatMap(locale =>
    (['light', 'dark'] as const).map(colorScheme => ({
      name: `${locale}-${colorScheme}`,
      use: { locale, colorScheme, viewport: { width: 1280, height: 900 } },
    }))),
  use: {
    baseURL: process.env.POLISH_BASE_URL ?? 'http://localhost:80',
    browserName: 'chromium',
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
    timezoneId: 'Asia/Hebron',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.HARNESS_CHROMIUM_PATH ??
        (existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined),
    },
  },
});
