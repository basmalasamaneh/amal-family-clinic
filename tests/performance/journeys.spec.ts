import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { test as bookingTest, type BookingFixture } from '../../artifacts/amal-network/tests/booking-live/fixtures';
import { action, instrument, paint, persist, thresholds, type Sample } from './measure';

const require = createRequire(new URL('../../artifacts/api-server/package.json', import.meta.url));
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const origin = 'http://127.0.0.1:4189';
type Journey = 'login' | 'calendar-booking' | 'patient-lookup' | 'doctor-day' | 'admin-kpi';
type Actor = { email: string; password: string };

// Reuse the booking fixture's synthetic operational rows, independent sessions,
// immutable-source fingerprint checks and scoped cleanup. Only role/linkage differs.
const test = bookingTest.extend<{ actor: Actor; journey: Journey }>({
  journey: ['patient-lookup', { option: true }],
  actor: async ({ f, journey }, use) => {
    if (process.env.AMAL_OFFLINE_E2E !== '1' || process.env.AMAL_DEVELOPER_TOOLS !== '0' ||
        process.env.NODE_ENV !== 'development') throw new Error('Performance audit requires the isolated development host with developer tools disabled');
    if (Object.values(f.before).some(table => table.count !== 0)) {
      throw new Error('Performance audit requires a schema-only disposable DB; source rows must not be copied');
    }
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    const email = `performance-${randomUUID()}@example.invalid`;
    const password = randomUUID();
    try {
      const role = journey === 'login' || journey === 'admin-kpi' ? 'administrator' :
        journey === 'doctor-day' ? 'doctor' : 'receptionist';
      await db.query('BEGIN');
      await db.query(`UPDATE operational.users SET role=$1,email=$2,password_hash=$3,doctor_id=$4 WHERE id=$5`,
        [role, email, await bcrypt.hash(password, 12), role === 'doctor' ? f.doctor : null, f.user]);
      if (role === 'doctor') {
        await db.query('UPDATE operational.doctors SET user_id=$1 WHERE doctor_id=$2 AND clinic_id=$3', [f.user, f.doctor, f.clinic]);
        await db.query(`INSERT INTO operational.patient_doctor_access(patient_id,clinic_id,doctor_id)
          VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [f.patients[0], f.clinic, f.doctor]);
        // Doctor/day is server-Today, never a mocked clock or a hard-coded empty date.
        const today = formatInTimeZone(new Date(), 'Asia/Hebron', 'yyyy-MM-dd');
        await db.query('UPDATE operational.appointments SET scheduled_at=$1 WHERE appointment_id=$2 AND clinic_id=$3',
          [fromZonedTime(`${today}T09:00:00`, 'Asia/Hebron').toISOString(), f.ids[0], f.clinic]);
      }
      if (journey === 'calendar-booking') {
        for (let i = 0; i < f.ids.length; i++) {
          await db.query('UPDATE operational.appointments SET scheduled_at=$1 WHERE appointment_id=$2 AND clinic_id=$3',
            [fromZonedTime(`${bookingDay()}T${String(9 + i).padStart(2, '0')}:00:00`, 'Asia/Hebron').toISOString(), f.ids[i], f.clinic]);
        }
      }
      await db.query('COMMIT');
      await use({ email, password });
    } finally {
      // Extra linkage may also be created by the real booking write.
      // Remove it before the shared fixture removes its scoped users/doctors/patients.
      try {
        await db.query('ROLLBACK');
        await db.query('BEGIN');
        await db.query('DELETE FROM operational.patient_doctor_access WHERE clinic_id=$1', [f.clinic]);
        await db.query("UPDATE operational.users SET role='receptionist',doctor_id=NULL WHERE id=$1", [f.user]);
        await db.query('UPDATE operational.doctors SET user_id=NULL WHERE clinic_id=$1 AND user_id=$2', [f.clinic, f.user]);
        await db.query('DELETE FROM operational.auth_throttles WHERE key_digest=$1',
          [createHash('sha256').update(`account:${email}`).digest('hex')]);
        // The IP-wide throttle is intentionally not reset: it is shared, not fixture-owned.
        // The disposable schema is destroyed by the owning runner.
        await db.query('COMMIT');
      } finally { await db.end(); }
    }
  },
});

async function visible(page: Page, id: string) {
  await page.getByTestId(id).waitFor({ state: 'visible', timeout: 30_000 });
}
async function hidden(page: Page, id: string) {
  await page.getByTestId(id).waitFor({ state: 'hidden', timeout: 30_000 });
}
async function kpiReady(page: Page) {
  await visible(page, 'section-kpi-meta');
  await page.locator('[data-testid="page-kpi"][aria-busy="false"]').waitFor({ timeout: 30_000 });
}
function bookingDay() {
  return formatInTimeZone(new Date(Date.now() + 24 * 60 * 60_000), 'Asia/Hebron', 'yyyy-MM-dd');
}
function route(journey: Journey) {
  return {
    login: '/login',
    'calendar-booking': `/desk/today?date=${bookingDay()}`,
    'patient-lookup': '/desk/patients',
    'doctor-day': '/doctor/my-day',
    'admin-kpi': '/admin/kpi',
  }[journey];
}
async function ready(page: Page, journey: Journey, f: BookingFixture) {
  if (journey === 'login') await visible(page, 'button-submit-password');
  if (journey === 'calendar-booking') {
    await page.locator('[data-testid="page-calendar-day"][data-adapter="real"]').waitFor({ timeout: 30_000 });
    await visible(page, `card-appointment-${f.ids[0]}`);
  }
  if (journey === 'patient-lookup') {
    await visible(page, 'input-patient-search');
    await visible(page, 'button-new-patient');
  }
  if (journey === 'doctor-day') await visible(page, `button-day-open-${f.ids[0]}`);
  if (journey === 'admin-kpi') await kpiReady(page);
}

async function exercise(page: Page, journey: Journey, f: BookingFixture, actor: Actor, sample: Sample) {
  if (journey === 'login') {
    await page.getByTestId('input-email').fill(actor.email);
    await page.getByTestId('input-password').fill(actor.password);
    await action(page, sample, 'password-submit-to-admin-kpi', () => page.getByTestId('button-submit-password').click(),
      () => kpiReady(page));
  }
  if (journey === 'patient-lookup') {
    await action(page, sample, 'search-to-patient-option', () => page.getByTestId('input-patient-search').fill(f.patientNames[0]),
      () => visible(page, `option-patient-${f.patients[0]}`));
    await action(page, sample, 'select-to-patient-detail', () => page.getByTestId(`option-patient-${f.patients[0]}`).click(),
      async () => { await visible(page, 'text-patient-name'); await visible(page, `row-upcoming-${f.ids[0]}`); });
  }
  if (journey === 'doctor-day') {
    await action(page, sample, 'day-row-to-patient-card', () => page.getByTestId(`button-day-open-${f.ids[0]}`).click(),
      () => visible(page, `card-patient-${f.patients[0]}`));
  }
  if (journey === 'admin-kpi') {
    await action(page, sample, 'range-month-to-dashboard', () => page.getByTestId('button-range-month').click(),
      () => kpiReady(page));
  }
  if (journey === 'calendar-booking') {
    await action(page, sample, 'new-booking-to-patient-search', () => page.getByTestId('link-new-booking').click(),
      () => visible(page, 'input-patient-search'));
    await action(page, sample, 'booking-search-to-patient-option', () => page.getByTestId('input-patient-search').fill(f.patientNames[0]),
      () => visible(page, `option-patient-${f.patients[0]}`));
    await page.getByTestId(`option-patient-${f.patients[0]}`).click();
    await page.getByTestId('select-booking-doctor').selectOption(String(f.doctor));
    await page.getByTestId('input-booking-date').fill(bookingDay());
    // Six distinct half-hour slots, avoiding both source fixture appointments and prior runs.
    const slot = (sample.repetition - 1) * 2 + (sample.condition === 'warm' ? 1 : 0);
    await page.getByTestId('input-booking-time').fill(`${13 + Math.floor(slot / 2)}:${slot % 2 ? '30' : '00'}`);
    await page.getByTestId('button-stage-next').click();
    await visible(page, 'button-confirm-booking');
    // Local-first confirmation closes only after the durable local proposal.
    // This measures visible acknowledgement, not server-commit latency.
    await action(page, sample, 'confirm-booking-to-local-acknowledgement',
      () => page.getByTestId('button-confirm-booking').click(),
      () => hidden(page, 'drawer-booking'));
  }
}

for (const journey of ['login', 'calendar-booking', 'patient-lookup', 'doctor-day', 'admin-kpi'] as const) {
  test.describe(journey, () => {
    test.use({ journey });
    test('three paired cold and warm full-document production journeys', async ({ browser, f, actor }) => {
      // Read only a build fingerprint, never source contents into evidence.
      const buildHash = createHash('sha256').update(await readFile('artifacts/amal-network/dist/pwa-verification/index.html')).digest('hex');
      let failed = false;
      for (let repetition = 1; repetition <= 3; repetition++) {
        const context = await f.secondContext();
        // This helper's context defaults intentionally match the production audit, except
        // deviceScaleFactor (Chromium default 1) and reducedMotion (default no-preference).
        const page = await context.newPage();
        page.setDefaultTimeout(30_000);
        page.setDefaultNavigationTimeout(30_000);
        await page.addInitScript(({ user }) => {
          const role = location.pathname.startsWith('/doctor/') ? 'doctor' :
            location.pathname.startsWith('/admin/') || location.pathname === '/login' ? 'admin' : 'front-desk';
          localStorage.setItem(`amal.tour.v1:${encodeURIComponent(`account:${user}`)}:${role}`, 'dismissed');
        }, { user: f.user });
        const meter = await instrument(context, page);
        try {
          for (const condition of ['cold', 'warm'] as const) {
            // Login is genuinely unauthenticated navigation plus a real password POST.
            // Clearing cookies does not clear HTTP/app caches, preserving the warm definition.
            if (journey === 'login') await context.clearCookies();
            const sample: Sample = {
              journey, condition, repetition, status: 'failed',
              navigationKind: `full-document; build-sha256:${buildHash}`,
              auth: journey === 'login' ? 'unauthenticated /login; real synthetic administrator password submission' :
                'synthetic authenticated session fixture; real app/API; credential entry not measured',
              browser: browser.version(), actions: [], api: [], issues: [], misses: [],
            };
            let stage = 'navigate';
            meter.reset();
            try {
              const start = performance.now();
              await page.goto(`${origin}${route(journey)}`, { waitUntil: 'domcontentloaded' });
              stage = 'ui-ready';
              await ready(page, journey, f);
              await paint(page);
              sample.navigationReadyMs = performance.now() - start;
              // Fixed bounded observation, not networkidle (the app has background sync).
              await page.waitForTimeout(1000);
              sample.visual = await meter.visual();
              sample.cache = await meter.cache();
              if (sample.visual.lcpMs === null) sample.issues.push('lcp-unavailable');
              else if (sample.visual.lcpMs > thresholds.lcpMs) sample.misses.push('lcp');
              if (sample.visual.cls > thresholds.cls) sample.misses.push('cls');
              if (!['largest-contentful-paint', 'layout-shift', 'longtask'].every(type => sample.visual!.supported.includes(type))) {
                throw new Error('Required Chromium performance entry type unavailable');
              }
              if (sample.cache.serviceWorkerControlled || sample.cache.serviceWorkerRegistrations) {
                throw new Error('Unexpected service worker in blocked-SW profile');
              }
              stage = 'key-actions';
              await exercise(page, journey, f, actor, sample);
              sample.status = 'ok';
            } catch {
              sample.failureStage = stage;
              // Do not serialize exception text: Playwright errors can contain DOM/input data.
            } finally {
              sample.api = meter.snapshot();
              sample.apiInflightAtCutoff = meter.pendingCount();
              if (sample.apiInflightAtCutoff) sample.issues.push('api-inflight-at-cutoff');
              // An unauthenticated /me 401 is normal during real login, not an API failure.
              if (sample.api.some(request => request.failed || ((request.status ?? 0) >= 400 &&
                  !(journey === 'login' && request.endpoint === 'me' && request.status === 401)))) sample.issues.push('api-failure');
              await persist(sample);
            }
            // Keep all three pairs even after a failed observation; do not cherry-pick
            // successful runs or silently replace an outlier with another repetition.
            if (sample.status !== 'ok') failed = true;
          }
        } finally {
          try { await meter.close(); } finally { await context.close(); }
        }
      }
      if (failed) throw new Error('One or more production journey samples failed; see sanitized per-sample failureStage and API status evidence');
    });
  });
}
