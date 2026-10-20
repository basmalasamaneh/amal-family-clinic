import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

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
