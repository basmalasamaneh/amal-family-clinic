import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { dayGridHours, fromSchedulingSettings } from '../src/calendar/hours';
import { readCachedClinicHours } from '../src/calendar/local-schedule';
import { localToUtc } from '../src/calendar/dates';
import type { CalendarAppointment } from '../src/calendar/adapter';
import { LocalCacheController } from '../src/offline/controller';
import { LocalCacheDatabase } from '../src/offline/database';
import { appointmentWindow } from '../src/offline/calendar';
import type { AuthorizedSnapshot, Result } from '../src/offline/types';

const date = '2026-10-20'; // Tuesday.
const configured = { openTime: '08:00:00', closeTime: '17:00:00', slotMinutes: 30, workingDays: [0, 1, 2, 3, 4, 5, 6] };
const hours = fromSchedulingSettings(configured)!;
const appointment = (id: number, start: number, end: number): CalendarAppointment => ({
  id, clinicId: 701, doctorId: 801, patientName: 'Synthetic appointment',
  startsAt: localToUtc(date, start), endsAt: localToUtc(date, end),
  lifecycle: 'booked', syncPending: false, conflict: false,
});
function value<T>(result: Result<T>): T {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

test('actual 08–17 hours generate complete slots, with none starting at or after close', () => {
  assert.deepEqual(hours, { open: 480, close: 1020, slotMinutes: 30, workingDays: configured.workingDays });
  const grid = dayGridHours(date, hours, []);
  assert.equal(grid.open, 480);
  assert.equal(grid.close, 1020);
  assert.equal(grid.available.length, 18);
  assert.equal(grid.available.at(-1), 990);
  assert.ok(grid.available.every(m => m >= hours.open && m + grid.step <= hours.close));
});

test('non-default hours/days are used without substituting defaults; partial final slot is not offered', () => {
  const actual = fromSchedulingSettings({ ...configured, openTime: '10:15', closeTime: '14:25', workingDays: [2] })!;
  const grid = dayGridHours(date, actual, []);
  assert.equal(grid.open, 615);
  assert.deepEqual(grid.available, [615, 645, 675, 705, 735, 765, 795, 825]);
  assert.ok(!grid.available.includes(855));
  assert.equal(grid.slots.at(-1), 855, 'partial row can render but is never clickable');
});

test('known closed days (including empty working_days) do not look missing and have no availability', () => {
  for (const workingDays of [[1, 3], []]) {
    const grid = dayGridHours(date, { ...hours, workingDays }, []);
    assert.equal(grid.closed, true);
    assert.deepEqual(grid.available, []);
    assert.deepEqual(grid.slots, []);
  }
});

test('null missing configuration stays distinct from unavailable older data, without invented slots', () => {
  assert.equal(fromSchedulingSettings(null), null);
  assert.equal(fromSchedulingSettings(undefined), undefined);
  for (const missing of [null, undefined]) {
    const grid = dayGridHours(date, missing, []);
    assert.equal(grid.closed, false);
    assert.deepEqual(grid.available, []);
    assert.deepEqual(grid.slots, []);
  }
  for (const invalid of [
    { ...configured, openTime: '25:00' }, { ...configured, closeTime: '07:00' },
    { ...configured, workingDays: [7] }, { ...configured, workingDays: [2, 2] },
    { ...configured, slotMinutes: 0 },
  ]) assert.throws(() => fromSchedulingSettings(invalid), /Invalid clinic scheduling hours/);
});

test('out-of-hours and closed-day appointments retain their full rendered bounds without clickable availability outside hours', () => {
  const appointments = [appointment(1, 6 * 60 + 15, 7 * 60), appointment(2, 18 * 60, 19 * 60 + 15)];
  for (const config of [hours, { ...hours, workingDays: [] }, null, undefined]) {
    const grid = dayGridHours(date, config, appointments);
    assert.ok(grid.open <= 375);
    assert.ok(grid.close >= 1155);
    for (const appt of appointments) {
      const start = appt.id === 1 ? 375 : 1080;
      const end = appt.id === 1 ? 420 : 1155;
      const rowStart = Math.floor((start - grid.open) / grid.step);
      const rowEnd = Math.floor((end - 1 - grid.open) / grid.step) + 1;
      assert.ok(rowStart >= 0 && rowStart < grid.slots.length);
      assert.ok(rowEnd <= grid.slots.length);
    }
    assert.ok(grid.available.every(m => m >= hours.open && m + grid.step <= hours.close));
    if (config !== hours) assert.deepEqual(grid.available, []);
  }
});

test('validated hours survive same-identity offline cache reopen; old snapshots, other clinic and stale identity stay isolated', async t => {
  const now = new Date(`${date}T08:00:00Z`);
  const auth = { userId: 'synthetic-hours-user', clinicId: 701, authorizedUntil: `${date}T16:00:00Z` };
  const name = `calendar-hours-${randomUUID()}`;
  const db = new LocalCacheDatabase(name);
  let cache = new LocalCacheController({ database: db, now: () => now });
  const window = appointmentWindow(now);
  const snapshot: AuthorizedSnapshot = {
    userId: auth.userId, clinicId: auth.clinicId, clinicHours: hours,
    doctors: [{ id: 801, clinicId: 701, name: 'Synthetic doctor' }],
    patients: [], appointments: [], coverage: { startUtc: window.startUtc, endUtc: window.endUtc },
  };
  t.after(async () => { cache.close(); await new LocalCacheDatabase(name).delete(); });
  value(await cache.setContext(auth));
  const originalTicket = value(cache.captureScope());
  value(await cache.replaceSnapshot(originalTicket, snapshot));
  cache.close();
  // No network transport is involved in a reopened authorized read.
  cache = new LocalCacheController({ database: new LocalCacheDatabase(name), now: () => now });
  value(await cache.setContext(auth));
  let ticket = value(cache.captureScope());
  assert.deepEqual(value(await cache.readSnapshot(ticket)).metadata?.clinicHours, hours);
  assert.equal((await cache.readSnapshot(originalTicket)).ok, false, 'old controller tickets cannot authorize reads');
  assert.equal((await cache.replaceSnapshot(ticket, { ...snapshot, clinicId: 702 })).ok, false);
  assert.equal((await cache.replaceSnapshot(ticket, { ...snapshot, clinicHours: { ...hours, workingDays: [7] } })).ok, false);
  assert.deepEqual(value(await cache.readSnapshot(ticket)).metadata?.clinicHours, hours, 'invalid replacement cannot lose valid hours');
  value(await cache.replaceSnapshot(ticket, { ...snapshot, clinicHours: null }));
  assert.equal(value(await cache.readSnapshot(ticket)).metadata?.clinicHours, null);
  value(await cache.replaceSnapshot(ticket, { ...snapshot, clinicHours: undefined }));
  assert.equal(value(await cache.readSnapshot(ticket)).metadata?.clinicHours, undefined);
  value(await cache.setContext({ ...auth, clinicId: 702 }));
  assert.equal((await cache.readSnapshot(ticket)).ok, false);
  ticket = value(cache.captureScope());
  assert.equal(value(await cache.readSnapshot(ticket)).metadata, null);
  value(await cache.setContext({ ...auth, userId: 'another-synthetic-user' }));
  ticket = value(cache.captureScope());
  assert.equal(value(await cache.readSnapshot(ticket)).metadata, null);
  value(await cache.setContext(null));
  assert.equal((await cache.readSnapshot(ticket)).ok, false);
});

test('the cached calendar hours read works offline without any fetch and rejects other clinics/identities', async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => { fetches++; throw new Error('Offline: no network read allowed'); }) as typeof fetch;
  const db = new LocalCacheDatabase(`calendar-hours-offline-${randomUUID()}`);
  const cache = new LocalCacheController({ database: db });
  try {
    const now = new Date();
    const auth = { userId: 'synthetic-offline-hours-user', clinicId: 701,
      authorizedUntil: new Date(now.getTime() + 60_000).toISOString() };
    value(await cache.setContext(auth));
    const ticket = value(cache.captureScope());
    const window = appointmentWindow(now);
    value(await cache.replaceSnapshot(ticket, {
      userId: auth.userId, clinicId: auth.clinicId, clinicHours: hours,
      doctors: [], patients: [], appointments: [],
      coverage: { startUtc: window.startUtc, endUtc: window.endUtc },
    }));
    assert.deepEqual(await readCachedClinicHours(cache, ticket, 701), hours);
    await assert.rejects(readCachedClinicHours(cache, ticket, 702), /unauthorized/);
    value(await cache.setContext({ ...auth, userId: 'different-offline-hours-user' }));
    await assert.rejects(readCachedClinicHours(cache, ticket, 701), /stale-context/);
    await assert.rejects(readCachedClinicHours(cache, value(cache.captureScope()), 701), /identity-not-cached/);
    assert.equal(fetches, 0);
  } finally {
    cache.close();
    await db.delete();
    globalThis.fetch = originalFetch;
  }
});
