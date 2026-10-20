import { test, expect, chromium, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { issueOfflinePermit } from '../../api-server/src/lib/offline-permit';
import { bootAdmin, exampleClinic } from './helpers/admin-fixtures';

// Only the existing signing function is imported (its Auth import is type-only).
// No keys, verification functions, auth logic, cache grants or IDB records are replaced.
const clinic = exampleClinic();
const doctor = { id: 87654, clinicId: clinic.id, name: 'Synthetic Doctor · طبيب تجريبي', networkVisible: true };
const patient = { id: 98761, clinicId: clinic.id, name: 'Synthetic Cedar · مريض تجريبي', phone: '0590000000', dateOfBirth: '1990-01-01' };
const day = formatInTimeZone(new Date(), 'Asia/Hebron', 'yyyy-MM-dd');
const stamp = new Date().toISOString();
const envelope = (items: unknown[]) => ({ items, nextCursor: null });

function batch(id: number) {
  const reviewed = id !== 901;
  return {
    id, version: 1, sourceName: 'synthetic-presentation.json', status: id === 904 ? 'committed' : reviewed ? 'reviewed' : 'staged',
    createdAt: stamp, committedAt: id === 904 ? stamp : null,
    rows: [{
      id: 1, source: { event_id: 'synthetic-event', doctor_email: 'synthetic@example.invalid', patient_name_typed: patient.name,
        start_time: `${day}T09:00:00`, end_time: `${day}T09:30:00`, event_status: 'confirmed' },
      suggestedPatientIds: [patient.id], confirmedPatientId: reviewed ? patient.id : null, errors: [],
      review: reviewed ? { action: 'include', reviewerId: 42, reviewedAt: stamp, identityAction: 'existing', verificationMethod: 'phone' } : null,
      mapping: { doctorId: doctor.id, clinicId: clinic.id, startsAt: fromZonedTime(`${day}T09:00:00`, 'Asia/Hebron').toISOString(),
        endsAt: fromZonedTime(`${day}T09:30:00`, 'Asia/Hebron').toISOString(), startLocal: `${day}T09:00:00`,
        endLocal: `${day}T09:30:00`, durationMinutes: 30, status: 'booked', timezone: 'Asia/Hebron' },
      outcome: id === 904 ? 'created' : reviewed ? 'reviewed' : 'review-required',
      appointmentId: id === 904 ? 98765 : null, availableActions: ['include-existing', 'include-new', 'skip'],
    }],
    totals: { sourceRows: 1, autoLinked: 0, reviewRequired: reviewed ? 0 : 1, suggestedRows: 1, skipped: 0,
      created: id === 904 ? 1 : 0, linked: 0, intraExportPairs: 0, existingOverlaps: id === 903 ? 1 : 0, existingCoincidences: 0 },
    conflicts: id === 903 ? [{ kind: 'existing-appointment', severity: 'blocking', rowIds: [1], appointmentId: 98765,
      code: 'DOCTOR_OVERLAP', messageKey: 'import.conflict.doctorOverlap', params: {} }] : [],
  };
}

async function fixture(page: Page, info: TestInfo, role: 'admin' | 'front-desk' | 'doctor', signed = false) {
  const locale = info.project.use.locale ?? 'en', theme = info.project.use.colorScheme ?? 'light';
  if (locale !== 'ar' && locale !== 'en') throw new Error(`Unsupported presentation locale: ${locale}`);
  if (theme !== 'light' && theme !== 'dark') throw new Error(`Unsupported presentation theme: ${theme}`);
  await bootAdmin(page, { role, locale, theme });
  let offline = false;
  const writes: string[] = [], unknown: string[] = [], reads: string[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    // Routing must not manufacture connectivity while Chromium is offline.
    if (offline) return route.abort('internetdisconnected');
    if (request.method() !== 'GET') {
      writes.push(`${request.method()} ${path}`);
      return route.fulfill({ status: 405, json: { code: 'PRESENTATION_READ_ONLY', messageKey: 'error.forbidden', params: {} } });
    }
    reads.push(path);
    const json = (body: unknown) => route.fulfill({ json: body, headers: { 'cache-control': 'no-store' } });
    if (path === '/api/demo/context') return json({ enabled: false, generation: null, clinicId: null, outage: false });
    if (path === '/api/me') return json({
      id: 42, email: 'synthetic@example.invalid', role, clinicId: role === 'admin' ? null : clinic.id,
      doctorId: role === 'doctor' ? doctor.id : null, locale, theme, csrfToken: 'synthetic-no-server-credential',
      device: signed ? { id: 76544, clinicId: clinic.id } : null,
      session: { expiresAt: new Date(Date.now() + 3600_000).toISOString(), absoluteExpiresAt: null, idleTimeoutSeconds: 1800 },
      reauth: { required: false, validUntil: null },
    });
    if (path === '/api/auth/offline-permit' && signed) {
      const nonce = url.searchParams.get('nonce') ?? '';
      expect(nonce).toMatch(/^[a-f0-9]{64}$/);
      return json(issueOfflinePermit({
        id: 42, email: 'synthetic@example.invalid', role, clinicId: clinic.id, doctorId: null, locale, theme,
        sessionDigest: 'synthetic-not-a-server-session', csrfToken: 'synthetic-no-server-credential',
        device: { id: 76544, clinicId: clinic.id }, expiresAt: new Date(Date.now() + 3600_000),
        absoluteExpiresAt: null, pinVerifiedAt: null,
      }, clinic, nonce));
    }
    if (path === '/api/auth/offline-permit')
      return route.fulfill({ status: 503, json: { code: 'INTERNAL', messageKey: 'error.internal', params: {} } });
    if (path === '/api/clinics') return json(envelope([{ ...clinic, mode: 'network' }]));
    if (path === '/api/admin/clinics') return json(envelope([clinic]));
    if (path === '/api/doctors' || path === '/api/admin/doctors') return json(envelope([doctor]));
    if (path === '/api/patients') return json(envelope([patient]));
    if (path === `/api/patients/${patient.id}`) return json(patient);
    if (path === `/api/patients/${patient.id}/consent`) return json({
      patient: { id: patient.id, name: patient.name }, current: null, history: [], effectiveLevel: 'none', canWithdraw: false,
      eligibility: { dateOfBirth: patient.dateOfBirth, ageStatus: 'adult', asOfDate: day },
    });
    if (path === '/api/appointments') return json(envelope([{
      id: 98765, clinicId: clinic.id, doctorId: doctor.id, patientId: patient.id, patientName: patient.name,
      startsAt: fromZonedTime(`${day}T09:00:00`, 'Asia/Hebron').toISOString(),
      endsAt: fromZonedTime(`${day}T09:30:00`, 'Asia/Hebron').toISOString(),
      status: 'booked', version: 1, source: 'phone', clientOpId: '00000000-0000-4000-8000-000000000020',
    }]));
    if (path === '/api/sync/state') return json({ deviceId: 76544, nextSequence: 1 });
    if (path === '/api/sync/conflicts') return json(envelope([]));
    if (path === '/api/sync/pull') return json({ changes: [], nextCursor: null, since: 'synthetic-cursor' });
    if (path === '/api/reception/context') return json({ clinic, doctors: [doctor] });
    if (path === '/api/doctor/day') return json({
      day, items: [{ id: 98765, startsAt: fromZonedTime(`${day}T09:00:00`, 'Asia/Hebron').toISOString(), status: 'booked',
        patient: { id: patient.id, name: patient.name, identityVerified: false, effectiveConsentLevel: 'clinical', visits: [] } }],
      nextCursor: null,
    });
    const bid = path.match(/^\/api\/import\/(\d+)$/)?.[1];
    if (bid) return json(batch(Number(bid)));
    // Delegate only read-only admin GETs to the closed 503 helper.
    if (role === 'admin') return route.fallback();
    unknown.push(path);
    return route.fulfill({ status: 503, json: { code: 'UNMOCKED_PRESENTATION_READ', messageKey: 'error.internal', params: {} } });
  });
  return {
    writes, unknown, reads,
    async goOffline() { offline = true; await page.context().setOffline(true); },
    async done() {
      await info.attach('request-safety', { body: JSON.stringify({ writes, unknown, reads }, null, 2), contentType: 'application/json' });
      expect(writes, 'No API mutation, including mocked domain mutation, may be attempted').toEqual([]);
      expect(unknown, 'Every private GET fixture must be explicit').toEqual([]);
    },
  };
}

async function capture(page: Page, info: TestInfo, label: string) {
  await page.evaluate(() => document.fonts.ready);
  const file = info.outputPath(`${label}.png`);
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
  await info.attach(label, { path: file, contentType: 'image/png' });
  const layout = await page.evaluate(() => ({
    width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll<HTMLElement>('body *')].map(el => {
      const box = el.getBoundingClientRect();
      return { tag: el.tagName, class: el.className, testId: el.dataset.testid, left: box.left, right: box.right, width: box.width };
    }).filter(box => box.width > 0 && (box.left < -1 || box.right > document.documentElement.clientWidth + 1)).slice(0, 30),
  }));
  await info.attach(`${label}-layout`, { body: JSON.stringify(layout, null, 2), contentType: 'application/json' });
  expect.soft(layout.scrollWidth <= layout.width + 1, `${label}: overflow`).toBe(true);
  const scan = await new AxeBuilder({ page }).analyze();
  await info.attach(`${label}-axe`, { body: JSON.stringify(scan.violations, null, 2), contentType: 'application/json' });
  expect.soft(scan.violations.filter(v => ['serious', 'critical'].includes(v.impact ?? '')).map(v => v.id), `${label}: axe`).toEqual([]);
}

test('fixture: registration validation, minor guardian and consent access PIN dialog (no submit)', async ({ page }, info) => {
  const api = await fixture(page, info, 'front-desk');
  await page.goto('/desk/patients');
  const opener = page.getByTestId('button-new-patient');
  await opener.click();
  await expect(page.getByTestId('dialog-new-patient')).toBeVisible();
  await capture(page, info, 'registration-empty');
  await page.getByTestId('button-reg-save').click(); // Invalid form: frontend validation only.
  await expect(page.getByTestId('text-reg-summary')).toBeVisible();
  await page.getByTestId('input-reg-dob').fill(`${Number(day.slice(0, 4)) - 8}-01-01`);
  await expect(page.getByTestId('fieldset-guardian')).toBeVisible();
  await capture(page, info, 'registration-minor-validation');
  await page.keyboard.press('Tab');
  expect(await page.getByTestId('dialog-new-patient').evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.getByTestId('button-reg-cancel').click();
  await expect(opener).toBeFocused();
  await page.getByTestId('input-patient-search').fill('Synthetic');
  await page.getByTestId(`option-patient-${patient.id}`).click();
  await page.getByTestId('link-patient-consent').click();
  await page.getByTestId('checkbox-access-confirm').check();
  await page.getByTestId('button-access-open').click();
  await expect(page.getByTestId('dialog-pin')).toBeVisible();
  await capture(page, info, 'consent-access-pin');
  await page.getByTestId('button-pin-cancel').click();
  await api.done();
});

test('fixture: admin doctor create/edit and user create dialogs (cancel only)', async ({ page }, info) => {
  const api = await fixture(page, info, 'admin');
  await page.goto('/admin/clinics-doctors');
  await page.getByTestId(`button-add-doctor-clinic-${clinic.id}`).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await capture(page, info, 'doctor-create-dialog');
  await page.keyboard.press('Escape');
  await page.getByTestId(`button-edit-doctor-${doctor.id}`).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await capture(page, info, 'doctor-edit-dialog');
  await page.keyboard.press('Escape');
  await page.goto('/admin/users-devices');
  await page.getByTestId('button-add-user').click();
  await capture(page, info, 'user-create-dialog');
  await page.getByTestId('button-user-cancel').click();
  await api.done();
});

test('fixture: import mapping, identity dialog, status, conflicts and commit preview (GET only)', async ({ page }, info) => {
  const api = await fixture(page, info, 'doctor');
  await page.goto('/work/import?batch=901');
  await expect(page.getByTestId('status-staged')).toBeVisible();
  await page.getByTestId('step-doctors').click();
  await capture(page, info, 'import-doctors');
  await page.getByTestId('step-patients').click();
  await capture(page, info, 'import-patients-open');
  await page.getByTestId('button-review-1').click();
  await expect(page.getByTestId('dialog-row-review')).toBeVisible();
  await capture(page, info, 'import-identity-review');
  await page.getByTestId('radio-kind-create').check();
  await capture(page, info, 'import-new-identity');
  await page.getByTestId('button-row-cancel').click();
  // Different GET fixture, not a simulated successful save of the open row.
  await page.goto('/work/import?batch=903');
  await expect(page.getByTestId('status-staged')).toBeVisible();
  await page.getByTestId('step-status').click();
  await capture(page, info, 'import-status');
  await page.getByTestId('step-conflicts').click();
  await capture(page, info, 'import-conflicts');
  await page.goto('/work/import?batch=902');
  await expect(page.getByTestId('status-staged')).toBeVisible();
  await page.getByTestId('step-commit').click();
  await capture(page, info, 'import-commit-preview');
  // Pre-existing synthetic committed batch: no commit request ever sent.
  await page.goto('/work/import?batch=904');
  await expect(page.getByTestId('status-batch')).toBeVisible();
  await expect(page.getByTestId('status-batch')).toHaveClass(/im-pill--committed/);
  await capture(page, info, 'import-committed-report-entry');
  await api.done();
});

test('fixture: genuine signed authority, authorized offline populated/empty day-sheet and PDF', async ({ page }, info) => {
  const api = await fixture(page, info, 'front-desk', true);
  await page.goto(`/desk/today?date=${day}`);
  await expect(page.getByTestId('calendar-day')).toBeVisible();
  expect(await page.evaluate(() => !!JSON.parse(sessionStorage.getItem('amal-offline-permit-v1') ?? 'null')?.permit?.signature)).toBe(true);
  expect(api.reads).toContain('/api/auth/offline-permit');
  await page.goto('/desk/day-sheet');
  await expect(page.getByTestId('table-day-sheet')).toBeVisible();
  await expect(page.getByTestId('button-day-sheet-print')).toBeEnabled();
  await api.goOffline();
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  await expect(page.getByTestId('table-day-sheet')).toContainText(patient.name);
  await capture(page, info, 'authorized-offline-sheet');
  // Native Chromium PDF invokes the real beforeprint/afterprint listeners.
  await page.pdf({ path: info.outputPath('authorized-populated.pdf'), format: 'A4', printBackground: true });
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await expect(page.getByTestId('page-day-sheet')).toHaveAttribute('data-print-allowed', 'true');
  await capture(page, info, 'authorized-populated-print');
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: 'screen' });
  const dates = await page.getByTestId('select-day-sheet-day').locator('option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value));
  await page.getByTestId('select-day-sheet-day').selectOption(dates.find(d => d !== day)!);
  await expect(page.getByTestId('state-day-sheet-empty')).toBeVisible();
  await capture(page, info, 'authorized-offline-empty-sheet');
  // Reset the explicit screen-media override before PDF. Earlier retained empty
  // PDFs exposed this fixture mistake during image review; do not approve them.
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: info.outputPath('authorized-empty.pdf'), format: 'A4', printBackground: true });
  await api.done();
});

test('fixture: extra consent minor/history/withdrawal PIN and populated device dialogs (cancel only)', async ({ page }, info) => {
  const consentApi = await fixture(page, info, 'front-desk');
  await page.route(`**/api/patients/${patient.id}/consent`, route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const active = { id: 71, patientId: patient.id, level: 'clinical', status: 'active', recordedAt: stamp };
    return route.fulfill({ json: {
      patient: { id: patient.id, name: patient.name }, current: active,
      history: [active, { ...active, id: 70, level: 'basic', status: 'withdrawn', withdrawnAt: stamp }],
      effectiveLevel: 'clinical', canWithdraw: true,
      eligibility: { dateOfBirth: `${Number(day.slice(0, 4)) - 8}-01-01`, ageStatus: 'minor', asOfDate: day },
    } });
  });
  await page.goto('/desk/patients');
  await page.getByTestId('input-patient-search').fill('Synthetic');
  await page.getByTestId(`option-patient-${patient.id}`).click();
  await page.getByTestId('link-patient-consent').click();
  await page.getByTestId('radio-level-clinical').check();
  await expect(page.getByTestId('fieldset-guardian')).toBeVisible();
  await capture(page, info, 'consent-minor-history');
  await page.getByTestId('button-consent-withdraw').click();
  await expect(page.getByTestId('dialog-withdraw')).toBeVisible();
  await capture(page, info, 'consent-withdraw-confirmation');
  // This only opens the PIN dialog. No PIN is entered and no reauthentication is attempted.
  await page.getByTestId('button-withdraw-confirm').click();
  await expect(page.getByTestId('dialog-pin')).toBeVisible();
  await capture(page, info, 'consent-withdraw-pin');
  await page.getByTestId('button-pin-cancel').click();
  await consentApi.done();

  const adminApi = await fixture(page, info, 'admin');
  await page.route('**/api/auth/devices?*', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: {
      items: [{ id: 76544, clinicId: clinic.id, label: 'Synthetic shared reception · جهاز تجريبي',
        registeredAt: stamp, revokedAt: null }], page: 1, pageSize: 25, total: 1,
    } });
  });
  await page.goto('/admin/users-devices');
  await page.getByTestId('tab-devices').click();
  await expect(page.getByTestId('row-device-76544')).toBeVisible();
  await capture(page, info, 'devices-populated');
  await page.getByTestId('button-enroll-device').click();
  await expect(page.getByTestId('dialog-enroll-device')).toBeVisible();
  await capture(page, info, 'device-enrollment-dialog');
  await page.getByTestId('button-enroll-cancel').click();
  await page.getByTestId('button-revoke-device-76544').click();
  await expect(page.getByTestId('dialog-revoke-device')).toBeVisible();
  await capture(page, info, 'device-revoke-confirmation');
  await page.keyboard.press('Escape');
  await adminApi.done();
});

test('fixture: extra local import file validation and parsed preview (never stage)', async ({ page }, info) => {
  const api = await fixture(page, info, 'front-desk');
  await page.goto('/work/import');
  await page.getByTestId('input-import-file').setInputFiles({
    name: 'synthetic-invalid.json', mimeType: 'application/json', buffer: Buffer.from('{'),
  });
  await expect(page.getByTestId('error-file')).toBeVisible();
  await capture(page, info, 'import-file-invalid');
  await page.getByTestId('input-import-file').setInputFiles({
    name: 'synthetic-local-only.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify([batch(901).rows[0].source])),
  });
  await expect(page.getByTestId('button-stage-file')).toBeEnabled();
  await capture(page, info, 'import-file-parsed-not-staged');
  await api.done();
});

test('fixture: print pagination from authorized read-only synthetic 48-row cache', async ({ page }, info) => {
  expect(info.project.use.viewport?.width, 'A4 pagination fixture is configured only at desktop width').toBe(1440);
  const api = await fixture(page, info, 'front-desk', true);
  const start = fromZonedTime(`${day}T09:00:00`, 'Asia/Hebron').getTime();
  await page.route('**/api/appointments?*', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: envelope(Array.from({ length: 48 }, (_, i) => ({
      id: 99000 + i, clinicId: clinic.id, doctorId: doctor.id, patientId: patient.id,
      startsAt: new Date(start + i * 600_000).toISOString(), endsAt: new Date(start + (i + 1) * 600_000).toISOString(),
      status: i % 5 === 0 ? 'cancelled' : 'booked', version: 1, source: 'phone',
      clientOpId: `00000000-0000-4000-8000-${String(1000 + i).padStart(12, '0')}`,
    }))) });
  });
  await page.goto(`/desk/today?date=${day}`);
  await expect(page.getByTestId('calendar-day')).toBeVisible();
  await page.goto('/desk/day-sheet');
  await expect(page.getByTestId('table-day-sheet').locator('tbody tr')).toHaveCount(48);
  await api.goOffline();
  await page.pdf({ path: info.outputPath('authorized-multipage.pdf'), format: 'A4', printBackground: true });
  await api.done();
});

test('native zoom: Chromium extension tabs.setZoom(2), measured browser layout and focus', async ({}, info) => {
  // chrome.tabs.setZoom is browser zoom, unlike CSS zoom, root-font resize,
  // deviceScaleFactor or CDP pinch/pageScaleFactor.
  const extension = info.outputPath('zoom-extension');
  await mkdir(extension, { recursive: true });
  await writeFile(`${extension}/manifest.json`, JSON.stringify({
    manifest_version: 3, name: 'Read-only presentation zoom verification', version: '1.0',
    permissions: ['tabs'], background: { service_worker: 'worker.js' },
  }));
  await writeFile(`${extension}/worker.js`, 'chrome.runtime.onInstalled.addListener(() => {});');
  const context = await chromium.launchPersistentContext(info.outputPath('zoom-profile'), {
    executablePath: process.env.HARNESS_CHROMIUM_PATH ?? '/repl/tools/bin/chromium',
    headless: false, viewport: null, serviceWorkers: 'allow',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--window-size=1440,1000'],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15_000 });
    const page = context.pages()[0] ?? await context.newPage();
    const windowSession = await context.newCDPSession(page);
    const { windowId } = await windowSession.send('Browser.getWindowForTarget');
    await windowSession.send('Browser.setWindowBounds', { windowId,
      bounds: { left: 0, top: 0, width: 1440, height: 1000 } });
    await windowSession.detach();
    await page.route('**/api/**', r => r.fulfill({ status: 401, json: {} }));
    await page.goto(`${process.env.POLISH_BASE_URL ?? 'http://localhost:80'}/ui-kit`);
    await expect(page.getByTestId('button-theme-light')).toBeVisible();
    const metrics = () => page.evaluate(() => ({
      innerWidth, outerWidth, devicePixelRatio, font: getComputedStyle(document.documentElement).fontSize,
      scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
    }));
    const before = await metrics();
    const zoom = await worker.evaluate(async () => {
      const chrome = (globalThis as unknown as { chrome: {
        tabs: { query: (q: object) => Promise<{ id?: number; url?: string }[]>;
          setZoom: (id: number, zoom: number) => Promise<void>; getZoom: (id: number) => Promise<number> };
      } }).chrome;
      const tab = (await chrome.tabs.query({})).find(t => t.url?.includes('/ui-kit'));
      if (!tab?.id) throw new Error('No UI-kit browser tab for native zoom');
      await chrome.tabs.setZoom(tab.id, 2);
      return chrome.tabs.getZoom(tab.id);
    });
    await expect.poll(async () => (await metrics()).devicePixelRatio / before.devicePixelRatio).toBeCloseTo(2, 1);
    const after = await metrics();
    expect(zoom).toBe(2);
    expect(after.innerWidth).toBeLessThan(before.innerWidth * 0.55);
    expect(after.font).toBe(before.font);
    await info.attach('native-zoom-metrics', { body: JSON.stringify({ mechanism: 'chrome.tabs.setZoom', zoom, before, after }, null, 2), contentType: 'application/json' });
    // At native tab zoom, Chromium's fullPage screenshot surface can retain
    // pre-zoom dimensions. Capture the real viewport at CSS scale instead.
    const zoomViewport = async (label: string) => {
      await page.bringToFront();
      const cdp = await context.newCDPSession(page);
      const raw = await cdp.send('Page.captureScreenshot', {
        format: 'png', fromSurface: false, captureBeyondViewport: false,
      });
      await writeFile(info.outputPath(`${label}-compositor.png`), Buffer.from(raw.data, 'base64'));
      await cdp.detach();
      // Independent X11 display pixels: avoids all DevTools/Playwright zoom
      // screenshot math. The disposable browser is foreground; no sign-in.
      await promisify(execFile)('import', ['-window', 'root', '-crop', '1440x1000+0+0', '+repage',
        info.outputPath(`${label}-display.png`)]);
      await page.screenshot({ path: info.outputPath(`${label}-viewport.png`),
        fullPage: false, scale: 'css', animations: 'disabled' });
      const geometry = await page.evaluate(() => {
        const main = document.querySelector('main') ?? document.body;
        const box = main.getBoundingClientRect();
        const active = document.activeElement as HTMLElement;
        const focus = active.getBoundingClientRect();
        return { innerWidth, innerHeight, scrollX, scrollY,
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          main: { x: box.x, y: box.y, width: box.width, height: box.height },
          mobileMedia: matchMedia('(max-width:1023px)').matches,
          bottomNav: [...document.querySelectorAll<HTMLElement>('.shell-bottom, .shell-bottom a, .shell-bottom button')].map(el => {
            const r = el.getBoundingClientRect();
            return { text: el.textContent?.trim(), position: getComputedStyle(el).position,
              x: r.x, y: r.y, width: r.width, height: r.height };
          }),
          focus: { tag: active.tagName, x: focus.x, y: focus.y,
            width: focus.width, height: focus.height },
          fixed: [...document.querySelectorAll('body *')].filter(el =>
            getComputedStyle(el).position === 'fixed').map(el => {
            const r = el.getBoundingClientRect();
            return { tag: el.tagName, testId: el.getAttribute('data-testid'),
              x: r.x, y: r.y, width: r.width, height: r.height };
          }).filter(r => r.width > 0 && r.height > 0),
        };
      });
      await info.attach(`${label}-viewport-geometry`, {
        body: JSON.stringify(geometry, null, 2), contentType: 'application/json',
      });
    };
    for (const locale of ['ar', 'en']) for (const theme of ['light', 'dark']) {
      await page.getByTestId(`button-locale-${locale}`).click();
      await page.getByTestId(`button-theme-${theme}`).click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await capture(page, info, `native-200-${locale}-${theme}`);
      await zoomViewport(`native-200-${locale}-${theme}`);
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
    }
    const api = await fixture(page, info, 'doctor');
    for (const [path, ready, label] of [
      ['/doctor/my-day', 'row-day-98765', 'doctor-day'],
      ['/data', 'page-data', 'privacy'],
    ]) {
      await page.goto(`${process.env.POLISH_BASE_URL ?? 'http://localhost:80'}${path}`);
      await expect(page.getByTestId(ready)).toBeVisible();
      expect((await metrics()).devicePixelRatio / before.devicePixelRatio).toBe(2);
      for (const locale of ['ar', 'en']) for (const theme of ['light', 'dark']) {
        const needsMenu = !(await page.getByTestId(`button-locale-${locale}`).filter({ visible: true }).count());
        if (needsMenu) await page.getByTestId('button-user-menu').click();
        await page.getByTestId(`button-locale-${locale}`).filter({ visible: true }).click();
        await page.getByTestId(`button-theme-${theme}`).filter({ visible: true }).click();
        if (needsMenu) await page.getByTestId('button-user-close').click();
        await page.evaluate(() => window.scrollTo(0, 0));
        await capture(page, info, `native-200-${label}-${locale}-${theme}`);
        await zoomViewport(`native-200-${label}-${locale}-${theme}`);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await zoomViewport(`native-200-${label}-${locale}-${theme}-bottom`);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.keyboard.press('Tab');
        const focus = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement;
          const box = el.getBoundingClientRect(), style = getComputedStyle(el);
          return { tag: el.tagName, width: box.width, height: box.height,
            indicator: (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none' };
        });
        await info.attach(`native-focus-${label}-${locale}-${theme}`, { body: JSON.stringify(focus), contentType: 'application/json' });
        expect(focus.tag).not.toBe('BODY');
        expect(focus.width).toBeGreaterThan(0);
        expect(focus.height).toBeGreaterThan(0);
        expect.soft(focus.indicator).toBe(true);
      }
    }
    await api.done();
  } finally {
    await context.close();
  }
});
