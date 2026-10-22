import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Mocked My Day / Privacy specs (real adapter with /api/me mocked). Synthetic data only, no seed access.
const user = (role = 'doctor', id = 42) => ({
  id, email: 'synthetic@example.invalid', role, clinicId: 101, doctorId: role === 'doctor' ? 201 : null,
  locale: 'en', theme: 'light', csrfToken: 'test-only-csrf',
  session: { expiresAt: '2027-01-01T00:00:00Z', absoluteExpiresAt: null, idleTimeoutSeconds: 1800 },
  device: null, reauth: { required: false, validUntil: null },
});
const alert = { kind: 'allergy', labelKey: 'alerts.allergy.penicillin', labelParams: {}, label: 'Penicillin allergy', ruleId: 'allergy.penicillin', dictionaryVersion: '1', sourceNoteExcerpt: 'Synthetic: allergic to penicillin', excerptStart: 0, excerptEnd: 10, sourceVisitId: 5, patientId: 51, sourceClinicId: 101, sourceClinicName: 'Synthetic Home Clinic', sourceVisitDate: '2025-05-20', disclaimerKey: 'alerts.unconfirmed', crossClinicDisclaimerKey: null };
const visit = (o: Record<string, unknown> = {}) => ({ clinicId: 101, doctorId: 201, clinicName: 'Synthetic Home Clinic', doctorName: 'Synthetic Doctor', seenAt: '2025-05-20T08:30:00Z', visibility: 'basic', ...o });
const clinicalVisit = (alerts: unknown[]) => visit({ visibility: 'clinical', complaint: 'Synthetic follow-up note', alerts, keyAlerts: [] });
const patient = (id: number, level: string, visits: unknown[], name = 'Synthetic Day Patient') => ({ id, name, identityVerified: false, effectiveConsentLevel: level, visits });
const forbidden = { status: 403, json: { code: 'FORBIDDEN', messageKey: 'error.forbidden', params: {} } };

async function boot(page: Page, role = 'doctor', locale: 'ar' | 'en' = 'ar', theme: 'light' | 'dark' = 'light') {
  await page.addInitScript((prefs) => {
    localStorage.setItem(`amal.tour.v1:account%3A42:${prefs.role}`, 'dismissed');
    localStorage.setItem(`amal.tour.v1:account:42:${prefs.role}`, 'dismissed');
    localStorage.setItem('amal.display.v1:account%3A42', JSON.stringify({ locale: prefs.locale, theme: prefs.theme, digitPreference: 'latn' }));
  }, { role, locale, theme });
  await page.route('**/api/me', (r) => r.fulfill({ json: user(role) }));
  // This synthetic online session has no trusted device or offline permit.
  await page.route('**/api/auth/offline-permit*', (r) => r.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }));
  await page.route('**/api/clinics?*', (r) => r.fulfill({ json: { items: [{ id: 101, name: 'Synthetic Home Clinic', timezone: 'Asia/Hebron', mode: 'network' }], nextCursor: null } }));
}
const params = (r: Route) => new URL(r.request().url()).searchParams;
function noSensitiveUrl(page: Page) {
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) expect(f.url()).not.toMatch(/Synthetic|patient=|id=\d|\/\d+$/); });
}
async function storedBlob(page: Page) {
  return page.evaluate(async () => {
    const dbs = 'databases' in indexedDB ? (await indexedDB.databases()).map((d) => d.name).join(',') : '';
    const caches_ = 'caches' in window ? (await caches.keys()).join(',') : '';
    return JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + dbs + caches_ + document.cookie;
  });
}

test('My Day lists own patients chronologically with consent, alerts, empty alerts and midnight time', async ({ page }, info) => {
  await boot(page, 'doctor', info.project.use.locale, info.project.use.colorScheme);
  let sawDay: string | null = 'unset';
  await page.route('**/api/doctor/day*', (r) => {
    sawDay = params(r).get('day');
    return r.fulfill({ json: { day: '2025-06-15', nextCursor: null, items: [
      { id: 2, startsAt: '2025-06-15T07:30:00Z', status: 'booked', patient: patient(52, 'none', [], 'Synthetic Later') },
      { id: 1, startsAt: '2025-06-14T21:00:00Z', status: 'completed', patient: patient(51, 'clinical', [clinicalVisit([alert])], 'Synthetic Early') },
    ] } });
  });
  noSensitiveUrl(page);
  await page.goto('/doctor/my-day');
  await expect(page.getByTestId('page-myDay')).toBeVisible();
  expect(sawDay).toBeNull(); // server computes Today; client never sends a day
  const rows = page.getByTestId('list-my-day').locator('> li');
  await expect(rows.nth(0)).toHaveAttribute('data-testid', 'row-day-1');
  await expect(page.getByTestId('text-day-time-1')).toHaveText('00:00'); // Hebron midnight is a real scheduled time
  await expect(page.getByTestId('text-day-time-2')).toHaveText('10:30');
  await expect(page.getByTestId('badge-day-consent-1')).toHaveAttribute('data-level', 'clinical');
  await expect(page.getByTestId('chip-day-alert-1-0')).toContainText('Synthetic: allergic to penicillin');
  await expect(page.getByTestId('badge-day-consent-2')).toHaveAttribute('data-level', 'none');
  await expect(page.getByTestId('status-day-no-alerts-2')).toBeVisible();
  await expect(page.getByTestId('text-day-date')).toContainText(info.project.use.locale === 'ar' ? '15 يونيو 2025' : '15 June 2025'); // server date shown
  await page.getByTestId('button-day-open-1').focus();
  await expect(page.getByTestId('button-day-open-1')).toBeFocused();
  const axe = await new AxeBuilder({ page }).include('.doc').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations.map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => n.target) }))).toEqual([]);
  const shot = `../../generated-artifacts/doctor/screens/my-day-${info.project.name}`;
  await page.screenshot({ path: `${shot}-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByTestId('button-day-open-2')).toBeVisible();
  await page.screenshot({ path: `${shot}-mobile.png`, fullPage: true });
});

test('opening a card from My Day uses the stable id in memory, never in the URL', async ({ page }, info) => {
  await boot(page, 'doctor', info.project.use.locale, info.project.use.colorScheme);
  let lookups = 0; const fetched: string[] = [];
  await page.route('**/api/network/lookup?*', (r) => { lookups++; return r.fulfill({ json: { items: [], nextCursor: null } }); });
  await page.route('**/api/doctor/day*', (r) => r.fulfill({ json: { day: '2025-06-15', nextCursor: null, items: [
    { id: 1, startsAt: '2025-06-15T07:30:00Z', status: 'booked', patient: patient(61, 'basic', [], 'Synthetic Same Name') },
    { id: 2, startsAt: '2025-06-15T08:30:00Z', status: 'booked', patient: patient(62, 'clinical', [], 'Synthetic Same Name') },
  ] } }));
  await page.route('**/api/doctor/patients/*', (r) => { const id = r.request().url().split('/').pop()!; fetched.push(id); return r.fulfill({ json: patient(Number(id), 'clinical', [clinicalVisit([])], 'Synthetic Same Name') }); });
  noSensitiveUrl(page);
  await page.goto('/doctor/my-day');
  await page.getByTestId('button-day-open-2').press('Enter');
  await expect(page).toHaveURL(/\/doctor\/patient-card$/);
  await expect(page.getByTestId('card-patient-62')).toBeVisible();
  expect(fetched).toEqual(['62']);
  expect(lookups).toBe(0);
  await page.getByTestId('link-myday-back').click();
  await expect(page).toHaveURL(/\/doctor\/my-day$/);
  expect(await storedBlob(page)).not.toMatch(/Synthetic|61|62/);
  await page.goto('/doctor/patient-card');
  await expect(page.getByTestId('state-card-none')).toBeVisible();
});

test('date and week browsing retains selection on focus and Today returns to day mode', async ({ page }, info) => {
  await boot(page, 'doctor', info.project.use.locale, info.project.use.colorScheme);
  const reads: { date: string | null; view: string | null }[] = [];
  await page.route('**/api/doctor/day*', (r) => {
    const date = params(r).get('date');
    const view = params(r).get('view');
    reads.push({ date, view });
    return r.fulfill({ json: { day: view === 'week' ? '2025-12-27' : date, items: [], nextCursor: null } });
  });
  await page.goto('/doctor/my-day');
  await expect(page.getByTestId('state-day-empty')).toBeVisible();
  await page.getByTestId('input-day-date').fill('2026-01-01');
  await expect.poll(() => reads.at(-1)).toEqual({ date: '2026-01-01', view: 'day' });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('input-day-date')).toHaveValue('2026-01-01');
  await page.getByTestId('button-day-view-week').click();
  await expect.poll(() => reads.at(-1)).toEqual({ date: '2026-01-01', view: 'week' });
  await expect(page.getByTestId('text-day-date')).toContainText('2025');
  await expect(page.getByTestId('text-day-date')).toContainText('2026');
  await page.getByTestId('button-day-next').click();
  await expect.poll(() => reads.at(-1)).toEqual({ date: '2026-01-08', view: 'week' });
  await page.getByTestId('button-day-previous').click();
  await expect.poll(() => reads.at(-1)).toEqual({ date: '2026-01-01', view: 'week' });
  await page.getByTestId('button-day-today').click();
  await expect(page.getByTestId('button-day-view-day')).toHaveAttribute('aria-pressed', 'true');
  const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hebron', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
  await expect(page.getByTestId('input-day-date')).toHaveValue(today);
});

test('week rows group by Hebron dates and retain status, alert and patient-card actions', async ({ page }, info) => {
  await boot(page, 'doctor', info.project.use.locale, info.project.use.colorScheme);
  await page.route('**/api/doctor/day*', (r) => r.fulfill({ json: {
    day: params(r).get('view') === 'week' ? '2025-06-14' : '2025-06-15', nextCursor: null,
    items: [{ id: 1, startsAt: '2025-06-14T21:00:00Z', status: 'completed', patient: patient(51, 'clinical', [clinicalVisit([alert])]) }],
  } }));
  await page.goto('/doctor/my-day');
  await page.getByTestId('input-day-date').fill('2025-06-15');
  await page.getByTestId('button-day-view-week').click();
  await expect(page.getByTestId('group-day-2025-06-15').getByTestId('row-day-1')).toBeVisible();
  await expect(page.getByTestId('group-day-2025-06-14').getByTestId('row-day-1')).toHaveCount(0);
  await expect(page.getByTestId('list-my-day').locator(':scope > li')).toHaveCount(7);
  await expect(page.getByTestId('chip-day-alert-1-0')).toBeVisible();
  await expect(page.getByTestId('status-day-1')).toBeVisible();
  await expect(page.getByTestId('button-day-open-1')).toBeVisible();
});

test('consent change revalidates and clears previously shown alerts', async ({ page }, info) => {
  await boot(page, 'doctor', info.project.use.locale, info.project.use.colorScheme);
  let phase: 'clinical' | 'none' = 'clinical';
  await page.route('**/api/doctor/day*', (r) => r.fulfill({ json: { day: '2025-06-15', nextCursor: null, items: [
    { id: 1, startsAt: '2025-06-15T07:30:00Z', status: 'booked', patient: phase === 'clinical' ? patient(51, 'clinical', [clinicalVisit([alert])]) : patient(51, 'none', []) },
  ] } }));
  await page.goto('/doctor/my-day');
  await expect(page.getByTestId('chip-day-alert-1-0')).toBeVisible();
  phase = 'none';
  await page.evaluate(() => document.dispatchEvent(new Event('amal:consent-changed')));
  await expect(page.getByTestId('badge-day-consent-1')).toHaveAttribute('data-level', 'none');
  await expect(page.getByTestId('chip-day-alert-1-0')).toHaveCount(0);
  await expect(page.getByText('Synthetic: allergic to penicillin')).toHaveCount(0);
});

test('My Day empty, error-retry and forbidden states', async ({ page }, info) => {
  await boot(page, 'doctor', info.project.use.locale, info.project.use.colorScheme);
  let mode: 'error' | 'empty' | 'denied' = 'error';
  await page.route('**/api/doctor/day*', (r) => mode === 'error' ? r.fulfill({ status: 500, json: { code: 'X', messageKey: 'x', params: {} } })
    : mode === 'denied' ? r.fulfill(forbidden) : r.fulfill({ json: { day: '2025-06-15', items: [], nextCursor: null } }));
  await page.goto('/doctor/my-day');
  await expect(page.getByTestId('state-day-error')).toBeVisible({ timeout: 20_000 });
  mode = 'empty';
  await page.getByTestId('button-day-retry').click();
  await expect(page.getByTestId('state-day-empty')).toBeVisible();
  mode = 'denied';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('state-day-denied')).toBeVisible();
});

test('Privacy shows exact bilingual statement, read-only mode, never defaults to Full', async ({ page }, info) => {
  await boot(page, 'doctor', info.project.use.locale, info.project.use.colorScheme);
  let body: Record<string, unknown> = { clinic: { id: 101, name: 'Synthetic Home Clinic' }, mode: 'lite', effectiveSharing: 'local-only', trialStateAvailable: false };
  await page.route('**/api/doctor/privacy', (r) => r.fulfill({ json: body }));
  await page.route('**/api/audit*', (r) => r.fulfill({ json: { items: [], nextCursor: null } }));
  await page.goto('/doctor/privacy');
  await expect(page.getByTestId('text-no-performance-en')).toHaveText('There are no doctor-performance analytics. Doctors are not ranked or measured.');
  await expect(page.getByTestId('text-no-performance-ar')).toHaveText('لا توجد تحليلات لأداء الأطباء. لا يتم ترتيب الأطباء أو قياس أدائهم.');
  await expect(page.getByTestId('privacy-mode')).toHaveAttribute('data-mode', 'lite');
  await expect(page.getByTestId('text-privacy-clinic')).toHaveText('Synthetic Home Clinic');
  await expect(page.getByTestId('section-privacy-mode').locator('input, select, button[role="switch"]')).toHaveCount(0);
  for (const [mode, sharing, expected] of [['unknown', 'consent', 'unknown'], ['trial', 'consent', 'trialUnavailable'], ['full', 'consent', 'full']] as const) {
    body = { clinic: { id: 101, name: 'Synthetic Home Clinic' }, mode, effectiveSharing: sharing, trialStateAvailable: false };
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByTestId('privacy-mode')).toHaveAttribute('data-mode', expected);
    await expect(page.getByTestId('privacy-mode')).toHaveAttribute('data-sharing', expected === 'full' ? 'consent' : 'localOnly');
  }
  await expect(page.getByTestId('state-audit-empty')).toBeVisible();
});

test('audit list paginates, labels unknown actors, and denial mid-pagination clears it', async ({ page }, info) => {
  await boot(page, 'doctor', info.project.use.locale, info.project.use.colorScheme);
  await page.route('**/api/doctor/privacy', (r) => r.fulfill({ json: { clinic: { id: 101, name: 'Synthetic Home Clinic' }, mode: 'full', effectiveSharing: 'consent', trialStateAvailable: false } }));
  let deny = false; const cursors: (string | null)[] = [];
  await page.route('**/api/audit*', (r) => {
    const c = params(r).get('cursor'); cursors.push(c);
    expect(params(r).get('patientId')).toBeNull();
    if (deny) return r.fulfill(forbidden);
    if (!c) return r.fulfill({ json: { nextCursor: 'opaque-2', items: [
      { id: 9, at: '2025-06-14T21:00:00Z', patient: { id: 51, name: 'Synthetic Audit Patient' }, viewerName: 'Synthetic Viewer', viewerClinicName: 'Synthetic North Clinic', action: 'patient-view' },
    ] } });
    return r.fulfill({ json: { nextCursor: 'opaque-3', items: [
      { id: 8, at: '2025-06-13T10:00:00Z', patient: { id: 51, name: 'Synthetic Audit Patient' }, viewerName: null, viewerClinicName: null, action: 'patient-view' },
    ] } });
  });
  await page.goto('/doctor/privacy');
  await expect(page.getByTestId('row-audit-9')).toBeVisible();
  await expect(page.getByTestId('text-audit-time-9')).toContainText('00:00');
  await page.getByTestId('button-audit-more').click();
  await expect(page.getByTestId('row-audit-8')).toBeVisible();
  await expect(page.getByTestId('text-audit-viewer-8')).toHaveText(info.project.use.locale === 'ar' ? 'هوية المطّلع غير متاحة أو محجوبة' : 'Viewer unavailable or redacted');
  await expect(page.getByTestId('text-audit-clinic-8')).toHaveText(info.project.use.locale === 'ar' ? 'العيادة غير متاحة أو محجوبة' : 'Clinic unavailable or redacted');
  expect(cursors).toEqual([null, null, 'opaque-2']);
  deny = true;
  await page.getByTestId('button-audit-more').click();
  await expect(page.getByTestId('state-audit-denied')).toBeVisible();
  await expect(page.getByTestId('row-audit-9')).toHaveCount(0);
  expect(await storedBlob(page)).not.toMatch(/Synthetic Audit|Synthetic Viewer/);
});

test('non-doctor roles get forbidden on direct routes and never call doctor APIs', async ({ page }, info) => {
  for (const role of ['front-desk', 'admin']) {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await boot(page, role, info.project.use.locale, info.project.use.colorScheme);
    let calls = 0;
    await page.route(/\/api\/(doctor|audit)/, (r) => { calls++; return r.fulfill({ json: {} }); });
    for (const path of ['/doctor/my-day', '/doctor/privacy']) {
      await page.goto(path);
      await expect(page.getByTestId('state-forbidden')).toBeVisible();
    }
    expect(calls).toBe(0);
  }
});

test('stale day response never replaces newer data', async ({ page }, info) => {
  await boot(page, 'doctor', info.project.use.locale, info.project.use.colorScheme);
  let n = 0; let releaseFirst!: () => void;
  const gate = new Promise<void>((r) => { releaseFirst = r; });
  await page.route('**/api/doctor/day*', async (r) => {
    const call = ++n;
    if (call === 1) { await gate; return r.fulfill({ json: { day: '2025-06-15', nextCursor: null, items: [{ id: 1, startsAt: '2025-06-15T07:30:00Z', status: 'booked', patient: patient(70, 'none', [], 'Synthetic Stale') }] } }).catch(() => {}); }
    return r.fulfill({ json: { day: '2025-06-15', nextCursor: null, items: [{ id: 2, startsAt: '2025-06-15T08:30:00Z', status: 'booked', patient: patient(71, 'none', [], 'Synthetic Fresh') }] } });
  });
  const firstRequest = page.waitForRequest('**/api/doctor/day*');
  await page.goto('/doctor/my-day');
  await firstRequest;
  await expect(page.getByTestId('page-myDay')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('row-day-2')).toBeVisible();
  releaseFirst();
  await page.waitForTimeout(300);
  await expect(page.getByTestId('row-day-1')).toHaveCount(0);
});

test('withdrawal between audit pages: load more re-reads from page 1 and never keeps prior payloads', async ({ page }, info) => {
  await boot(page, 'doctor', info.project.use.locale, info.project.use.colorScheme);
  let phase: 'clinical' | 'none' = 'clinical'; const cursors: (string | null)[] = [];
  await page.route('**/api/doctor/day*', (r) => {
    const c = params(r).get('cursor'); cursors.push(c);
    const p = phase === 'clinical' ? patient(51, 'clinical', [clinicalVisit([alert])]) : patient(51, 'none', []);
    if (!c) return r.fulfill({ json: { day: '2025-06-15', nextCursor: phase === 'clinical' ? 'old-2' : 'new-2', items: [{ id: 1, startsAt: '2025-06-15T07:30:00Z', status: 'booked', patient: p }] } });
    return r.fulfill({ json: { day: '2025-06-15', nextCursor: null, items: [{ id: 2, startsAt: '2025-06-15T08:30:00Z', status: 'booked', patient: patient(53, 'none', [], 'Synthetic Second') }] } });
  });
  await page.goto('/doctor/my-day');
  await expect(page.getByTestId('chip-day-alert-1-0')).toBeVisible();
  phase = 'none';
  await page.getByTestId('button-day-more').click();
  await expect(page.getByTestId('row-day-2')).toBeVisible();
  await expect(page.getByTestId('badge-day-consent-1')).toHaveAttribute('data-level', 'none');
  await expect(page.getByText('Synthetic: allergic to penicillin')).toHaveCount(0);
  expect(cursors).toEqual([null, null, 'new-2']);
  await expect(page.getByTestId('list-my-day')).toBeFocused();
});
