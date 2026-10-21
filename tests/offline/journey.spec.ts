import { randomUUID } from 'node:crypto';
import { test, expect, display, origin } from '../../artifacts/amal-network/tests/booking-live/fixtures';
import { addCalendarDays, hebronDate, hebronInstant } from '../builders/time';
import { durable } from './evidence';

test.use({ offlineJourney: true });

test('three UI bookings survive outage, committed-response loss, retry and explicit move', async ({ page, context, f }, info) => {
  const day = addCalendarDays(hebronDate(new Date()), 1);
  const remote = await f.secondContext();
  const me = await f.read<{ csrfToken: string }>('/me', remote);
  const headers = { origin, 'x-csrf-token': me.csrfToken };
  const list = () => f.read(`/appointments?${new URLSearchParams({
    clinicId: String(f.clinic), from: hebronInstant(day, '00:00').toISOString(),
    to: hebronInstant(addCalendarDays(day, 1), '00:00').toISOString(), limit: '100',
  })}`, remote).then(r => r.items.sort((a, b) => a.id - b.id));
  let release = () => {};
  let phase = 'setup';
  const networkEvents: string[] = [];
  await page.exposeFunction('recordNetworkState', (event: string) => networkEvents.push(event));
  await page.addInitScript(() => {
    for (const name of ['online', 'offline']) window.addEventListener(name, () => {
      void (window as any).recordNetworkState(name);
    });
  });
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) networkEvents.push(new URL(frame.url()).pathname); });
  try {
    expect(await list()).toEqual([]);
    expect(await f.syncEvidence()).toEqual({ receipts: [], conflicts: [], history: [] });
    await context.addInitScript(id => {
      localStorage.setItem(`amal.tour.v1:${encodeURIComponent(`account:${id}`)}:front-desk`, 'dismissed');
    }, f.user);
    await page.goto(`/desk/today?date=${day}`);
    await expect(page.getByTestId('page-calendar-day')).toHaveAttribute('data-adapter', 'real');
    await page.getByTestId('input-date').fill(day);
    await expect(page.getByTestId('calendar-cache-coverage')).toBeVisible();
    await display(page);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await expect(page.getByTestId('calendar-cache-coverage')).toBeVisible();
    // Wait on the product's verified permit/cache, not a guessed signing delay.
    await expect.poll(() => page.evaluate(() => {
      const s = JSON.parse(sessionStorage.getItem('amal-offline-permit-v1') ?? 'null');
      return !!s?.permit?.signature && !!s?.nonce;
    })).toBe(true);

    phase = 'offline-booking';
    await context.setOffline(true);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    for (let i = 0; i < 3; i++) {
      await page.getByTestId('link-new-booking').click();
      await expect(page.getByTestId('status-local-booking-note')).toBeVisible();
      await page.getByTestId('input-patient-search').fill(`059000000${i}`);
      await page.getByTestId(`option-patient-${f.patients[i]}`).click();
      await page.getByTestId('select-booking-doctor').selectOption(String(f.doctor));
      await page.getByTestId('input-booking-date').fill(day);
      await page.getByTestId('input-booking-time').fill(`${9 + i}:00`.padStart(5, '0'));
      await page.getByTestId('select-booking-duration').selectOption('30');
      await expect(page.getByTestId('status-check-ok')).toBeVisible();
      await page.getByTestId('button-stage-next').click();
      await expect(page.getByTestId('status-local-no-hold')).toBeVisible();
      await page.getByTestId('button-confirm-booking').click();
      await expect(page.getByTestId('drawer-booking')).toHaveCount(0);
      await page.getByTestId('input-date').fill(day);
      await expect(page.getByTestId('status-sync')).toHaveCount(i + 1);
    }
    const pending = await durable(page);
    expect(pending.proposals.map(p => p.sequence)).toEqual([1, 2, 3]);
    const ids = pending.proposals.map(p => p.operationId);
    expect(new Set(ids).size).toBe(3);
    expect(new Set(pending.proposals.map(p => p.localId)).size).toBe(3);
    for (const [i, p] of pending.proposals.entries()) {
      expect(p.input).toMatchObject({
        clientOpId: p.operationId, patientId: f.patients[i], doctorId: f.doctor,
        startsAt: hebronInstant(day, `${9 + i}:00`.padStart(5, '0')).toISOString(),
        endsAt: hebronInstant(day, `${9 + i}:30`.padStart(5, '0')).toISOString(),
      });
      expect(p.canonical).toBeNull();
      expect(p.outcome).toBe('pending');
      expect(p.localId).toBeLessThan(0);
      expect(pending.outbox.find(o => o.operationId === p.operationId)).toMatchObject({ status: 'pending', attempts: 0 });
      await expect(page.getByTestId(`card-appointment-${p.localId}`)).toBeVisible();
    }
    expect(await list()).toEqual([]);
    expect((await f.syncEvidence()).receipts).toEqual([]);
    phase = 'offline-reload';
    const response = await page.reload();
    expect(response?.fromServiceWorker()).toBe(true);
    expect(await page.evaluate(async () => {
      try { await fetch(`/uncached-probe-${Date.now()}`, { cache: 'no-store' }); return false; }
      catch { return true; }
    })).toBe(true);
    // Chromium can reset navigator.onLine on SW navigation; restore its actual
    // network emulation signal, never override navigator or the product.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await page.getByTestId('input-date').fill(day);
    await expect(page.getByTestId('status-sync')).toHaveCount(3);
    expect(await durable(page)).toEqual(pending);

    phase = 'competitor';
    const competitorResponse = await remote.request.post(`${origin}/api/appointments`, {
      headers, data: { ...pending.proposals[2]!.input, clientOpId: randomUUID(), patientId: f.patients[3] },
    });
    expect(competitorResponse.status()).toBe(201);
    const competitor = await competitorResponse.json();
    expect(await list()).toEqual([competitor]);
    expect((await f.syncEvidence()).receipts).toEqual([]);

    // Real HTTP commit, withheld response. No success is mocked. The SW does not
    // handle API requests; require interception evidence or fail this test.
    let committed = false;
    const pushes: unknown[] = [];
    const gate = new Promise<void>(resolve => { release = resolve; });
    await context.route('**/api/sync/push', async route => {
      pushes.push(route.request().postDataJSON());
      if (pushes.length === 1) {
        const real = await route.fetch();
        expect(real.status()).toBe(200);
        committed = true;
        await gate;
        await route.abort('connectionreset');
      } else await route.continue();
    });
    phase = 'committed-unacknowledged';
    await cdp.detach();
    await context.setOffline(false); // This, not a Retry click, starts delivery.
    await expect.poll(() => committed).toBe(true);
    const unacknowledged = await f.syncEvidence();
    expect(unacknowledged.receipts.map(r => r.client_op_id)).toEqual([ids[0]]);
    expect(unacknowledged.conflicts).toEqual([]);
    const committedRows = await list();
    expect(committedRows.map(a => a.clientOpId).sort()).toEqual([ids[0], competitor.clientOpId].sort());
    expect((await durable(page)).proposals.map(p => p.input)).toEqual(pending.proposals.map(p => p.input));
    expect((await durable(page)).proposals.map(p => p.canonical)).toEqual([null, null, null]);
    expect((await durable(page)).outbox.map(o => o.payload)).toEqual(pending.outbox.map(o => o.payload));
    release();
    phase = 'automatic-retry';
    await expect.poll(() => pushes.length, { timeout: 45_000 }).toBeGreaterThanOrEqual(2);
    expect(pushes[1]).toEqual(pushes[0]);
    await page.goto('/desk/sync');
    await expect(page.getByTestId('count-acknowledged')).toHaveText('2');
    await expect(page.getByTestId('count-conflict')).toHaveText('1');
    const afterRetry = await list();
    expect(afterRetry.map(a => a.clientOpId).sort()).toEqual([ids[0], ids[1], competitor.clientOpId].sort());
    expect(afterRetry.filter(a => committedRows.some(b => b.id === a.id))).toEqual(committedRows);
    const first = await f.syncEvidence();
    expect(first.receipts.map(r => r.client_op_id)).toEqual(ids);
    expect(first.receipts[0]).toEqual(unacknowledged.receipts[0]);
    expect(first.conflicts).toEqual([expect.objectContaining({ client_op_id: ids[2], status: 'open' })]);
    await page.goto('/desk/today');
    await page.goto('/desk/sync');
    await page.reload();
    await expect(page.getByTestId('count-conflict')).toHaveText('1');
    expect(await f.syncEvidence()).toEqual(first);
    expect(await list()).toEqual(afterRetry);
    for (const id of ids) await expect(page.getByTestId(`row-booking-${id}`)).toBeVisible();
    expect((await durable(page)).proposals.map(p => p.operationId)).toEqual(ids);

    phase = 'explicit-move';
    const conflictId = String(first.conflicts[0]!.id);
    const card = page.getByTestId(`card-conflict-${conflictId}`);
    const radio = card.locator('[data-testid^="radio-move-"]').first();
    await expect(radio, 'Conflict must offer a selectable move alternative').toBeVisible();
    const alternative = await radio.locator('..').locator('time').getAttribute('datetime');
    expect(alternative).toBeTruthy();
    expect(alternative).not.toBe(pending.proposals[2]!.input.startsAt);
    const alternativeStart = Date.parse(alternative!);
    const alternativeEnd = alternativeStart + 30 * 60_000;
    expect(afterRetry.filter(a => (a.doctorId === f.doctor || a.patientId === f.patients[2])
      && Date.parse(a.startsAt) < alternativeEnd && Date.parse(a.endsAt) > alternativeStart)).toEqual([]);
    await radio.check();
    await card.getByTestId(`button-move-${conflictId}`).click();
    await expect(page.getByTestId(`dialog-confirm-${conflictId}`)).toBeVisible();
    expect((await f.syncEvidence()).conflicts).toEqual(first.conflicts);
    await page.getByTestId('button-confirm-ok').click();
    await expect(page.getByTestId('count-acknowledged')).toHaveText('3');
    await expect(page.getByTestId('count-conflict')).toHaveText('0');
    const final = await list();
    const local = await durable(page);
    expect(local.proposals.map(p => p.operationId)).toEqual(ids);
    expect(local.proposals.map(p => p.outcome)).toEqual(['applied', 'applied', 'applied']);
    expect(local.outbox.map(o => o.operationId).sort()).toEqual([...ids].sort());
    expect(local.outbox.every(o => o.status === 'succeeded')).toBe(true);
    const canonical = local.proposals.map(p => p.canonical!);
    expect(new Set(canonical.map(a => a.id)).size).toBe(3);
    expect(canonical[2]!.startsAt).toBe(alternative);
    expect(final).toEqual([...canonical, competitor].sort((a, b) => a.id - b.id));
    const resolved = await f.syncEvidence();
    expect(resolved.receipts).toEqual(first.receipts);
    expect(resolved.conflicts).toEqual([expect.objectContaining({ id: conflictId, client_op_id: ids[2], status: 'resolved' })]);
    expect(resolved.history).toHaveLength(1);
    await page.reload();
    await expect(page.getByTestId('count-acknowledged')).toHaveText('3');
    await expect(page.locator('html')).toHaveAttribute('lang', info.project.use.locale!);
    await expect(page.locator('html')).toHaveAttribute('dir', info.project.use.locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.locator('html')).toHaveAttribute('data-theme', info.project.use.colorScheme!);
    expect((await durable(page)).proposals).toEqual(local.proposals);
    expect(await list()).toEqual(final);
    expect(await f.syncEvidence()).toEqual(resolved);
    await page.goto(`/desk/today?date=${day}`);
    await page.getByTestId('input-date').fill(day);
    for (const a of final) await expect(page.getByTestId(`card-appointment-${a.id}`)).toBeVisible();
    await expect(page.locator('[data-testid^="card-appointment-"]')).toHaveCount(4);
    expect(await f.seed()).toEqual(f.before);
    phase = 'complete';
  } finally {
    release();
    await context.setOffline(false);
    await info.attach('sanitized-offline-evidence', {
      contentType: 'application/json',
      body: JSON.stringify({ phase, project: info.project.name, successful: phase === 'complete', networkEvents,
        online: await page.evaluate(() => navigator.onLine).catch(() => null),
        state: await page.locator('[data-testid^="status-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid'))).catch(() => []),
        receipts: await f.syncEvidence().then(e => e.receipts.length),
        proposalCount: await durable(page).then(d => d.proposals.length).catch(() => null) }),
    });
  }
});
