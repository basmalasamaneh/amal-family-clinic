import { defineConfig } from '@playwright/test';
import base from './playwright.admin.config';

export default defineConfig({
  ...base,
  testMatch: ['adoption.spec.ts'],
  outputDir: '../../generated-artifacts/adoption/results',
});
