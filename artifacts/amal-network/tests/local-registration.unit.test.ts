import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { LocalCacheController } from '../src/offline/controller';
import { LocalCacheDatabase, SCHEMA_V1 } from '../src/offline/database';
import { appointmentWindow } from '../src/offline/calendar';
import { SyncRunner, type SyncTransport } from '../src/sync/runner';
import type { Result, AuthorizedSnapshot } from '../src/offline/types';
import type { PatientInput, AppointmentInput } from '@workspace/api-client-react';

const now = new Date('2026-10-20T08:00:00Z');
const auth = { userId: 'registration-test', clinicId: 701, authorizedUntil: '2026-10-20T16:00:00Z' };
const window = appointmentWindow(now);
const snapshot: AuthorizedSnapshot = { userId: auth.userId, clinicId: auth.clinicId,
  doctors: [{ id: 801, clinicId: 701, name: 'Test doctor' }], patients: [], appointments: [],
  coverage: { startUtc: window.startUtc, endUtc: window.endUtc } };
function value<T>(r: Result<T>): T { if (!r.ok) assert.fail(r.error); return r.value; }
const input = (): PatientInput => ({ clientOpId: randomUUID(), name: 'Test patient', phone: '0599000000', dateOfBirth: '1990-01-01' });
const booking = (patientId: number, hour = 10): AppointmentInput => ({
  clientOpId: randomUUID(), clinicId: 701, doctorId: 801, patientId, source: 'walk-in',
  startsAt: `2026-10-20T${hour}:00:00.000Z`, endsAt: `2026-10-20T${hour}:30:00.000Z`,
});
async function setup(t: TestContext) {
  const db = new LocalCacheDatabase(`registration-${randomUUID()}`);
  let clock = now;
  const cache = new LocalCacheController({ database: db, now: () => clock });
  value(await cache.setContext(auth));
  const ticket = value(cache.captureScope());
  value(await cache.replaceSnapshot(ticket, snapshot));
  value(await cache.prepareBookingStream(ticket, { deviceId: 12, nextSequence: 1 }));
  t.after(async () => { cache.close(); await db.delete(); });
  return { cache, db, ticket, expire: () => { clock = new Date(auth.authorizedUntil); } };
}

test('registration retains exact id/payload, reload and refresh; mapping freezes only delivery input', async t => {
  const { cache, db, ticket } = await setup(t);
  const i = input();
  const r = value(await cache.savePatientRegistration(ticket, i));
  assert.ok(r.localId < 0);
  assert.equal(value(await cache.savePatientRegistration(ticket, i)).localId, r.localId);
  assert.equal((await db.streams.get(12))?.nextSequence, 1);
  assert.equal((await cache.savePatientRegistration(ticket, { ...i, name: 'Different' })).ok, false);
  const p = value(await cache.saveBooking(ticket, booking(r.localId)));
  assert.equal(value(await cache.beginBookingDelivery(ticket, p.operationId)), null);
  assert.equal(value(await cache.listOutbox(ticket))[0]?.payload.patientId, r.localId);
  value(await cache.replaceSnapshot(ticket, snapshot));
  value(await cache.resetSyncCursor(ticket));
  value(await cache.replaceSnapshot(ticket, snapshot));
  assert.equal(value(await cache.readSnapshot(ticket)).patients[0]?.id, r.localId);
  const reopened = new LocalCacheDatabase(db.name);
  await reopened.open();
  assert.deepEqual((await reopened.registrations.toArray())[0]?.input, i);
  reopened.close();
  const canonical = { id: 901, clinicId: 701, name: 'Canonical name', phone: i.phone, dateOfBirth: i.dateOfBirth };
  value(await cache.acknowledgePatientRegistration(ticket, i.clientOpId, canonical));
  const op = value(await cache.beginBookingDelivery(ticket, p.operationId))!;
  assert.equal(op.input.patientId, 901);
  assert.deepEqual(value(await cache.beginBookingDelivery(ticket, p.operationId)), op);
  value(await cache.acknowledgeBooking(ticket, p.operationId, {
    clientOpId: p.operationId, sequence: p.sequence, status: 'applied',
    result: { ...op.input, id: 1234, status: 'booked', version: 1 },
  }));
  const stored = value(await cache.listBookings(ticket))[0]!;
  assert.equal(stored.input.patientId, r.localId);
  assert.equal(stored.canonical?.patientId, 901);
  value(await cache.replaceSnapshot(ticket, snapshot));
  assert.equal(value(await cache.readSnapshot(ticket)).patients[0]?.name, 'Canonical name');
});

test('invalid DOB/phone/minor guardian, forged negative and canonical negative are rejected', async t => {
  const { cache, ticket } = await setup(t);
  for (const patch of [{ dateOfBirth: '' }, { dateOfBirth: '2026-02-30' }, { dateOfBirth: '2027-01-01' },
    { phone: 'bad' }, { dateOfBirth: '2020-01-01' }, { dateOfBirth: '2020-01-01', guardianName: 'Guardian' }]) {
    assert.deepEqual(await cache.savePatientRegistration(ticket, { ...input(), ...patch }), { ok: false, error: 'invalid-data' });
  }
  value(await cache.savePatientRegistration(ticket, { ...input(), dateOfBirth: '2020-01-01', guardianName: 'Guardian', guardianRelation: 'mother' }));
  assert.deepEqual(await cache.saveBooking(ticket, booking(-999)), { ok: false, error: 'identity-not-cached' });
  assert.equal((await cache.replaceSnapshot(ticket, { ...snapshot, patients: [{
    id: -1, clinicId: 701, name: 'Forged', phone: '000', dateOfBirth: '2000-01-01',
  }] })).ok, false);
});

test('rejected dependent blocks later device work; pending registrations prevent logout deletion', async t => {
  const { cache, ticket, db } = await setup(t);
  const r = value(await cache.savePatientRegistration(ticket, input()));
  const first = value(await cache.saveBooking(ticket, booking(r.localId)));
  const second = value(await cache.saveBooking(ticket, booking(r.localId, 11)));
  value(await cache.markPatientRegistration(ticket, r.clientOpId, 'rejected'));
  assert.equal(value(await cache.beginBookingDelivery(ticket, first.operationId)), null);
  assert.equal(value(await cache.beginBookingDelivery(ticket, second.operationId)), null);
  assert.equal(value(await cache.pendingCount(ticket)), 3);
  value(await cache.retryPatientRegistration(ticket, r.clientOpId));
  assert.equal(value(await cache.listPatientRegistrations(ticket))[0]?.status, 'pending');
  assert.deepEqual(await cache.logout(), { ok: false, error: 'pending-outbox' });
  assert.equal(await db.registrations.count(), 1);
});

test('stale tickets, other scope, and expiry cannot register or acknowledge mappings', async t => {
  const { cache, ticket, expire } = await setup(t);
  const r = value(await cache.savePatientRegistration(ticket, input()));
  value(await cache.setContext({ ...auth, userId: 'another-owner' }));
  assert.deepEqual(await cache.savePatientRegistration(ticket, input()), { ok: false, error: 'stale-context' });
  const other = value(cache.captureScope());
  assert.equal(value(await cache.listPatientRegistrations(other)).length, 0);
  assert.equal((await cache.acknowledgePatientRegistration(other, r.clientOpId, {
    ...r.patient, id: 901,
  })).ok, false);
  expire();
  assert.equal((await cache.savePatientRegistration(other, input())).ok, false);
});

test('revocation at registration commit rolls back private input and temporary counter', async t => {
  const { cache, db, ticket } = await setup(t);
  let revoked: Promise<Result<void>> | undefined;
  db.registrations.hook('creating', () => { revoked = cache.setContext(null); });
  assert.equal((await cache.savePatientRegistration(ticket, input())).ok, false);
  await revoked;
  assert.equal(await db.registrations.count(), 0);
  assert.equal(await db.lifecycle.get('registration-local-id'), undefined);
});

test('only exact canonical clinic can map; negative or mismatched acknowledgements preserve intent', async t => {
  const { cache, ticket } = await setup(t);
  const r = value(await cache.savePatientRegistration(ticket, input()));
  const p = value(await cache.saveBooking(ticket, booking(r.localId)));
  for (const patient of [{ ...r.patient, id: 900, clinicId: 702 }, r.patient]) {
    assert.equal((await cache.acknowledgePatientRegistration(ticket, r.clientOpId, patient)).ok, false);
  }
  value(await cache.acknowledgePatientRegistration(ticket, r.clientOpId, { ...r.patient, id: 900 }));
  const op = value(await cache.beginBookingDelivery(ticket, p.operationId))!;
  assert.equal((await cache.acknowledgeBooking(ticket, p.operationId, {
    clientOpId: p.operationId, sequence: p.sequence, status: 'applied',
    result: { ...op.input, patientId: 999, id: 1234, status: 'booked', version: 1 },
  })).ok, false);
  assert.equal(value(await cache.listBookings(ticket))[0]?.canonical, null);
  assert.equal((await cache.acknowledgePatientRegistration(ticket, r.clientOpId, { ...r.patient, id: 901 })).ok, false);
  assert.deepEqual(value(await cache.beginBookingDelivery(ticket, p.operationId)), op);
});

test('v5 upgrade preserves outbox and sequence, adds empty registration store', async t => {
  const name = `registration-v5-${randomUUID()}`;
  const old = new Dexie(name);
  old.version(5).stores({ ...SCHEMA_V1, lifecycle: 'key', streams: 'deviceId' });
  await old.open();
  await old.table('streams').put({ deviceId: 12, nextSequence: 44 });
  await old.table('outbox').put({ userId: auth.userId, clinicId: 701, operationId: 'legacy-evidence', status: 'failed' });
  old.close();
  const db = new LocalCacheDatabase(name);
  t.after(async () => { db.close(); await db.delete(); });
  await db.open();
  assert.equal(await db.registrations.count(), 0);
  assert.equal((await db.streams.get(12))?.nextSequence, 44);
  assert.equal(await db.outbox.count(), 1);
});

test('lost registration reply retries exact payload under queue lock before positive-only booking delivery', async t => {
  const { cache, ticket } = await setup(t);
  const i = input();
  const r = value(await cache.savePatientRegistration(ticket, i));
  value(await cache.saveBooking(ticket, booking(r.localId)));
  let calls = 0, pushes = 0, locked = false;
  const api: SyncTransport = {
    state: async () => ({ deviceId: 12, nextSequence: 1 }),
    pull: async () => ({ changes: [], nextCursor: null, since: '0' }),
    conflicts: async () => ({ items: [], nextCursor: null }),
    resolve: async () => { throw Error('unused'); },
    registerPatient: async payload => {
      assert.equal(locked, true);
      assert.deepEqual(payload, i);
      if (++calls === 1) throw Error('lost reply after commit');
      return { id: 901, clinicId: 701, name: 'Canonical', phone: i.phone, dateOfBirth: i.dateOfBirth };
    },
    push: async operations => {
      pushes++;
      assert.equal(calls, 2);
      const op = operations[0]!;
      assert.equal(op.type, 'create');
      assert.ok('patientId' in op.input && op.input.patientId === 901);
      return { outcomes: [{ clientOpId: op.input.clientOpId, sequence: op.sequence, status: 'applied',
        result: { ...op.input, id: 1234, status: 'booked', version: 1 } }], nextSequence: 2 } as never;
    },
  };
  const runner = new SyncRunner(cache, api, async (_id, _signal, work) => {
    locked = true; try { return await work(); } finally { locked = false; }
  }, () => true, () => assert.fail('unexpected auth'));
  t.after(() => runner.close());
  async function wait(phase: string) {
    for (let n = 0; n < 200; n++) {
      if (runner.getSnapshot().phase === phase) return;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail(`runner did not reach ${phase}: ${JSON.stringify(runner.getSnapshot())}`);
  }
  runner.start(ticket, true);
  await wait('error');
  assert.equal(pushes, 0);
  runner.retry();
  await wait('idle');
  assert.equal(pushes, 1);
  assert.equal(value(await cache.listPatientRegistrations(ticket))[0]?.status, 'applied');
});
