import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { auditEvent, bootAdmin, exampleClinic, health } from './helpers/admin-fixtures';

async function details(page: Page, name: string) {
  await page.getByTestId('input-clinic-name').fill(name);
  await page.getByTestId('input-clinic-city').fill('Synthetic city');
  await page.getByTestId('input-clinic-booking').fill('phone');
  await page.getByTestId('button-wizard-next').click();
}
async function schedule(page: Page) {
  await expect(page.getByTestId('input-clinic-timezone')).toHaveValue('Asia/Hebron');
  await page.getByTestId('input-clinic-slot').fill('30');
  await page.getByTestId('input-clinic-open').fill('07:45');
  await page.getByTestId('input-clinic-close').fill('19:15');
  await expect(page.getByTestId('text-clinic-adoption-policy')).toBeVisible();
  await expect(page.locator('input[name="mode"]')).toHaveCount(0);
  await page.getByTestId('button-wizard-next').click();
}

test('dynamic health, unavailable evidence, stale refresh and accessible mobile layout', async ({ page }, info) => {
  await bootAdmin(page, { locale: info.project.use.locale, theme: info.project.use.colorScheme });
  await page.goto('/admin/network-health');
  await expect(page.getByTestId('card-health-76543')).toContainText(exampleClinic().name);
  await expect(page.getByTestId('text-health-pending-76543')).not.toHaveText('0');
  await expect(page.getByTestId('text-health-sync-76543')).not.toContainText('2026');
  await expect(page.getByTestId('text-health-observed')).toBeVisible();
  await page.route('**/api/network/health', r => r.fulfill({ status: 503, json: {
    code: 'INTERNAL', messageKey: 'error.internal', params: {},
  } }));
  await page.getByTestId('button-health-refresh').click();
  await expect(page.getByTestId('list-health-clinics')).toHaveClass(/is-stale/);
  await expect(page.getByTestId('card-health-76543')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const axe = await new AxeBuilder({ page }).include('[data-testid="page-networkHealth"]').analyze();
  expect(axe.violations).toEqual([]);
});

test('create wizard preserves input and confirmed clinic survives reload and appears in health', async ({ page }, info) => {
  const fixture = await bootAdmin(page, { locale: info.project.use.locale, theme: info.project.use.colorScheme });
  await page.goto('/admin/clinics-doctors');
  await page.getByTestId('button-add-clinic').click();
  const name = `عيادة اختبار ${info.project.name} ${Date.now()}`;
  await details(page, name);
  await page.getByTestId('button-wizard-back').click();
  await expect(page.getByTestId('input-clinic-name')).toHaveValue(name);
  await page.getByTestId('button-wizard-next').click();
  await schedule(page);
  await expect(page.getByTestId('text-review-name')).toHaveText(name);
  const axe = await new AxeBuilder({ page }).include('[data-testid="wizard-add-clinic"]').analyze();
  expect(axe.violations).toEqual([]);
  await page.getByTestId('button-wizard-submit').click();
  await expect(page.getByTestId('panel-wizard-done')).toBeVisible();
  expect(fixture.writes).toHaveLength(1);
  expect(fixture.writes[0].body).toMatchObject({ name, slotMinutes: 30, timezone: 'Asia/Hebron', openTime: '07:45', closeTime: '19:15' });
  expect(fixture.writes[0].body).not.toHaveProperty('mode');
  await page.getByTestId('button-wizard-finish').click();
  await page.reload();
  await expect(page.locator('main')).toContainText(name);
  await page.goto('/admin/network-health');
  await expect(page.getByTestId('card-health-98671')).toContainText(name);
  await expect(page.getByTestId('text-health-pending-98671')).not.toHaveText('0');
  await page.goBack();
  await expect(page.locator('main')).toContainText(name);
  await page.getByTestId('button-add-clinic').click();
  await page.getByTestId('button-wizard-cancel').click();
  await expect(page.getByTestId('button-add-clinic')).toBeFocused();
});

test('ambiguous clinic write cannot be retried blindly and reconciles returned identity', async ({ page }) => {
  const fixture = await bootAdmin(page);
  await page.route('**/api/clinics', async r => {
    if (r.request().method() !== 'POST') return r.fallback();
    const body = r.request().postDataJSON();
    fixture.clinics.push({ ...exampleClinic(88819), ...body, id: 88819 });
    fixture.writes.push({ path: '/api/clinics', body });
    return r.abort('failed');
  });
  await page.goto('/admin/clinics-doctors');
  await page.getByTestId('button-add-clinic').click();
  await details(page, 'Uncertain synthetic clinic');
  await schedule(page);
  await page.getByTestId('button-wizard-submit').click();
  await expect(page.getByTestId('panel-wizard-ambiguous')).toBeVisible();
  await expect(page.getByTestId('button-wizard-submit')).toBeDisabled();
  await expect(page.getByTestId('panel-wizard-done')).toHaveCount(0);
  await page.getByTestId('button-wizard-cancel').click();
  await expect(page.getByTestId('dialog-wizard-cancel')).toContainText('may already have been created');
  await page.getByTestId('dialog-wizard-cancel-confirm').click();
  await page.reload();
  await page.getByTestId('button-add-clinic').click();
  await details(page, 'Uncertain synthetic clinic');
  await schedule(page);
  await expect(page.getByTestId('panel-wizard-ambiguous')).toBeVisible();
  await expect(page.getByTestId('button-wizard-submit')).toBeDisabled();
  expect(fixture.writes).toHaveLength(1);
  await page.getByTestId('button-wizard-reconcile').click();
  await page.getByTestId('button-reconcile-mine-88819').click();
  await expect(page.getByTestId('panel-wizard-done')).toBeVisible();
  expect(fixture.writes).toHaveLength(1);
});

test('confirmed clinic remains confirmed when selector refresh fails', async ({ page }) => {
  const fixture = await bootAdmin(page);
  await page.route('**/api/admin/clinics?*', r => fixture.writes.length
    ? r.fulfill({ status: 503, json: { code: 'INTERNAL', messageKey: 'error.internal', params: {} } })
    : r.fallback());
  await page.goto('/admin/clinics-doctors');
  await page.getByTestId('button-add-clinic').click();
  await details(page, 'Confirmed despite refresh failure');
  await schedule(page);
  await page.getByTestId('button-wizard-submit').click();
  await expect(page.getByTestId('panel-wizard-done')).toBeVisible();
  await expect(page.getByTestId('status-wizard-refresh-failed')).toBeVisible();
  await expect(page.getByTestId('panel-wizard-ambiguous')).toHaveCount(0);
  expect(fixture.writes).toHaveLength(1);
});

test('all direct admin destinations deny doctor and unknown roles without requesting admin data', async ({ page }) => {
  for (const role of ['doctor', 'unrecognized']) {
    await page.unrouteAll();
    await bootAdmin(page, { role });
    for (const path of ['network-health', 'users-devices', 'clinics-doctors', 'audit']) {
      await page.goto(`/admin/${path}`);
      await expect(page.getByTestId(role === 'doctor' ? 'state-forbidden' : 'state-noRole')).toBeVisible();
      await expect(page.locator('section.adm')).toHaveCount(0);
    }
  }
});

test('forbidden health cannot display cached data as live', async ({ page }) => {
  await bootAdmin(page);
  await page.route('**/api/network/health', r => r.fulfill({ status: 403, json: {
    code: 'FORBIDDEN', messageKey: 'error.forbidden', params: {},
  } }));
  await page.goto('/admin/network-health');
  await expect(page.getByTestId('state-admin-error')).toBeVisible();
  await expect(page.getByTestId('card-health-76543')).toHaveCount(0);
  await page.unroute('**/api/network/health');
  await page.route('**/api/network/health', r => r.fulfill({ json: health([]) }));
  await page.getByTestId('button-admin-retry').click();
  await expect(page.getByTestId('state-admin-error')).toHaveCount(0);
});

test('audit uses server pagination and Hebron filters without exposing extra response detail', async ({ page }, info) => {
  await bootAdmin(page, { locale: info.project.use.locale, theme: info.project.use.colorScheme });
  const seen: URL[] = [];
  await page.route('**/api/admin/audit?*', r => {
    const url = new URL(r.request().url()); seen.push(url);
    const next = url.searchParams.has('beforeId');
    return r.fulfill({ json: { items: [{
      ...auditEvent(next ? 400 : 900, 76543),
      detail: { secret: 'NEVER_RENDER_PRIVATE_SENTINEL' }, patientId: 99,
    }], nextBeforeId: next ? null : 900 } });
  });
  await page.goto('/admin/audit');
  await expect(page.getByTestId('row-audit-900')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('NEVER_RENDER_PRIVATE_SENTINEL');
  await page.getByTestId('button-audit-next').click();
  await expect(page.getByTestId('row-audit-400')).toBeVisible();
  expect(seen.some(u => u.searchParams.get('beforeId') === '900')).toBe(true);
  await page.getByTestId('input-audit-from').fill('2026-10-20');
  await page.getByTestId('input-audit-to').fill('2026-10-20');
  await page.getByTestId('button-audit-apply').click();
  await expect.poll(() => seen.at(-1)?.searchParams.get('from')).toBe('2026-10-19T21:00:00.000Z');
  expect(seen.at(-1)?.searchParams.get('to')).toBe('2026-10-20T21:00:00.000Z');
  expect(seen.at(-1)?.searchParams.has('beforeId')).toBe(false);
  const axe = await new AxeBuilder({ page }).include('[data-testid="page-audit"]').analyze();
  expect(axe.violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('last-admin protection leaves account visible and never reports success', async ({ page }) => {
  await bootAdmin(page);
  await page.route('**/api/admin/users?*', r => r.fulfill({ json: {
    items: [{ id: 42, email: 'synthetic@example.invalid', role: 'admin', clinicId: null, doctorId: null,
      locale: 'en', theme: 'light', active: true, lastLogin: null, disabledAt: null }],
    page: 1, pageSize: 25, total: 1,
  } }));
  await page.route('**/api/admin/users/42', r => r.fulfill({ status: 409, json: {
    code: 'LAST_ADMIN', messageKey: 'error.lastAdmin', params: {},
  } }));
  await page.goto('/admin/users-devices');
  await page.getByTestId('button-deactivate-user-42').click();
  await page.locator('[data-testid$="-confirm"]').click();
  await expect(page.getByRole('alertdialog')).toContainText(/last.*admin/i);
  await expect(page.getByTestId('status-admin-flash')).toHaveCount(0);
  await expect(page.getByTestId('row-user-42')).toBeVisible();
});

test('reception account creation, PIN reset and device enrollment use explicit secure flows', async ({ page }) => {
  await bootAdmin(page);
  const users: Record<string, unknown>[] = [];
  const devices: Record<string, unknown>[] = [];
  let reset = false;
  await page.route('**/api/admin/users**', async r => {
    const req = r.request(), path = new URL(req.url()).pathname;
    if (req.method() === 'GET') return r.fulfill({ json: { items: users, page: 1, pageSize: 25, total: users.length } });
    if (path.endsWith('/reset-pin')) {
      expect(req.postDataJSON()).toEqual({ pin: '8642' }); reset = true;
      return r.fulfill({ status: 204 });
    }
    const body = req.postDataJSON();
    expect(body.role).toBe('front-desk'); expect(body.clinicId).toBe(76543); expect(body.pin).toBe('1357');
    const { pin: _pin, password: _password, ...safe } = body;
    const saved = { ...safe, id: 9813, lastLogin: null, disabledAt: null };
    users.push(saved); return r.fulfill({ status: 201, json: saved });
  });
  await page.route('**/api/auth/devices**', r => {
    const req = r.request();
    if (req.method() === 'GET') return r.fulfill({ json: { items: devices, page: 1, pageSize: 25, total: devices.length } });
    if (req.method() === 'DELETE') { devices[0].revokedAt = new Date().toISOString(); return r.fulfill({ status: 204 }); }
    const body = req.postDataJSON();
    const d = { ...body, id: 7491, registeredAt: new Date().toISOString(), revokedAt: null };
    devices.push(d); return r.fulfill({ status: 201, json: d });
  });
  await page.goto('/admin/users-devices');
  await page.getByTestId('button-add-user').click();
  await page.getByTestId('input-user-email').fill('reception-test@example.invalid');
  await page.getByTestId('select-user-role').selectOption('front-desk');
  await page.getByTestId('select-user-clinic').selectOption('76543');
  await page.getByTestId('input-user-pin').fill('1357');
  await page.getByTestId('button-user-submit').click();
  await expect(page.getByTestId('row-user-9813')).toBeVisible();
  await page.getByTestId('button-reset-pin-9813').click();
  await page.getByTestId('input-reset-pin').fill('8642');
  await page.getByTestId('button-pin-submit').click();
  await expect.poll(() => reset).toBe(true);
  await expect(page.getByTestId('dialog-reset-pin')).toHaveCount(0);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage).not.toContain('1357'); expect(storage).not.toContain('8642');
  await page.getByTestId('tab-devices').click();
  await page.getByTestId('button-enroll-device').click();
  await page.getByTestId('select-device-clinic').selectOption('76543');
  await page.getByTestId('input-device-label').fill('frontdesk-test');
  await page.getByTestId('button-enroll-submit').click();
  await expect(page.getByTestId('row-device-7491')).toBeVisible();
  await page.getByTestId('button-revoke-device-7491').click();
  await page.getByTestId('dialog-revoke-device-confirm').click();
  await expect(page.getByTestId('status-device-7491')).toContainText(/revoked/i);
});
