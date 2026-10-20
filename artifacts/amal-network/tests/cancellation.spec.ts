import { expect, test, type Page } from '@playwright/test';

// Contract-route fixtures, NOT live API evidence. Real read services are not implemented yet.
async function setup(page: Page, failFirst = false) {
  await page.addInitScript(() => localStorage.setItem('amal.tour.v1:account%3A9876:front-desk', 'dismissed'));
  const writes: unknown[] = [];
  let status = 'booked';
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown;
    if (path === '/api/me') body = {
      id: 9876, email: 'synthetic@example.test', role: 'front-desk', clinicId: 101, doctorId: null,
      locale: 'en', theme: 'light', session: { expiresAt: '2099-01-01T00:00:00Z', absoluteExpiresAt: null, idleTimeoutSeconds: null },
      device: { id: 1, clinicId: 101 }, reauth: { required: false, validUntil: null }, csrfToken: 'fixture-only',
    };
    else if (path === '/api/clinics') body = { items: [{ id: 101, name: 'Synthetic clinic', mode: 'network', timezone: 'Asia/Hebron' }], nextCursor: null };
    else if (path === '/api/doctors') body = { items: [{ id: 201, clinicId: 101, name: 'Synthetic doctor', networkVisible: true }], nextCursor: null };
    else if (path === '/api/appointments/701' && route.request().method() === 'PATCH') {
      writes.push(route.request().postDataJSON());
      if (failFirst && writes.length === 1) return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE', messageKey: 'error.internal', params: {} } });
      status = 'cancelled';
      body = { id: 701, clinicId: 101, doctorId: 201, patientId: 301, version: 2, clientOpId: null, startsAt: '2026-09-09T07:00:00Z', endsAt: '2026-09-09T07:30:00Z', source: 'phone', status };
    } else if (path === '/api/appointments') body = { items: [{ id: 701, clinicId: 101, doctorId: 201, patientId: 301, version: 1, clientOpId: null, startsAt: '2026-09-09T07:00:00Z', endsAt: '2026-09-09T07:30:00Z', source: 'phone', status }], nextCursor: null };
    else return route.fulfill({ status: 404, json: { code: 'NOT_FOUND', messageKey: 'error.notFound', params: {} } });
    return route.fulfill({ json: body });
  });
  await page.goto('/desk/today?date=2026-09-09');
  if (await page.getByTestId('tour-dialog').isVisible()) await page.getByTestId('button-tour-skip').click();
  await page.getByTestId('button-locale-en').click();
  await expect(page.getByTestId('card-appointment-701')).toBeVisible();
  return writes;
}
async function start(page: Page) {
  await page.getByTestId('card-appointment-701').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel appointment', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
}
test('deferred cancellation survives navigation, Undo sends no mutation, and deadline sends once', async ({ page }) => {
  const writes = await setup(page);
  await start(page);
  await page.getByTestId('link-view-week').click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
  expect(writes).toHaveLength(0);
  await start(page);
  await expect(page.getByText('Appointment cancelled.', { exact: false })).toBeVisible({ timeout: 15000 });
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ expectedVersion: 1, status: 'cancelled' });
});
test('failed cancellation is retryable with the same idempotency key', async ({ page }) => {
  const writes = await setup(page, true);
  await start(page);
  await expect(page.getByRole('button', { name: 'Retry cancellation' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('card-appointment-701')).toBeEnabled();
  await page.getByRole('button', { name: 'Retry cancellation' }).click();
  await expect(page.getByText('Appointment cancelled.', { exact: false })).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[0]).toEqual(writes[1]);
});
test('reload explicitly discards unsent cancellation and Escape restores card focus', async ({ page }) => {
  const writes = await setup(page);
  await page.getByTestId('card-appointment-701').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('card-appointment-701')).toBeFocused();
  await start(page);
  await page.reload();
  await expect(page.getByTestId('card-appointment-701')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
  expect(writes).toHaveLength(0);
});
