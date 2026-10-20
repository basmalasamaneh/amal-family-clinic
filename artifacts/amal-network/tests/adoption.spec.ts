import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { ClinicAdoption, AdoptionResults } from '@workspace/api-client-react';

// Explicit test-only scenario: IDs and names deliberately differ from the workbook.
const TRIAL = 87201;
const SOURCES = [97603, 94519];
const stamp = '2026-10-20T09:00:00Z';
function lifecycle(state: 'trial' | 'lite' | 'full' = 'trial', left = false, manager = true): ClinicAdoption {
  return { clinicId: TRIAL, state, membershipStatus: left ? 'left' : 'active',
    changedAt: stamp, trialStartedAt: stamp, liteStartedAt: state === 'lite' ? stamp : null,
    fullStartedAt: state === 'full' ? stamp : null, leftAt: left ? stamp : null, leftBy: left ? 42 : null,
    capabilities: { canManage: manager, canExport: manager, canLeave: manager && !left, localBooking: true, networkSharing: state === 'full' && !left },
    allowedTransitions: left || !manager ? [] : ['lite', 'full'] };
}
function published(): AdoptionResults {
  return { available: true, reason: null, generatedAt: stamp, calculationVersion: 'test-fixture-v1',
    window: { startDate: '2026-10-13', endDateExclusive: '2026-10-20', start: '2026-10-12T21:00:00Z', end: '2026-10-19T21:00:00Z', days: 7, timezone: 'Asia/Hebron' },
    clinics: SOURCES.map((clinicId, n) => ({ clinicId, clinicName: ['Synthetic Cedar', 'عيادة الزيتون التجريبية'][n],
      preventedBlocks: { available: true, reason: null, value: n === 0 ? 4 : 0, units: 'blocks', sampleCount: 12, coverage: 'test-only', provenance: 'test-only' },
      medianLookupSeconds: { available: n === 0, reason: n === 0 ? null : 'NO_LOOKUP_SAMPLES', value: n === 0 ? 3.75 : null, units: 'seconds', sampleCount: n === 0 ? 8 : 0, coverage: 'test-only', provenance: 'test-only' },
    })) };
}
async function boot(page: Page, locale: string, theme: string, manager = true, role = 'doctor') {
  const fixture = { state: lifecycle('trial', false, manager), results: published(), writes: [] as { path: string; body: unknown }[],
    failExport: false, failLeave: false, loseFull: false, fullDelay: 0, statusForbidden: false, accountId: 42 };
  await page.addInitScript(p => {
    localStorage.setItem(`amal.tour.v1:account%3A42:${p.role}`, 'dismissed');
    localStorage.setItem(`amal.tour.v1:account:42:${p.role}`, 'dismissed');
    localStorage.setItem('amal.display.v1:account%3A42', JSON.stringify({ locale: p.locale, theme: p.theme, digitPreference: 'latn' }));
  }, { locale, theme, role });
  await page.route('**/api/**', async r => {
    const req = r.request(), path = new URL(req.url()).pathname;
    if (path === '/api/me') return r.fulfill({ json: {
      id: fixture.accountId, email: 'synthetic@example.invalid', role, clinicId: TRIAL, doctorId: 500,
      locale, theme, csrfToken: 'test-only-csrf', device: null,
      session: { expiresAt: '2030-01-01T00:00:00Z', absoluteExpiresAt: null, idleTimeoutSeconds: 1800 },
      reauth: { required: false, validUntil: null },
    } });
    if (path === '/api/clinics') return r.fulfill({ json: { items: [{ id: TRIAL, name: 'Synthetic Trial Clinic', timezone: 'Asia/Hebron', mode: fixture.state.state === 'full' ? 'network' : 'lite' }], nextCursor: null } });
    if (path === '/api/adoption/results') return r.fulfill({ json: fixture.results });
    if (path === `/api/clinics/${TRIAL}/adoption` && req.method() === 'GET')
      return fixture.statusForbidden ? r.fulfill({ status: 403, json: { code: 'FORBIDDEN', messageKey: 'error.forbidden', params: {} } }) : r.fulfill({ json: fixture.state });
    if (req.method() === 'POST' && path.startsWith(`/api/clinics/${TRIAL}/`)) {
      expect(req.headers()['x-csrf-token']).toBe('test-only-csrf');
      const body = req.postDataJSON(); fixture.writes.push({ path, body });
      if (path.endsWith('/export')) return fixture.failExport
        ? r.fulfill({ status: 503, json: { code: 'EXPORT_TIMEOUT', messageKey: 'error.exportUnavailable', params: {} } })
        : r.fulfill({ json: { format: 'amal-clinic-export', schemaVersion: 1, clinicId: TRIAL, datasets: {} } });
      if (path.endsWith('/leave')) {
        expect(body).toEqual({ confirm: true });
        if (fixture.failLeave) return r.fulfill({ status: 503, json: { code: 'INTERNAL', params: {} } });
        fixture.state = lifecycle('lite', true);
      } else {
        expect(body).toEqual({ state: body.state });
        if (fixture.fullDelay) await new Promise(resolve => setTimeout(resolve, fixture.fullDelay));
        fixture.state = lifecycle(body.state);
        if (fixture.loseFull) { fixture.loseFull = false; return r.abort('failed'); }
      }
      return r.fulfill({ json: fixture.state });
    }
    return r.fulfill({ status: 503, json: { code: 'INTERNAL', messageKey: 'error.internal', params: {} } });
  });
  await page.goto('/work/adoption');
  await expect(page.getByTestId('state-adoption-status')).toHaveAttribute('data-state', 'trial');
  return fixture;
}

test('explicit trial → published results → Full, reload, bilingual accessible mobile layout', async ({ page }, info) => {
  const f = await boot(page, info.project.use.locale!, info.project.use.colorScheme!);
  await expect(page.getByTestId('results-adoption')).toHaveAttribute('data-state', 'available');
  await expect(page.getByTestId(`card-result-${SOURCES[0]}`)).toContainText('Synthetic Cedar');
  await expect(page.getByTestId(`metric-${SOURCES[1]}-preventedBlocks`)).toHaveAttribute('data-available', 'true');
  await expect(page.getByTestId(`metric-${SOURCES[1]}-medianLookupSeconds`)).toHaveAttribute('data-available', 'false');
  expect(f.writes).toHaveLength(0);
  await expect(page.getByTestId('text-no-monitoring')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', info.project.use.locale === 'ar' ? 'rtl' : 'ltr');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('[data-testid="page-adoption"]').analyze()).violations).toEqual([]);
  f.fullDelay = 150;
  await page.getByTestId('button-adoption-full').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('button-adoption-leave')).toBeDisabled();
  await expect(page.getByTestId('state-adoption-status')).toHaveAttribute('data-state', 'full');
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0].body).toEqual({ state: 'full' });
  await page.reload();
  await expect(page.getByTestId('state-adoption-status')).toHaveAttribute('data-state', 'full');
  expect(f.writes).toHaveLength(1);
});

test('remain Lite, independent export failure, one-click leave and post-exit export', async ({ page }, info) => {
  const f = await boot(page, info.project.use.locale!, info.project.use.colorScheme!);
  await page.getByTestId('button-adoption-lite').click();
  await expect(page.getByTestId('state-adoption-status')).toHaveAttribute('data-state', 'lite');
  f.failExport = true;
  await page.getByTestId('button-adoption-export').click();
  await expect(page.getByTestId('state-adoption-message')).toHaveAttribute('data-tone', 'error');
  expect(f.state.membershipStatus).toBe('active');
  f.failExport = false;
  const before = page.waitForEvent('download');
  await page.getByTestId('button-adoption-export').click();
  expect((await before).suggestedFilename()).toBe(`amal-clinic-${TRIAL}-export.json`);
  expect(f.state.membershipStatus).toBe('active');
  await page.getByTestId('button-adoption-leave').click();
  await expect(page.getByTestId('button-adoption-leave')).toHaveCount(0);
  expect(f.state.membershipStatus).toBe('left');
  expect(f.state.capabilities.localBooking).toBe(true);
  expect(f.writes.filter(w => w.path.endsWith('/leave'))).toHaveLength(1);
  const after = page.waitForEvent('download');
  await page.getByTestId('button-adoption-export').click(); await after;
  await page.reload();
  await expect(page.getByTestId('state-adoption-status')).toHaveAttribute('data-state', 'lite');
  await expect(page.getByTestId('button-adoption-full')).toHaveCount(0);
});

test('lost response survives reload, exact retry, no offline queue or automatic replay', async ({ page, context }, info) => {
  const f = await boot(page, info.project.use.locale!, info.project.use.colorScheme!);
  f.loseFull = true;
  await page.getByTestId('button-adoption-full').click();
  await expect(page.getByTestId('button-adoption-retry')).toBeVisible();
  await expect(page.getByTestId('button-adoption-leave')).toBeDisabled();
  await page.reload();
  await expect(page.getByTestId('button-adoption-retry')).toBeVisible();
  expect(f.writes).toHaveLength(1);
  await page.getByTestId('button-adoption-retry').click();
  await expect(page.getByTestId('button-adoption-retry')).toHaveCount(0);
  expect(f.writes).toHaveLength(2);
  await context.setOffline(true);
  // No signed offline permit in this fixture: the shell correctly locks private
  // pages. There must be neither a lifecycle control nor a queued write.
  await expect(page.getByTestId('button-adoption-leave')).toHaveCount(0);
  expect(f.writes).toHaveLength(2);
  await context.setOffline(false);
  await page.goto('/work/adoption');
  await expect(page.getByTestId('state-adoption-status')).toHaveAttribute('data-state', 'full');
  expect(f.state.membershipStatus).toBe('active');
  f.failLeave = true;
  await page.getByTestId('button-adoption-leave').click();
  await expect(page.getByTestId('button-adoption-retry')).toBeVisible();
  expect(f.state.membershipStatus).toBe('active');
  f.failLeave = false;
  await page.getByTestId('button-adoption-retry').click();
  await expect(page.getByTestId('button-adoption-leave')).toHaveCount(0);
  expect(f.state.membershipStatus).toBe('left');
});

test('read-only reception, unavailable configuration, refresh denial and dismissal never mutate', async ({ page }, info) => {
  const f = await boot(page, info.project.use.locale!, info.project.use.colorScheme!, false, 'front-desk');
  await expect(page.getByTestId('text-adoption-readonly')).toBeVisible();
  await expect(page.getByTestId('button-adoption-full')).toHaveCount(0);
  await expect(page.getByTestId('button-adoption-export')).toHaveCount(0);
  await expect(page.getByTestId('link-adoption-privacy')).toHaveCount(0);
  f.results = { ...f.results, available: false, reason: 'SCENARIO_UNCONFIGURED', clinics: [] };
  await page.reload();
  await expect(page.getByTestId('state-results-unavailable')).toBeVisible();
  f.statusForbidden = true;
  await page.getByTestId('button-adoption-refresh').click();
  await expect(page.getByTestId('state-adoption-status')).toHaveAttribute('data-state', 'error');
  await page.getByTestId('button-adoption-dismiss').click();
  await expect(page).toHaveURL(/\/desk\/today/);
  expect(f.writes).toHaveLength(0);
});

test('same-clinic account switching isolates pending choices and preserves doctor privacy link', async ({ page }, info) => {
  const f = await boot(page, info.project.use.locale!, info.project.use.colorScheme!);
  await expect(page.getByTestId('link-adoption-privacy')).toBeVisible();
  f.failLeave = true;
  await page.getByTestId('button-adoption-leave').click();
  await expect(page.getByTestId('button-adoption-retry')).toBeVisible();
  expect(await page.evaluate(id => sessionStorage.getItem(`amal:adoption:unresolved:account:42:${id}`), TRIAL)).not.toBeNull();
  // Identity responses switch account while preserving the same tab's storage.
  f.accountId = 43;
  await page.addInitScript(() => {
    localStorage.setItem('amal.tour.v1:account%3A43:doctor', 'dismissed');
    localStorage.setItem('amal.tour.v1:account:43:doctor', 'dismissed');
  });
  await page.reload();
  await expect(page.getByTestId('state-adoption-status')).toHaveAttribute('data-state', 'trial');
  await expect(page.getByTestId('link-adoption-privacy')).toBeVisible();
  await expect(page.getByTestId('button-adoption-retry')).toHaveCount(0);
  await expect(page.getByTestId('button-adoption-full')).toBeEnabled();
  expect(f.writes).toHaveLength(1);
  f.accountId = 42;
  await page.reload();
  await expect(page.getByTestId('button-adoption-retry')).toBeVisible();
  await expect(page.getByTestId('button-adoption-full')).toBeDisabled();
  expect(f.writes).toHaveLength(1);
});
