import { test, expect, type Page, type Route } from '@playwright/test';

// Mocked network search / patient card specs (real adapter with /api/me mocked). No live data, no seed access.
const user = (role = 'doctor', id = 42) => ({
  id, email: 'synthetic@example.invalid', role, clinicId: 101, doctorId: role === 'doctor' ? 201 : null,
  locale: 'en', theme: 'light', csrfToken: 'test-only-csrf',
  session: { expiresAt: '2027-01-01T00:00:00Z', absoluteExpiresAt: null, idleTimeoutSeconds: 1800 },
  device: null, reauth: { required: false, validUntil: null },
});
const visit = (o: Record<string, unknown> = {}) => ({ clinicId: 102, doctorId: 7, clinicName: 'Synthetic North Clinic', doctorName: 'Synthetic Doctor', seenAt: '2025-05-20T08:30:00Z', visibility: 'basic', ...o });
const patient = (id: number, level: string, visits: unknown[], name = 'Synthetic Same Name') => ({ id, name, identityVerified: false, effectiveConsentLevel: level, visits });
const clinical = (alerts: unknown[] = []) => visit({ visibility: 'clinical', complaint: 'Synthetic follow-up note', alerts, keyAlerts: [] });

async function boot(page: Page, role = 'doctor', locale: 'ar' | 'en' = 'ar', theme: 'light' | 'dark' = 'light') {
  await page.addInitScript((prefs) => {
    localStorage.setItem(`amal.tour.v1:account%3A42:${prefs.role}`, 'dismissed');
    localStorage.setItem(`amal.tour.v1:account:42:${prefs.role}`, 'dismissed');
    localStorage.setItem('amal.display.v1:account%3A42', JSON.stringify({ locale: prefs.locale, theme: prefs.theme, digitPreference: 'latn' }));
  }, { role, locale, theme });
  await page.route('**/api/me', (r) => r.fulfill({ json: user(role) }));
  await page.route('**/api/clinics?*', (r) => r.fulfill({ json: { items: [{ id: 101, name: 'Synthetic Home Clinic', timezone: 'Asia/Hebron', mode: 'network' }], nextCursor: null } }));
}
type Handler = (q: string, route: Route) => Promise<void> | void;
async function lookup(page: Page, h: Handler) {
  await page.route('**/api/network/lookup?*', (r) => h(new URL(r.request().url()).searchParams.get('q') ?? '', r));
}
function noSensitiveUrl(page: Page) {
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) expect(f.url()).not.toMatch(/Same|q=|patient=|id=\d/); });
}

test('stale responses never replace newer query results', async ({ page }, info) => {
  await boot(page, 'doctor', info.project.use.locale, info.project.use.colorScheme);
  let releaseOld!: () => void;
  const oldGate = new Promise<void>((r) => { releaseOld = r; });
  await lookup(page, async (q, r) => {
    if (q === 'Old Term') { await oldGate; return r.fulfill({ json: { items: [patient(1, 'clinical', [visit()], 'Stale Person')], nextCursor: null } }); }
    return r.fulfill({ json: { items: [patient(2, 'basic', [visit()], 'Fresh Person')], nextCursor: null } });
  });
  noSensitiveUrl(page);
  await page.goto('/doctor/network-search');
  await expect(page.getByTestId('input-global-search')).toHaveCount(0);
  await page.getByTestId('input-network-search').fill('Old Term');
  await page.getByTestId('button-network-search').click();
  await page.getByTestId('input-network-search').fill('New Term');
  await page.getByTestId('button-network-search').click();
  await expect(page.getByTestId('network-result-2')).toBeVisible();
  releaseOld();
  await page.waitForTimeout(400);
  await expect(page.getByTestId('network-result-1')).toHaveCount(0);
  await page.getByTestId('input-network-search').fill('New Ter');
  await expect(page.getByTestId('network-result-2')).toHaveCount(0); // cleared on input change
});

test('duplicate names stay distinct; card timeline, consent, empty alerts and no fake midnight', async ({ page }, info) => {
  await boot(page, 'doctor', info.project.use.locale, info.project.use.colorScheme);
  await lookup(page, (_q, r) => r.fulfill({ json: { items: [
    patient(11, 'clinical', [clinical(), visit({ seenAt: '2024-03-09T22:00:00Z', clinicId: 101, clinicName: 'Synthetic Home Clinic' })]),
    patient(12, 'none', []),
  ], nextCursor: null } }));
  noSensitiveUrl(page);
  await page.goto('/doctor/network-search');
  await page.getByTestId('input-network-search').fill('Synthetic Same');
  await page.getByTestId('button-network-search').click();
  await expect(page.getByTestId('network-result-11')).toBeVisible();
  await expect(page.getByTestId('network-result-12')).toBeVisible();
  await expect(page.getByTestId('badge-consent-12')).toHaveAttribute('data-level', 'none');
  await expect(page.getByTestId('text-summary-date-11')).toContainText('2025');
  await page.getByTestId('button-open-patient-11').click();
  await expect(page).toHaveURL(/\/doctor\/patient-card$/);
  await expect(page.getByTestId('network-timeline')).toBeVisible();
  await expect(page.getByTestId('network-consent')).toHaveAttribute('data-level', 'clinical');
  await expect(page.getByTestId('status-no-alerts-0')).toBeVisible();
  await expect(page.getByTestId('text-visit-date-1')).toHaveText(
    info.project.use.locale === 'ar' ? '10 مارس 2024' : '10 March 2024',
  ); // Hebron start-of-day, localized, no 00:00
  await page.getByTestId('link-network-back').click();
  await expect(page.getByTestId('button-open-patient-11')).toBeFocused();
});

test('withdrawal and downgrade after prior success remove protected content', async ({ page }, info) => {
  await boot(page, 'doctor', info.project.use.locale, info.project.use.colorScheme);
  let phase: 'clinical' | 'basic' | 'withdrawn' | 'denied' = 'clinical';
  const alert = { kind: 'allergy', labelKey: 'alerts.allergy.penicillin', labelParams: {}, label: 'Penicillin allergy', ruleId: 'allergy.penicillin', dictionaryVersion: '1', sourceNoteExcerpt: 'Synthetic: allergic to penicillin', excerptStart: 0, excerptEnd: 10, sourceVisitId: 5, patientId: 21, sourceClinicId: 102, sourceClinicName: 'Synthetic North Clinic', sourceVisitDate: '2025-05-20', disclaimerKey: 'alerts.unconfirmed', crossClinicDisclaimerKey: 'alerts.crossClinic' };
  await lookup(page, (_q, r) => {
    if (phase === 'denied') return r.fulfill({ status: 403, json: { code: 'FORBIDDEN', messageKey: 'error.forbidden', params: {} } });
    if (phase === 'withdrawn') return r.fulfill({ json: { items: [], nextCursor: null } });
    return r.fulfill({ json: { items: [patient(21, phase, [phase === 'clinical' ? clinical([alert]) : visit()])], nextCursor: null } });
  });
  await page.goto('/doctor/network-search');
  await page.getByTestId('input-network-search').fill('Synthetic Same');
  await page.getByTestId('button-network-search').click();
  await page.getByTestId('button-open-patient-21').click();
  await expect(page.getByTestId('text-alert-cross').first()).toHaveText(
    info.project.use.locale === 'ar' ? 'تنبيه من عيادة أخرى: تأكد مع المريض' : 'Flag from another clinic: confirm with the patient',
  );
  await expect(page.getByTestId('text-visit-note-0')).toBeVisible();
  phase = 'basic';
  await page.evaluate(() => document.dispatchEvent(new Event('amal:consent-changed')));
  await expect(page.getByTestId('network-consent')).toHaveAttribute('data-level', 'basic');
  await expect(page.getByTestId('text-visit-note-0')).toHaveCount(0);
  await expect(page.getByTestId('chip-alert-0-0')).toHaveCount(0);
  phase = 'withdrawn';
  await page.evaluate(() => document.dispatchEvent(new Event('amal:consent-changed')));
  await expect(page.getByTestId('state-card-gone')).toBeVisible();
  await expect(page.getByTestId('network-timeline')).toHaveCount(0);
  phase = 'denied';
  await page.getByTestId('link-network-back').click();
  await expect(page.getByTestId('state-network-denied')).toBeVisible();
  await expect(page.locator('[data-testid^="network-result-"]')).toHaveCount(0);
});

test('denied roles and direct navigation never call lookup', async ({ page }, info) => {
  await boot(page, 'front-desk', info.project.use.locale, info.project.use.colorScheme);
  let calls = 0;
  await lookup(page, (_q, r) => { calls++; return r.fulfill({ json: { items: [], nextCursor: null } }); });
  for (const path of ['/doctor/network-search', '/doctor/patient-card']) {
    await page.goto(path);
    await expect(page.getByTestId('state-forbidden')).toBeVisible();
  }
  expect(calls).toBe(0);
});

test('direct card navigation without a selection shows composed empty state', async ({ page }, info) => {
  await boot(page, 'doctor', info.project.use.locale, info.project.use.colorScheme);
  let calls = 0;
  await lookup(page, (_q, r) => { calls++; return r.fulfill({ json: { items: [], nextCursor: null } }); });
  await page.goto('/doctor/patient-card');
  await expect(page.getByTestId('state-card-none')).toBeVisible();
  expect(calls).toBe(0);
});

test('reload clears selection (memory-only), nothing persisted to storage', async ({ page }, info) => {
  await boot(page, 'doctor', info.project.use.locale, info.project.use.colorScheme);
  await lookup(page, (_q, r) => r.fulfill({ json: { items: [patient(31, 'basic', [visit()])], nextCursor: null } }));
  await page.goto('/doctor/network-search');
  await page.getByTestId('input-network-search').fill('Synthetic Same');
  await page.getByTestId('button-network-search').click();
  await page.getByTestId('button-open-patient-31').click();
  await expect(page.getByTestId('network-timeline')).toBeVisible();
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(stored).not.toMatch(/Synthetic Same|North Clinic/);
  await page.reload();
  await expect(page.getByTestId('state-card-none')).toBeVisible();
});
