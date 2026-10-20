import 'fake-indexeddb/auto';
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { LocalCacheController } from '../src/offline/controller';
import { LocalCacheDatabase } from '../src/offline/database';
import type { Result, AuthorizedSnapshot, BookingProposal } from '../src/offline/types';
import type { AppointmentInput, SyncOutcome } from '@workspace/api-client-react';
import { appointmentWindow } from '../src/offline/calendar';
import { effectiveInterval } from '../src/booking/time';

const now = new Date('2026-10-20T08:00:00Z');
const auth = { userId: 'synthetic-local-booker', clinicId: 701, authorizedUntil: '2026-10-20T16:00:00Z' };
const window = appointmentWindow(now);
const snapshot: AuthorizedSnapshot = {
  userId: auth.userId, clinicId: auth.clinicId,
  doctors: [{ id: 801, clinicId: 701, name: 'Synthetic doctor' }],
  patients: [{ id: 901, clinicId: 701, name: 'Synthetic patient', phone: '000000', dateOfBirth: '1990-01-01' }],
  appointments: [], coverage: { startUtc: window.startUtc, endUtc: window.endUtc },
};
function value<T>(r: Result<T>): T { assert.equal(r.ok, true, JSON.stringify(r)); if (!r.ok) throw Error(r.error); return r.value; }
function input(hour = 10, clientOpId = randomUUID()): AppointmentInput {
  return { clientOpId, clinicId: 701, doctorId: 801, patientId: 901,
    startsAt: `2026-10-20T${hour}:00:00.000Z`, endsAt: `2026-10-20T${hour}:30:00.000Z`, source: 'phone' };
}
async function setup(t: TestContext) {
  const db = new LocalCacheDatabase(`local-booking-${randomUUID()}`);
  const cache = new LocalCacheController({ database: db, now: () => now });
  value(await cache.setContext(auth));
  const ticket = value(cache.captureScope());
  value(await cache.replaceSnapshot(ticket, snapshot));
  value(await cache.prepareBookingStream(ticket, { deviceId: 4001, nextSequence: 1 }));
  t.after(async () => { cache.close(); await db.delete(); });
  return { db, cache, ticket };
}
function applied(p: BookingProposal, id = 1234): SyncOutcome {
  return { clientOpId: p.operationId, sequence: p.sequence, status: 'applied',
    result: { ...p.input, id, status: 'booked', version: 1 } };
}

test('three bookings persist atomically and survive database reopen and cache replacement', async t => {
  const { db, cache, ticket } = await setup(t);
  for (const hour of [10, 11, 12]) value(await cache.saveBooking(ticket, input(hour)));
  assert.equal(await db.proposals.count(), 3);
  assert.equal(await db.outbox.count(), 3);
  value(await cache.replaceSnapshot(ticket, snapshot));
  value(await cache.rollover(ticket));
  const reopened = new LocalCacheDatabase(db.name);
  await reopened.open();
  assert.equal(await reopened.proposals.count(), 3);
  assert.deepEqual((await reopened.proposals.toArray()).map(p => p.sequence).sort(), [1, 2, 3]);
  reopened.close();
});
test('storage failure rolls back proposal, outbox, local id and device sequence', async t => {
  const { db, cache, ticket } = await setup(t);
  const fail = () => { throw new DOMException('synthetic quota', 'QuotaExceededError'); };
  db.outbox.hook('creating', fail);
  const result = await cache.saveBooking(ticket, input());
  assert.deepEqual(result, { ok: false, error: 'storage-quota' });
  assert.equal(await db.proposals.count(), 0);
  assert.equal(await db.outbox.count(), 0);
  assert.equal((await db.streams.get(4001))?.nextSequence, 1);
  assert.equal(await db.lifecycle.get('booking-local-id'), undefined);
  db.outbox.hook('creating').unsubscribe(fail);
});
test('double clicks and exact retries retain one frozen id; changed payload rejected', async t => {
  const { db, cache, ticket } = await setup(t);
  const i = input();
  const results = await Promise.all([cache.saveBooking(ticket, i), cache.saveBooking(ticket, i)]);
  assert.equal(value(results[0]!).localId, value(results[1]!).localId);
  assert.equal(await db.proposals.count(), 1);
  assert.deepEqual(await cache.saveBooking(ticket, { ...i, endsAt: '2026-10-20T10:45:00Z' }), { ok: false, error: 'invalid-data' });
  assert.equal((await db.streams.get(4001))?.nextSequence, 2);
});
test('overlap checks serialize concurrent submissions; exact adjacency is allowed', async t => {
  const { cache, ticket } = await setup(t);
  const results = await Promise.all([cache.saveBooking(ticket, input()), cache.saveBooking(ticket, input())]);
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.deepEqual(results.find(r => !r.ok), { ok: false, error: 'doctor-overlap' });
  value(await cache.saveBooking(ticket, { ...input(), startsAt: '2026-10-20T10:30:00Z', endsAt: '2026-10-20T11:00:00Z' }));
});
test('cross-connection contention cannot bypass persisted lifecycle or overlaps', async t => {
  const { db, cache, ticket } = await setup(t);
  const peer = new LocalCacheController({ database: new LocalCacheDatabase(db.name), now: () => now });
  value(await peer.setContext(auth));
  const other = value(peer.captureScope());
  const results = await Promise.all([cache.saveBooking(ticket, input()), peer.saveBooking(other, input())]);
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal(await db.proposals.count(), 1);
  peer.close();
});
test('server active statuses block, completed/no-show/cancelled do not', async t => {
  const { cache, ticket } = await setup(t);
  for (const status of ['booked', 'double_booked', 'completed', 'no_show', 'cancelled'] as const) {
    value(await cache.replaceSnapshot(ticket, { ...snapshot, appointments: [{ ...input(), id: 51, status, version: 1 }] }));
    const result = await cache.validateBooking(ticket, input());
    assert.equal(result.ok, !['booked', 'double_booked'].includes(status), status);
  }
});
test('missing identities, partial coverage, and window boundaries refuse validation', async t => {
  const { cache, ticket } = await setup(t);
  assert.deepEqual(await cache.saveBooking(ticket, { ...input(), patientId: 999 }), { ok: false, error: 'identity-not-cached' });
  assert.deepEqual(await cache.saveBooking(ticket, { ...input(), startsAt: window.endUtc, endsAt: '2026-11-04T12:00:00Z' }), { ok: false, error: 'coverage' });
  value(await cache.replaceSnapshot(ticket, { ...snapshot, coverage: { startUtc: window.startUtc, endUtc: '2026-10-20T10:15:00Z' } }));
  assert.deepEqual(await cache.saveBooking(ticket, input()), { ok: false, error: 'coverage' });
});
test('a cached appointment crossing the window start still blocks after pruning', async t => {
  const { cache, ticket } = await setup(t);
  const start = Date.parse(window.startUtc);
  value(await cache.replaceSnapshot(ticket, { ...snapshot, appointments: [{
    ...input(), id: 51, status: 'booked', version: 1,
    startsAt: new Date(start - 30 * 60000).toISOString(), endsAt: new Date(start + 30 * 60000).toISOString(),
  }] }));
  value(await cache.rollover(ticket));
  assert.deepEqual(await cache.validateBooking(ticket, { ...input(), startsAt: window.startUtc,
    endsAt: new Date(start + 15 * 60000).toISOString() }), { ok: false, error: 'doctor-overlap' });
});
test('unmatched acknowledgement cannot reconcile; explicit match acknowledges and retains evidence', async t => {
  const { db, cache, ticket } = await setup(t);
  const p = value(await cache.saveBooking(ticket, input()));
  assert.deepEqual(await cache.acknowledgeBooking(ticket, p.operationId, { ...applied(p), sequence: 99 }), { ok: false, error: 'invalid-data' });
  const bad = applied(p); if (bad.status === 'applied') bad.result.patientId = 999;
  assert.deepEqual(await cache.acknowledgeBooking(ticket, p.operationId, bad), { ok: false, error: 'invalid-data' });
  value(await cache.acknowledgeBooking(ticket, p.operationId, applied(p)));
  assert.equal((await db.outbox.toArray())[0]?.status, 'succeeded');
  assert.equal((await db.proposals.toArray())[0]?.canonical?.id, 1234);
  value(await cache.logout());
  assert.equal(await db.proposals.count(), 1);
  assert.equal(await db.outbox.count(), 1);
});
test('failed and conflicted proposals survive logout, timeout/rollover and scope changes', async t => {
  const { db, cache, ticket } = await setup(t);
  const p = value(await cache.saveBooking(ticket, input()));
  value(await cache.acknowledgeBooking(ticket, p.operationId, { sequence: 1, clientOpId: p.operationId, status: 'conflict',
    code: 'APPOINTMENT_CONFLICT', messageKey: 'error.conflict', params: {}, conflictId: randomUUID() }));
  assert.deepEqual(await cache.logout({ discardPending: true }), { ok: false, error: 'pending-outbox' });
  value(await cache.setContext({ ...auth, userId: 'other-synthetic-user' }));
  assert.deepEqual(value(await cache.listBookings(value(cache.captureScope()))), []);
  assert.equal(await db.proposals.count(), 1);
  value(await cache.setContext(auth));
  const restored = value(cache.captureScope());
  value(await cache.rollover(restored));
  assert.equal(value(await cache.listBookings(restored))[0]?.outcome, 'conflict');
  assert.deepEqual(value(await cache.listBookings(restored))[0]?.input, p.input);
});
test('ordering is durable across reauthorization; predecessor failure blocks later submission', async t => {
  const { cache, ticket } = await setup(t);
  const first = value(await cache.saveBooking(ticket, input()));
  const second = value(await cache.saveBooking(ticket, input(11)));
  assert.equal(value(await cache.beginBookingDelivery(ticket, second.operationId)), null);
  assert.deepEqual(value(await cache.beginBookingDelivery(ticket, first.operationId))?.input, first.input);
  value(await cache.acknowledgeBooking(ticket, first.operationId, applied(first)));
  assert.equal(value(await cache.beginBookingDelivery(ticket, second.operationId))?.sequence, 2);
  value(await cache.prepareBookingStream(ticket, { deviceId: 4001, nextSequence: 1 }));
  assert.equal(value(await cache.saveBooking(ticket, input(12))).sequence, 3);
});
test('outbox primitives cannot forge acknowledgement of a booking', async t => {
  const { cache, ticket } = await setup(t);
  const p = value(await cache.saveBooking(ticket, input()));
  assert.deepEqual(await cache.updateOutbox(ticket, p.operationId, { status: 'succeeded', attempts: 1 }), { ok: false, error: 'invalid-data' });
});
test('existing timezone validator rejects DST gap and preserves exact UTC slots', () => {
  const gap = effectiveInterval(null, '2026-03-28', '02:15', 30);
  assert.equal(gap.ok, false);
  const exact = effectiveInterval({ startsAt: '2026-10-24T00:30:00Z', endsAt: '2026-10-24T01:00:00Z' }, '2026-10-24', '02:30', 30);
  assert.equal(exact.ok, true);
  if (exact.ok) assert.equal(Date.parse(exact.startsAt), Date.parse('2026-10-24T00:30:00Z'));
});
