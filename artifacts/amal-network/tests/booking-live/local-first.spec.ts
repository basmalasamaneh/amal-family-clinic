import type { Page, Route } from '@playwright/test';
import { test, expect, display, type BookingFixture } from './fixtures';
import { expectAccessible } from './accessibility';
import { addCalendarDays, hebronDate, hebronInstant } from '../../../../tests/builders/time';
import { durable } from '../../../../tests/offline/evidence';

test.use({ offlineJourney: true });

async function slot(page: Page, f: BookingFixture, day: string, patient = 0) {
  await page.getByTestId('link-new-booking').click();
  await expect(page.getByTestId('status-local-booking-note')).toBeVisible();
  await expect(page.getByTestId('text-booking-cache-coverage')).toBeVisible();
  await expect(page.getByTestId('status-fixture-writes')).toHaveCount(0);
  await expect(page.getByTestId('status-fixture-patients')).toHaveCount(0);
  await page.getByTestId('input-patient-search').fill(f.patientNames[patient]!);
  await expect(page.getByTestId(`option-patient-${f.patients[0]}`)).toBeVisible();
  await expect(page.getByTestId(`option-patient-${f.patients[1]}`)).toBeVisible();
  expect(await page.getByTestId(`option-patient-${f.patients[0]}`).innerText())
    .not.toBe(await page.getByTestId(`option-patient-${f.patients[1]}`).innerText());
  await page.getByTestId(`option-patient-${f.patients[patient]}`).click();
  await page.getByTestId('select-booking-doctor').selectOption(String(f.doctor));
  await page.getByTestId('input-booking-date').fill(day);
  await page.getByTestId('select-booking-duration').selectOption('30');
}

for (const mode of ['online', 'offline'] as const) {
  test(`${mode}: local acknowledgement is not server commit; duplicate activation and reload preserve one operation @axe`, async ({ page, context, f }, info) => {
    const day = addCalendarDays(hebronDate(new Date()), 1);
    const remote = await f.secondContext();
    const list = () => f.read(`/appointments?${new URLSearchParams({
      clinicId: String(f.clinic), from: hebronInstant(day, '00:00').toISOString(),
      to: hebronInstant(addCalendarDays(day, 1), '00:00').toISOString(), limit: '100',
    })}`, remote).then(result => result.items);
    const requests: { method: string; path: string }[] = [];
    context.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/api/')) requests.push({ method: request.method(), path });
    });
    let deliveryAllowed = false;
    let held = 0;
    const delayPush = async (route: Route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      if (!deliveryAllowed) {
        held++;
        // End this transport attempt before dispatch. Keeping it pending would
        // hold the product's shared queue/cache lock and stall the online
        // calendar refresh, obscuring the already-persisted local proposal.
        await route.abort('connectionreset');
      } else await route.continue(); // Every successful write is the real API.
    };
    try {
      expect(await list()).toEqual([]);
      await page.goto(`/desk/today?date=${day}`);
      await expect(page.getByTestId('page-calendar-day')).toHaveAttribute('data-adapter', 'real');
      await page.getByTestId('input-date').fill(day);
      await expect(page.getByTestId('calendar-cache-coverage')).toBeVisible();
      await display(page);
      await page.evaluate(async () => { await navigator.serviceWorker.ready; });
      await page.reload();
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
      await expect(page.getByTestId('calendar-cache-coverage')).toBeVisible();
      await expect.poll(() => page.evaluate(() => {
        const stored = JSON.parse(sessionStorage.getItem('amal-offline-permit-v1') ?? 'null');
        return !!stored?.permit?.signature && !!stored?.nonce;
      })).toBe(true);
      if (mode === 'online') await context.route('**/api/sync/push', delayPush);
      else await context.setOffline(true);
      expect(await page.evaluate(() => navigator.onLine)).toBe(mode === 'online');
      await page.setViewportSize({ width: 390, height: 844 });
      await slot(page, f, day);
      await page.getByTestId('input-booking-time').fill('23:50');
      await expect(page.getByTestId('text-interval-error')).toBeVisible();
      await expect(page.getByTestId('input-booking-time')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByTestId('button-stage-next')).toBeDisabled();
      expect((await durable(page)).proposals).toEqual([]);
      await page.getByTestId('input-booking-time').fill('13:00');
      await expect(page.getByTestId('status-check-ok')).toBeVisible();
      await page.getByTestId('button-stage-next').click();
      await expect(page.getByTestId('status-local-no-hold')).toBeVisible();
      await expect(page.getByTestId('status-hold-active')).toHaveCount(0);
      const drawer = page.getByTestId('drawer-booking');
      const bounds = await drawer.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
      const controls = drawer.locator('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]');
      await controls.last().focus();
      await page.keyboard.press('Tab');
      await expect(controls.first()).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(controls.last()).toBeFocused();
      await expectAccessible(page);
      await expect(page.getByTestId('button-confirm-booking')).toBeEnabled();
      await page.getByTestId('button-confirm-booking').evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
      await expect(drawer).toHaveCount(0);
      await page.getByTestId('input-date').fill(day);
      const pending = await durable(page);
      expect(pending.proposals).toHaveLength(1);
      expect(pending.outbox).toHaveLength(1);
      const proposal = pending.proposals[0]!;
      expect(proposal).toMatchObject({
        userId: `account:${f.user}`, clinicId: f.clinic, sequence: 1, canonical: null, outcome: 'pending',
        input: { clientOpId: proposal.operationId, patientId: f.patients[0], doctorId: f.doctor,
          startsAt: hebronInstant(day, '13:00').toISOString(), endsAt: hebronInstant(day, '13:30').toISOString(), source: 'phone' },
      });
      expect(proposal.localId).toBeLessThan(0);
      expect(pending.outbox[0]).toMatchObject({ operationId: proposal.operationId,
        booking: { localId: proposal.localId, deviceId: proposal.deviceId, sequence: 1 } });
      const provisional = page.getByTestId(`card-appointment-${proposal.localId}`);
      await expect(provisional).toBeVisible();
      await expect(provisional).toBeDisabled();
      await expect(provisional.getByTestId('status-sync')).toBeVisible();
      // Local UI closed and durable storage committed, but no server write has occurred.
      expect(await list()).toEqual([]);
      expect(await f.syncEvidence()).toEqual({ receipts: [], conflicts: [], history: [] });
      if (mode === 'online') {
        await expect.poll(() => held).toBeGreaterThanOrEqual(1);
      } else {
        expect(pending.outbox[0]).toMatchObject({ status: 'pending', attempts: 0 });
        await slot(page, f, day, 1);
        await page.getByTestId('input-booking-time').fill('13:00');
        await expect(page.getByTestId('status-check-error')).toBeVisible();
        await expect(page.getByTestId('button-stage-next')).toBeDisabled();
        await page.getByTestId('button-close-booking').click();
        expect(await durable(page)).toEqual(pending);
        const response = await page.reload();
        expect(response?.fromServiceWorker()).toBe(true);
        expect(await page.evaluate(async () => {
          try { await fetch(`/uncached-booking-probe-${Date.now()}`, { cache: 'no-store' }); return false; }
          catch { return true; }
        })).toBe(true);
        // Chromium may reset its online signal after a SW navigation. Restore
        // actual CDP emulation, never override navigator or application state.
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
        await page.getByTestId('input-date').fill(day);
        await expect(provisional).toBeVisible();
        expect(await durable(page)).toEqual(pending);
        expect(await list()).toEqual([]);
        expect((await f.syncEvidence()).receipts).toEqual([]);
        await cdp.detach();
      }
      deliveryAllowed = true;
      await context.setOffline(false);
      await expect.poll(async () => (await durable(page)).proposals[0]?.outcome, { timeout: 45_000 }).toBe('applied');
      const applied = await durable(page);
      const canonical = applied.proposals[0]!.canonical!;
      expect(canonical.id).toBeGreaterThan(0);
      expect(canonical).toMatchObject({ ...proposal.input, status: 'booked', version: 1 });
      expect(applied.proposals[0]!.operationId).toBe(proposal.operationId);
      expect(applied.outbox).toHaveLength(1);
      expect(applied.outbox[0]).toMatchObject({ operationId: proposal.operationId, status: 'succeeded' });
      expect(await list()).toEqual([canonical]);
      const evidence = await f.syncEvidence();
      expect(evidence.receipts).toEqual([expect.objectContaining({ client_op_id: proposal.operationId, sequence: 1 })]);
      expect(evidence.conflicts).toEqual([]);
      expect(evidence.history).toEqual([]);
      await page.reload();
      await page.getByTestId('input-date').fill(day);
      await expect(page.getByTestId(`card-appointment-${canonical.id}`)).toBeVisible();
      await expect(provisional).toHaveCount(0);
      await expect(page.getByTestId('status-sync')).toHaveCount(0);
      await expect(page.locator('[data-testid^="card-appointment-"]')).toHaveCount(1);
      expect((await durable(page)).proposals).toEqual(applied.proposals);
      expect(await list()).toEqual([canonical]);
      expect(await f.syncEvidence()).toEqual(evidence);
      expect(requests.filter(request => /\/(?:check|holds?|availability)(?:\/|$)/.test(request.path) ||
        (request.path === '/api/appointments' && request.method !== 'GET'))).toEqual([]);
      expect(await f.seed()).toEqual(f.before);
      await info.attach('local-first-booking-summary', {
        contentType: 'application/json',
        body: JSON.stringify({ mode, localProposals: 1, canonicalRows: 1, receipts: 1, duplicateActivations: 2 }),
      });
    } finally {
      // On failure never release a blocked write into teardown. Stop page
      // networking first, then wait for active routing handlers to finish.
      await context.setOffline(true);
      if (mode === 'online') await context.unrouteAll({ behavior: 'wait' });
    }
  });
}
