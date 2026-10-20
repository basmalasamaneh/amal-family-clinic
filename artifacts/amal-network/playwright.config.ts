import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

export default defineConfig({
  testDir: './tests',
  // Production PWA checks own an isolated build/origin in playwright.pwa.config.ts.
  testIgnore: ['**/*.unit.test.ts', '**/pwa.spec.ts'],
  outputDir: '../../generated-artifacts/amal-ui-tests',
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:80',
    headless: true,
    launchOptions: existsSync('/repl/tools/bin/chromium') ? { executablePath: '/repl/tools/bin/chromium' } : {},
  },
  reporter: [['list']],
});
