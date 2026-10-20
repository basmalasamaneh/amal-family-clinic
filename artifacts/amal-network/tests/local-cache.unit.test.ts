import 'fake-indexeddb/auto';
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import Dexie from 'dexie';
import { LocalCacheController, type InvalidationTransport } from '../src/offline/controller';
import { LocalCacheDatabase, SCHEMA_V1 } from '../src/offline/database';
import { appointmentWindow, formatHebronInstant } from '../src/offline/calendar';
import type { AuthorizedSnapshot, LocalOperation, Result, ScopeTicket } from '../src/offline/types';

// All fixtures are synthetic, not imported from operational or permanently read-only seed tables.
const USER = 'synthetic-account-a';
const CLINIC = 9001;
const AUTH = { userId: USER, clinicId: CLINIC, authorizedUntil: '2027-01-01T00:00:00Z' };
const NOW = '2026-04-02T09:00:00Z';
function value<T>(result: Result<T>): T {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('Expected success');
  return result.value;
}
function error<T>(result: Result<T>, expected: string) {
  assert.deepEqual(result, { ok: false, error: expected });
}
function snapshot(userId = USER, clinicId = CLINIC): AuthorizedSnapshot {
  return {
    userId, clinicId,
    coverage: { startUtc: '2026-03-01T00:00:00Z', endUtc: '2026-06-01T00:00:00Z' },
    doctors: [{ id: 9101, clinicId, name: 'Synthetic Doctor' }],
    patients: [{ id: 9201, clinicId, name: 'Synthetic Patient', phone: '+00000000', dateOfBirth: '1990-05-12' }],
    appointments: [{
      id: 9301, clinicId, doctorId: 9101, patientId: 9201, startsAt: '2026-04-02T10:00:00+03:00',
      endsAt: '2026-04-02T10:15:00+03:00', status: 'booked', version: 1,
    }],
  };
}
function operation(id = '00000000-0000-4000-8000-000000000001'): LocalOperation {
  return {
    operationId: id, type: 'appointment.create', entityId: null,
    payload: { doctorId: 9101, patientId: 9201, startsAt: '2026-04-03T10:00:00+03:00', endsAt: '2026-04-03T10:15:00+03:00', source: 'phone' },
  };
}
async function setup(t: TestContext) {
  const name = `synthetic-cache-${crypto.randomUUID()}`;
  const db = new LocalCacheDatabase(name);
  let now = new Date(NOW);
  const cache = new LocalCacheController({ database: db, now: () => now });
  t.after(async () => { cache.close(); await Dexie.delete(name); });
  value(await cache.setContext(AUTH));
  const ticket = value(cache.captureScope());
  return { cache, db, ticket, setNow: (time: string) => { now = new Date(time); } };
}

test('14 Hebron calendar days use UTC boundaries, including both DST transitions', () => {
  const spring = appointmentWindow(new Date('2026-03-25T12:00:00Z'));
  assert.deepEqual([spring.localStartDate, spring.localEndDate], ['2026-03-25', '2026-04-08']);
  assert.equal((Date.parse(spring.endUtc) - Date.parse(spring.startUtc)) / 3_600_000, 335);
  const autumn = appointmentWindow(new Date('2026-10-21T12:00:00Z'));
  assert.deepEqual([autumn.localStartDate, autumn.localEndDate], ['2026-10-21', '2026-11-04']);
  assert.equal((Date.parse(autumn.endUtc) - Date.parse(autumn.startUtc)) / 3_600_000, 337);
  assert.equal(formatHebronInstant(spring.startUtc), '2026-03-25 00:00');
  assert.equal(formatHebronInstant(spring.endUtc), '2026-04-08 00:00');
  assert.equal(appointmentWindow(new Date('2026-04-01T21:30:00Z')).localStartDate, '2026-04-02');
});

test('allowlisted projections strip clinical data and credentials; instants normalize, DOB stays date-only', async (t) => {
  const { cache, db, ticket } = await setup(t);
  const input = snapshot();
  Object.assign(input, { token: 'SYNTHETIC-DO-NOT-PERSIST' });
  Object.assign(input.patients[0]!, { history: ['SYNTHETIC'], consent: { secret: true }, password: 'SYNTHETIC' });
  Object.assign(input.doctors[0]!, { networkVisible: true, credentials: 'SYNTHETIC' });
  Object.assign(input.appointments[0]!, { notes: 'SYNTHETIC CLINICAL', token: 'SYNTHETIC' });
  value(await cache.replaceSnapshot(ticket, input));
  const stored = value(await cache.readSnapshot(ticket));
  assert.deepEqual(Object.keys(stored.patients[0]!).sort(), ['clinicId', 'dateOfBirth', 'id', 'name', 'phone', 'userId']);
  assert.equal(stored.patients[0]!.dateOfBirth, '1990-05-12');
  assert.equal(stored.appointments[0]!.startsAt, '2026-04-02T07:00:00.000Z');
  assert.equal(stored.fullyCovered, true);
  assert.equal(stored.metadata!.refreshedAt, new Date(NOW).toISOString());
  const all = JSON.stringify(await Promise.all(db.tables.map((table) => table.toArray())));
  assert.ok(!all.includes('SYNTHETIC'));
  assert.ok(!all.includes('history'));
  assert.ok(!all.includes('credentials'));
});

test('strict user/clinic scope, identity-safe keys, missing context and fabricated tickets deny access', async (t) => {
  const { cache, db, ticket } = await setup(t);
  value(await cache.replaceSnapshot(ticket, snapshot()));
  error(await cache.replaceSnapshot(ticket, snapshot('other-user')), 'invalid-data');
  const wrong = snapshot();
  wrong.patients[0]!.clinicId = CLINIC + 1;
  error(await cache.replaceSnapshot(ticket, wrong), 'invalid-data');
  error(await cache.readSnapshot({ ...ticket }), 'stale-context');
  value(await cache.setContext({ ...AUTH, clinicId: CLINIC + 1 }));
  const next = value(cache.captureScope());
  assert.equal(value(await cache.readSnapshot(next)).patients.length, 0);
  value(await cache.replaceSnapshot(next, snapshot(USER, CLINIC + 1)));
  assert.equal(await db.patients.count(), 2);
  value(await cache.setContext({ ...AUTH, userId: 'synthetic-account-b' }));
  assert.equal(value(await cache.readSnapshot(value(cache.captureScope()))).patients.length, 0);
  error(await cache.readSnapshot(ticket), 'stale-context');
  const invalidation = cache.setContext(null);
  error(cache.captureScope(), 'unauthorized'); // Synchronous, before storage completes.
  value(await invalidation);
});

test('unknown/expired authorization fails closed; expiry on access revokes tickets', async (t) => {
  const { cache, ticket, setNow } = await setup(t);
  value(await cache.replaceSnapshot(ticket, snapshot()));
  setNow('2027-02-01T00:00:00Z');
  error(await cache.readSnapshot(ticket), 'unauthorized');
  error(cache.captureScope(), 'unauthorized');
  error(await cache.setContext({ ...AUTH, authorizedUntil: '' }), 'unauthorized');
  error(await cache.setContext({ ...AUTH, authorizedUntil: '2026-01-01T00:00:00Z' }), 'unauthorized');
});

test('14-day pruning is half-open, runs on read/refresh/rollover, and retains outbox rows', async (t) => {
  const { cache, ticket, db, setNow } = await setup(t);
  const input = snapshot();
  const window = appointmentWindow(new Date(NOW));
  const row = input.appointments[0]!;
  input.appointments = [
    { ...row, id: 1, startsAt: window.startUtc, endsAt: new Date(Date.parse(window.startUtc) + 60_000).toISOString() },
    { ...row, id: 2, startsAt: window.endUtc, endsAt: new Date(Date.parse(window.endUtc) + 60_000).toISOString() },
    { ...row, id: 3, startsAt: new Date(Date.parse(window.startUtc) - 1).toISOString(), endsAt: window.startUtc },
  ];
  input.coverage = { startUtc: window.startUtc, endUtc: new Date(Date.parse(window.endUtc) + 86_400_000).toISOString() };
  // Source coverage must honestly include every source row.
  input.coverage.startUtc = new Date(Date.parse(window.startUtc) - 86_400_000).toISOString();
  value(await cache.replaceSnapshot(ticket, input));
  assert.deepEqual(value(await cache.readSnapshot(ticket)).appointments.map((a) => a.id), [1]);
  value(await cache.enqueue(ticket, operation()));
  setNow('2026-04-04T09:00:00Z');
  const next = value(await cache.readSnapshot(ticket));
  assert.equal(next.appointments.length, 0);
  assert.equal(next.fullyCovered, false);
  assert.equal(next.metadata!.refreshedAt, new Date(NOW).toISOString());
  assert.equal(await db.appointments.count(), 0);
  assert.equal(value(await cache.listOutbox(ticket)).length, 1);
  value(await cache.rollover(ticket));
  value(await cache.replaceSnapshot(ticket, snapshot()));
  assert.equal(await db.appointments.count(), 0);
  assert.equal(await db.outbox.count(), 1);
});

test('snapshot validation is atomic; malformed DOB, duplicate IDs and unscoped references reject', async (t) => {
  const { cache, ticket } = await setup(t);
  value(await cache.replaceSnapshot(ticket, snapshot()));
  for (const mutate of [
    (s: AuthorizedSnapshot) => { s.patients[0]!.dateOfBirth = '1990-02-31'; },
    (s: AuthorizedSnapshot) => { s.doctors = [...s.doctors, s.doctors[0]!]; },
    (s: AuthorizedSnapshot) => { s.appointments[0]!.patientId = 12345; },
    (s: AuthorizedSnapshot) => { s.appointments[0]!.startsAt = '2026-04-02 10:00'; },
  ]) {
    const input = snapshot();
    mutate(input);
    error(await cache.replaceSnapshot(ticket, input), 'invalid-data');
    assert.equal(value(await cache.readSnapshot(ticket)).appointments.length, 1);
  }
});

test('stale fetch tickets cannot write after same-identity reset; in-flight transactions abort', async (t) => {
  const { cache, db, ticket } = await setup(t);
  value(await cache.setContext(AUTH));
  error(await cache.replaceSnapshot(ticket, snapshot()), 'stale-context');
  const current = value(cache.captureScope());
  let revoke: Promise<Result<void>> | undefined;
  const hook = () => { revoke = cache.setContext(null); };
  db.patients.hook('creating', hook);
  error(await cache.replaceSnapshot(current, snapshot()), 'stale-context');
  db.patients.hook('creating').unsubscribe(hook);
  assert.ok(revoke);
  value(await revoke!);
  assert.equal(await db.patients.count(), 0);
  assert.equal(await db.doctors.count(), 0);
  assert.equal(await db.appointments.count(), 0);
});

test('outbox is scoped, minimal, idempotent, ordered, and explicitly updated without replay', async (t) => {
  const { cache, ticket, db, setNow } = await setup(t);
  const input = operation();
  Object.assign(input.payload, { notes: 'SYNTHETIC PRIVATE', sessionToken: 'SYNTHETIC' });
  const first = value(await cache.enqueue(ticket, input));
  assert.deepEqual(value(await cache.enqueue(ticket, input)), first);
  const conflict = operation();
  conflict.payload.startsAt = '2026-04-03T06:00:00Z';
  error(await cache.enqueue(ticket, conflict), 'invalid-data');
  setNow('2026-04-02T10:00:00Z');
  value(await cache.enqueue(ticket, operation('00000000-0000-4000-8000-000000000002')));
  value(await cache.updateOutbox(ticket, first.operationId, {
    status: 'failed', attempts: 1, retryAt: '2026-04-02T11:00:00Z', errorCode: 'network',
  }));
  const rows = value(await cache.listOutbox(ticket));
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.operationId, first.operationId);
  assert.equal(rows[0]!.attempts, 1);
  assert.equal(rows[0]!.retryAt, '2026-04-02T11:00:00.000Z');
  assert.equal(rows[0]!.enqueuedAt, new Date(NOW).toISOString());
  assert.equal(rows[0]!.updatedAt, '2026-04-02T10:00:00.000Z');
  assert.equal(value(await cache.listOutbox(ticket, 'pending')).length, 1);
  error(await cache.updateOutbox(ticket, first.operationId, { status: 'failed', attempts: 0 }), 'invalid-data');
  assert.ok(!JSON.stringify(await db.outbox.toArray()).includes('SYNTHETIC'));
  value(await cache.replaceSnapshot(ticket, snapshot()));
  assert.equal(await db.outbox.count(), 2);
});

test('logout counts pending across all clinics, requires discard, clears all current-user scopes only', async (t) => {
  const { cache, ticket, db } = await setup(t);
  value(await cache.replaceSnapshot(ticket, snapshot()));
  value(await cache.enqueue(ticket, operation()));
  value(await cache.setContext({ ...AUTH, clinicId: CLINIC + 1 }));
  let active = value(cache.captureScope());
  value(await cache.replaceSnapshot(active, snapshot(USER, CLINIC + 1)));
  value(await cache.enqueue(active, operation()));
  value(await cache.setContext({ ...AUTH, userId: 'synthetic-account-b' }));
  active = value(cache.captureScope());
  value(await cache.replaceSnapshot(active, snapshot('synthetic-account-b')));
  value(await cache.enqueue(active, operation()));
  value(await cache.setContext(AUTH));
  active = value(cache.captureScope());
  assert.equal(value(await cache.pendingCount(active)), 2);
  error(await cache.logout(), 'pending-outbox');
  assert.equal(await db.outbox.count(), 3);
  error(cache.captureScope(), 'unauthorized');
  value(await cache.setContext(null));
  value(await cache.logout({ discardPending: true }));
  for (const table of [db.appointments, db.doctors, db.patients, db.metadata, db.outbox]) {
    assert.equal(await table.where('userId').equals(USER).count(), 0);
    assert.equal(await table.where('userId').equals('synthetic-account-b').count(), 1);
  }
});

test('storage probe/subscription surfaces sanitized errors and quota abort preserves snapshot', async (t) => {
  const { cache, db, ticket } = await setup(t);
  const seen: string[] = [];
  const off = cache.subscribeStorage(() => seen.push(cache.getStorageStatus().state));
  value(await cache.probe());
  assert.deepEqual(seen, ['checking', 'ready']);
  off();
  value(await cache.probe());
  assert.equal(seen.length, 2);
  value(await cache.replaceSnapshot(ticket, snapshot()));
  const hook = () => { throw new DOMException('SYNTHETIC SECRET RAW ERROR', 'QuotaExceededError'); };
  db.doctors.hook('creating', hook);
  const quota = await cache.replaceSnapshot(ticket, snapshot());
  error(quota, 'storage-quota');
  assert.ok(!JSON.stringify(quota).includes('SECRET'));
  db.doctors.hook('creating').unsubscribe(hook);
  assert.equal(value(await cache.readSnapshot(ticket)).patients.length, 1);
  assert.equal(cache.getStorageStatus().state, 'error');
  value(await cache.probe());
  assert.equal(cache.getStorageStatus().state, 'ready');

  const unavailable = new LocalCacheDatabase(`synthetic-disabled-${crypto.randomUUID()}`);
  unavailable.open = (() => Promise.reject(Object.assign(new Error('SYNTHETIC RAW'), { name: 'MissingAPIError' }))) as typeof unavailable.open;
  const disabled = new LocalCacheController({ database: unavailable });
  t.after(() => disabled.close());
  error(await disabled.probe(), 'storage-unavailable');
  error(await disabled.setContext(AUTH), 'storage-unavailable');
  error(disabled.captureScope(), 'unauthorized');
});

test('v1 -> v2 nondestructive migration preserves patient/cache and pending operation', async (t) => {
  const name = `synthetic-migration-${crypto.randomUUID()}`;
  const old = new Dexie(name);
  old.version(1).stores(SCHEMA_V1);
  await old.open();
  const scope = { userId: USER, clinicId: CLINIC };
  await old.table('patients').put({ ...scope, ...snapshot().patients[0]! });
  await old.table('doctors').put({ ...scope, ...snapshot().doctors[0]! });
  await old.table('appointments').put({
    ...scope, ...snapshot().appointments[0]!,
    startsAt: '2026-04-02T07:00:00.000Z', endsAt: '2026-04-02T07:15:00.000Z',
  });
  await old.table('outbox').put({
    ...scope, ...operation(), enqueuedAt: NOW, updatedAt: NOW,
    status: 'pending', attempts: 0, retryAt: null, errorCode: null,
  });
  old.close();
  const db = new LocalCacheDatabase(name);
  const cache = new LocalCacheController({ database: db, now: () => new Date(NOW) });
  t.after(async () => { cache.close(); await Dexie.delete(name); });
  value(await cache.setContext(AUTH));
  const ticket = value(cache.captureScope());
  assert.equal(db.verno, 2);
  assert.equal(value(await cache.readSnapshot(ticket)).patients.length, 1);
  assert.equal(value(await cache.listOutbox(ticket)).length, 1);
  assert.ok(db.outbox.schema.indexes.some((index) => index.name === '[userId+clinicId+status+enqueuedAt]'));
});

test('blocked upgrade returns promptly with storage-blocked, without deleting old records', { timeout: 4000 }, async (t) => {
  const name = `synthetic-blocked-${crypto.randomUUID()}`;
  const old = new Dexie(name);
  old.version(1).stores(SCHEMA_V1);
  await old.open();
  await old.table('patients').put({ userId: USER, ...snapshot().patients[0]! });
  old.close();
  const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 10);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const db = new LocalCacheDatabase(name);
  const cache = new LocalCacheController({ database: db });
  t.after(async () => { blocker.close(); cache.close(); await Dexie.delete(name); });
  error(await cache.probe(), 'storage-blocked');
  assert.deepEqual(cache.getStorageStatus(), { state: 'error', error: 'storage-blocked' });
  await new Promise<void>((resolve) => {
    db.on('ready', () => { resolve(); });
    blocker.close();
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  value(await cache.probe());
  assert.equal(await db.patients.count(), 1);
});

test('cross-tab messages immediately revoke context; persisted revision rejects stale tabs even without messages', async (t) => {
  const { cache, db, ticket } = await setup(t);
  value(await cache.replaceSnapshot(ticket, snapshot()));
  const secondDb = new LocalCacheDatabase(db.name);
  const second = new LocalCacheController({ database: secondDb, now: () => new Date(NOW) });
  t.after(() => second.close());
  value(await second.setContext(AUTH));
  error(await cache.readSnapshot(ticket), 'stale-context');
  error(cache.captureScope(), 'unauthorized');

  const listeners = new Set<() => void>();
  const transport: InvalidationTransport = {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    post() {}, close() {},
  };
  const thirdDb = new LocalCacheDatabase(`synthetic-tab-${crypto.randomUUID()}`);
  const third = new LocalCacheController({ database: thirdDb, transport, now: () => new Date(NOW) });
  t.after(async () => { third.close(); await Dexie.delete(thirdDb.name); });
  value(await third.setContext(AUTH));
  const thirdTicket = value(third.captureScope());
  let notifications = 0;
  const off = third.subscribeContext(() => { ++notifications; });
  listeners.forEach((notify) => notify());
  assert.equal(notifications, 1);
  error(third.captureScope(), 'unauthorized');
  error(await third.readSnapshot(thirdTicket), 'stale-context');
  off();
});

test('logout revocation persists across tabs even when pending-outbox confirmation rejects deletion', async (t) => {
  const { cache, db, ticket } = await setup(t);
  value(await cache.enqueue(ticket, operation()));
  const peerDb = new LocalCacheDatabase(db.name);
  const peer = new LocalCacheController({ database: peerDb, now: () => new Date(NOW) });
  t.after(() => peer.close());
  value(await peer.setContext(AUTH));
  const peerTicket = value(peer.captureScope());
  error(await cache.logout(), 'pending-outbox');
  error(await peer.listOutbox(peerTicket), 'stale-context');
  assert.equal(await db.outbox.count(), 1);
});

test('explicit user cleanup works without a successful authorized clinic context and grants no reads', async (t) => {
  const { cache, db, ticket } = await setup(t);
  value(await cache.replaceSnapshot(ticket, snapshot()));
  value(await cache.enqueue(ticket, operation()));
  cache.close();
  const cleanupDb = new LocalCacheDatabase(db.name);
  const cleanup = new LocalCacheController({ database: cleanupDb, now: () => new Date(NOW) });
  t.after(() => cleanup.close());
  error(cleanup.captureScope(), 'unauthorized');
  error(await cleanup.setContext({ ...AUTH, authorizedUntil: '' }), 'unauthorized');
  error(await cleanup.logout({ userId: USER }), 'pending-outbox');
  assert.equal(await cleanupDb.patients.count(), 1);
  value(await cleanup.logout({ userId: USER, discardPending: true }));
  assert.equal(await cleanupDb.patients.count(), 0);
  assert.equal(await cleanupDb.outbox.count(), 0);
  error(cleanup.captureScope(), 'unauthorized');
});
