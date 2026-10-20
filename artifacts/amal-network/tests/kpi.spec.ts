import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { addDays } from '../src/kpi/model';

// Mocked KPI dashboard specs (real adapter, /api/me + /api/kpis mocked). Synthetic aggregates only.
const user = (role = 'admin') => ({
  id: 42, email: 'synthetic@example.invalid', role, clinicId: role === 'admin' ? null : 101, doctorId: null,
  locale: 'en', theme: 'light', csrfToken: 'test-only-csrf',
  session: { expiresAt: '2027-01-01T00:00:00Z', absoluteExpiresAt: null, idleTimeoutSeconds: 1800 },
  device: null, reauth: { required: false, validUntil: null },
});
const rate = (n: number, d: number) => ({ numerator: n, denominator: d, ratio: d ? n / d : null, percent: d ? Math.round((n / d) * 1000) / 10 : null });
const src = (o: Record<string, number> = {}) => ({ phone: 0, 'walk-in': 0, calendar: 0, 'amal-network': 0, unknown: 0, ...o });
const defs = {
  collisions: 'Synthetic definition: matching appointment start times.',
  clinicAttribution: 'Synthetic clinic-attribution definition.',
  noShow: 'Synthetic no-show definition.',
  sources: 'Synthetic booking-source definition.',
  weekday: 'Synthetic weekday definition using Palestine time.',
};
const clinic = (id: number, name: string, same: number, ns = rate(0, 0)) => ({ clinicId: id, clinicName: name, totalAppointments: ns.denominator, completed: 0, collisions: { sameDoctorSameStartPairs: same, samePatientSameStartCrossClinicPairs: 0 }, noShow: ns, bookingsBySource: src() });
const period = (startDate: string, endDateExclusive: string, days: number) => ({ startDate, endDateExclusive, start: '2026-10-04T21:00:00Z', end: '2026-10-11T21:00:00Z', days, timezone: 'Asia/Hebron' });
const weekdays = Array.from({ length: 7 }, (_, w) => ({ weekday: w, noShow: w === 6 ? rate(0, 0) : rate(w, 10), bookingsBySource: src() }));
function kpis(range = 'week', o: { empty?: boolean } = {}) {
  return {
    range, appointments: 30, completed: 20, noShowRate: 0.1, periodStart: '2026-10-04T21:00:00Z', periodEnd: '2026-10-11T21:00:00Z', calculationVersion: 'synthetic-1', generatedAt: '2026-10-11T08:00:00Z', scope: { clinicId: null },
    comparison: { equalExposure: false, note: 'Synthetic note' },
    before: { period: period('2026-09-08', '2026-09-14', 6), provenance: 'Synthetic seed', metrics: { totalAppointments: 40, completed: 30, collisions: { sameDoctorSameStartPairs: 5, samePatientSameStartCrossClinicPairs: 2 }, noShow: rate(4, 40), bookingsBySource: src({ phone: 30, unknown: 10 }), clinics: [clinic(501, 'Synthetic Hills Clinic', 3), clinic(502, 'عيادة تجريبية', 2)], weekdays, definitions: defs } },
    after: {
      period: period('2026-10-05', '2026-10-12', 7), provenance: 'Synthetic ops',
      metrics: { totalAppointments: o.empty ? 0 : 30, completed: 20, collisions: { sameDoctorSameStartPairs: 1, samePatientSameStartCrossClinicPairs: 0 }, noShow: rate(3, 30), bookingsBySource: o.empty ? src() : src({ phone: 12, 'walk-in': 9, 'amal-network': 6, unknown: 3 }), clinics: o.empty ? [] : [clinic(501, 'Synthetic Hills Clinic', 1, rate(3, 30)), clinic(503, 'Synthetic Empty Clinic', 0)], weekdays, definitions: defs },
      telemetry: {
        conflicts: { daily: o.empty ? Array.from({ length: 7 }, (_, i) => ({ date: addDays('2026-10-05', i), blocked: 0, warnings: 0, overrides: 0, cumulativeBlocked: 0, cumulativeWarnings: 0, cumulativeOverrides: 0 })) : [{ date: '2026-10-05', blocked: 2, warnings: 1, overrides: 1, cumulativeBlocked: 2, cumulativeWarnings: 1, cumulativeOverrides: 1 }, { date: '2026-10-07', blocked: 1, warnings: 0, overrides: 0, cumulativeBlocked: 3, cumulativeWarnings: 1, cumulativeOverrides: 1 }], cumulative: { blocked: o.empty ? 0 : 3, warnings: o.empty ? 0 : 1, overrides: o.empty ? 0 : 1 }, coverage: 'Synthetic coverage' },
        lookupTime: { available: false, reason: 'LOOKUP_DURATION_PRODUCER_UNAVAILABLE', medianSeconds: null, sampleCount: null, measurementBoundaries: 'Synthetic boundaries' },
        networkActivity: { available: false, reason: 'LOGICAL_NETWORK_LOOKUP_PRODUCER_UNAVAILABLE', daily: null },
        downtime: { receivedCreates: 4, synced: 3, conflicted: 1, rejected: 0, pending: 0, queued: { available: false, reason: 'CLIENT_QUEUE_NOT_OBSERVED', value: null }, lost: { available: false, reason: 'CLIENT_LOSS_NOT_OBSERVED', value: null }, coverage: 'Synthetic coverage' },
      },
    },
    adoption: { clinics: [{ clinicId: 501, clinicName: 'Synthetic Hills Clinic', state: 'full', joinedAt: '2026-09-01T00:00:00Z' }, { clinicId: 502, clinicName: 'عيادة تجريبية', state: 'lite', joinedAt: null }], counts: { trial: null, lite: 1, full: 1 }, history: { available: false, reason: 'ADOPTION_TRANSITION_HISTORY_UNAVAILABLE' }, coverage: 'Synthetic adoption coverage' },
  };
}

async function boot(page: Page, role = 'admin', locale: 'ar' | 'en' = 'en', theme: 'light' | 'dark' = 'light') {
  await page.addInitScript((p) => {
    localStorage.setItem(`amal.tour.v1:account%3A42:${p.role}`, 'dismissed');
    localStorage.setItem(`amal.tour.v1:account:42:${p.role}`, 'dismissed');
    localStorage.setItem('amal.display.v1:account%3A42', JSON.stringify({ locale: p.locale, theme: p.theme, digitPreference: 'latn' }));
  }, { role, locale, theme });
  await page.route('**/api/me', (r) => r.fulfill({ json: user(role) }));
  await page.route('**/api/clinics?*', (r) => r.fulfill({ json: { items: [{ id: 101, name: 'Synthetic clinic', mode: 'network', timezone: 'Asia/Hebron' }], nextCursor: null } }));
  await page.route('**/api/auth/offline-permit*', (r) => r.fulfill({ status: 503, json: { code: 'UNAVAILABLE', messageKey: 'error.internal', params: {} } }));
}

test('renders every chart with summary, table parity, unavailable evidence and designation notice', async ({ page }, info) => {
  await boot(page, 'admin', info.project.use.locale as 'ar' | 'en', info.project.use.colorScheme as 'light' | 'dark');
  await page.route('**/api/kpis?*', (r) => r.fulfill({ json: kpis(new URL(r.request().url()).searchParams.get('range') ?? 'week') }));
  await page.goto('/admin/kpi');
  await expect(page.getByTestId('page-kpi')).toBeVisible();
  for (const id of ['collisions', 'prevention', 'lookup', 'loss', 'sources', 'noshow', 'weekday', 'network-activity', 'adoption']) {
    await expect(page.getByTestId(`summary-${id}`)).not.toBeEmpty();
    const btn = page.getByTestId(`button-table-${id}`);
    await btn.focus(); await page.keyboard.press('Enter');
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId(`table-${id}`).locator('caption')).not.toBeEmpty();
  }
  await expect(page.getByTestId('table-noshow')).toContainText('Synthetic Empty Clinic');
  await expect(page.getByTestId('table-noshow').locator('[data-unavailable]')).toHaveCount(1);
  await expect(page.getByTestId('table-prevention').locator('tbody tr')).toHaveCount(7);
  await expect(page.getByTestId('point-2026-10-06')).toHaveCount(0); // gap, not zero
  await expect(page.getByTestId('spark-lookup-unavailable')).toBeVisible();
  await expect(page.getByTestId('value-lookup')).toHaveAttribute('data-status', 'unavailable');
  await expect(page.getByTestId('value-loss')).toHaveAttribute('data-status', 'unavailable');
  await expect(page.getByTestId('notice-designation-unavailable')).toBeVisible();
  await expect(page.getByTestId('step-501-full')).toHaveAttribute('aria-current', 'step');
  await expect(page.getByTestId('cell-weekday-6')).toHaveAttribute('data-level', 'none');
  const axe = await new AxeBuilder({ page }).include('[data-testid="page-kpi"]').analyze();
  expect(axe.violations).toEqual([]);
});

test('range change never shows stale data; error retry; empty state', async ({ page }) => {
  await boot(page);
  let fail = true;
  await page.route('**/api/kpis?*', async (r) => {
    const range = new URL(r.request().url()).searchParams.get('range')!;
    if (range === 'day' && fail) return r.fulfill({ status: 500, json: { code: 'INTERNAL', messageKey: 'error.internal', params: {} } });
    if (range === 'week') await new Promise((res) => setTimeout(res, 800));
    const result = kpis(range, { empty: range === 'month' });
    if (range === 'month') result.after.telemetry.downtime.receivedCreates = 0;
    return r.fulfill({ json: result });
  });
  await page.goto('/admin/kpi');
  await page.getByTestId('button-range-month').click();
  await expect(page.getByTestId('state-kpi-empty')).toBeVisible();
  await expect(page.getByTestId('state-sources-empty')).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.getByTestId('button-range-month')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('state-kpi-empty')).toBeVisible(); // late week response did not replace month
  await page.getByTestId('button-range-day').click();
  await expect(page.getByTestId('state-kpi-error')).toBeVisible({ timeout: 15_000 });
  fail = false;
  await page.getByTestId('button-kpi-retry').click();
  await expect(page.getByTestId('chart-collisions')).toBeVisible();
});

test('non-admin receives inherited forbidden state', async ({ page }) => {
  await boot(page, 'doctor');
  await page.goto('/admin/kpi');
  await expect(page.getByTestId('state-forbidden')).toBeVisible();
  await expect(page.getByTestId('page-kpi')).toHaveCount(0);
});

test('mobile layout has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page, 'admin', 'ar');
  await page.route('**/api/kpis?*', (r) => r.fulfill({ json: kpis() }));
  await page.goto('/admin/kpi');
  await expect(page.getByTestId('chart-weekday')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
