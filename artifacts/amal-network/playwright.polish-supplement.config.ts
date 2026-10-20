import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const runName = process.env.POLISH_SUPPLEMENT_RUN ?? 'supplement';
if (!/^[a-z0-9-]+$/.test(runName)) throw new Error('Invalid POLISH_SUPPLEMENT_RUN');
const evidence = `../../generated-artifacts/polish/${runName}`;
// New presentation gaps only. No webServer, live-write suites or prior matrix.
export default defineConfig({
  testDir: './tests',
  testMatch: 'polish-supplement.spec.ts',
  forbidOnly: true,
  workers: 2,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: `${evidence}/results`,
  reporter: [
    ['list'],
    ['json', { outputFile: `${evidence}/results.json` }],
    ['html', { outputFolder: `${evidence}/report`, open: 'never' }],
  ],
  projects: [
    ...(['ar', 'en'] as const).flatMap(locale => (['light', 'dark'] as const).flatMap(colorScheme =>
      [360, 768, 1024, 1440].map(width => ({
        name: `${locale}-${colorScheme}-${width}`,
        grep: width === 1440 ? /fixture:/ : /fixture:(?! print pagination)/,
        use: { locale, colorScheme, viewport: { width, height: 900 } },
      })))),
    { name: 'native-zoom', grep: /native zoom:/ },
  ],
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
