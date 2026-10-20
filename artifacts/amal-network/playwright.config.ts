import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

export default defineConfig({
  testDir: './tests',
  testIgnore: '**/*.unit.test.ts',
  outputDir: '../../generated-artifacts/amal-ui-tests',
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:80',
    headless: true,
    launchOptions: existsSync('/repl/tools/bin/chromium') ? { executablePath: '/repl/tools/bin/chromium' } : {},
  },
  reporter: [['list']],
});
