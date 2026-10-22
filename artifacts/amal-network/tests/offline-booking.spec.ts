import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { issueOfflinePermit } from '../../api-server/src/lib/offline-permit';

/**
 * MOCKED API integration suite, not live-server evidence.
 *
 * The normal real-session shell and booking code run in a production PWA build.
 * Only HTTP authorization/demographic/calendar projections are synthetic.
 * The actual server signing function signs the actual browser-generated nonce.
 * No shellDemo, fixture adapter, IndexedDB writes/seeding, offline-identity
 * override, service-worker replacement or localCache monkeypatch is used.
 */
const origin = 'http://127.0.0.1:4178';
const mount = '/pwa-check/';
const userId = 581001;
const clinic = { id: 581002, name: 'Mock API offline-booking clinic · عيادة اختبار' };
const deviceId = 581003;
const doctors = [{ id: 581004, clinicId: clinic.id, name: 'Dr. Mock Booking · طبيب الاختبار', networkVisible: true }];
const patients = [
  { id: 581011, clinicId: clinic.id, name: 'Offline Test Amal · أمل', phone: '0599000011', dateOfBirth: '1990-01-02', visibility: 'basic' },
  { id: 581012, clinicId: clinic.id, name: 'Offline Test Nour · نور', phone: '0599000012', dateOfBirth: '1992-03-04', visibility: 'basic' },
  { id: 581013, clinicId: clinic.id, name: 'Offline Test Rami · رامي', phone: '0599000013', dateOfBirth: '1994-05-06', visibility: 'basic' },
];
const canonicalId = 581020;
const mockedLogin = { email: 'mock-offline-auth@example.test', password: 'mock-only-password' };
type Locale = 'ar' | 'en';
type Theme = 'light' | 'dark';
interface RequestEvidence { method: string; path: string; offline: boolean }
interface ProposalEvidence {
  userId: string; clinicId: number; operationId: string; localId: number;
  deviceId: number; sequence: number; canonical: unknown; outcome: string;
  input: { clientOpId: string; patientId: number; doctorId: number; startsAt: string; endsAt: string; source: string };
}
interface OutboxEvidence {
  userId: string; clinicId: number; operationId: string; status: string; attempts: number;
  booking: { localId: number; deviceId: number; sequence: number };
}
interface DeviceEvidence {
  proposals: ProposalEvidence[];
  outbox: OutboxEvidence[];
  registrations: Array<{
    clientOpId: string; localId: number; input: Record<string, unknown>;
    patient: { id: number; name: string; phone: string; dateOfBirth: string };
    canonical: { id: number } | null; status: string; attempts: number;
  }>;
  metadata: Array<{ userId: string; clinicId: number; refreshedAt: string }>;
  patients: Array<{ id: number; userId: string; clinicId: number }>;
  streams: Array<{ deviceId: number; nextSequence: number }>;
  bookingScopes: Array<{ userId: string; clinicId: number; deviceId: number }>;
}

function tomorrowHebron() {
  const today = formatInTimeZone(new Date(), 'Asia/Hebron', 'yyyy-MM-dd');
  const next = new Date(`${today}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

async function mockAuthorizedApi(context: BrowserContext, day: string, locale: Locale, theme: Theme,
  options: { offlineNewPatient?: boolean } = {}) {
  let offline = false;
  const requests: RequestEvidence[] = [];
  const unhandled: string[] = [];
  const fulfilledOffline: string[] = [];
  const registrationPosts: Array<Record<string, unknown>> = [];
  const pushPosts: Array<Record<string, unknown>> = [];
  const syncOrder: string[] = [];
  let lostRegistrationResponse = false;
  let lostPushResponse = false;
  const registeredPatientId = 581030;
  const syncedAppointmentId = 581031;
  const loginPages = new WeakMap<Page, boolean>();
  const loginBodies: Array<{ email: string; password: string }> = [];
  const canonical = {
    id: canonicalId, clinicId: clinic.id, doctorId: doctors[0].id, patientId: patients[0].id,
    startsAt: fromZonedTime(`${day}T16:00:00`, 'Asia/Hebron').toISOString(),
    endsAt: fromZonedTime(`${day}T16:30:00`, 'Asia/Hebron').toISOString(),
    status: 'booked', version: 1, source: 'phone', clientOpId: '00000000-0000-4000-8000-000000000020',
  };
  context.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (/(?:^|\/)api\//.test(path)) requests.push({ method: request.method(), path, offline });
  });
  await context.route(url => /(?:^|\/)api\//.test(url.pathname), async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    // Playwright routing can otherwise fulfill a request even when its context is
    // offline. Never let an HTTP mock defeat the genuine offline browser check.
    if (offline) {
      await route.abort('internetdisconnected');
      return;
    }
    const json = async (body: unknown, status = 200) => {
      if (offline) {
        fulfilledOffline.push(path);
        await route.abort('internetdisconnected');
        return;
      }
      await route.fulfill({ status, headers: { 'cache-control': 'no-store' }, json: body });
    };
    const requestPage = request.frame().page();
    if (request.method() === 'GET') {
      // Isolated real-session tests run with demo authority explicitly disabled;
      // this prevents demo bootstrap from blocking the HTTP-auth mock.
      if (path === '/api/demo/context') return json({ enabled: false, generation: null, clinicId: null, outage: false });
      if (path === '/api/me') {
        if (loginPages.get(requestPage) === false) {
          return json({ code: 'UNAUTHORIZED', messageKey: 'unauthorized', params: {} }, 401);
        }
        return json({
          id: userId, email: 'mock-offline-booking@example.test', role: 'front-desk',
          clinicId: clinic.id, doctorId: null, locale, theme, csrfToken: 'mock-api-csrf-not-a-live-credential',
          session: { expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() },
          device: { id: deviceId, clinicId: clinic.id }, reauth: { pinVerifiedAt: null },
        });
      }
      if (path === '/api/auth/offline-permit') {
        const nonce = url.searchParams.get('nonce') ?? '';
        expect(nonce).toMatch(/^[a-f0-9]{64}$/);
        // Importing this module does not import the database: Auth is type-only.
        return json(issueOfflinePermit({
          id: userId, email: 'mock-offline-booking@example.test', role: 'front-desk',
          clinicId: clinic.id, doctorId: null, locale, theme,
          sessionDigest: 'mock-api-only', csrfToken: 'mock-api-csrf-not-a-live-credential',
          device: { id: deviceId, clinicId: clinic.id }, expiresAt: new Date(Date.now() + 60 * 60_000),
          absoluteExpiresAt: null, pinVerifiedAt: null,
        }, clinic, nonce));
      }
      if (path === '/api/clinics') return json({ items: [{ ...clinic, mode: 'network', timezone: 'Asia/Hebron' }], nextCursor: null });
      if (path === '/api/doctors') return json({ items: doctors, nextCursor: null });
      if (path === '/api/patients') return json({ items: patients, nextCursor: null });
      if (path === '/api/appointments') {
        const from = url.searchParams.get('from'), to = url.searchParams.get('to');
        const items = (!from || canonical.startsAt >= from) && (!to || canonical.startsAt < to) ? [canonical] : [];
        return json({ items, nextCursor: null });
      }
      if (path === '/api/sync/state') return json({ deviceId, nextSequence: 1 });
      if (path === '/api/reception/context') return json({ clinic, doctors });
      if (path === '/api/sync/conflicts') return json({ items: [], nextCursor: null });
      if (path === '/api/sync/pull') return json({ changes: [], nextCursor: null, since: 'mock-offline-booking-cursor' });
    }
    if (options.offlineNewPatient && request.method() === 'POST' && path === '/api/patients') {
      const body = request.postDataJSON() as Record<string, unknown>;
      registrationPosts.push(body);
      syncOrder.push('registration');
      if (!lostRegistrationResponse) {
        lostRegistrationResponse = true;
        await route.abort('connectionreset');
        return;
      }
      return json({
        id: registeredPatientId, clinicId: clinic.id, name: body.name,
        phone: body.phone, dateOfBirth: body.dateOfBirth, visibility: 'basic',
      }, 201);
    }
    if (options.offlineNewPatient && request.method() === 'POST' && path === '/api/sync/push') {
      const body = request.postDataJSON() as { operations?: Array<{ sequence: number; input: Record<string, unknown> }> };
      pushPosts.push(body as unknown as Record<string, unknown>);
      syncOrder.push('push');
      if (!lostPushResponse) {
        lostPushResponse = true;
        await route.abort('connectionreset');
        return;
      }
      const operation = body.operations?.[0];
      if (!operation) return json({ code: 'INVALID_MOCK_OPERATION', messageKey: 'test.invalid', params: {} }, 400);
      const appointment = {
        id: syncedAppointmentId, clinicId: clinic.id, doctorId: doctors[0].id,
        patientId: registeredPatientId, startsAt: operation.input.startsAt,
        endsAt: operation.input.endsAt, status: 'booked', version: 1,
        source: operation.input.source, clientOpId: operation.input.clientOpId,
      };
      return json({ outcomes: [{
        sequence: operation.sequence, clientOpId: operation.input.clientOpId,
        status: 'applied', result: appointment,
      }] });
    }
    if (request.method() === 'POST' && path === '/api/auth/login' && loginPages.has(requestPage)) {
      const body = request.postDataJSON() as { email?: string; password?: string };
      loginBodies.push({ email: body.email ?? '', password: body.password ?? '' });
      if (body.email !== mockedLogin.email || body.password !== mockedLogin.password) {
        return json({ code: 'UNAUTHORIZED', messageKey: 'unauthorized', params: {} }, 401);
      }
      loginPages.set(requestPage, true);
      return json({
        id: userId, email: 'mock-offline-booking@example.test', role: 'front-desk',
        clinicId: clinic.id, doctorId: null, locale, theme, csrfToken: 'mock-api-csrf-not-a-live-credential',
        session: { expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() },
        device: { id: deviceId, clinicId: clinic.id }, reauth: { pinVerifiedAt: null },
      });
    }
    // A new authenticated read must be deliberately mocked, not accidentally fall
    // through to the public-shell harness (which has no authenticated backend).
    unhandled.push(`${request.method()} ${path}`);
    return json({ code: 'UNEXPECTED_MOCK_API_REQUEST', messageKey: 'test.unexpectedApi', params: {} }, 501);
  });
  return {
    requests, unhandled, fulfilledOffline, loginBodies, registrationPosts, pushPosts, syncOrder,
    beginLogin(page: Page) { loginPages.set(page, false); },
    async goOffline() {
      offline = true; // Set the route guard BEFORE Chromium changes network state.
      await context.setOffline(true);
    },
    async goOnline() {
      offline = false;
      await context.setOffline(false);
    },
  };
}

/** Read-only inspection of actual application-created IndexedDB transactions. */
async function deviceEvidence(page: Page): Promise<DeviceEvidence> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('amal-private-cache');
      open.onupgradeneeded = () => {
        open.transaction?.abort();
        reject(new Error('Application did not create its private cache'));
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      const names = ['proposals', 'outbox', 'registrations', 'metadata', 'patients', 'streams', 'bookingScopes'];
      const transaction = db.transaction(names, 'readonly');
      const complete = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      const all = <T,>(name: string) => new Promise<T[]>((resolve, reject) => {
        const request = transaction.objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const [proposals, outbox, registrations, metadata, patients, streams, bookingScopes] = await Promise.all([
        all<ProposalEvidence>('proposals'), all<OutboxEvidence>('outbox'),
        all<DeviceEvidence['registrations'][number]>('registrations'),
        all<DeviceEvidence['metadata'][number]>('metadata'), all<DeviceEvidence['patients'][number]>('patients'),
        all<DeviceEvidence['streams'][number]>('streams'), all<DeviceEvidence['bookingScopes'][number]>('bookingScopes'),
      ]);
      await complete;
      return { proposals: proposals.sort((a, b) => a.sequence - b.sequence), outbox: outbox.sort((a, b) => a.booking.sequence - b.booking.sequence), registrations, metadata, patients, streams, bookingScopes };
    } finally { db.close(); }
  });
}

async function display(page: Page, locale: Locale, theme: Theme) {
  await page.getByTestId('button-user-menu').click();
  const menu = page.getByTestId('dialog-user');
  await menu.getByTestId(`button-locale-${locale}`).click();
  await menu.getByTestId(`button-theme-${theme}`).click();
  await menu.getByTestId('button-user-close').click();
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function calendarDay(page: Page, day: string) {
  await expect(page.getByTestId('page-calendar-day')).toHaveAttribute('data-adapter', 'real');
  if (await page.getByTestId('input-date').inputValue() !== day) await page.getByTestId('input-date').fill(day);
  await expect(page.getByTestId('input-date')).toHaveValue(day);
  await expect(page.getByTestId('calendar-cache-coverage')).toBeVisible();
  await expect(page.getByTestId(`card-appointment-${canonicalId}`)).toBeVisible();
}

async function expectPendingCards(page: Page, proposals: ProposalEvidence[], locale: Locale) {
  await expect(page.locator('[data-testid^="card-appointment-"]')).toHaveCount(proposals.length + 1);
  await expect(page.getByTestId('status-sync')).toHaveCount(proposals.length);
  for (const proposal of proposals) {
    const card = page.getByTestId(`card-appointment-${proposal.localId}`);
    await expect(card).toBeVisible();
    await expect(card).toBeDisabled();
    await expect(card.getByTestId('status-booked')).toBeVisible();
    await expect(card.getByTestId('status-sync')).toBeVisible();
    await expect(card.getByTestId('status-sync')).toHaveText(locale === 'en' ? 'Waiting to sync' : /مزامنة/);
    await expect(card).toContainText(patients.find(patient => patient.id === proposal.input.patientId)!.name);
  }
}

test('MOCKED API · offline-new-patient registration and dependent booking survive reload and exact retry', async ({ page, context }, testInfo) => {
  testInfo.annotations.push({
    type: 'evidence-scope',
    description: 'Mocked HTTP and signed permit only; real production PWA, browser offline networking, IndexedDB and retry flow. No live account, DB or server evidence.',
  });
  const day = tomorrowHebron();
  const api = await mockAuthorizedApi(context, day, 'en', 'light', { offlineNewPatient: true });
  await page.addInitScript(({ id }) => {
    localStorage.setItem(`amal.tour.v1:${encodeURIComponent(`account:${id}`)}:front-desk`, 'dismissed');
  }, { id: userId });
  await page.goto(`desk/today?date=${day}`);
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await calendarDay(page, day);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await calendarDay(page, day);
  await display(page, 'ar', 'light');
  await display(page, 'en', 'light');
  await api.goOffline();
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);

  await page.getByTestId('link-new-booking').click();
  await expect(page.getByTestId('drawer-booking')).toBeVisible();
  await page.getByTestId('input-patient-search').fill('Offline New Patient');
  await expect(page.getByTestId('status-patient-empty')).toBeVisible();
  await page.getByTestId('button-register-booking-patient').click();
  await expect(page.getByTestId('dialog-new-patient')).toBeVisible();
  await page.getByTestId('input-reg-name').fill('Offline New Patient');
  await page.getByTestId('input-reg-phone').fill('05995550001');
  await page.getByTestId('input-reg-dob').fill('1990-01-02');
  await page.getByTestId('button-reg-save').click();
  await expect(page.getByTestId('dialog-new-patient')).toHaveCount(0);
  await expect(page.getByTestId('status-booking-patient-pending')).toBeVisible();
  await expect(page.getByTestId('card-booking-slot-patient')).toContainText('Offline New Patient');
  await testInfo.attach('offline-new-patient-selected.png', {
    contentType: 'image/png', body: await page.screenshot(),
  });
  await page.getByTestId('select-booking-doctor').selectOption(String(doctors[0].id));
  await page.getByTestId('input-booking-date').fill(day);
  await page.getByTestId('input-booking-time').fill('10:00');
  await page.getByTestId('select-booking-duration').selectOption('30');
  await expect(page.getByTestId('status-check-ok')).toBeVisible();
  await page.getByTestId('button-stage-next').click();
  await expect(page.getByTestId('status-local-no-hold')).toBeVisible();
  await page.getByTestId('button-confirm-booking').click();
  await expect(page.getByTestId('drawer-booking')).toHaveCount(0);
  let saved = await deviceEvidence(page);
  expect(saved.registrations).toHaveLength(1);
  expect(saved.registrations[0].status).toBe('pending');
  expect(saved.registrations[0].localId).toBeLessThan(0);
  expect(saved.proposals).toHaveLength(1);
  expect(saved.proposals[0].input.patientId).toBe(saved.registrations[0].localId);
  expect(saved.proposals[0].input.clientOpId).toBe(saved.proposals[0].operationId);
  expect(saved.outbox[0].booking.localId).toBe(saved.proposals[0].localId);

  await context.setOffline(true);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const failedRequests: Array<{ url: string; errorText: string }> = [];
  page.on('requestfailed', request => failedRequests.push({
    url: request.url(), errorText: request.failure()?.errorText ?? '',
  }));
  const offlineReload = await page.reload();
  expect(offlineReload?.fromServiceWorker()).toBe(true);
  await expect(page.getByTestId('app-shell')).toBeVisible();
  // Chromium may report online after a service-worker navigation while CDP is
  // still disconnected. Restore and prove the real browser offline signal before
  // detaching this extra session and letting the context own reconnect.
  await cdp.send('Network.emulateNetworkConditions', {
    offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0, connectionType: 'none',
  });
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  const probeUrl = `/__offline-new-patient-probe-${Date.now()}`;
  const probeError = await page.evaluate(async path => {
    try { await fetch(path, { cache: 'no-store' }); return 'unexpected success'; }
    catch (error) { return String(error); }
  }, probeUrl);
  expect(probeError).not.toBe('unexpected success');
  await expect.poll(() => failedRequests.some(failure =>
    failure.url.includes(probeUrl) && failure.errorText === 'net::ERR_INTERNET_DISCONNECTED')).toBe(true);
  await cdp.detach();
  saved = await deviceEvidence(page);
  expect(saved.registrations).toHaveLength(1);
  expect(saved.proposals).toHaveLength(1);
  // Use the application's SPA navigation: another worker-served document load
  // would reset Chromium's offline signal after the CDP correction above.
  await page.locator('a[href$="/desk/sync"]').first().click();
  await expect(page.getByTestId('page-sync')).toBeVisible();
  const registrationOp = saved.registrations[0].clientOpId;
  const bookingOp = saved.proposals[0].operationId;
  await expect(page.getByTestId(`row-registration-${registrationOp}`)).toBeVisible();
  await expect(page.getByTestId(`status-booking-${bookingOp}`)).toBeVisible();
  expect(api.registrationPosts).toEqual([]);
  expect(api.pushPosts).toEqual([]);
  await testInfo.attach('offline-new-patient-queued.png', {
    contentType: 'image/png', body: await page.screenshot(),
  });

  await api.goOnline();
  await expect.poll(() => api.syncOrder, { timeout: 65_000 }).toEqual(['registration', 'registration', 'push', 'push']);
  // Requests being observed is not proof that their acknowledgements committed.
  await expect(page.getByTestId(`status-booking-${bookingOp}`)).toHaveAttribute('data-s', 'acknowledged');
  const retryEvidence = await deviceEvidence(page);
  expect(api.registrationPosts).toHaveLength(2);
  expect(api.registrationPosts[1]).toEqual(api.registrationPosts[0]);
  expect(api.pushPosts).toHaveLength(2);
  expect(api.pushPosts[1]).toEqual(api.pushPosts[0]);
  const pushBody = api.pushPosts[0] as { operations: Array<{ sequence: number; input: { patientId: number; clientOpId: string } }> };
  expect(pushBody.operations).toHaveLength(1);
  expect(pushBody.operations[0].sequence).toBe(saved.proposals[0].sequence);
  expect(pushBody.operations[0].input.clientOpId).toBe(bookingOp);
  expect(pushBody.operations[0].input.patientId).toBe(581030);
  expect(retryEvidence.registrations).toHaveLength(1);
  expect(retryEvidence.registrations[0].status).toBe('applied');
  expect(retryEvidence.registrations[0].canonical?.id).toBe(581030);
  expect(retryEvidence.proposals).toHaveLength(1);
  // Original local intent is immutable. Only the delivered payload is mapped,
  // as asserted above, so uncertain retries preserve the exact wire identity.
  expect(retryEvidence.proposals[0].input.patientId).toBe(saved.registrations[0].localId);
  expect(retryEvidence.proposals[0].canonical).not.toBeNull();
  expect(retryEvidence.outbox).toHaveLength(1);
  expect(retryEvidence.outbox[0].attempts).toBe(2);
  await expect(page.getByTestId(`row-registration-${registrationOp}`)).toBeVisible();
  await expect(page.getByTestId(`status-booking-${bookingOp}`)).toHaveAttribute('data-s', 'acknowledged');
  expect(api.unhandled).toEqual([]);
  await testInfo.attach('offline-new-patient-retry-evidence.json', {
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify({
      evidenceScope: 'MOCKED API only; real application IndexedDB/offline/reload/retry behavior. Not live server evidence.',
      registrationPosts: api.registrationPosts, syncOrder: api.syncOrder, pushPosts: api.pushPosts,
      persistedRegistrationCount: retryEvidence.registrations.length,
      persistedBookingCount: retryEvidence.proposals.length,
      canonicalPatientId: retryEvidence.registrations[0].canonical?.id,
      canonicalBookingPatientId: retryEvidence.proposals[0].input.patientId,
    }, null, 2)),
  });
});

test('MOCKED API · login sender keeps its permit while peer revocation locks the other tab', async ({ page, context }, testInfo) => {
  testInfo.annotations.push({
    type: 'evidence-scope',
    description: 'Mocked login/session/API; real production shell, BroadcastChannel/storage events and IndexedDB. No live credentials or database.',
  });
  const day = tomorrowHebron();
  const api = await mockAuthorizedApi(context, day, 'en', 'light');
  const peer = await context.newPage();
  api.beginLogin(page);
  api.beginLogin(peer);
  for (const tab of [page, peer]) {
    await tab.addInitScript(({ id }) => {
      localStorage.setItem(`amal.tour.v1:${encodeURIComponent(`account:${id}`)}:front-desk`, 'dismissed');
    }, { id: userId });
  }

  // Both documents first see an unauthenticated /me and render the real login form.
  await page.goto('login');
  await expect(page.getByTestId('form-password')).toBeVisible();
  await peer.goto('login');
  await expect(peer.getByTestId('form-password')).toBeVisible();

  // The first tab signs in normally. Its own async revocation broadcast must not
  // revoke the permit/cache it is about to establish.
  await page.getByTestId('input-email').fill(mockedLogin.email);
  await page.getByTestId('input-password').fill(mockedLogin.password);
  await page.getByTestId('button-submit-password').click();
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await calendarDay(page, day);
  await expect.poll(() => page.evaluate(() => {
    const stored = JSON.parse(sessionStorage.getItem('amal-offline-permit-v1') ?? 'null');
    return !!stored?.permit?.signature && !!stored?.nonce;
  })).toBe(true);
  const firstTabCache = await deviceEvidence(page);
  expect(firstTabCache.patients.map(patient => patient.id).sort()).toEqual(patients.map(patient => patient.id).sort());
  expect(firstTabCache.bookingScopes).toEqual([{ userId: `account:${userId}`, clinicId: clinic.id, deviceId }]);
  await page.waitForTimeout(200);
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(peer.getByTestId('page-login')).toBeVisible();

  // Now the already-authenticated tab is the peer of a second normal login.
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await peer.getByTestId('input-email').fill(mockedLogin.email);
  await peer.getByTestId('input-password').fill(mockedLogin.password);
  await peer.getByTestId('button-submit-password').click();
  await expect(peer.getByTestId('app-shell')).toBeVisible();
  await calendarDay(peer, day);
  await expect(page.getByTestId('app-shell')).toHaveCount(0);
  await expect(page.getByTestId('status-session-expired')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('amal-offline-permit-v1'))).toBeNull();

  // Allow the asynchronous same-origin broadcast/storage delivery to settle:
  // the sender remains authorized and has its real cache, while the peer locks.
  await peer.waitForTimeout(200);
  await expect(peer.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('page-login')).toBeVisible();
  await expect.poll(() => peer.evaluate(() => {
    const stored = JSON.parse(sessionStorage.getItem('amal-offline-permit-v1') ?? 'null');
    return !!stored?.permit?.signature && !!stored?.nonce;
  })).toBe(true);
  const initiatingCache = await deviceEvidence(peer);
  expect(initiatingCache.patients.map(patient => patient.id).sort()).toEqual(patients.map(patient => patient.id).sort());
  expect(initiatingCache.bookingScopes).toEqual([{ userId: `account:${userId}`, clinicId: clinic.id, deviceId }]);
  expect(api.loginBodies).toEqual([mockedLogin, mockedLogin]);
  expect(api.unhandled).toEqual([]);
  await testInfo.attach('auth-sender-peer-revocation-evidence.json', {
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify({
      evidenceScope: 'Mocked API/auth; real browser BroadcastChannel/storage and IndexedDB. Not live backend evidence.',
      loginPosts: api.loginBodies.length,
      peerLocked: await page.getByTestId('status-session-expired').isVisible(),
      initiatingTabSignedIn: await peer.getByTestId('app-shell').isVisible(),
      initiatingPermitStored: await peer.evaluate(() => !!JSON.parse(sessionStorage.getItem('amal-offline-permit-v1') ?? 'null')?.permit?.signature),
      initiatingCachedPatients: initiatingCache.patients.map(patient => patient.id),
      initiatingBookingScopes: initiatingCache.bookingScopes,
    }, null, 2)),
  });
});

for (const locale of ['ar', 'en'] as const) for (const theme of ['light', 'dark'] as const) {
  test(`MOCKED API · three durable offline drawer bookings · ${locale}/${theme}`, async ({ page, context }, testInfo) => {
    testInfo.annotations.push({
      type: 'evidence-scope',
      description: 'Mocked authorized HTTP projections and signed permit; real production PWA/IndexedDB/offline browser. NOT live API, database or server-sync evidence.',
    });
    const day = tomorrowHebron();
    const api = await mockAuthorizedApi(context, day, locale, theme);
    await page.addInitScript(({ id }) => {
      // Dismiss onboarding only; never seed identity, records or operational state.
      localStorage.setItem(`amal.tour.v1:${encodeURIComponent(`account:${id}`)}:front-desk`, 'dismissed');
    }, { id: userId });

    await test.step('authorize normally, verify signed permit, warm real cache and activate scoped worker', async () => {
      await page.goto(`desk/today?date=${day}`);
      await expect(page.getByTestId('app-shell')).toBeVisible();
      await calendarDay(page, day);
      await page.evaluate(async () => { await navigator.serviceWorker.ready; });
      await page.reload();
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
      expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)).toBe(`${origin}${mount}`);
      await calendarDay(page, day);
      await display(page, locale, theme);
      const warm = await deviceEvidence(page);
      expect(warm.proposals).toEqual([]);
      expect(warm.outbox).toEqual([]);
      expect(warm.patients.map(patient => patient.id).sort()).toEqual(patients.map(patient => patient.id).sort());
      expect(warm.bookingScopes).toEqual([{ userId: `account:${userId}`, clinicId: clinic.id, deviceId }]);
      expect(warm.streams).toEqual([{ deviceId, nextSequence: 1 }]);
      expect(await page.evaluate(() => {
        const stored = JSON.parse(sessionStorage.getItem('amal-offline-permit-v1') ?? 'null');
        return !!stored?.permit?.signature && !!stored?.nonce;
      })).toBe(true);
      expect(api.requests.some(request => request.path === '/api/auth/offline-permit')).toBe(true);
      expect(api.requests.some(request => request.path === '/api/sync/state')).toBe(true);
    });

    await api.goOffline();
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(page.getByTestId('status-connection')).toContainText(locale === 'ar' ? 'غير متصل' : 'Offline');
    let persisted: DeviceEvidence | undefined;

    for (const [index, patient] of patients.entries()) {
      await test.step(`save offline proposal ${index + 1} through the real drawer`, async () => {
        await calendarDay(page, day);
        await page.getByTestId('link-new-booking').click();
        await expect(page.getByTestId('drawer-booking')).toBeVisible();
        await expect(page.getByTestId('status-fixture-writes')).toHaveCount(0);
        await expect(page.getByTestId('status-fixture-patients')).toHaveCount(0);
        await expect(page.getByTestId('text-booking-cache-coverage')).toBeVisible();
        await expect(page.getByTestId('status-local-booking-note')).toBeVisible();
        await page.getByTestId('input-patient-search').fill(patient.phone);
        await page.getByTestId(`option-patient-${patient.id}`).click();
        await page.getByTestId('select-booking-doctor').selectOption(String(doctors[0].id));
        await page.getByTestId('input-booking-date').fill(day);
        await page.getByTestId('input-booking-time').fill(`${String(9 + index).padStart(2, '0')}:00`);
        await page.getByTestId('select-booking-duration').selectOption('30');
        await expect(page.getByTestId('status-check-ok')).toBeVisible();
        await page.getByTestId('button-stage-next').click();
        await expect(page.getByTestId('status-local-no-hold')).toBeVisible();
        await expect(page.getByTestId('status-hold-active')).toHaveCount(0);
        await expect(page.getByTestId('button-confirm-booking')).toBeEnabled();
        if (index === 0) {
          const axe = await new AxeBuilder({ page }).include('[data-testid="drawer-booking"]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
          expect(axe.violations).toEqual([]);
        }
        await page.getByTestId('button-confirm-booking').click();
        await expect(page.getByTestId('drawer-booking')).toHaveCount(0);
        await calendarDay(page, day);
        persisted = await deviceEvidence(page);
        expect(persisted.proposals).toHaveLength(index + 1);
        expect(persisted.outbox).toHaveLength(index + 1);
        await expectPendingCards(page, persisted.proposals, locale);
      });
    }

    const before = persisted!;
    expect(before.proposals.map(proposal => proposal.sequence)).toEqual([1, 2, 3]);
    expect(new Set(before.proposals.map(proposal => proposal.operationId)).size).toBe(3);
    expect(new Set(before.proposals.map(proposal => proposal.localId)).size).toBe(3);
    expect(before.streams).toEqual([{ deviceId, nextSequence: 4 }]);
    for (const proposal of before.proposals) {
      expect(proposal.localId).toBeLessThan(0);
      expect(proposal.canonical).toBeNull();
      expect(proposal.outcome).toBe('pending');
      expect(proposal.input.clientOpId).toBe(proposal.operationId);
      expect(proposal.userId).toBe(`account:${userId}`);
      expect(proposal.clinicId).toBe(clinic.id);
      const operation = before.outbox.find(row => row.operationId === proposal.operationId)!;
      expect(operation.status).toBe('pending');
      expect(operation.attempts).toBe(0);
      expect(operation.booking).toEqual({ localId: proposal.localId, deviceId, sequence: proposal.sequence });
    }

    await test.step('two genuine offline document reloads retain all three proposals and stable attempt identities', async () => {
      // Chromium reports navigator.onLine=true after a ServiceWorker-served
      // navigation even though CDP remains offline (confirmed with an uncached
      // request below). Keep both context and page network emulation explicitly
      // offline around each navigation; do not override navigator in page JS.
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      const requestUrls = new Map<string, string>();
      const failedRequests: Array<{ url: string; errorText: string }> = [];
      const pageFailedRequests: Array<{ url: string; errorText: string }> = [];
      page.on('requestfailed', request => pageFailedRequests.push({
        url: request.url(), errorText: request.failure()?.errorText ?? '',
      }));
      cdp.on('Network.requestWillBeSent', event => requestUrls.set(event.requestId, event.request.url));
      cdp.on('Network.loadingFailed', event => {
        failedRequests.push({ url: requestUrls.get(event.requestId) ?? '', errorText: event.errorText });
      });
      const offlineReloads: Array<{ fromServiceWorker: boolean; onlineAfterNavigation: boolean; probeUrl: string; probeError: string }> = [];
      for (let reload = 0; reload < 2; reload++) {
        await context.setOffline(true);
        await cdp.send('Network.emulateNetworkConditions', {
          offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0, connectionType: 'none',
        });
        expect(await page.evaluate(() => navigator.onLine)).toBe(false);
        const response = await page.reload();
        expect(response?.fromServiceWorker(), 'offline document navigation must be served by the active service worker').toBe(true);
        await expect(page.getByTestId('app-shell')).toBeVisible();
        const onlineAfterNavigation = await page.evaluate(() => navigator.onLine);
        const probeUrl = `/__offline-network-probe-${reload}-${Date.now()}`;
        const probeError = await page.evaluate(async path => {
          try {
            await fetch(path, { cache: 'no-store' });
            return 'unexpected success';
          } catch (error) {
            return String(error);
          }
        }, probeUrl);
        expect(probeError).not.toBe('unexpected success');
        expect(
          pageFailedRequests.some(failure => failure.url.includes(probeUrl) && failure.errorText === 'net::ERR_INTERNET_DISCONNECTED'),
          `uncached offline probe did not report ERR_INTERNET_DISCONNECTED: ${JSON.stringify({ probeUrl, probeError, failedRequests, pageFailedRequests })}`,
        ).toBe(true);
        offlineReloads.push({ fromServiceWorker: response!.fromServiceWorker(), onlineAfterNavigation, probeUrl, probeError });
        // Reapply browser emulation after SW navigation to restore Chromium's
        // navigator.onLine signal for the app UI; the reload itself was already
        // proven offline by its SW response and failed uncached network request.
        await cdp.send('Network.emulateNetworkConditions', {
          offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0, connectionType: 'none',
        });
        expect(await page.evaluate(() => navigator.onLine)).toBe(false);
        await calendarDay(page, day);
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expectPendingCards(page, before.proposals, locale);
        const after = await deviceEvidence(page);
        expect(after.proposals).toEqual(before.proposals);
        expect(after.outbox).toEqual(before.outbox);
        expect(after.streams).toEqual(before.streams);
      }
      const axe = await new AxeBuilder({ page }).include('[data-testid="app-shell"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(axe.violations).toEqual([]);
      await cdp.detach();
      expect(offlineReloads).toHaveLength(2);
      testInfo.annotations.push({
        type: 'offline-reload-browser-evidence',
        description: JSON.stringify(offlineReloads),
      });
    });

    await test.step('cached day sheet reloads offline and prints a stable minimal projection', async () => {
      await page.goto('desk/day-sheet');
      await expect(page.getByTestId('select-day-sheet-day')).toBeVisible();
      await page.getByTestId('select-day-sheet-day').selectOption(day);
      await expect(page.getByTestId('table-day-sheet').locator('tbody tr')).toHaveCount(4);
      const response = await page.reload();
      expect(response?.fromServiceWorker()).toBe(true);
      await page.getByTestId('select-day-sheet-day').selectOption(day);
      await expect(page.getByTestId('table-day-sheet').locator('tbody tr')).toHaveCount(4);
      await expect(page.getByTestId('status-connection')).toContainText('3');
      const axe = await new AxeBuilder({ page }).include('[data-testid="page-day-sheet"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      await testInfo.attach(`day-sheet-axe-${locale}-${theme}.json`, {
        contentType: 'application/json', body: Buffer.from(JSON.stringify(axe.violations, null, 2)),
      });
      expect(axe.violations).toEqual([]);
      await page.evaluate(() => { window.print = () => { document.documentElement.dataset.printInvoked = 'true'; }; });
      await page.getByTestId('button-day-sheet-print').click();
      await expect(page.locator('html')).toHaveAttribute('data-print-invoked', 'true');
      await expect(page.getByTestId('text-day-sheet-generated')).toBeVisible();
      await page.emulateMedia({ media: 'print' });
      await expect(page.locator('.shell-top')).toBeHidden();
      await page.pdf({ path: testInfo.outputPath(`sheet-${locale}-${theme}.pdf`), format: 'A4', printBackground: false });
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      await page.emulateMedia({ media: 'screen' });

      await test.step('synthetic 70-row paper layout only; cloned rows are not real records', async () => {
        const layoutEvidence = await page.evaluate(() => {
          const preview = document.querySelector<HTMLElement>('[data-testid="day-sheet-preview"]');
          const table = document.querySelector<HTMLTableElement>('[data-testid="table-day-sheet"]');
          const body = table?.tBodies[0];
          if (!preview || !table || !body || body.rows.length === 0) throw new Error('Day sheet table unavailable for layout-only evidence');
          const originalRows = body.rows.length;
          const label = document.createElement('p');
          label.textContent = 'SYNTHETIC PAPER-LAYOUT TEST ONLY — cloned rows; NOT real records.';
          label.dataset.syntheticPaperLayoutOnly = 'true';
          preview.insertBefore(label, table);
          const template = body.rows[0];
          while (body.rows.length < 70) {
            const clone = template.cloneNode(true) as HTMLTableRowElement;
            clone.removeAttribute('data-testid');
            clone.dataset.syntheticPaperLayoutOnly = 'true';
            body.appendChild(clone);
          }
          return { originalRows, tbodyRows: body.rows.length, syntheticRows: body.querySelectorAll('[data-synthetic-paper-layout-only="true"]').length };
        });
        expect(layoutEvidence).toEqual({ originalRows: 4, tbodyRows: 70, syntheticRows: 66 });
        testInfo.annotations.push({
          type: 'paper-layout-only-synthetic-evidence',
          description: '70 tbody rows total: 4 application rows plus 66 DOM-cloned synthetic rows. Not real records.',
        });
        await page.emulateMedia({ media: 'print' });
        await page.pdf({
          path: testInfo.outputPath(`sheet-layout-only-synthetic-${locale}-${theme}.pdf`),
          format: 'A4', printBackground: false,
        });
        await page.emulateMedia({ media: 'screen' });
      });
    });
    const forbidden = api.requests.filter(request =>
      /\/(?:check|holds?|availability)(?:\/|$)/.test(request.path) || request.path === '/api/sync/push');
    expect(forbidden, 'Local booking must not call remote checks, holds, quick availability or push').toEqual([]);
    // Chromium may incorrectly report online immediately after a SW navigation.
    // Failed identity/sync-state reachability probes are allowed; no operational
    // read/write may depend on them, and fulfilledOffline must remain empty.
    expect(api.requests.filter(request => request.offline && !(request.method === 'GET' && ['/api/me', '/api/sync/state'].includes(request.path))),
      'Offline booking must not attempt operational API access').toEqual([]);
    expect(api.fulfilledOffline, 'HTTP mocks must never bypass genuine offline networking').toEqual([]);
    expect(api.unhandled, 'Every authenticated HTTP read must have an explicit mock').toEqual([]);
    expect(await page.evaluate(async () => {
      const cached: string[] = [];
      for (const name of await caches.keys()) {
        for (const request of await (await caches.open(name)).keys()) cached.push(new URL(request.url).pathname);
      }
      return cached.filter(path => /(?:^|\/)api\//.test(path));
    }), 'Private API data must not enter public PWA CacheStorage').toEqual([]);
    await testInfo.attach('mock-api-real-offline-evidence.json', {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({
        evidenceScope: 'MOCKED authenticated API; real IndexedDB/PWA/offline browser. NOT live backend evidence.',
        locale, theme, mount, offlineReloads: 2, durableProposals: before.proposals.length,
        operationIds: before.proposals.map(proposal => proposal.operationId),
        localIds: before.proposals.map(proposal => proposal.localId),
        sequences: before.proposals.map(proposal => proposal.sequence),
        apiRequests: api.requests, forbiddenRequests: forbidden, unhandled: api.unhandled,
      }, null, 2)),
    });
  });
}
