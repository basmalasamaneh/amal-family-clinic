import type { Page, Response, Route } from '@playwright/test';
import { fromZonedTime } from 'date-fns-tz';
import { expectAccessible } from '../../../../tests/browser/fixtures';
import { test, expect, display, origin, type BookingFixture } from './fixtures';

test.use({ baseURL: origin, trace: 'off', video: 'off', screenshot: 'off' });

type Preview = {
  ok: boolean;
  conflicts: { type: string; severity: string; suggestedSlots: { startsAt: string; endsAt: string }[] }[];
};
const isCheck = (response: Response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/appointments/check';
const isCreate = (response: Response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/appointments';
const utc = (date: string, time: string) => fromZonedTime(`${date}T${time}:00`, 'Asia/Hebron').toISOString();
const listPath = (f: BookingFixture) => `/appointments?clinicId=${f.clinic}&from=${utc('2030-01-07', '00:00')}&to=${utc('2030-01-08', '00:00')}&limit=100`;

async function openSlot(page: Page, f: BookingFixture, patient: number, time: string) {
  await page.goto(`${origin}/desk/today?date=2030-01-07`);
  await display(page);
  await page.getByTestId('link-new-booking').click();
  await page.getByTestId('input-patient-search').fill(f.patientNames[patient]!);
  await page.getByTestId(`option-patient-${f.patients[patient]}`).click();
  await page.getByTestId('select-booking-doctor').selectOption(String(f.doctor));
  await page.getByTestId('input-booking-date').fill('2030-01-07');
  await page.getByTestId('select-booking-duration').selectOption('30');
  const checked = page.waitForResponse(response => isCheck(response) &&
    response.request().postDataJSON().startsAt === utc('2030-01-07', time));
  await page.getByTestId('input-booking-time').fill(time);
  const response = await checked;
  expect(response.status()).toBe(200);
  return response.json() as Promise<Preview>;
}

async function confirm(page: Page) {
  await page.getByTestId('button-stage-next').click();
  await expect(page.getByTestId('status-hold-active')).toBeVisible();
  await expect(page.getByTestId('button-confirm-booking')).toBeEnabled();
}

async function mobileConflictKeyboard(page: Page, controlIds: string[] = []) {
  const desktop = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    const dialog = page.getByTestId('dialog-conflicts');
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(845);
    for (const id of controlIds) {
      const control = page.getByTestId(id);
      await control.scrollIntoViewIfNeeded();
      const rect = await control.boundingBox();
      expect(rect).not.toBeNull();
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(391);
      expect(rect!.y).toBeGreaterThanOrEqual(0);
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(845);
    }
    const controls = dialog.locator('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]');
    await controls.last().focus();
    await page.keyboard.press('Tab');
    await expect(controls.first()).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(controls.last()).toBeFocused();
    await expectAccessible(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('button-review-conflicts')).toBeFocused();
    await expect(page.getByTestId('drawer-booking')).toBeVisible();
  } finally {
    if (desktop) await page.setViewportSize(desktop);
  }
}

test('doctor collision blocks without persistence; server alternative is rechecked and persisted @axe', async ({ page, f }) => {
  const before = await f.read(listPath(f));
  const preview = await openSlot(page, f, 2, '09:00');
  expect(preview.ok).toBe(false);
  const collision = preview.conflicts.find(item => item.type === 'doctor-overlap');
  expect(collision?.severity).toBe('blocking');
  await expect(page.getByTestId('status-check-blocked')).toBeVisible();
  await expect(page.getByTestId('button-stage-next')).toBeDisabled();
  await page.getByTestId('button-review-conflicts').click();
  await expect(page.getByTestId('conflict-doctor-overlap')).toBeVisible();
  await expect(page.getByTestId('text-no-override')).toBeVisible();
  await expect(page.getByTestId('section-override')).toHaveCount(0);
  await expectAccessible(page);
  expect(await f.read(listPath(f))).toEqual(before);
  await mobileConflictKeyboard(page, ['button-close-conflicts']);
  // Closing a blocked draft is also non-mutating.
  await page.getByTestId('button-close-booking').click();
  expect(await f.read(listPath(f))).toEqual(before);

  const secondPreview = await openSlot(page, f, 2, '09:00');
  const suggested = secondPreview.conflicts.find(item => item.type === 'doctor-overlap')?.suggestedSlots[0];
  expect(suggested, 'Real server must offer an alternative inside this run-owned clinic').toBeTruthy();
  await page.getByTestId('button-review-conflicts').click();
  const rechecked = page.waitForResponse(response => isCheck(response) &&
    response.request().postDataJSON().startsAt === suggested!.startsAt &&
    response.request().postDataJSON().endsAt === suggested!.endsAt);
  await page.getByTestId(`button-suggestion-${suggested!.startsAt}`).click();
  const check = await rechecked;
  expect(check.status()).toBe(200);
  expect((await check.json()).ok).toBe(true);
  await expect(page.getByTestId('status-check-ok')).toBeVisible();
  await confirm(page);
  const created = page.waitForResponse(isCreate);
  await page.getByTestId('button-confirm-booking').click();
  const response = await created;
  expect(response.status()).toBe(201);
  const saved = await response.json();
  await expect(page.getByTestId('drawer-booking')).toHaveCount(0);
  const persisted = await f.read(listPath(f));
  expect(persisted.items).toHaveLength(before.items.length + 1);
  expect(persisted.items.find(item => item.id === saved.id)).toMatchObject({
    clinicId: f.clinic, doctorId: f.doctor, patientId: f.patients[2],
    startsAt: suggested!.startsAt, endsAt: suggested!.endsAt, source: 'phone', status: 'booked', version: 1,
  });
});

test('patient overlap requires acknowledgement and a nonblank authorized justification @axe', async ({ page, f }) => {
  const before = await f.read(listPath(f));
  const preview = await openSlot(page, f, 0, '11:00');
  expect(preview.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'patient-overlap', severity: 'warning' })]));
  expect(preview.ok).toBe(false);
  await expect(page.getByTestId('status-check-warning')).toBeVisible();
  await expect(page.getByTestId('button-stage-next')).toBeDisabled();
  await page.getByTestId('button-review-conflicts').click();
  await expect(page.getByTestId('conflict-patient-overlap')).toBeVisible();
  await expect(page.getByTestId('checkbox-override-ack')).not.toBeChecked();
  await expectAccessible(page);
  await page.getByTestId('checkbox-override-ack').check();
  await page.getByTestId('input-override-reason').fill('   ');
  await expect(page.getByTestId('input-override-reason')).toHaveAttribute('aria-invalid', 'true');
  await expectAccessible(page);
  await mobileConflictKeyboard(page, ['checkbox-override-ack', 'input-override-reason']);
  await expect(page.getByTestId('button-stage-next')).toBeDisabled();
  expect(await f.read(listPath(f))).toEqual(before);
  expect(await f.audits()).toEqual([]);
  await page.getByTestId('button-review-conflicts').click();
  const reason = 'Patient confirmed coordinated assessment with both doctors; receptionist approved.';
  await page.getByTestId('input-override-reason').fill(reason);
  await expect(page.getByTestId('input-override-reason')).toHaveAttribute('aria-invalid', 'false');
  await expectAccessible(page);
  await page.getByTestId('button-close-conflicts').click();
  await confirm(page);
  await expect(page.getByTestId('booking-review')).toContainText(reason);
  const created = page.waitForResponse(isCreate);
  await page.getByTestId('button-confirm-booking').click();
  const response = await created;
  expect(response.status()).toBe(201);
  const saved = await response.json();
  const persisted = await f.read(listPath(f));
  expect(persisted.items).toHaveLength(before.items.length + 1);
  expect(persisted.items.find(item => item.id === saved.id)).toMatchObject({
    doctorId: f.doctor, patientId: f.patients[0], startsAt: utc('2030-01-07', '11:00'), status: 'booked',
  });
  expect(await f.audits()).toEqual([expect.objectContaining({
    action: 'appointment.patient_overlap_override',
    detail: expect.objectContaining({ reason, appointmentId: saved.id, clientOpId: saved.clientOpId }),
  })]);
});

test('two isolated real sessions race at commit: one winner, one rejection retaining inputs @axe', async ({ page, context, f }) => {
  const secondContext = await f.secondContext();
  const second = await secondContext.newPage();
  // Distinct sessions/devices, never a copied storageState or mocked auth endpoint.
  const cookies = await context.cookies(origin);
  const otherCookies = await secondContext.cookies(origin);
  expect(cookies.find(cookie => cookie.name === 'amal_session')?.value ===
    otherCookies.find(cookie => cookie.name === 'amal_session')?.value).toBe(false);
  expect((await openSlot(page, f, 2, '13:00')).ok).toBe(true);
  expect((await openSlot(second, f, 2, '13:00')).ok).toBe(true);
  // Exact owner+patient+interval holds are reusable by the server. Both real sessions can
  // reach confirmation without disabling holds or fabricating a response.
  await confirm(page);
  await confirm(second);
  const before = await f.read(listPath(f));
  let releaseLoser!: () => void;
  let dispatchObserved!: () => void;
  const gate = new Promise<void>(resolve => { releaseLoser = resolve; });
  const observed = new Promise<void>(resolve => { dispatchObserved = resolve; });
  const delayCommit = async (route: Route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    dispatchObserved();
    await gate;
    await route.continue();
  };
  await second.route('**/api/appointments', delayCommit);
  const loserResponse = second.waitForResponse(isCreate);
  try {
    await second.getByTestId('button-confirm-booking').click();
    await observed;
    const winnerResponse = page.waitForResponse(isCreate);
    await page.getByTestId('button-confirm-booking').click();
    const winner = await winnerResponse;
    expect(winner.status()).toBe(201);
    releaseLoser();
    expect((await loserResponse).status()).toBe(409);
    await expect(page.getByTestId('drawer-booking')).toHaveCount(0);
    await expect(second.getByTestId('dialog-conflicts')).toBeVisible();
    await expect(second.getByTestId('conflict-doctor-overlap')).toBeVisible();
    await expectAccessible(second);
    await second.getByTestId('button-close-conflicts').click();
    await expect(second.getByTestId('input-booking-date')).toHaveValue('2030-01-07');
    await expect(second.getByTestId('input-booking-time')).toHaveValue('13:00');
    await expect(second.getByTestId('select-booking-doctor')).toHaveValue(String(f.doctor));
    await expect(second.getByTestId('select-booking-duration')).toHaveValue('30');
    await expect(second.getByTestId('button-stage-next')).toBeDisabled();
    await second.getByTestId('button-stage-back').click();
    await expect(second.getByTestId('card-selected-patient')).toContainText(f.patientNames[2]!);
    const persisted = await f.read(listPath(f));
    expect(persisted.items).toHaveLength(before.items.length + 1);
    expect(persisted.items.filter(item => item.doctorId === f.doctor && item.startsAt === utc('2030-01-07', '13:00'))).toHaveLength(1);
    const saved = await winner.json();
    expect(persisted.items.find(item => item.id === saved.id)).toMatchObject({ patientId: f.patients[2], source: 'phone', status: 'booked' });
  } finally {
    releaseLoser();
    await second.unroute('**/api/appointments', delayCommit);
  }
});
