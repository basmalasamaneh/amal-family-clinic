import { test, expect, type Page } from '@playwright/test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Isolated network fixtures only: no backend patient data, credentials, or writes.
const patientId = 44;
const offlineKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const screenshotDir = resolve(process.cwd(), '../../generated-artifacts/network/visit-authoring');
mkdirSync(screenshotDir, { recursive: true });
async function capture(page: Page, project: string, name: string) {
  const path = resolve(screenshotDir, `${project}-${name}.png`);
  const body = await page.screenshot({ path });
  return { path, body };
}
const existingVisit = () => ({
  visitId: 700, clinicId: 102, doctorId: 7, clinicName: 'Synthetic North Clinic',
  doctorName: 'Synthetic Doctor', seenAt: '2025-05-20T08:30:00Z',
  visibility: 'clinical', canAddendum: true, complaint: 'Original clinical note',
  note: 'Original clinical note', addenda: [],
});
type Fixture = {
  visits: any[];
  access: any;
  accessStatus: number;
  accessCalls: number;
  createMode: 'success' | 'ambiguous' | 'validation';
  createRequests: any[];
  committed: Map<string, number>;
  addenda: any[];
};

async function boot(page: Page, locale: 'ar' | 'en', theme: 'dark' | 'light') {
  const f: Fixture = {
    visits: [existingVisit()], access: { canCreate: true, clinicId: 101, doctorId: 201 },
    accessStatus: 200, accessCalls: 0, createMode: 'success', createRequests: [],
    committed: new Map(), addenda: [],
  };
  await page.addInitScript(({ locale, theme }) => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => (window as any).__amalTestOnline ?? true });
    (window as any).__amalTestOnline = true;
    localStorage.setItem('amal.tour.v1:account%3A42:doctor', 'dismissed');
    localStorage.setItem('amal.tour.v1:account:42:doctor', 'dismissed');
    localStorage.setItem('amal.display.v1:account%3A42', JSON.stringify({ locale, theme, digitPreference: 'latn' }));
  }, { locale, theme });
  // All unmatched API traffic is rejected locally; a fixture bug must never fall through to live data.
  await page.route('**/api/**', r => r.fulfill({ status: 404, json: { code: 'UNFIXTURED_TEST_API' } }));
  await page.route('**/api/demo/context', r => r.fulfill({ json: { enabled: false, generation: null, clinicId: null, outage: false } }));
  await page.route('**/api/auth/offline-permit**', async r => {
    const nonce = new URL(r.request().url()).searchParams.get('nonce')!;
    const issuedAt = await page.evaluate(() => Date.now());
    const payload = Buffer.from(JSON.stringify({
      version: 1, audience: 'amal-offline-tab', nonce, userId: 'account:42',
      name: 'synthetic@example.invalid', role: 'doctor',
      clinic: { id: 101, name: 'Synthetic Home Clinic' }, issuedAt, expiresAt: issuedAt + 30 * 60_000,
    })).toString('base64url');
    const signature = sign('sha256', Buffer.from(payload), { key: offlineKeys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return r.fulfill({ json: {
      payload, signature, publicKey: offlineKeys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    } });
  });
  await page.route('**/api/me', r => r.fulfill({ json: {
    id: 42, email: 'synthetic@example.invalid', role: 'doctor', clinicId: 101, doctorId: 201,
    locale, theme, csrfToken: 'test-only-csrf',
    session: { expiresAt: '2031-01-01T00:00:00Z', absoluteExpiresAt: null, idleTimeoutSeconds: 1800 },
    device: null, reauth: { required: false, validUntil: null },
  } }));
  await page.route('**/api/clinics?*', r => r.fulfill({ json: {
    items: [{ id: 101, name: 'Synthetic Home Clinic', timezone: 'Asia/Hebron', mode: 'network' }], nextCursor: null,
  } }));
  await page.route('**/api/network/lookup?*', r => r.fulfill({ json: {
    items: [{ id: patientId, name: 'Synthetic Visit Patient', identityVerified: false, effectiveConsentLevel: 'clinical', visits: f.visits }],
    nextCursor: null,
  } }));
  await page.route(`**/api/doctor/patients/${patientId}`, r => r.fulfill({ json: {
    id: patientId, name: 'Synthetic Visit Patient', identityVerified: false,
    effectiveConsentLevel: 'clinical', visits: f.visits,
  } }));
  await page.route(`**/api/doctor/patients/${patientId}/visit-authoring`, async r => {
    f.accessCalls++;
    if (f.accessStatus !== 200) return r.fulfill({ status: f.accessStatus, json: { code: 'FORBIDDEN', message: 'Synthetic denial' } });
    return r.fulfill({ json: f.access });
  });
  await page.route(`**/api/doctor/patients/${patientId}/visits**`, async r => {
    const url = new URL(r.request().url());
    const body = r.request().postDataJSON();
    if (url.pathname.endsWith('/addenda')) {
      f.addenda.push(body);
      const visitId = Number(url.pathname.split('/').at(-2));
      const visit = f.visits.find(v => v.visitId === visitId);
      visit.addenda.push({ doctorName: 'Synthetic Doctor', createdAt: '2030-01-15T09:00:00Z', note: body.note });
      return r.fulfill({ status: 201, json: { addendumId: f.addenda.length, createdAt: '2030-01-15T09:00:00Z' } });
    }
    f.createRequests.push(body);
    if (f.createMode === 'validation') return r.fulfill({ status: 400, json: { code: 'VALIDATION', message: 'Synthetic validation error' } });
    let visitId = f.committed.get(body.clientOpId);
    if (!visitId) {
      visitId = 900 + f.committed.size;
      f.committed.set(body.clientOpId, visitId);
      f.visits.unshift({
        visitId, clinicId: 101, doctorId: 201, clinicName: 'Synthetic Home Clinic',
        doctorName: 'Synthetic Doctor', seenAt: body.seenAt, visibility: 'clinical',
        canAddendum: true, complaint: body.note, note: body.note, addenda: [],
      });
    }
    if (f.createMode === 'ambiguous' && f.createRequests.length === 1)
      return r.fulfill({ status: 500, json: { code: 'OUTCOME_UNKNOWN' } });
    return r.fulfill({ status: 201, json: { visitId, createdAt: '2030-01-15T09:00:00Z' } });
  });
  await page.goto('/doctor/network-search');
  await page.getByTestId('input-network-search').fill('Synthetic Visit Patient');
  await page.getByTestId('button-network-search').click();
  await page.getByTestId(`button-open-patient-${patientId}`).click();
  await expect(page.getByTestId('network-timeline')).toBeVisible();
  return f;
}

async function startNewVisit(page: Page, date = '2030-01-15T10:30') {
  await page.getByTestId('button-new-visit').click();
  await expect(page.getByTestId('input-visit-note')).toBeVisible();
  await page.getByTestId('input-visit-date').fill(date);
}

test('creates a Hebron-dated visit and appends an addendum without changing the original', async ({ page }, info) => {
  await page.clock.install({ time: new Date('2030-01-15T09:00:00Z') });
  const f = await boot(page, info.project.use.locale, info.project.use.colorScheme);
  await startNewVisit(page);
  await page.getByTestId('input-visit-note').fill('New synthetic visit note');
  const editor = await capture(page, info.project.name, 'open-editor');
  await info.attach('visit-authoring-open-editor', { body: editor.body, contentType: 'image/png' });
  await page.getByTestId('button-save-visit').click();
  await expect(page.getByTestId('status-visit-save')).toBeVisible();
  await expect(page.getByTestId('status-visit-save')).toHaveText(
    info.project.use.locale === 'ar' ? 'تم حفظ الملاحظة.' : 'Note saved.',
  );
  expect(f.createRequests[0]).toMatchObject({
    clientOpId: expect.any(String),
    note: 'New synthetic visit note', seenAt: '2030-01-15T08:30:00.000Z',
  });
  await expect(page.getByTestId('network-timeline')).toContainText('New synthetic visit note');
  expect(await page.locator('[data-testid^="text-visit-note-"]').allInnerTexts())
    .toContain('New synthetic visit note');
  expect((await page.locator('[data-testid^="text-visit-note-"]').allInnerTexts())
    .filter(n => n === 'New synthetic visit note')).toHaveLength(1);

  await page.getByTestId('button-addendum-900').click();
  await page.getByTestId('input-visit-note').fill('Synthetic addendum text');
  await page.getByTestId('button-save-visit').click();
  await expect(page.getByTestId('network-timeline')).toContainText('Synthetic addendum text');
  expect(f.addenda).toHaveLength(1);
  expect(f.addenda[0]).toMatchObject({ clientOpId: expect.any(String), note: 'Synthetic addendum text' });
  expect(f.visits.find(v => v.visitId === 900).note).toBe('New synthetic visit note');
  await expect(page.getByTestId('network-timeline')).toContainText('Original clinical note');
  const timeline = await capture(page, info.project.name, 'updated-timeline');
  await info.attach('visit-authoring-updated-timeline', { body: timeline.body, contentType: 'image/png' });
});

test('focus revalidation 503 and offline blocking retain a typed draft', async ({ page }, info) => {
  await page.clock.install({ time: new Date('2030-01-15T09:00:00Z') });
  const f = await boot(page, 'en', 'light');
  await startNewVisit(page);
  await page.getByTestId('input-visit-note').fill('Draft retained through revalidation');
  f.accessStatus = 503;
  const beforeRecheck = f.accessCalls;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => f.accessCalls).toBeGreaterThan(beforeRecheck);
  await expect(page.getByTestId('button-verify-visit-composer')).toBeVisible();
  await expect(page.getByTestId('input-visit-note')).toHaveValue('Draft retained through revalidation');
  await page.evaluate(() => {
    (window as any).__amalTestOnline = false;
    window.dispatchEvent(new Event('offline'));
  });
  await expect(page.getByTestId('status-visit-composer')).toBeVisible();
  await expect(page.getByTestId('input-visit-note')).toHaveValue('Draft retained through revalidation');
  await expect(page.getByTestId('button-save-visit')).toBeDisabled();
  const offline = await capture(page, info.project.name, 'offline-permission-error');
  await info.attach('visit-authoring-offline-permission-error', { body: offline.body, contentType: 'image/png' });
});

test('unknown commit retries exact body and id once; definite 400 allows correction', async ({ page }, info) => {
  await page.clock.install({ time: new Date('2030-01-15T09:00:00Z') });
  const f = await boot(page, 'en', 'light');
  await startNewVisit(page);
  await page.getByTestId('input-visit-note').fill('Draft retained through revalidation');
  f.createMode = 'ambiguous';
  await page.getByTestId('button-save-visit').click();
  await expect(page.getByTestId('button-save-visit')).toContainText('Retry');
  expect(f.createRequests).toHaveLength(1);
  await page.getByTestId('button-save-visit').click();
  await expect(page.getByTestId('network-timeline')).toContainText('Draft retained through revalidation');
  expect(f.createRequests).toHaveLength(2);
  expect(f.createRequests[1]).toEqual(f.createRequests[0]);
  expect(f.visits.filter(v => v.note === 'Draft retained through revalidation')).toHaveLength(1);
  expect((await page.locator('[data-testid^="text-visit-note-"]').allInnerTexts())
    .filter(n => n === 'Draft retained through revalidation')).toHaveLength(1);

  f.createMode = 'validation';
  await startNewVisit(page);
  await page.getByTestId('input-visit-note').fill('Needs correction');
  await page.getByTestId('button-save-visit').click();
  await expect(page.getByTestId('status-visit-composer')).toBeVisible();
  await expect(page.getByTestId('input-visit-note')).toBeEnabled();
  const validation = await capture(page, info.project.name, 'validation-error');
  await info.attach('visit-authoring-validation-error', { body: validation.body, contentType: 'image/png' });
  await page.getByTestId('input-visit-note').fill('Corrected synthetic note');
  f.createMode = 'success';
  await page.getByTestId('button-save-visit').click();
  await expect(page.getByTestId('network-timeline')).toContainText('Corrected synthetic note');
  expect(f.createRequests.at(-1).note).toBe('Corrected synthetic note');
  expect(f.createRequests.at(-1).clientOpId).not.toBe(f.createRequests.at(-2).clientOpId);
});

test('capability revocation clears the composer; basic projections show neither clinical text nor addendum controls', async ({ page }) => {
  const f = await boot(page, 'en', 'light');
  await startNewVisit(page);
  await page.getByTestId('input-visit-note').fill('Draft cleared on revocation');
  f.accessStatus = 401;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('input-visit-note')).toHaveCount(0);
  await expect(page.getByTestId('status-visit-save')).toBeVisible();
  await expect(page.getByTestId('button-new-visit')).toHaveCount(0);

  await page.getByTestId('link-network-back').click();
  f.accessStatus = 200;
  f.access = { canCreate: false, clinicId: 101, doctorId: 201 };
  f.visits = [{ ...existingVisit(), visibility: 'basic', canAddendum: false, note: undefined, complaint: undefined, addenda: [] }];
  await page.getByTestId('input-network-search').fill('Synthetic Visit Patient');
  await page.getByTestId('button-network-search').click();
  await page.getByTestId(`button-open-patient-${patientId}`).click();
  await expect(page.getByTestId('network-timeline')).toBeVisible();
  await expect(page.getByTestId('button-new-visit')).toHaveCount(0);
  await expect(page.getByTestId('button-addendum-700')).toHaveCount(0);
  await expect(page.locator('[data-testid^="text-visit-note-"]')).toHaveCount(0);
  await expect(page.getByTestId('network-timeline')).not.toContainText('Original clinical note');
});

test('Arabic dark composer is RTL and remains inside a mobile viewport; English light is LTR', async ({ page }, info) => {
  const ar = info.project.use.locale === 'ar';
  test.skip(!((ar && info.project.use.colorScheme === 'dark') ||
    (!ar && info.project.use.colorScheme === 'light')), 'Run the requested Arabic-dark and English-light combinations only.');
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page, ar ? 'ar' : 'en', ar ? 'dark' : 'light');
  await startNewVisit(page);
  const layout = await page.getByTestId('input-visit-note').evaluate(el => {
    const dialog = el.closest('[role="dialog"]')!;
    const r = dialog.getBoundingClientRect();
    return { x: r.x, right: r.right, width: r.width, top: r.top, bottom: r.bottom, height: innerHeight, position: getComputedStyle(dialog).position, direction: getComputedStyle(dialog).direction,
      documentDirection: getComputedStyle(document.documentElement).direction, viewport: innerWidth };
  });
  expect(layout.x).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(layout.viewport);
  expect(layout.position).toBe('fixed');
  expect(layout.top).toBeGreaterThanOrEqual(0);
  expect(layout.bottom).toBeLessThanOrEqual(layout.height);
  expect(layout.direction).toBe(ar ? 'rtl' : 'ltr');
  if (ar) expect(layout.documentDirection).toBe('rtl');
  await expect(page.getByTestId('input-visit-date')).toBeVisible();
  await page.screenshot({ path: resolve(screenshotDir, `${info.project.name}-fixed-dialog.png`) });
});
