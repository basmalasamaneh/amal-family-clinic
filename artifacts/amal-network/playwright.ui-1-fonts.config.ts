import { defineConfig } from '@playwright/test';
import pwa from './playwright.pwa.config';

// Same isolated production build, mount, host and worker policy as the existing
// PWA suite. No backend/auth fixtures, isolation changes or offline overrides.
export default defineConfig({
  ...pwa,
  forbidOnly: true,
  retries: 0,
  testMatch: 'ui-1-fonts.spec.ts',
  outputDir: '../../generated-artifacts/ui-1-fonts',
});
