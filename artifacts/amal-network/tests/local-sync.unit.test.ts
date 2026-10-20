import 'fake-indexeddb/auto';
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { LocalCacheController } from '../src/offline/controller';
import { LocalCacheDatabase } from '../src/offline/database';
import { appointmentWindow } from '../src/offline/calendar';
import type { Result } from '../src/offline/types';
import type { SyncConflict, SyncPullResult, Appointment } from '@workspace/api-client-react';

const now = new Date('2026-10-20T08:00:00Z');
const auth = { userId: 'account:71', clinicId: 701, authorizedUntil: '2026-10-20T16:00:00Z' };
const window = appointmentWindow(now);
function value<T>(r: Result<T>): T { assert.equal(r.ok, true, JSON.stringify(r)); if (!r.ok) throw Error(r.error); return r.value; }
async function setup(t: TestContext) {
  const db = new LocalCacheDatabase(`sync-${randomUUID()}`);
  const cache = new LocalCacheController({ database: db, now: () => now });
  value(await cache.setContext(auth));
  const ticket = value(cache.captureScope());
  value(await cache.replaceSnapshot(ticket, { ...auth,
    doctors: [{ id: 801, clinicId: 701, name: 'Synthetic doctor' }],
    patients: [{ id: 901, clinicId: 701, name: 'Synthetic patient', phone: '000000', dateOfBirth: '1990-01-01' }],
    appointments: [], coverage: { startUtc: window.startUtc, endUtc: window.endUtc } }));
  value(await cache.prepareBookingStream(ticket, { deviceId: 4001, nextSequence: 1 }));
  const p = value(await cache.saveBooking(ticket, { clientOpId: randomUUID(), clinicId: 701, doctorId: 801, patientId: 901,
    startsAt: '2026-10-20T10:00:00.000Z', endsAt: '2026-10-20T10:30:00.000Z', source: 'phone' }));
  const conflict: SyncConflict = { id: randomUUID(), clientOpId: p.operationId,
    operation: { target: 'create', payload: p.input }, targetId: null, baseVersion: null, serverState: null,
    reasons: [], status: 'open', version: 1, createdAt: now.toISOString(), updatedAt: now.toISOString(), history: [] };
  const a: Appointment = { ...p.input, id: 8000, version: 1, status: 'booked' };
  t.after(async () => { cache.close(); await db.delete(); });
  return { db, cache, ticket, p, conflict, a };
}
function page(a: Appointment): SyncPullResult {
  return { changes: [{ id: '1', kind: 'appointment', entityId: String(a.id),
    payload: { ...a, clientOpId: a.clientOpId ?? null, deleted: false } }], nextCursor: null, since: 'opaque-cursor' };
}

test('pull commits cursor and tombstones atomically, never acknowledges a proposal or invents coverage', async t => {
  const { db, cache, ticket, a } = await setup(t);
  value(await cache.resetSyncCursor(ticket));
  value(await cache.applySyncPage(ticket, page(a)));
  assert.equal((await db.appointments.toArray())[0].id, a.id);
  assert.equal(value(await cache.readSyncState(ticket)).cursor, 'opaque-cursor');
  assert.equal(value(await cache.readSnapshot(ticket)).fullyCovered, false);
  assert.equal((await db.proposals.toArray())[0].outcome, 'pending');
  const tombstone = page(a);
  if (tombstone.changes[0].kind === 'appointment') tombstone.changes[0].payload.deleted = true;
  value(await cache.applySyncPage(ticket, tombstone));
  assert.equal(await db.appointments.count(), 0);
  assert.equal(await db.proposals.count(), 1);
});

test('malformed partial pull or wrong scope rolls back every row and cursor', async t => {
  const { db, cache, ticket, a } = await setup(t);
  const bad = page(a);
  bad.changes.push({ ...bad.changes[0], id: '2', entityId: '999' });
  assert.deepEqual(await cache.applySyncPage(ticket, bad), { ok: false, error: 'invalid-data' });
  assert.equal(await db.appointments.count(), 0);
  assert.equal(value(await cache.readSyncState(ticket)).cursor, null);
  assert.deepEqual(await cache.applySyncPage(ticket, page({ ...a, clinicId: 999 })), { ok: false, error: 'invalid-data' });
});

test('storage abort cannot advance the pull cursor', async t => {
  const { db, cache, ticket, a } = await setup(t);
  const fail = () => { throw new DOMException('quota', 'QuotaExceededError'); };
  db.syncCursors.hook('creating', fail);
  assert.deepEqual(await cache.applySyncPage(ticket, page(a)), { ok: false, error: 'storage-quota' });
  assert.equal(await db.appointments.count(), 0);
  db.syncCursors.hook('creating').unsubscribe(fail);
});

test('conflict disappearance is never inferred and partial invalid conflict pages roll back', async t => {
  const { cache, ticket, conflict } = await setup(t);
  value(await cache.reconcileConflicts(ticket, [conflict]));
  value(await cache.reconcileConflicts(ticket, []));
  assert.equal(value(await cache.readSyncState(ticket)).conflicts.length, 1);
  const other = { ...conflict, id: randomUUID() };
  assert.deepEqual(await cache.reconcileConflicts(ticket, [other, { ...conflict, version: 0 }]), { ok: false, error: 'invalid-data' });
  assert.equal(value(await cache.readSyncState(ticket)).conflicts.length, 1);
});

test('resolution intent freezes payload, blocks ambiguous duplicates, survives reopen and permits explicit rejection', async t => {
  const { db, cache, ticket, conflict } = await setup(t);
  value(await cache.reconcileConflicts(ticket, [conflict]));
  const input = { action: 'call' as const, clientOpId: randomUUID(), conflictId: conflict.id, expectedVersion: 1 };
  const intent = value(await cache.saveResolutionIntent(ticket, input));
  assert.deepEqual(value(await cache.saveResolutionIntent(ticket, input)), intent);
  assert.equal((await cache.saveResolutionIntent(ticket, { ...input, clientOpId: randomUUID() })).ok, false);
  assert.equal((await cache.saveResolutionIntent(ticket, { ...input, expectedVersion: 2 })).ok, false);
  const reopened = new LocalCacheDatabase(db.name);
  await reopened.open();
  assert.deepEqual((await reopened.resolutionIntents.toArray())[0], intent);
  reopened.close();
  value(await cache.rejectResolutionIntent(ticket, input.clientOpId));
  value(await cache.saveResolutionIntent(ticket, { ...input, clientOpId: randomUUID() }));
  assert.deepEqual(value(await cache.readSyncState(ticket)).intents.map(i => i.status).sort(), ['pending', 'rejected']);
});

test('malformed resolution remains pending, call records follow-up without any persisted phone', async t => {
  const { db, cache, ticket, conflict } = await setup(t);
  value(await cache.reconcileConflicts(ticket, [conflict]));
  const input = { action: 'call' as const, clientOpId: randomUUID(), conflictId: conflict.id, expectedVersion: 1 };
  value(await cache.saveResolutionIntent(ticket, input));
  const result = { status: 'follow-up' as const, conflictId: conflict.id, patientId: 901, called: false as const, version: 2, phone: 'sensitive-phone' };
  assert.equal((await cache.finishResolutionIntent(ticket, input.clientOpId, { ...result, conflictId: 'wrong' })).ok, false);
  assert.equal(value(await cache.readSyncState(ticket)).intents[0].status, 'pending');
  value(await cache.finishResolutionIntent(ticket, input.clientOpId, result));
  value(await cache.finishResolutionIntent(ticket, input.clientOpId, result));
  const state = value(await cache.readSyncState(ticket));
  assert.equal(state.conflicts[0].status, 'open');
  assert.equal(state.conflicts[0].version, 2);
  assert.equal(JSON.stringify(state).includes('sensitive-phone'), false);
  assert.equal(JSON.stringify(await db.resolutionIntents.toArray()).includes('"phone"'), false);
});

test('explicit resolution accepts new booking id/time and retains original canonical evidence', async t => {
  const { db, cache, ticket, conflict, p, a } = await setup(t);
  value(await cache.acknowledgeBooking(ticket, p.operationId, { status: 'applied', clientOpId: p.operationId, sequence: p.sequence, result: a }));
  value(await cache.reconcileConflicts(ticket, [conflict]));
  const input = { action: 'move-self' as const, clientOpId: randomUUID(), conflictId: conflict.id, expectedVersion: 1,
    startsAt: '2026-10-20T12:00:00.000Z', endsAt: '2026-10-20T12:30:00.000Z' };
  value(await cache.saveResolutionIntent(ticket, input));
  const resolved = { ...a, id: 8001, clientOpId: randomUUID(), startsAt: input.startsAt, endsAt: input.endsAt };
  value(await cache.finishResolutionIntent(ticket, input.clientOpId,
    { status: 'resolved', conflictId: conflict.id, appointment: resolved, version: 2 }));
  const stored = (await db.proposals.toArray())[0];
  assert.equal(stored.canonical?.id, 8001);
  assert.deepEqual(stored.canonicalHistory?.map(h => h.id), [8000, 8001]);
  assert.equal(stored.input.startsAt, p.input.startsAt);
  assert.equal((await db.outbox.toArray())[0].status, 'succeeded');
});

test('resolution elsewhere reconciles original proposal via history, not resolution clientOpId', async t => {
  const { db, cache, ticket, conflict, a } = await setup(t);
  const resolved = { ...a, id: 8001, clientOpId: randomUUID(), startsAt: '2026-10-20T12:00:00.000Z', endsAt: '2026-10-20T12:30:00.000Z' };
  value(await cache.reconcileConflicts(ticket, [{ ...conflict, version: 2, status: 'resolved',
    history: [{ id: '1', clientOpId: randomUUID(), action: 'move-self', createdAt: now.toISOString(),
      result: { status: 'resolved', conflictId: conflict.id, version: 2, appointment: resolved } }] }]));
  assert.equal((await db.proposals.toArray())[0].canonical?.id, 8001);
  value(await cache.resetSyncCursor(ticket));
  assert.equal((await db.proposals.toArray())[0].canonical?.id, 8001);
});

test('progress persists safely and stale auth tickets cannot update it', async t => {
  const { cache, ticket, p } = await setup(t);
  value(await cache.markBookingAttempt(ticket, p.operationId, 'processing', null, null));
  value(await cache.markBookingAttempt(ticket, p.operationId, 'failed', '2026-10-20T09:00:00Z', 'network'));
  assert.equal(value(await cache.listOutbox(ticket))[0].errorCode, 'network');
  value(await cache.setContext(auth));
  assert.deepEqual(await cache.markBookingAttempt(ticket, p.operationId, 'processing', null, null), { ok: false, error: 'stale-context' });
});

test('wrong actor feed and foreign resolution cannot write private records', async t => {
  const { db, cache, ticket, conflict, a } = await setup(t);
  assert.equal((await cache.applySyncPage(ticket, { since: 'bad', nextCursor: null, changes: [{
    id: '1', kind: 'conflict', entityId: conflict.id,
    payload: { id: conflict.id, actorId: 72, status: 'open', version: 1, clientOpId: conflict.clientOpId },
  }] })).ok, false);
  value(await cache.reconcileConflicts(ticket, [conflict]));
  const input = { action: 'move-self' as const, clientOpId: randomUUID(), conflictId: conflict.id, expectedVersion: 1,
    startsAt: a.startsAt, endsAt: a.endsAt };
  value(await cache.saveResolutionIntent(ticket, input));
  assert.equal((await cache.finishResolutionIntent(ticket, input.clientOpId, {
    status: 'resolved', conflictId: conflict.id, version: 2, appointment: { ...a, patientId: 902 },
  })).ok, false);
  assert.equal(value(await cache.readSyncState(ticket)).intents[0].status, 'pending');
  assert.equal((await db.proposals.toArray())[0].canonical, null);
});

test('persisted epoch rejects sync writes from another reauthorized tab', async t => {
  const { db, cache, ticket, a } = await setup(t);
  const peerDb = new LocalCacheDatabase(db.name);
  const peer = new LocalCacheController({ database: peerDb, now: () => now });
  t.after(() => peer.close());
  value(await peer.setContext(auth));
  assert.deepEqual(await cache.applySyncPage(ticket, page(a)), { ok: false, error: 'stale-context' });
  assert.equal(await peerDb.appointments.count(), 0);
  assert.equal(await peerDb.syncCursors.count(), 0);
});

test('tombstones survive reset and old bootstrap upserts; only newer feed upsert revives', async t => {
  const { db, cache, ticket, a, p } = await setup(t);
  value(await cache.acknowledgeBooking(ticket, p.operationId,
    { status: 'applied', clientOpId: p.operationId, sequence: p.sequence, result: a }));
  const deletion = page(a);
  deletion.changes[0].id = '20';
  if (deletion.changes[0].kind === 'appointment') deletion.changes[0].payload.deleted = true;
  value(await cache.applySyncPage(ticket, deletion));
  assert.deepEqual(value(await cache.readSyncState(ticket)).tombstoneIds, [a.id]);
  value(await cache.resetSyncCursor(ticket));
  value(await cache.applySyncPage(ticket, page(a)));
  assert.equal(await db.appointments.count(), 0);
  assert.deepEqual(value(await cache.readSyncState(ticket)).tombstoneIds, [a.id]);
  assert.equal((await db.proposals.toArray())[0].canonical?.id, a.id); // evidence retained; bridge filters by tombstoneIds
  const next = page(a);
  next.changes[0].id = '21';
  value(await cache.applySyncPage(ticket, next));
  assert.equal(await db.appointments.count(), 1);
  assert.deepEqual(value(await cache.readSyncState(ticket)).tombstoneIds, []);
});

test('tombstone and cursor changes roll back together on storage failure', async t => {
  const { db, cache, ticket, a } = await setup(t);
  value(await cache.applySyncPage(ticket, page(a)));
  const deletion = page(a);
  deletion.since = 'new-cursor';
  deletion.changes[0].id = '20';
  if (deletion.changes[0].kind === 'appointment') deletion.changes[0].payload.deleted = true;
  const fail = () => { throw new DOMException('quota', 'QuotaExceededError'); };
  db.syncCursors.hook('updating', fail);
  assert.equal((await cache.applySyncPage(ticket, deletion)).ok, false);
  db.syncCursors.hook('updating').unsubscribe(fail);
  assert.equal(await db.appointments.count(), 1);
  const state = value(await cache.readSyncState(ticket));
  assert.equal(state.cursor, 'opaque-cursor');
  assert.deepEqual(state.tombstoneIds, []);
});
