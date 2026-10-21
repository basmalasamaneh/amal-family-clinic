import { defineConfig } from '@playwright/test';
import booking from './artifacts/amal-network/playwright.booking.config';
import offline from './playwright.offline.config';

// The real drawer is local-first. Legacy server-preview UI contracts remain
// runnable explicitly, unchanged; their server guarantees are mapped in
// docs/testing/booking-coverage.md, not treated as passing production-UI tests.
const suite = process.env.AMAL_BOOKING_AUDIT_SUITE ?? 'local-first';
if (!['local-first', 'legacy-server-preview'].includes(suite))
  throw new Error('AMAL_BOOKING_AUDIT_SUITE must be local-first or legacy-server-preview');
const legacy = suite === 'legacy-server-preview';

export default defineConfig({
  ...booking,
  testDir: '.',
  testMatch: legacy ? [
    'artifacts/amal-network/tests/booking-live/lifecycle.spec.ts',
    'artifacts/amal-network/tests/booking-live/collisions.spec.ts',
  ] : [
    'artifacts/amal-network/tests/booking-live/local-first.spec.ts',
    'artifacts/amal-network/tests/booking-live/local-first-lifecycle.spec.ts',
    'tests/offline/journey.spec.ts',
  ],
  projects: booking.projects!.map(project => ({ ...project, name: `${suite}-${project.name}` })),
  metadata: {
    bookingAuditSuite: suite,
    legacyServerPreview: 'Retained unchanged; select AMAL_BOOKING_AUDIT_SUITE=legacy-server-preview explicitly. See docs/testing/booking-coverage.md.',
  },
  globalTimeout: 900_000,
  expect: { timeout: 20_000 },
  outputDir: `generated-artifacts/bug-bash/booking/${suite}/results`,
  reporter: [['list'], ['json', { outputFile: `generated-artifacts/bug-bash/booking/${suite}/results.json` }]],
  use: { ...offline.use, serviceWorkers: legacy ? 'block' : 'allow' },
  webServer: offline.webServer,
});
