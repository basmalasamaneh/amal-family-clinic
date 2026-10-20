import { test, expect, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { AdminAuditAction } from '@workspace/api-client-react';
import { bootAdmin, exampleClinic } from './helpers/admin-fixtures';

// Presentation-only synthetic responses, following admin/doctor/network/adoption suites.
// Do NOT import edit-fixture, booking-live fixtures, or reception-live (they write DB).
const CLINIC = 76543;
const DOCTOR = 87654;
const PATIENT = 98761;
const stamp = '2026-10-20T09:00:00Z';
type Role = 'admin' | 'front-desk' | 'doctor' | 'anonymous';
type Mode = 'populated' | 'empty' | 'error' | 'forbidden';
const person = {
  id: PATIENT, clinicId: CLINIC, name: 'Synthetic Cedar · مريض تجريبي طويل الاسم',
  phone: '0590000000', dateOfBirth: '1990-01-01',
};
const card = {
  id: PATIENT, name: person.name, identityVerified: false, effectiveConsentLevel: 'clinical',
  visits: [{
    clinicId: CLINIC, doctorId: DOCTOR, clinicName: exampleClinic().name,
    doctorName: 'Synthetic Doctor · طبيب تجريبي', seenAt: stamp, visibility: 'clinical',
    complaint: 'Synthetic presentation-only note · ملاحظة تجريبية', alerts: [], keyAlerts: [],
  }],
};
const envelope = (items: unknown[]) => ({ items, nextCursor: null });
const failure = (status = 503) => ({
  status, json: { code: status === 403 ? 'FORBIDDEN' : 'INTERNAL',
    messageKey: status === 403 ? 'error.forbidden' : 'error.internal', params: {} },
});
const rate = (numerator = 0, denominator = 0) => ({
  numerator, denominator, ratio: denominator ? numerator / denominator : null,
  percent: denominator ? numerator / denominator * 100 : null,
});
const sources = { phone: 4, 'walk-in': 2, calendar: 0, 'amal-network': 1, unknown: 0 };
function kpiFixture() {
  // Same aggregate shape as kpi.spec.ts, independently synthetic; unavailable != zero.
  const metrics = {
    totalAppointments: 7, completed: 5,
    collisions: { sameDoctorSameStartPairs: 1, samePatientSameStartCrossClinicPairs: 0 },
    noShow: rate(1, 7), bookingsBySource: sources,
    clinics: [{ clinicId: CLINIC, clinicName: exampleClinic().name, totalAppointments: 7,
      completed: 5, collisions: { sameDoctorSameStartPairs: 1, samePatientSameStartCrossClinicPairs: 0 },
      noShow: rate(1, 7), bookingsBySource: sources }],
    weekdays: Array.from({ length: 7 }, (_, weekday) => ({ weekday, noShow: rate(), bookingsBySource: sources })),
    definitions: { collisions: 'Synthetic collision definition', clinicAttribution: 'Synthetic attribution',
      noShow: 'Synthetic no-show definition', sources: 'Synthetic sources', weekday: 'Synthetic weekday' },
  };
  const period = { startDate: '2026-10-13', endDateExclusive: '2026-10-20',
    start: '2026-10-12T21:00:00Z', end: '2026-10-19T21:00:00Z', days: 7, timezone: 'Asia/Hebron' };
  return {
    range: 'week', appointments: 7, completed: 5, noShowRate: 1 / 7,
    periodStart: period.start, periodEnd: period.end, calculationVersion: 'synthetic-polish',
    generatedAt: stamp, scope: { clinicId: null }, comparison: { equalExposure: false, note: 'Synthetic comparison' },
    before: { period, provenance: 'Synthetic before', metrics },
    after: { period, provenance: 'Synthetic after', metrics, telemetry: {
      conflicts: { daily: [{ date: '2026-10-13', blocked: 1, warnings: 0, overrides: 0,
        cumulativeBlocked: 1, cumulativeWarnings: 0, cumulativeOverrides: 0 }],
      cumulative: { blocked: 1, warnings: 0, overrides: 0 }, coverage: 'Synthetic coverage' },
      lookupTime: { available: false, reason: 'LOOKUP_DURATION_PRODUCER_UNAVAILABLE',
        medianSeconds: null, sampleCount: null, measurementBoundaries: 'Synthetic boundaries' },
      networkActivity: { available: false, reason: 'LOGICAL_NETWORK_LOOKUP_PRODUCER_UNAVAILABLE', daily: null },
      downtime: { receivedCreates: 1, synced: 1, conflicted: 0, rejected: 0, pending: 0,
        queued: { available: false, reason: 'CLIENT_QUEUE_NOT_OBSERVED', value: null },
        lost: { available: false, reason: 'CLIENT_LOSS_NOT_OBSERVED', value: null }, coverage: 'Synthetic coverage' },
    } },
    adoption: { clinics: [{ clinicId: CLINIC, clinicName: exampleClinic().name, state: 'full', joinedAt: stamp }],
      counts: { trial: null, lite: 0, full: 1 },
      history: { available: false, reason: 'ADOPTION_TRANSITION_HISTORY_UNAVAILABLE' }, coverage: 'Synthetic coverage' },
  };
}

async function fixture(page: Page, info: TestInfo, role: Role, mode: Mode = 'populated') {
  const locale = info.project.use.locale ?? 'en';
  const theme = info.project.use.colorScheme ?? 'light';
  const writes: string[] = [];
  await bootAdmin(page, { role, locale, theme });
  await page.addInitScript(p => {
    localStorage.setItem('amal.locale', p.locale);
    localStorage.setItem('amal.theme', p.theme);
    localStorage.setItem('amal.display.v1:fixture%3Afront-desk', JSON.stringify({
      locale: p.locale, theme: p.theme, digitPreference: 'latn',
    }));
    localStorage.setItem('amal.tour.v1:fixture%3Afront-desk:front-desk', 'dismissed');
  }, { locale, theme });
  // Registered last, so every API mutation is intercepted BEFORE bootAdmin's
  // synthetic creation handler. Even accidental destructive clicks cannot hit a server.
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    // Selecting a network result legitimately emits optional timing telemetry.
    // Consume it entirely in-browser; it must never reach operational storage.
    if (req.method() === 'POST' && path === '/api/kpis/lookup-duration')
      return route.fulfill({ status: 204 });
    if (req.method() !== 'GET') {
      writes.push(`${req.method()} ${path}`);
      return route.fulfill({ status: 405, json: { code: 'POLISH_READ_ONLY', messageKey: 'error.forbidden', params: {} } });
    }
    const json = (value: unknown) => route.fulfill({ json: value });
    if (path === '/api/demo/context') return json({ enabled: false, generation: null, clinicId: null, outage: false });
    if (path === '/api/me') return role === 'anonymous'
      ? route.fulfill({ status: 401, json: {} })
      : json({ id: 42, email: 'synthetic@example.invalid', role,
        clinicId: role === 'admin' ? null : CLINIC, doctorId: role === 'doctor' ? DOCTOR : null,
        locale, theme, csrfToken: 'test-only-csrf', device: null,
        session: { expiresAt: '2099-01-01T00:00:00Z', absoluteExpiresAt: null, idleTimeoutSeconds: 1800 },
        reauth: { required: false, validUntil: null } });
    // No forged offline permit: unsigned fixtures must lock on actual connectivity loss.
    if (path.startsWith('/api/auth/offline-permit')) return route.fulfill(failure());
    if (path === '/api/clinics' || path === '/api/admin/clinics')
      return json(envelope([path.includes('/admin/') ? exampleClinic() :
        { id: CLINIC, name: exampleClinic().name, mode: 'network', timezone: 'Asia/Hebron' }]));
    const domain = ['/api/doctor/day', '/api/patients/duplicates', '/api/network/lookup'].includes(path);
    if (domain && (mode === 'error' || mode === 'forbidden'))
      return route.fulfill(failure(mode === 'forbidden' ? 403 : 503));
    if (path === '/api/kpis') return json(kpiFixture());
    if (path === '/api/admin/developer/status')
      return json({ generation: '12345678-1234-1234-1234-123456789abc',
        clinics: [{ id: CLINIC, name: exampleClinic().name, outage: false }] });
    if (path === '/api/doctors') return json(envelope([
      { id: DOCTOR, clinicId: CLINIC, name: 'Synthetic Doctor · طبيب تجريبي', specialty: 'Synthetic specialty' },
    ]));
    if (path === '/api/patients') return json(envelope(mode === 'empty' ? [] : [person]));
    if (path === '/api/patients/duplicates') return json(envelope([]));
    if (path === `/api/patients/${PATIENT}`) return json(person);
    if (path === `/api/patients/${PATIENT}/consent`) return json({
      patient: { id: PATIENT, name: person.name }, current: null, history: [],
      effectiveLevel: 'none', canWithdraw: false,
      eligibility: { dateOfBirth: person.dateOfBirth, ageStatus: 'adult', asOfDate: '2026-10-20' },
    });
    if (path === '/api/appointments') return json(envelope([{
      id: 98765, clinicId: CLINIC, doctorId: DOCTOR, patientId: PATIENT,
      patientName: person.name, startsAt: '2026-10-20T07:00:00Z', endsAt: '2026-10-20T07:30:00Z',
      status: 'booked', source: 'phone', bookingMethod: 'phone', version: 1,
    }]));
    if (path === '/api/appointments/availability')
      return json({ items: [], durationMinutes: 30, checkedAt: stamp });
    if (path === '/api/doctor/day') return json({ day: '2026-10-20', ...envelope(mode === 'empty' ? [] : [{
      id: 98765, startsAt: '2026-10-20T07:00:00Z', status: 'booked', patient: card,
    }]) });
    if (path === `/api/doctor/patients/${PATIENT}`) return json(card);
    if (path === '/api/network/lookup') return json(envelope(mode === 'empty' ? [] : [card]));
    if (path === '/api/doctor/privacy') return json({
      clinic: { id: CLINIC, name: exampleClinic().name }, mode: 'full',
      effectiveSharing: 'consent', trialStateAvailable: false,
    });
    if (path === '/api/audit') return json(envelope([]));
    if (path === `/api/clinics/${CLINIC}/adoption`) return json({
      clinicId: CLINIC, state: 'trial', membershipStatus: 'active', changedAt: stamp, trialStartedAt: stamp,
      liteStartedAt: null, fullStartedAt: null, leftAt: null, leftBy: null,
      capabilities: { canManage: role === 'doctor', canExport: role === 'doctor',
        canLeave: role === 'doctor', localBooking: true, networkSharing: false },
      allowedTransitions: role === 'doctor' ? ['lite', 'full'] : [],
    });
    if (path === '/api/adoption/results') return json({
      available: false, reason: 'SCENARIO_UNCONFIGURED', generatedAt: stamp,
      calculationVersion: 'synthetic-polish', clinics: [],
    });
    return route.fallback(); // Existing admin GET fixtures; their catch-all is 503, never network.
  });
  return writes;
}

const rawKey = /\b(?:shell|adm|dev|bk|rx|cs|doc|net|im|adoption|kpi|offline|sync|auth|data|help|tour|cal|alerts)\.[A-Za-z][\w.-]*\b|\{\{[^}]+\}\}/g;
// Administrative event IDs are legitimate API taxonomy, not i18n keys. Keep an
// exact contract-derived allowlist rather than suppressing an entire namespace.
const auditTaxonomy = new Set<string>(Object.values(AdminAuditAction));
async function publicDisplay(page: Page, info: TestInfo) {
  // Anonymous shell intentionally starts AR/light and does not inherit an
  // account's persisted settings. Exercise its actual visible display controls.
  await page.getByTestId(`button-locale-${info.project.use.locale}`).click();
  await page.getByTestId(`button-theme-${info.project.use.colorScheme}`).click();
}
async function review(page: Page, info: TestInfo, label: string) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('html')).toHaveAttribute('lang', info.project.use.locale!);
  await expect(page.locator('html')).toHaveAttribute('dir', info.project.use.locale === 'ar' ? 'rtl' : 'ltr');
  await expect(page.locator('html')).toHaveAttribute('data-theme', info.project.use.colorScheme!);
  const shot = info.outputPath(`${label}.png`);
  await page.screenshot({ path: shot, fullPage: true, animations: 'disabled' });
  await info.attach(label, { path: shot, contentType: 'image/png' });
  // Scrollable tables/calendar regions are allowed; document-level overflow is not.
  expect.soft(await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${label}: document overflow`).toBe(true);
  const untranslated = ((await page.locator('body').innerText()).match(rawKey) ?? [])
    .filter(value => !auditTaxonomy.has(value));
  expect.soft(untranslated, `${label}: untranslated keys`).toEqual([]);
  for (const action of await page.getByRole('button').or(page.getByRole('link')).all()) {
    if (await action.isVisible()) await expect.soft(action, `${label}: unnamed action`).toHaveAccessibleName(/\S/);
  }
  const result = await new AxeBuilder({ page }).analyze();
  await info.attach(`${label}-axe`, { body: JSON.stringify(result.violations, null, 2), contentType: 'application/json' });
  const blocking = result.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
  expect.soft(blocking.map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => n.target) })),
    `${label}: axe critical/serious`).toEqual([]);
}

const routes: { role: Role; path: string; ready: string; label: string }[] = [
  { role: 'admin', path: '/admin/kpi', ready: 'chart-weekday', label: 'admin-kpi' },
  { role: 'admin', path: '/admin/network-health', ready: `card-health-${CLINIC}`, label: 'admin-health' },
  { role: 'admin', path: '/admin/users-devices', ready: 'button-add-user', label: 'admin-users' },
  { role: 'admin', path: '/admin/clinics-doctors', ready: 'button-add-clinic', label: 'admin-clinics-doctors' },
  { role: 'admin', path: '/admin/audit', ready: 'row-audit-98765', label: 'admin-audit' },
  { role: 'admin', path: '/admin/developer', ready: 'button-developer-refresh', label: 'admin-developer' },
  { role: 'front-desk', path: '/desk/today?date=2026-10-20&shellDemo=front-desk', ready: 'calendar-day', label: 'desk-day' },
  { role: 'front-desk', path: '/desk/week?date=2026-10-20&shellDemo=front-desk', ready: 'calendar-week', label: 'desk-week' },
  { role: 'front-desk', path: '/desk/new-booking?shellDemo=front-desk', ready: 'drawer-booking', label: 'desk-booking' },
  { role: 'front-desk', path: '/desk/patients', ready: 'input-patient-search', label: 'desk-patients' },
  { role: 'front-desk', path: '/desk/consent', ready: 'state-consent-guard', label: 'desk-consent-guard' },
  { role: 'front-desk', path: '/desk/sync', ready: 'empty-queue', label: 'desk-sync' },
  { role: 'front-desk', path: '/desk/day-sheet', ready: 'state-day-sheet-locked', label: 'desk-print-locked' },
  { role: 'doctor', path: '/doctor/my-day', ready: 'row-day-98765', label: 'doctor-day' },
  { role: 'doctor', path: '/doctor/network-search', ready: 'input-network-search', label: 'doctor-network' },
  { role: 'doctor', path: '/doctor/patient-card', ready: 'state-card-none', label: 'doctor-card-unselected' },
  { role: 'doctor', path: '/doctor/privacy', ready: 'text-no-performance-en', label: 'doctor-privacy' },
  { role: 'doctor', path: '/work/adoption', ready: 'state-results-unavailable', label: 'adoption-doctor' },
  { role: 'front-desk', path: '/work/adoption', ready: 'text-adoption-readonly', label: 'adoption-readonly' },
  { role: 'front-desk', path: '/work/import', ready: 'input-import-file', label: 'import-upload' },
  { role: 'doctor', path: '/work/import', ready: 'input-import-file', label: 'import-doctor' },
  { role: 'front-desk', path: '/work/duplicates', ready: 'state-dup-empty', label: 'duplicates-empty' },
  { role: 'doctor', path: '/work/duplicates', ready: 'state-dup-empty', label: 'duplicates-doctor' },
  { role: 'anonymous', path: '/login', ready: 'page-login', label: 'public-login' },
  { role: 'anonymous', path: '/data', ready: 'page-data', label: 'public-data-privacy' },
  { role: 'anonymous', path: '/ui-kit', ready: 'button-theme-light', label: 'public-ui-kit' },
];

for (const route of routes) {
  test(`${route.label}: matrix presentation`, async ({ page }, info) => {
    const writes = await fixture(page, info, route.role);
    if (route.label === 'desk-day' || route.label === 'desk-week') {
      // A real identity without encrypted authority must stay locked; synthetic
      // GET responses alone cannot authorize the local calendar.
      await page.goto(route.path.replace('&shellDemo=front-desk', ''));
      await expect(page.getByTestId('state-calendar-error')).toBeVisible();
      await expect(page.getByTestId('calendar-day')).toHaveCount(0);
      await expect(page.getByTestId('calendar-week')).toHaveCount(0);
    }
    await page.goto(route.path);
    await expect(page.getByTestId(route.ready)).toBeVisible();
    if (route.role === 'anonymous' && route.path !== '/ui-kit') await publicDisplay(page, info);
    await review(page, info, route.label);
    expect(writes, 'Presentation must not issue mutations').toEqual([]);
  });
}

for (const scenario of ['standard', 'empty', 'error'] as const) {
  test(`labelled calendar ${scenario} presentation`, async ({ page }, info) => {
    const writes = await fixture(page, info, 'front-desk');
    await page.goto(`/desk/today?date=2025-03-10&shellDemo=front-desk&calendarDemo=${scenario}`);
    const expected = { standard: 'calendar-day', empty: 'state-no-appointments', error: 'state-calendar-error' }[scenario];
    await expect(page.getByTestId(expected)).toBeVisible();
    if (scenario === 'standard') {
      for (const status of ['completed', 'booked', 'conflict', 'noshow', 'cancelled'])
        await expect(page.locator(`.cal-card--${status}`).first()).toBeVisible();
      // Sync is deliberately an independent secondary badge, not a lifecycle.
      await expect(page.locator('.cal-card [data-status="sync"]').first()).toBeVisible();
    } else {
      await expect(page.locator('[data-testid^="card-appointment-"]')).toHaveCount(0);
    }
    await review(page, info, `calendar-${scenario}`);
    expect(writes).toEqual([]);
  });
}

test('users devices tab and clinic wizard stages; keyboard cancel restores focus', async ({ page }, info) => {
  const writes = await fixture(page, info, 'admin');
  await page.goto('/admin/users-devices');
  await page.getByTestId('tab-devices').click();
  await review(page, info, 'admin-devices');
  await page.goto('/admin/clinics-doctors');
  const opener = page.getByTestId('button-add-clinic');
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('input-clinic-name')).toBeVisible();
  await review(page, info, 'wizard-details');
  await page.getByTestId('input-clinic-name').fill('Synthetic Cedar · عيادة تجريبية');
  await page.getByTestId('input-clinic-city').fill('Synthetic city');
  await page.getByTestId('input-clinic-booking').fill('phone');
  await page.getByTestId('button-wizard-next').click();
  await review(page, info, 'wizard-schedule');
  await page.getByTestId('button-wizard-next').click();
  await expect(page.getByTestId('text-review-name')).toContainText('Synthetic Cedar');
  await review(page, info, 'wizard-review');
  // Back to an unsubmitted draft; cancelling may request discard confirmation.
  await page.getByTestId('button-wizard-cancel').click();
  const confirm = page.getByTestId('dialog-wizard-cancel-confirm');
  if (await confirm.isVisible()) await confirm.click();
  await expect(opener).toBeFocused();
  expect(writes).toEqual([]);
});

test('patient search, consent form and booking drawer stages (no save)', async ({ page }, info) => {
  const writes = await fixture(page, info, 'front-desk');
  await page.goto('/desk/patients');
  await page.getByTestId('input-patient-search').fill('Synthetic');
  await page.getByTestId(`option-patient-${PATIENT}`).click();
  await expect(page.getByTestId('panel-patient-detail')).toBeVisible();
  await review(page, info, 'patient-selected');
  await page.getByTestId('link-patient-consent').click();
  await expect(page.getByTestId('panel-consent-patient')).toBeVisible();
  await review(page, info, 'consent-form');
  // DEV-only labelled booking fixture: real booking requires a cryptographically
  // authorized local cache. Do not forge that permit just to render a drawer.
  await page.goto('/desk/today?date=2026-10-20&shellDemo=front-desk');
  await page.getByTestId('link-new-booking').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('drawer-booking')).toBeVisible();
  // Actual Tab navigation, not just programmatic focus.
  await page.keyboard.press('Tab');
  expect(await page.getByTestId('drawer-booking').evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.getByTestId('input-patient-search').fill('محمد احمد');
  await page.getByTestId('option-patient-9001').click();
  await expect(page.getByTestId('select-booking-doctor')).toBeVisible();
  await review(page, info, 'booking-schedule');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('drawer-booking')).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('network results and selected clinical card are localized and memory-only', async ({ page }, info) => {
  const writes = await fixture(page, info, 'doctor');
  await page.goto('/doctor/network-search');
  await page.getByTestId('input-network-search').fill('Synthetic');
  await page.getByTestId('button-network-search').click();
  await expect(page.getByTestId(`button-open-patient-${PATIENT}`)).toBeVisible();
  await review(page, info, 'network-results');
  await page.getByTestId(`button-open-patient-${PATIENT}`).press('Enter');
  await expect(page.getByTestId(`card-patient-${PATIENT}`)).toBeVisible();
  await review(page, info, 'clinical-card');
  expect(page.url()).not.toContain(String(PATIENT));
  await page.reload();
  await expect(page.getByTestId('state-card-none')).toBeVisible();
  expect(writes).toEqual([]);
});

for (const mode of ['empty', 'error', 'forbidden'] as const) {
  test(`doctor day ${mode} is not another state`, async ({ page }, info) => {
    const writes = await fixture(page, info, 'doctor', mode);
    await page.goto('/doctor/my-day');
    const expected = { empty: 'state-day-empty', error: 'state-day-error', forbidden: 'state-day-denied' }[mode];
    await expect(page.getByTestId(expected)).toBeVisible();
    for (const state of ['state-day-empty', 'state-day-error', 'state-day-denied'])
      if (state !== expected) await expect(page.getByTestId(state)).toHaveCount(0);
    await expect(page.getByTestId('row-day-98765')).toHaveCount(0);
    await review(page, info, `doctor-${mode}`);
    expect(writes).toEqual([]);
  });
}

test('offline without a signed permit locks private data, not an empty or forbidden list', async ({ page, context }, info) => {
  const writes = await fixture(page, info, 'doctor');
  await page.goto('/doctor/my-day');
  await expect(page.getByTestId('row-day-98765')).toBeVisible();
  await context.setOffline(true);
  try {
    await expect(page.getByTestId('row-day-98765')).toHaveCount(0);
    await expect(page.getByTestId('page-login')).toBeVisible();
    await publicDisplay(page, info);
    await expect(page.getByTestId('state-day-empty')).toHaveCount(0);
    await expect(page.getByTestId('state-day-denied')).toHaveCount(0);
    await review(page, info, 'offline-locked');
    expect(writes).toEqual([]);
  } finally {
    await context.setOffline(false);
  }
});

test('role forbidden and API failure retain separate recovery presentation', async ({ page }, info) => {
  const writes = await fixture(page, info, 'doctor');
  await page.goto('/admin/network-health');
  await expect(page.getByTestId('state-forbidden')).toBeVisible();
  await review(page, info, 'role-forbidden');
  await page.goto('/work/duplicates');
  await expect(page.getByTestId('state-dup-empty')).toBeVisible();
  await page.route('**/api/patients/duplicates?*', route => route.fulfill(failure()));
  await page.reload();
  await expect(page.getByTestId('status-dup-error')).toBeVisible();
  await expect(page.getByTestId('state-dup-empty')).toHaveCount(0);
  await review(page, info, 'duplicates-error');
  expect(writes).toEqual([]);
});

test('200% text resize proxy and keyboard focus on representative shell/public pages', async ({ page }, info) => {
  const writes = await fixture(page, info, 'doctor');
  for (const [path, ready] of [['/doctor/my-day', 'button-day-open-98765'], ['/data', 'page-data']] as const) {
    await page.goto(path);
    await expect(page.getByTestId(ready)).toBeVisible();
    // CSS root text resize is reproducible in headless Chromium. This is NOT a
    // claim of native browser zoom equivalence; see review inventory limitations.
    await page.evaluate(() => {
      document.documentElement.style.fontSize = `${parseFloat(getComputedStyle(document.documentElement).fontSize) * 2}px`;
    });
    await review(page, info, `text-200-${ready}`);
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement) || el === document.body) return null;
      const box = el.getBoundingClientRect(), style = getComputedStyle(el);
      return { width: box.width, height: box.height,
        indicator: (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none' };
    });
    expect(focused, 'Tab reaches a visible element').not.toBeNull();
    expect(focused?.width).toBeGreaterThan(0);
    expect(focused?.height).toBeGreaterThan(0);
    expect.soft(focused?.indicator, 'Focused action has outline or shadow').toBe(true);
  }
  expect(writes).toEqual([]);
});

test('print media guard never invents an authorized schedule', async ({ page }, info) => {
  const writes = await fixture(page, info, 'front-desk');
  await page.goto('/desk/day-sheet');
  await expect(page.getByTestId('state-day-sheet-locked')).toBeVisible();
  await expect(page.getByTestId('page-day-sheet')).toHaveAttribute('data-print-allowed', 'false');
  await page.emulateMedia({ media: 'print' });
  await page.screenshot({ path: info.outputPath('print-unauthorized.png'), fullPage: true });
  await expect(page.getByTestId('table-day-sheet')).toHaveCount(0);
  expect(writes).toEqual([]);
});
