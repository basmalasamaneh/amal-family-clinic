import type { Page, Locator } from '@playwright/test';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { test, expect, display } from './fixtures';
import { expectAccessible } from './accessibility';

const day = '2030-01-07';
const utc = (date: string, time: string) => fromZonedTime(`${date}T${time}:00`, 'Asia/Hebron').toISOString();
const range = `&from=${utc(day, '00:00')}&to=${utc('2030-01-08', '00:00')}&limit=100`;

async function trapped(page: Page, dialog: Locator) {
  const controls = dialog.locator('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]');
  await controls.last().focus();
  await page.keyboard.press('Tab');
  await expect(controls.first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(controls.last()).toBeFocused();
  const focus = await controls.last().evaluate(el => {
    const css = getComputedStyle(el);
    return css.outlineStyle !== 'none' && css.outlineWidth !== '0px' || css.boxShadow !== 'none';
  });
  expect(focus, 'Keyboard focus has a visible indicator').toBe(true);
}

async function bounds(page: Page, dialog: Locator) {
  const rect = await dialog.boundingBox();
  expect(rect).not.toBeNull();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
}

async function openEdit(page: Page, id: number) {
  await page.getByTestId(`card-appointment-${id}`).click();
  await page.getByTestId('button-edit-appointment').click();
  await expect(page.getByTestId('input-edit-time')).toBeVisible();
}

test('book explicit same-name identity, repeat submission, reload, edit and reject blocked edit @axe', async ({ page, f }) => {
  await page.goto(`/desk/today?date=${day}`);
  await display(page);
  await page.getByTestId('link-new-booking').click();
  const drawer = page.getByTestId('drawer-booking');
  await expect(drawer).toBeVisible();
  await expectAccessible(page);
  await trapped(page, drawer);
  await page.getByTestId('input-patient-search').fill(f.patientNames[0]);
  await expect(page.getByTestId(`option-patient-${f.patients[0]}`)).toBeVisible();
  await expect(page.getByTestId(`option-patient-${f.patients[1]}`)).toBeVisible();
  // Equal names must expose different identity evidence and require explicit selection.
  expect(await page.getByTestId(`option-patient-${f.patients[0]}`).innerText())
    .not.toBe(await page.getByTestId(`option-patient-${f.patients[1]}`).innerText());
  await page.getByTestId('input-patient-search').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('select-booking-doctor')).toBeVisible();
  await page.getByTestId('select-booking-doctor').selectOption(String(f.doctor));
  await page.getByTestId('input-booking-date').fill(day);
  await page.getByTestId('input-booking-time').fill('23:50');
  await expect(page.getByTestId('text-interval-error')).toBeVisible();
  await expect(page.getByTestId('input-booking-time')).toHaveAttribute('aria-invalid', 'true');
  await expectAccessible(page);
  await page.getByTestId('input-booking-time').fill('13:00');
  await expect(page.getByTestId('button-stage-next')).toBeEnabled();
  await expectAccessible(page);
  await page.getByTestId('button-stage-next').click();
  await expect(page.getByTestId('button-confirm-booking')).toBeEnabled();
  await expectAccessible(page);
  const saved = page.waitForResponse(r => r.url().endsWith('/api/appointments') && r.request().method() === 'POST');
  // Two activation events in the same turn; both travel through the real UI handler.
  await page.getByTestId('button-confirm-booking').evaluate((el: HTMLButtonElement) => { el.click(); el.click(); });
  const response = await saved;
  expect(response.status()).toBe(201);
  const created = await response.json();
  expect(created.patientId).toBe(f.patients[0]);
  expect(created.startsAt).toBe(utc(day, '13:00'));
  await expect(drawer).toBeHidden();
  await page.goto(`/desk/today?date=${day}`);
  await page.reload();
  await display(page);
  const list = await f.read(`/appointments?clinicId=${f.clinic}&patientId=${f.patients[0]}&from=${utc(day, '12:00')}&to=${utc(day, '15:00')}`);
  expect(list.items.filter((a: { clientOpId: string }) => a.clientOpId === created.clientOpId)).toHaveLength(1);
  await expect(page.getByTestId(`card-appointment-${created.id}`)).toBeVisible();

  await openEdit(page, created.id);
  await expect(page.getByTestId('input-edit-time')).toHaveValue('13:00');
  const editor = page.getByTestId('drawer-edit-appointment');
  await expectAccessible(page);
  await trapped(page, editor);
  // Duration change overlaps itself but must not be rejected.
  await page.getByTestId('select-edit-duration').selectOption('45');
  await expect(page.getByTestId('button-edit-save')).toBeEnabled();
  const updated = page.waitForResponse(r => r.url().endsWith(`/appointments/${created.id}`) && r.request().method() === 'PATCH');
  await page.getByTestId('button-edit-save').click();
  expect((await updated).status()).toBe(200);
  await expect(editor).toBeHidden();
  await page.reload();
  await display(page);
  await openEdit(page, created.id);
  await expect(page.getByTestId('select-edit-duration')).toHaveValue('45');
  const before = (await f.read(`/appointments?clinicId=${f.clinic}&patientId=${created.patientId}${range}`)).items.find((a: { id: number }) => a.id === created.id);
  if (!before) throw new Error('Saved appointment absent from operational read');
  expect(before.id).toBe(created.id);
  expect(before.endsAt).toBe(utc(day, '13:45'));
  await page.getByTestId('input-edit-time').fill('10:00');
  await expect(page.getByTestId('button-edit-save')).toBeDisabled();
  await expect(page.getByTestId('button-review-conflicts')).toBeVisible();
  await page.getByTestId('button-review-conflicts').click();
  await expectAccessible(page);
  await page.keyboard.press('Escape');
  const after = (await f.read(`/appointments?clinicId=${f.clinic}&patientId=${created.patientId}${range}`)).items.find((a: { id: number }) => a.id === created.id);
  expect(after).toEqual(before);
  await page.getByTestId('button-edit-cancel').click();
  await expect(page.getByTestId(`card-appointment-${created.id}`)).toBeFocused();
});

test('cancel confirmation, pending Undo without write, expiry exactly once, released slot @axe', async ({ page, f }) => {
  // Install before the store captures Date.now; keep it running during axe scans.
  await page.clock.install();
  await page.goto(`/desk/today?date=${day}`);
  await display(page);
  const id = f.ids[0];
  const original = (await f.read(`/appointments?clinicId=${f.clinic}${range}`)).items.find((a: { id: number }) => a.id === id);
  if (!original) throw new Error('Synthetic appointment absent from operational read');
  const patches: number[] = [];
  page.on('response', r => {
    if (r.request().method() === 'PATCH' && r.url().endsWith(`/appointments/${id}`)) patches.push(r.status());
  });
  await page.getByTestId(`card-appointment-${id}`).click();
  const confirm = page.getByRole('dialog');
  await expectAccessible(page);
  await trapped(page, confirm);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId(`card-appointment-${id}`)).toBeFocused();
  await page.getByTestId(`card-appointment-${id}`).click();
  await page.getByRole('button', { name: /^(Cancel appointment|إلغاء الموعد)$/ }).click();
  const undo = page.locator(`[data-cancellation-undo="${id}"]`);
  await expect(undo).toBeVisible();
  await expect(page.locator('.cancel-notice [role="status"]')).not.toBeEmpty();
  await expectAccessible(page);
  await undo.focus();
  await page.keyboard.press('Enter');
  await expect(undo).toBeHidden();
  // Axe uses browser timers, so audit the pending state before freezing time.
  // Start a fresh cancellation under the clock for exact boundary assertions.
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now())));
  await page.getByTestId(`card-appointment-${id}`).click();
  await page.getByRole('button', { name: /^(Cancel appointment|إلغاء الموعد)$/ }).click();
  await page.clock.runFor(9999);
  expect(patches).toEqual([]);
  expect((await f.read(`/appointments?clinicId=${f.clinic}${range}`)).items.find((a: { id: number }) => a.id === id)).toEqual(original);
  await undo.focus();
  await page.keyboard.press('Enter');
  await page.clock.runFor(2);
  expect(patches).toEqual([]);
  await expect(undo).toBeHidden();
  await page.getByTestId(`card-appointment-${id}`).click();
  await page.getByRole('button', { name: /^(Cancel appointment|إلغاء الموعد)$/ }).click();
  await page.clock.runFor(10000);
  await expect.poll(() => patches).toEqual([200]);
  await page.clock.runFor(10000);
  expect(patches).toEqual([200]);
  await page.clock.resume();
  // Return to wall time before acquiring a server-timed hold for rebooking.
  await page.clock.setSystemTime(new Date());
  await page.reload();
  await display(page);
  const cancelled = (await f.read(`/appointments?clinicId=${f.clinic}${range}`)).items.find((a: { id: number }) => a.id === id);
  if (!cancelled) throw new Error('Cancelled appointment absent from operational read');
  expect(cancelled.status).toBe('cancelled');
  // Rebook the exact cancelled slot through UI, proving cancellation frees occupancy.
  await page.getByTestId('link-new-booking').click();
  await page.getByTestId('input-patient-search').fill(f.patientNames[0]);
  await page.clock.runFor(1000);
  await page.getByTestId(`option-patient-${f.patients[0]}`).click();
  await page.getByTestId('select-booking-doctor').selectOption(String(f.doctor));
  await page.getByTestId('input-booking-date').fill(day);
  await page.getByTestId('input-booking-time').fill(formatInTimeZone(original.startsAt, 'Asia/Hebron', 'HH:mm'));
  await page.clock.runFor(1000);
  await expect(page.getByTestId('button-stage-next')).toBeEnabled();
  await page.getByTestId('button-stage-next').click();
  await expect(page.getByTestId('button-confirm-booking')).toBeEnabled();
  const booked = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/appointments'));
  await page.getByTestId('button-confirm-booking').click();
  expect((await booked).status()).toBe(201);
});

test('mobile RTL/LTR keyboard drawer, validation and timezone boundary states @axe', async ({ page, f }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/desk/today?date=${day}`);
  await display(page);
  expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe('America/New_York');
  await page.getByTestId('link-new-booking').click();
  const drawer = page.getByTestId('drawer-booking');
  await bounds(page, drawer);
  await expectAccessible(page);
  await page.getByTestId('input-patient-search').fill(f.patientNames[0]);
  await page.getByTestId(`option-patient-${f.patients[0]}`).click();
  await page.getByTestId('select-booking-doctor').selectOption(String(f.doctor));
  // Spring gap in IANA Asia/Hebron (2026); no fixed offset conversion.
  await page.getByTestId('input-booking-date').fill('2026-03-28');
  await page.getByTestId('input-booking-time').fill('02:30');
  await expect(page.getByTestId('text-interval-error')).toBeVisible();
  await expect(page.getByTestId('button-stage-next')).toBeDisabled();
  await expectAccessible(page);
  await page.getByTestId('input-booking-date').fill('2030-07-08');
  await page.getByTestId('input-booking-time').fill('08:00');
  await expect(page.getByTestId('button-stage-next')).toBeEnabled();
  await page.getByTestId('button-stage-next').click();
  await expect(page.getByTestId('button-confirm-booking')).toBeEnabled();
  await bounds(page, drawer);
  await expectAccessible(page);
  const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/appointments'));
  await page.getByTestId('button-confirm-booking').click();
  const created = await (await response).json();
  expect(created.startsAt).toBe(utc('2030-07-08', '08:00'));
  await page.goto('/desk/today?date=2030-07-08');
  await page.reload();
  await display(page);
  await openEdit(page, created.id);
  await expect(page.getByTestId('input-edit-time')).toHaveValue('08:00');
  await bounds(page, page.getByTestId('drawer-edit-appointment'));
  await expectAccessible(page);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId(`card-appointment-${created.id}`)).toBeFocused();
});
