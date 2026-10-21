import type { Locator, Page } from '@playwright/test';
import { test, expect, display, type BookingFixture } from './fixtures';
import { expectAccessible } from './accessibility';
import { addCalendarDays, hebronDate, hebronInstant } from '../../../../tests/builders/time';
import { durable } from '../../../../tests/offline/evidence';

// No synthetic 2030 rows: every canonical target begins as a real drawer proposal
// and must receive an applied outcome from the actual disposable API.
test.use({ offlineJourney: true });

function appointments(f: BookingFixture, day: string) {
  return f.read(`/appointments?${new URLSearchParams({
    clinicId: String(f.clinic), from: hebronInstant(day, '00:00').toISOString(),
    to: hebronInstant(addCalendarDays(day, 1), '00:00').toISOString(), limit: '100',
  })}`).then(result => result.items);
}

async function start(page: Page, day: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/desk/today?date=${day}`);
  await expect(page.getByTestId('page-calendar-day')).toHaveAttribute('data-adapter', 'real');
  await expect(page.getByTestId('calendar-cache-coverage')).toBeVisible();
  await display(page);
  await page.getByTestId('input-date').fill(day);
  expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe('America/New_York');
}

async function canonical(page: Page, f: BookingFixture, day: string, time: string, patient = 0) {
  const before = await durable(page);
  await page.getByTestId('link-new-booking').click();
  await expect(page.getByTestId('status-local-booking-note')).toBeVisible();
  await expect(page.getByTestId('status-fixture-writes')).toHaveCount(0);
  await expect(page.getByTestId('status-fixture-patients')).toHaveCount(0);
  await page.getByTestId('input-patient-search').fill(f.patientNames[patient]!);
  await page.getByTestId(`option-patient-${f.patients[patient]}`).click();
  await page.getByTestId('select-booking-doctor').selectOption(String(f.doctor));
  await page.getByTestId('input-booking-date').fill(day);
  await page.getByTestId('input-booking-time').fill(time);
  await page.getByTestId('select-booking-duration').selectOption('30');
  await expect(page.getByTestId('status-check-ok')).toBeVisible();
  await page.getByTestId('button-stage-next').click();
  await expect(page.getByTestId('status-local-no-hold')).toBeVisible();
  await page.getByTestId('button-confirm-booking').click();
  await expect(page.getByTestId('drawer-booking')).toHaveCount(0);
  // Closing the routed drawer returns to /desk/today, whose date is today.
  // Select the target day through the real calendar control, as in local-first.spec.
  await page.getByTestId('input-date').fill(day);
  await expect.poll(async () => {
    const fresh = (await durable(page)).proposals.filter(p => !before.proposals.some(old => old.operationId === p.operationId));
    return fresh.length === 1 && fresh[0]!.outcome === 'applied';
  }, { timeout: 45_000 }).toBe(true);
  const state = await durable(page);
  const proposal = state.proposals.find(p => !before.proposals.some(old => old.operationId === p.operationId))!;
  const saved = proposal.canonical!;
  expect(saved).toMatchObject({
    patientId: f.patients[patient], doctorId: f.doctor, clinicId: f.clinic,
    startsAt: hebronInstant(day, time).toISOString(), status: 'booked', version: 1,
  });
  expect(saved.id).toBeGreaterThan(0);
  expect(state.outbox.find(o => o.operationId === proposal.operationId)?.status).toBe('succeeded');
  expect((await appointments(f, day)).find(a => a.id === saved.id)).toEqual(saved);
  const evidence = await f.syncEvidence();
  expect(evidence.receipts.filter(r => r.client_op_id === proposal.operationId)).toHaveLength(1);
  expect(evidence.conflicts).toEqual([]);
  expect(evidence.history).toEqual([]);
  await expect(page.getByTestId(`card-appointment-${saved.id}`)).toBeVisible();
  await expect(page.getByTestId(`card-appointment-${proposal.localId}`)).toHaveCount(0);
  return saved;
}

async function keyboardOpen(page: Page, id: number) {
  const card = page.getByTestId(`card-appointment-${id}`);
  await card.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

async function keyboardEdit(page: Page, id: number) {
  await keyboardOpen(page, id);
  await page.getByTestId('button-edit-appointment').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('input-edit-time')).toBeVisible();
  return page.getByTestId('drawer-edit-appointment');
}

async function keyboardCancel(page: Page, id: number) {
  await keyboardOpen(page, id);
  await page.getByRole('button', { name: /^(Cancel appointment|إلغاء الموعد)$/ }).focus();
  await page.keyboard.press('Enter');
  const undo = page.locator(`[data-cancellation-undo="${id}"]`);
  await expect(undo).toBeVisible();
  return undo;
}

async function keyboardTrap(page: Page, dialog: Locator) {
  const controls = dialog.locator('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]');
  await controls.last().focus();
  await page.keyboard.press('Tab');
  await expect(controls.first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(controls.last()).toBeFocused();
  expect(await controls.last().evaluate(el => {
    const css = getComputedStyle(el);
    return css.outlineStyle !== 'none' && css.outlineWidth !== '0px' || css.boxShadow !== 'none';
  }), 'Keyboard focus has a visible indicator').toBe(true);
  const rect = await dialog.boundingBox();
  expect(rect).not.toBeNull();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(391);
}

function observePatches(page: Page, id: number) {
  const sent: { clientOpId: string; expectedVersion: number; status?: string }[] = [];
  const statuses: number[] = [];
  const matches = (url: string, method: string) => method === 'PATCH' && new URL(url).pathname === `/api/appointments/${id}`;
  page.on('request', request => { if (matches(request.url(), request.method())) sent.push(request.postDataJSON()); });
  page.on('response', response => { if (matches(response.url(), response.request().method())) statuses.push(response.status()); });
  return { sent, statuses };
}

test('canonical edit: keyboard escape/restore, self-excluding save, reload and blocked move @axe', async ({ page, f }) => {
  const day = addCalendarDays(hebronDate(new Date()), 1);
  await start(page, day);
  const original = await canonical(page, f, day, '13:00');
  const blocker = await canonical(page, f, day, '15:00', 1);
  const operations = await durable(page);
  const evidence = await f.syncEvidence();
  const patches = observePatches(page, original.id);
  const card = page.getByTestId(`card-appointment-${original.id}`);

  let editor = await keyboardEdit(page, original.id);
  await expect(page.getByTestId('input-edit-time')).toHaveValue('13:00');
  await expect(page.getByTestId('select-edit-duration')).toHaveValue('30');
  await keyboardTrap(page, editor);
  await expectAccessible(page);
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(card).toBeFocused();
  expect(patches.sent).toEqual([]);
  expect((await appointments(f, day)).find(a => a.id === original.id)).toEqual(original);

  editor = await keyboardEdit(page, original.id);
  // This interval overlaps only itself: a real check/hold/PATCH must permit it.
  await page.getByTestId('select-edit-duration').selectOption('45');
  await expect(page.getByTestId('button-edit-save')).toBeEnabled();
  await expectAccessible(page);
  await page.getByTestId('button-edit-save').evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(editor).toHaveCount(0);
  await expect.poll(() => patches.statuses).toEqual([200]);
  expect(patches.sent).toHaveLength(1);
  expect(patches.sent[0]).toMatchObject({ expectedVersion: 1 });
  expect(patches.sent[0]!.clientOpId).not.toBe(original.clientOpId);
  await expect(card).toBeFocused();
  const edited = (await appointments(f, day)).find(a => a.id === original.id)!;
  expect(edited).toMatchObject({
    id: original.id, clinicId: original.clinicId, patientId: original.patientId,
    doctorId: original.doctorId, source: original.source, status: 'booked', version: 2,
    startsAt: original.startsAt, endsAt: hebronInstant(day, '13:45').toISOString(),
  });
  await page.reload();
  await expect(card).toBeVisible();
  editor = await keyboardEdit(page, original.id);
  await expect(page.getByTestId('select-edit-duration')).toHaveValue('45');
  await page.getByTestId('input-edit-time').fill('15:00');
  await expect(page.getByTestId('status-check-blocked')).toBeVisible();
  await expect(page.getByTestId('button-edit-save')).toBeDisabled();
  const review = page.getByTestId('button-review-conflicts');
  await review.focus();
  await page.keyboard.press('Enter');
  const conflicts = page.getByTestId('dialog-conflicts');
  await expect(conflicts).toBeVisible();
  await keyboardTrap(page, conflicts);
  await expectAccessible(page);
  await page.keyboard.press('Escape');
  await expect(conflicts).toBeHidden();
  await expect(editor).toBeVisible();
  await expect(review).toBeFocused();
  await page.getByTestId('button-edit-cancel').focus();
  await page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect(card).toBeFocused();
  expect(patches.statuses).toEqual([200]);
  expect(patches.sent).toHaveLength(1);
  expect((await appointments(f, day)).sort((a, b) => a.id - b.id)).toEqual([edited, blocker].sort((a, b) => a.id - b.id));
  expect(await durable(page)).toEqual(operations);
  expect(await f.syncEvidence()).toEqual(evidence);
  expect(await f.seed()).toEqual(f.before);
});

test('canonical cancellation: running-timer axe, keyboard confirmation escape and Undo @axe', async ({ page, f }) => {
  // Install before CancellationStore captures Date.now, but never pause for axe.
  await page.clock.install();
  const day = addCalendarDays(hebronDate(new Date()), 1);
  await start(page, day);
  const original = await canonical(page, f, day, '13:00');
  const operations = await durable(page);
  const evidence = await f.syncEvidence();
  const patches = observePatches(page, original.id);
  const card = page.getByTestId(`card-appointment-${original.id}`);
  const dialog = await keyboardOpen(page, original.id);
  await keyboardTrap(page, dialog);
  await expectAccessible(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(card).toBeFocused();
  expect(patches.sent).toEqual([]);
  const undo = await keyboardCancel(page, original.id);
  await expect(page.locator('.cancel-notice [role="status"]')).not.toBeEmpty();
  await expectAccessible(page);
  // Never silently accept an axe scan consuming the ten-second Undo window.
  await expect(undo).toBeVisible();
  expect(patches.sent).toEqual([]);
  await undo.focus();
  await page.keyboard.press('Enter');
  await expect(undo).toHaveCount(0);
  await expect(card).toBeFocused();
  expect(patches.sent).toEqual([]);
  expect(patches.statuses).toEqual([]);
  expect(await appointments(f, day)).toEqual([original]);
  expect(await durable(page)).toEqual(operations);
  expect(await f.syncEvidence()).toEqual(evidence);
  expect(await f.seed()).toEqual(f.before);
});

test('canonical cancellation: 9999ms Undo wins, 10000ms commits once and releases occupancy', async ({ page, f }) => {
  await page.clock.install();
  const day = addCalendarDays(hebronDate(new Date()), 1);
  await start(page, day);
  const original = await canonical(page, f, day, '13:00');
  const operations = await durable(page);
  const evidence = await f.syncEvidence();
  const patches = observePatches(page, original.id);
  // Separate from the running-timer axe case. No axe call may enter this section.
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now())));
  try {
    let undo = await keyboardCancel(page, original.id);
    await page.clock.runFor(9999);
    expect(patches.sent).toEqual([]);
    expect(await appointments(f, day)).toEqual([original]);
    await undo.focus();
    await page.keyboard.press('Enter');
    await expect(undo).toHaveCount(0);
    await page.clock.runFor(2);
    expect(patches.sent).toEqual([]);
    expect(await appointments(f, day)).toEqual([original]);

    undo = await keyboardCancel(page, original.id);
    await page.clock.runFor(9999);
    expect(patches.sent).toEqual([]);
    await expect(undo).toBeVisible();
    expect(await appointments(f, day)).toEqual([original]);
    await page.clock.runFor(1);
    await expect.poll(() => patches.statuses).toEqual([200]);
    expect(patches.sent).toHaveLength(1);
    expect(patches.sent[0]).toMatchObject({ expectedVersion: 1, status: 'cancelled' });
    await expect(undo).toHaveCount(0);
    await page.clock.runFor(10000);
    expect(patches.sent).toHaveLength(1);
    expect(patches.statuses).toEqual([200]);
  } finally {
    await page.clock.resume();
    await page.clock.setSystemTime(new Date());
  }
  const cancelled = (await appointments(f, day))[0]!;
  expect(cancelled).toMatchObject({
    id: original.id, clinicId: original.clinicId, doctorId: original.doctorId,
    patientId: original.patientId, source: original.source,
    startsAt: original.startsAt, endsAt: original.endsAt, status: 'cancelled', version: 2,
  });
  expect(await durable(page)).toEqual(operations);
  expect(await f.syncEvidence()).toEqual(evidence);
  await page.reload();
  expect(await appointments(f, day)).toEqual([cancelled]);
  const replacement = await canonical(page, f, day, '13:00');
  expect(replacement.id).not.toBe(original.id);
  expect(replacement.startsAt).toBe(original.startsAt);
  expect(replacement.endsAt).toBe(original.endsAt);
  expect((await appointments(f, day)).sort((a, b) => a.id - b.id)).toEqual([cancelled, replacement].sort((a, b) => a.id - b.id));
  expect(patches.sent).toHaveLength(1);
  expect(patches.statuses).toEqual([200]);
  expect(await f.seed()).toEqual(f.before);
});
