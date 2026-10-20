import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

export default defineConfig({
  testDir: './tests',
  testMatch: 'pwa.spec.ts',
  outputDir: '../../generated-artifacts/pwa-tests',
  timeout: 60000,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:4178/pwa-check/',
    browserName: 'chromium',
    headless: true,
    serviceWorkers: 'allow',
    launchOptions: existsSync('/repl/tools/bin/chromium') ? { executablePath: '/repl/tools/bin/chromium' } : {},
  },
  webServer: {
    command: 'PORT=4178 BASE_PATH=/pwa-check/ PWA_VERIFY=1 pnpm build && node scripts/serve-pwa-verification.mjs',
    url: 'http://127.0.0.1:4178/pwa-check/index.html',
    reuseExistingServer: false,
    timeout: 120000,
  },
  reporter: [['list']],
});
