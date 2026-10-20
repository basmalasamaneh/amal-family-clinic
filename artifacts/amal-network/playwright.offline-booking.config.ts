import { defineConfig } from '@playwright/test';
import pwaVerification from './playwright.pwa.config';

/**
 * Database-free integration evidence: mocked authenticated HTTP, real production
 * PWA build, browser signature verification, IndexedDB, service worker and offline
 * reloads. This does NOT establish live backend/synchronization correctness.
 *
 * Run explicitly:
 * pnpm exec playwright test --config playwright.offline-booking.config.ts
 *
 * Inherits the existing non-root /pwa-check/ build/server harness. Do not run this
 * config concurrently with playwright.pwa.config.ts: both own port 4178/output build.
 */
export default defineConfig({
  ...pwaVerification,
  testMatch: 'offline-booking.spec.ts',
  outputDir: '../../generated-artifacts/offline-booking/results',
  forbidOnly: true,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    ...pwaVerification.use,
    viewport: { width: 1280, height: 960 },
    timezoneId: 'America/New_York', // Booking dates must still be Hebron-local.
    reducedMotion: 'reduce',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  reporter: [
    ['list'],
    ['json', { outputFile: '../../generated-artifacts/offline-booking/results.json' }],
  ],
});
