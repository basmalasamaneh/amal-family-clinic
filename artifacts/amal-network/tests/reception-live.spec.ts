import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { BrowserContext } from '@playwright/test';

const require = createRequire(new URL('../../api-server/package.json', import.meta.url));
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

// Explicit opt-in: these tests use the documented synthetic demo accounts and
// real operational APIs. They never use shellDemo or mutate the six seed tables.
const enabled = process.env.AMAL_RECEPTION_LIVE === '1';
const origin = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:80';
test.use({ baseURL: origin });
test.describe.configure({ mode: 'serial' });
test.skip(!enabled, 'Set AMAL_RECEPTION_LIVE=1 against a prepared development demo database.');

async function login(page: Page) {
  const { pool } = await import('@workspace/db');
  const { rows: [reception] } = await pool.query(
    "SELECT clinic_id,email FROM operational.users WHERE role='receptionist' AND email LIKE 'reception.%@amal-demo.example' ORDER BY id LIMIT 1",
  );
  expect(reception, 'A prepared synthetic reception account is required').toBeTruthy();
  const admin = await page.request.post('/api/auth/login', {
    headers: { origin },
    data: { email: 'admin@amal-demo.example', password: 'Amal-Demo-Only-2026!' },
  });
  expect(admin.ok(), 'Documented demo administrator must exist').toBeTruthy();
  const identity = await admin.json();
  const enrollment = await page.request.post('/api/auth/devices', {
    headers: { origin, 'x-csrf-token': identity.csrfToken },
    data: { clinicId: reception.clinic_id, label: `reception-live-${randomUUID()}` },
  });
  expect(enrollment.status()).toBe(201);
  const desk = await page.request.post('/api/auth/pin', {
    headers: { origin },
    data: { email: reception.email, pin: '2468' },
  });
  expect(desk.ok(), 'Documented reception account must exist').toBeTruthy();
  const me = await desk.json();
  const clinics = await (await page.request.get('/api/clinics')).json();
  const clinic = clinics.items[0];
  expect(clinic?.id).toBe(reception.clinic_id);
  await page.addInitScript(({ userId }) => {
    localStorage.setItem(`amal.tour.v1:${encodeURIComponent(String(userId))}:front-desk`, 'dismissed');
  }, { userId: `account:${me.id}` });
  return { clinic, me };
}

/** Isolated operational actors per project prevent shared demo PIN throttles. */
async function consentActors(context: BrowserContext) {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const one = async (sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows[0];
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  const run = randomUUID();
  const makeClinic = async (n: string) => (await one(
    `INSERT INTO operational.clinics(clinic_name,city,booking_method,network_mode)
     VALUES($1,'test','phone','full') RETURNING clinic_id`, [`Consent ${run} ${n}`],
  )).clinic_id as number;
  const sourceClinicId = await makeClinic('source');
  const viewerClinicId = await makeClinic('viewer');
  const makeDoctor = async (clinicId: number, n: string) => {
    await db.query('BEGIN');
    try {
    const doctorId = (await one(
      `INSERT INTO operational.doctors(doctor_name,clinic_id,specialty,email)
       VALUES($1,$2,'test',$3) RETURNING doctor_id`, [`Consent ${n} ${run}`, clinicId, `${run}-${n}@consent.test`],
    )).doctor_id as number;
    const userId = (await one(
      `INSERT INTO operational.users(email,password_hash,role,clinic_id,doctor_id)
       VALUES($1,'unused','doctor',$2,$3) RETURNING id`, [`${run}-${n}@consent.test`, clinicId, doctorId],
    )).id as number;
    await db.query('UPDATE operational.doctors SET user_id=$1 WHERE doctor_id=$2', [userId, doctorId]);
    const token = randomUUID(), csrf = randomUUID();
    await db.query(`INSERT INTO operational.auth_sessions(token_digest,user_id,csrf_token,absolute_expires_at)
      VALUES($1,$2,$3,now()+interval '8 hours')`, [hash(token), userId, csrf]);
    await db.query('COMMIT');
    return { doctorId, userId, token, csrf, clinicId };
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  };
  const sourceDoctor = await makeDoctor(sourceClinicId, 'source');
  const viewerDoctor = await makeDoctor(viewerClinicId, 'viewer');
  const deskUserId = (await one(
    `INSERT INTO operational.users(email,password_hash,role,clinic_id,pin_hash)
     VALUES($1,'unused','receptionist',$2,$3) RETURNING id`,
    [`${run}-desk@consent.test`, sourceClinicId, await bcrypt.hash('2468', 4)],
  )).id as number;
  const deviceId = (await one(
    `INSERT INTO operational.devices(clinic_id,label) VALUES($1,$2) RETURNING id`,
    [sourceClinicId, `consent-${run.slice(0, 12)}`],
  )).id as number;
  const device = randomUUID(), deskToken = randomUUID(), deskCsrf = randomUUID();
  await db.query('INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)', [deviceId, hash(device)]);
  await db.query(`INSERT INTO operational.auth_sessions(token_digest,user_id,device_id,csrf_token,absolute_expires_at,pin_verified_at)
    VALUES($1,$2,$3,$4,now()+interval '8 hours',now())`, [hash(deskToken), deskUserId, deviceId, deskCsrf]);
  const origin = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:80';
  await context.addCookies([
    { name: 'amal_session', value: deskToken, url: origin, httpOnly: true, secure: origin.startsWith('https'), sameSite: 'Strict' },
    { name: 'amal_device', value: device, url: origin, httpOnly: true, secure: origin.startsWith('https'), sameSite: 'Strict' },
  ]);
  return { db, run, sourceClinicId, viewerClinicId, sourceDoctor, viewerDoctor, deskUserId, origin, viewerToken: viewerDoctor.token };
}

test('live registration, demographics-only lookup and three-action walk-in from multiple routes', async ({ page }, info) => {
  test.setTimeout(180_000);
  const { clinic } = await login(page);
  const forbiddenRequests: string[] = [];
  page.on('request', r => {
    if (/\/api\/.*(?:history|clinical|network\/lookup|visits|alerts)/.test(r.url())) forbiddenRequests.push(r.url());
  });
  await page.goto('/desk/patients');
  await expect(page.getByTestId('page-patientLookup')).toBeVisible();
  await page.getByTestId('button-new-patient').click();
  await page.getByTestId('button-reg-save').click();
  await expect(page.locator('#rx-name')).toHaveAttribute('aria-invalid', 'true');
  const name = `أحمد reception ${randomUUID().slice(0, 8)}`;
  await page.locator('#rx-name').fill(`  ${name}  `);
  await page.locator('#rx-phone').fill('0590001234');
  await page.locator('#rx-dob').fill('2015-10-20');
  await expect(page.locator('#rx-guardianName')).toBeVisible();
  await page.locator('#rx-guardianName').fill('Synthetic guardian');
  await page.locator('#rx-guardianRelation').selectOption({ index: 1 });
  await page.locator('#rx-dob').fill('1990-10-20');
  await expect(page.locator('#rx-guardianName')).toBeHidden();
  const savedResponse = page.waitForResponse(r => r.url().endsWith('/api/patients') && r.request().method() === 'POST');
  await page.getByTestId('button-reg-save').click();
  const saved = await (await savedResponse).json();
  expect(saved.name).toBe(name);
  expect(saved.phone).toBe('0590001234');
  expect(Object.keys(saved).sort()).toEqual(['clinicId', 'dateOfBirth', 'id', 'name', 'phone', 'visibility'].sort());
  await expect(page.getByTestId('text-patient-name')).toHaveText(name);
  await expect(page.getByTestId('dialog-new-patient')).toBeHidden();
  // New registration must not create an appointment automatically.
  const before = await (await page.request.get(`/api/appointments?clinicId=${clinic.id}&patientId=${saved.id}&upcoming=true`)).json();
  expect(before.items).toHaveLength(0);

  for (const route of ['/desk/today', '/desk/patients']) {
    await page.goto(route);
    // Search text entry is separate from the three action taps. fill() focuses
    // the combobox and types; no arrow-key or additional navigation is needed.
    await page.getByTestId('link-walk-in').click(); // action 1
    await page.getByTestId('drawer-booking').getByTestId('input-patient-search').fill(name.replace('أحمد', 'احمد'));
    await page.getByTestId(`option-patient-${saved.id}`).click(); // action 2
    const book = page.locator('[data-testid^="button-quick-book-"]').first();
    await expect(book).toBeVisible();
    await expect(page.getByTestId('walkin-quick-slots')).toContainText(name);
    await expect(page.getByTestId('walkin-quick-slots')).toContainText(clinic.name);
    const createdResponse = page.waitForResponse(r => r.url().endsWith('/api/appointments') && r.request().method() === 'POST');
    await book.click(); // action 3, explicitly labelled doctor and interval
    const created = await createdResponse;
    expect(created.status()).toBe(201);
    const appointment = await created.json();
    expect(appointment.patientId).toBe(saved.id);
    expect(appointment.clinicId).toBe(clinic.id);
    expect(appointment.source).toBe('walk-in');
    await expect(page.getByTestId('status-walkin-done')).toBeVisible();
    await info.attach(`three-action-${route.split('/').pop()}`, {
      body: JSON.stringify({ route, actionTaps: 3, textEntry: 'combobox focus + fill; zero keyboard navigation presses', appointmentId: appointment.id }),
      contentType: 'application/json',
    });
  }
  expect(forbiddenRequests).toEqual([]);
  await page.goto('/desk/patients');
  await page.getByTestId('input-patient-search').fill(name);
  await page.getByTestId(`option-patient-${saved.id}`).click();
  await expect(page.locator('[data-testid^="row-upcoming-"]')).toHaveCount(2);
  await page.screenshot({ path: info.outputPath('live-patients.png'), fullPage: true });
});

test('lost registration response replays the same operation after closing, and offline drafts survive walk-in', async ({ page, context }) => {
  test.setTimeout(120_000);
  await login(page);
  await page.goto('/desk/patients');
  await page.getByTestId('button-new-patient').click();
  const name = `Synthetic uncertain ${randomUUID().slice(0, 8)}`;
  await page.locator('#rx-name').fill(name);
  await page.locator('#rx-phone').fill('0590009876');
  await page.locator('#rx-dob').fill('1991-01-01');
  const ids: string[] = [];
  let loseFirstResponse = true;
  await page.route('**/api/patients', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    ids.push(route.request().postDataJSON().clientOpId);
    if (loseFirstResponse) {
      loseFirstResponse = false;
      const response = await route.fetch();
      expect(response.status()).toBe(201); // commit happened, acknowledgement lost
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByTestId('button-reg-save').click();
  await expect(page.getByTestId('button-reg-retry')).toBeVisible();
  await page.getByTestId('button-reg-close').click();
  await page.getByTestId('button-draft-resume').click();
  await page.getByTestId('button-reg-retry').click();
  await expect(page.getByTestId('text-patient-name')).toHaveText(name);
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  const matches = await (await page.request.get(`/api/patients?q=${encodeURIComponent(name)}`)).json();
  expect(matches.items.filter((p: { name: string }) => p.name === name)).toHaveLength(1);
  await page.unroute('**/api/patients');
  await page.getByTestId('button-new-patient').click();
  await page.locator('#rx-name').fill('Synthetic unsaved draft');
  await context.setOffline(true);
  await expect(page.getByTestId('button-reg-save')).toBeDisabled();
  await page.getByTestId('button-reg-walkin').click();
  await expect(page.getByTestId('dialog-new-patient')).toBeHidden();
  await page.keyboard.press('Escape');
  await context.setOffline(false);
  await page.getByTestId('button-draft-resume').click();
  await expect(page.locator('#rx-name')).toHaveValue('Synthetic unsaved draft');
  await page.getByTestId('button-reg-close').click();
});

test('live consent capture, invalidation, guardian validation, access history, withdrawal and accessibility', async ({ page, context, browser }, info) => {
  test.setTimeout(180_000);
  const actors = await consentActors(context);
  const doctorContext = await browser.newContext({
    baseURL: actors.origin, serviceWorkers: 'block', reducedMotion: 'reduce',
    locale: info.project.use.locale, colorScheme: info.project.use.colorScheme, viewport: { width: 1280, height: 900 },
  });
  try {
  await doctorContext.addCookies([{ name: 'amal_session', value: actors.sourceDoctor.token, url: actors.origin, httpOnly: true,
    secure: actors.origin.startsWith('https'), sameSite: 'Strict' }]);
  const doctorPage = await doctorContext.newPage();
  await page.addInitScript((userId) => localStorage.setItem(`amal.tour.v1:${encodeURIComponent(String(userId))}:front-desk`, 'dismissed'), `account:${actors.deskUserId}`);
  await doctorPage.addInitScript((userId) => localStorage.setItem(`amal.tour.v1:${encodeURIComponent(String(userId))}:doctor`, 'dismissed'), `account:${actors.sourceDoctor.userId}`);
  await page.goto('/desk/patients');
  await page.getByTestId('button-user-menu').click();
  const preferences = page.getByTestId('dialog-user');
  await preferences.getByTestId(`button-locale-${info.project.use.locale}`).click();
  await preferences.getByTestId(`button-theme-${info.project.use.colorScheme}`).click();
  await page.getByTestId('button-user-close').click();
  await page.getByTestId('button-new-patient').click();
  const adultName = `Consent adult ${randomUUID().slice(0, 8)}`;
  await page.locator('#rx-name').fill(adultName);
  await page.locator('#rx-phone').fill('0590002468');
  await page.locator('#rx-dob').fill('1990-01-01');
  const adultSave = page.waitForResponse(r => r.url().endsWith('/api/patients') && r.request().method() === 'POST');
  await page.getByTestId('button-reg-save').click();
  const adult = await (await adultSave).json();
  await expect(page.getByTestId('text-patient-name')).toHaveText(adultName);
  await actors.db.query('INSERT INTO operational.patient_clinic_access(patient_id,clinic_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [adult.id, actors.viewerClinicId]);
  await actors.db.query('INSERT INTO operational.patient_doctor_access(patient_id,clinic_id,doctor_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [adult.id, actors.sourceClinicId, actors.sourceDoctor.doctorId]);
  await actors.db.query('INSERT INTO operational.patient_doctor_access(patient_id,clinic_id,doctor_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [adult.id, actors.viewerClinicId, actors.viewerDoctor.doctorId]);
  await actors.db.query(`INSERT INTO operational.patient_visit_history(patient_id,clinic_id,doctor_id,visit_date,diagnosis_notes)
    VALUES($1,$2,$3,'2026-10-19','Synthetic local clinic note'),($1,$4,$5,'2026-10-18','Synthetic cross-clinic note')`,
  [adult.id, actors.sourceClinicId, actors.sourceDoctor.doctorId, actors.viewerClinicId, actors.viewerDoctor.doctorId]);

  // A typed/direct URL is not a patient selection; only the Patients action authorizes navigation.
  const consentHref = await page.getByTestId('link-patient-consent').getAttribute('href');
  expect(consentHref).toContain(String(adult.id));
  await page.goto(consentHref!);
  await expect(page.getByTestId('state-consent-guard')).toBeVisible();
  await page.goto('/desk/patients');
  await page.getByTestId('input-patient-search').fill(adultName);
  await page.getByTestId(`option-patient-${adult.id}`).click();
  await page.getByTestId('link-patient-consent').click();
  await expect(page.getByTestId('panel-consent-patient')).toBeVisible();
  await expect(page.getByTestId('text-consent-never')).toBeVisible();

  const verifyPin = async () => {
    await expect(page.getByTestId('dialog-pin')).toBeVisible();
    await expect(page.getByTestId('input-pin')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('button-pin-submit')).toBeFocused();
    await page.getByTestId('input-pin').fill('2468');
    await page.getByTestId('button-pin-submit').click();
    await expect(page.getByTestId('dialog-pin')).toBeHidden();
  };
  let recorded = 0;
  const record = async (level: 'none' | 'basic' | 'clinical') => {
    await page.getByTestId(`radio-level-${level}`).check();
    await page.getByTestId('radio-evidence-signed').check();
    await page.getByTestId('button-consent-submit').click();
    await verifyPin();
    await expect.poll(async () => {
      const state = await (await page.request.get(`/api/patients/${adult.id}/consent`)).json();
      return state.effectiveLevel === level && state.history.length === recorded + 1;
    }).toBe(true);
    recorded++;
  };
  await record('none');
  await record('basic');
  const operationIds: string[] = [];
  let loseFirstConsentAck = true;
  const consentRoute = `**/api/patients/${adult.id}/consent`;
  await page.route(consentRoute, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    operationIds.push(route.request().postDataJSON().clientOpId);
    if (loseFirstConsentAck) {
      loseFirstConsentAck = false;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByTestId('radio-level-clinical').check();
  await page.getByTestId('radio-evidence-signed').check();
  await page.getByTestId('button-consent-submit').click();
  await verifyPin();
  await expect(page.getByTestId('status-consent-ambiguous')).toBeVisible();
  await page.getByTestId('button-consent-reconcile').click();
  await verifyPin();
  await expect.poll(async () => {
    const state = await (await page.request.get(`/api/patients/${adult.id}/consent`)).json();
    return state.effectiveLevel === 'clinical' && state.history.length === 3;
  }).toBe(true);
  expect(operationIds).toHaveLength(2);
  expect(operationIds[0]).toBe(operationIds[1]);
  await page.unroute(consentRoute);

  // Offline writes are refused immediately and never queued for later replay.
  await page.getByTestId('radio-level-basic').check();
  await page.getByTestId('radio-evidence-signed').check();
  await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
  await page.getByTestId('button-consent-submit').click();
  await verifyPin();
  await expect(page.getByTestId('status-consent-msg-block')).toBeVisible();
  await expect(page.getByTestId('status-consent-msg-block')).toContainText(info.project.name.startsWith('ar') ? 'غير متصل' : 'offline');
  await page.evaluate(() => delete (navigator as Navigator & { onLine?: boolean }).onLine);
  const afterOffline = await (await page.request.get(`/api/patients/${adult.id}/consent`)).json();
  expect(afterOffline.effectiveLevel).toBe('clinical');
  expect(afterOffline.history).toHaveLength(3);

  // Cross-clinic clinical view: a foreign visit note is visible under Clinical consent.
  for (let n = 0; n < 21; n++) {
    await actors.db.query(`INSERT INTO operational.audit_log(user_id,clinic_id,action,patient_id,detail,at)
      VALUES($1,$2,'network.lookup',$3,$4::jsonb,now()-($5 * interval '1 second'))`,
    [actors.viewerDoctor.userId, actors.viewerClinicId, adult.id,
      JSON.stringify({ outcome: 'disclosed', sourceClinicId: actors.sourceClinicId }), n]);
  }
  await doctorPage.goto('/doctor/network-search');
  await expect(doctorPage.getByTestId('input-network-search')).toBeVisible({ timeout: 10_000 });
  await doctorPage.getByTestId('input-network-search').fill(adultName);
  await doctorPage.getByTestId(`button-open-patient-${adult.id}`).click();
  await expect(doctorPage.getByTestId('network-timeline')).toContainText('Synthetic local clinic note');
  await expect(doctorPage.getByTestId('network-timeline')).toContainText('Synthetic cross-clinic note');
  const historyForbidden = await doctorPage.evaluate(async ({ patientId, csrf }) => {
    const r = await fetch(`/api/patients/${patientId}/access-history`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ patientRequestConfirmed: true }),
    });
    return r.status;
  }, { patientId: adult.id, csrf: actors.sourceDoctor.csrf });
  expect(historyForbidden).toBe(403);
  const beforeWithdraw = await (await page.request.get(`/api/patients/${adult.id}/consent`)).json();
  expect(beforeWithdraw.history.map((c: { level: string }) => c.level)).toEqual(['clinical', 'basic', 'none']);

  // Confirmed staff-assisted access-history read is bounded and paginated; every page gets a fresh PIN.
  await page.getByTestId('checkbox-access-confirm').check();
  await page.getByTestId('button-access-open').click();
  await verifyPin();
  await expect(page.locator('[data-testid^="row-access-"]')).toHaveCount(20);
  await expect(page.getByTestId('button-access-more')).toBeVisible();
  await page.getByTestId('button-access-more').click();
  await verifyPin();
  // Network-search itself creates additional successful audit rows; require the
  // second page to append beyond the first 20 rather than assuming a fixed total.
  await expect.poll(() => page.locator('[data-testid^="row-access-"]').count()).toBeGreaterThan(20);
  const pageTwoCount = await page.locator('[data-testid^="row-access-"]').count();

  await page.getByTestId('button-access-hide').click();
  await page.route(`**/api/patients/${adult.id}/access-history`, route => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'UNAVAILABLE', messageKey: 'error.internal', params: {} }),
  }));
  await page.getByTestId('checkbox-access-confirm').check();
  await page.getByTestId('button-access-open').click();
  await verifyPin();
  await expect(page.getByTestId('status-access-unavailable')).toBeVisible();
  await page.unroute(`**/api/patients/${adult.id}/access-history`);
  await page.getByTestId('button-access-retry').click();
  await verifyPin();
  await expect(page.locator('[data-testid^="row-access-"]')).toHaveCount(20);

  const axe = await new AxeBuilder({ page }).include('[data-testid="page-consent"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect.soft(axe.violations.map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => n.target) }))).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await info.attach('consent-browser-screenshot', { body: await page.screenshot(), contentType: 'image/png' });

  await page.getByTestId('button-consent-withdraw').click();
  await expect(page.getByTestId('dialog-withdraw')).toBeVisible();
  await page.getByTestId('button-withdraw-confirm').click();
  await verifyPin();
  const withdrawn = await (await page.request.get(`/api/patients/${adult.id}/consent`)).json();
  expect(withdrawn.effectiveLevel).toBe('none');
  expect(withdrawn.current.status).toBe('withdrawn');
  // A new authorized read after withdrawal clears the former network projection; local data remains.
  await doctorPage.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(doctorPage.getByTestId('network-timeline')).toContainText('Synthetic local clinic note');
  await expect(doctorPage.getByTestId('network-timeline')).not.toContainText('Synthetic cross-clinic note');
  expect((await actors.db.query('SELECT count(*)::int AS n FROM operational.patient_visit_history WHERE patient_id=$1', [adult.id])).rows[0].n).toBe(2);

  // Minor consent cannot be recorded with blank/whitespace guardian details; stored values are trimmed.
  await page.goto('/desk/patients');
  await page.getByTestId('button-new-patient').click();
  const minorName = `Consent minor ${randomUUID().slice(0, 8)}`;
  await page.locator('#rx-name').fill(minorName);
  await page.locator('#rx-phone').fill('0590001357');
  await page.locator('#rx-dob').fill('2015-01-01');
  await page.locator('#rx-guardianName').fill('Synthetic registration guardian');
  await page.locator('#rx-guardianRelation').selectOption({ index: 1 });
  const minorSave = page.waitForResponse(r => r.url().endsWith('/api/patients') && r.request().method() === 'POST');
  await page.getByTestId('button-reg-save').click();
  const minor = await (await minorSave).json();
  await expect(page.getByTestId('text-patient-name')).toHaveText(minorName);
  await page.getByTestId('link-patient-consent').click();
  await expect(page.getByTestId('fieldset-guardian')).toBeVisible();
  await page.getByTestId('radio-level-none').check();
  await page.getByTestId('radio-evidence-signed').check();
  await page.getByTestId('button-consent-submit').click();
  await expect(page.getByTestId('input-guardian-name')).toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('input-guardian-name').fill('   ');
  await page.getByTestId('input-guardian-relation').fill(' mother ');
  await page.getByTestId('button-consent-submit').click();
  await expect(page.getByTestId('input-guardian-name')).toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('input-guardian-name').fill(' Synthetic guardian ');
  await page.getByTestId('input-guardian-relation').fill(' mother ');
  await page.getByTestId('button-consent-submit').click();
  await verifyPin();
  const minorConsent = await (await page.request.get(`/api/patients/${minor.id}/consent`)).json();
  expect(minorConsent.current.givenBy).toBe('guardian');
  expect(minorConsent.current.guardian).toEqual({ name: 'Synthetic guardian', relationship: 'mother' });
  await page.getByTestId('checkbox-access-confirm').check();
  await page.getByTestId('button-access-open').click();
  await verifyPin();
  await expect(page.getByTestId('status-access-empty')).toBeVisible();
  await info.attach('consent-live-result', {
    body: JSON.stringify({ adultTransitions: ['none', 'basic', 'clinical', 'withdrawn'], guardian: 'blank rejected; trimmed values accepted', accessHistory: `explicit PIN, first page 20, second page ${pageTwoCount}, unavailable retry, minor empty state, doctor denied`, offline: 'refused without queued write', ambiguousReplay: 'exact clientOpId reused', crossClinic: 'foreign note hidden after withdrawal; local note and source rows retained', axeViolations: axe.violations.map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => n.target) })), mobile: '390px overflow check passed', directRouteGuard: 'shown' }),
    contentType: 'application/json',
  });
  await actors.db.query('UPDATE operational.auth_sessions SET revoked_at=now() WHERE user_id=ANY($1::int[])', [[actors.deskUserId, actors.sourceDoctor.userId, actors.viewerDoctor.userId]]);
  } finally {
    await actors.db.query('UPDATE operational.auth_sessions SET revoked_at=now() WHERE user_id=ANY($1::int[])', [[actors.deskUserId, actors.sourceDoctor.userId, actors.viewerDoctor.userId]]);
    await actors.db.end();
    await doctorContext.close();
  }
});
