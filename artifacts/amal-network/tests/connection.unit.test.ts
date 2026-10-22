import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectionState, summarizeQueue } from '../src/shell/connection-model';
import type { BookingProposal, OutboxRecord } from '../src/offline/types';
test('legacy waiting total retains all unacknowledged work; pending excludes attention', () => {
  const rows = [
    { status: 'pending' }, { status: 'processing' }, { status: 'failed', errorCode: 'network' },
    { status: 'conflict' }, { status: 'failed', errorCode: 'rejected' }, { status: 'succeeded' },
  ] as OutboxRecord[];
  const counts = summarizeQueue(rows);
  assert.deepEqual(counts, { waiting: 5, pending: 3, attention: 2, held: 0 });
  assert.equal(connectionState(false, 'ready', counts), 'attention');
  assert.equal(connectionState(true, 'ready', counts), 'attention');
  assert.equal(rows.length, 6);
});
test('unknown, loading, and failed reads never fabricate online success', () => {
  for (const state of ['loading', 'locked', 'error'] as const) {
    assert.equal(connectionState(true, state, null), state);
  }
  assert.equal(connectionState(true, 'ready', null), 'error');
});
test('reconnect changes connectivity but does not clear waiting or attention', () => {
  const counts = { waiting: 3, pending: 3, attention: 0, held: 0 };
  assert.equal(connectionState(false, 'ready', counts), 'offline');
  assert.equal(connectionState(true, 'ready', counts), 'online');
  assert.equal(counts.waiting, 3);
  assert.deepEqual(summarizeQueue([]), { waiting: 0, pending: 0, attention: 0, held: 0 });
});

test('empty and acknowledged queues have no pending, attention or held work', () => {
  for (const rows of [[], [{ status: 'succeeded', errorCode: 'rejected' }] as OutboxRecord[]]) {
    assert.deepEqual(summarizeQueue(rows), { waiting: 0, pending: 0, attention: 0, held: 0 });
  }
});

test('each unacknowledged status is categorized without implying confirmation', () => {
  for (const row of [
    { status: 'pending' }, { status: 'processing' },
    { status: 'failed', errorCode: 'network' }, { status: 'failed', errorCode: 'rate-limited' },
    { status: 'failed', errorCode: 'unknown' },
  ]) {
    assert.deepEqual(summarizeQueue([row] as OutboxRecord[]), { waiting: 1, pending: 1, attention: 0, held: 0 });
  }
  for (const row of [{ status: 'conflict' }, { status: 'failed', errorCode: 'rejected' }]) {
    assert.deepEqual(summarizeQueue([row] as OutboxRecord[]), { waiting: 1, pending: 0, attention: 1, held: 0 });
  }
  const held = summarizeQueue([{ status: 'failed', errorCode: 'blocked' }] as OutboxRecord[]);
  assert.deepEqual(held, { waiting: 1, pending: 0, attention: 0, held: 1 });
  assert.equal(connectionState(true, 'ready', held), 'attention');
  assert.equal(connectionState(false, 'ready', held), 'attention');
});

function booking(sequence: number, status: OutboxRecord['status'] = 'pending', deviceId = 42): OutboxRecord {
  return {
    userId: 'synthetic-user', clinicId: 7, operationId: `operation-${deviceId}-${sequence}`,
    type: 'appointment.create', entityId: null,
    payload: { doctorId: 8, patientId: 9, startsAt: '2026-10-20T10:00:00Z', endsAt: '2026-10-20T10:30:00Z', source: 'phone' },
    booking: { localId: -sequence, deviceId, sequence }, status, errorCode: null,
    attempts: 0, retryAt: null, enqueuedAt: '2026-10-20T08:00:00Z', updatedAt: '2026-10-20T08:00:00Z',
  };
}
function evidence(row: OutboxRecord, outcome: BookingProposal['outcome']) {
  return { userId: row.userId, clinicId: row.clinicId, operationId: row.operationId, outcome };
}

test('one conflict, two acknowledged and two dependent bookings are not three pending', () => {
  const rows = [booking(5), booking(1, 'succeeded'), booking(3, 'conflict'), booking(4), booking(2, 'succeeded')];
  const before = structuredClone(rows);
  assert.deepEqual(summarizeQueue(rows), { waiting: 3, pending: 0, attention: 1, held: 2 });
  assert.deepEqual(rows, before, 'presentation does not reorder, resolve, mutate or discard evidence');
});

test('held inference uses earlier unresolved attention on the same device only', () => {
  const rejected = { ...booking(2, 'failed'), errorCode: 'rejected' as const };
  assert.deepEqual(summarizeQueue([booking(3), booking(1), rejected, booking(3, 'pending', 43)]),
    { waiting: 4, pending: 2, attention: 1, held: 1 });
  assert.deepEqual(summarizeQueue([booking(1), booking(2)]),
    { waiting: 2, pending: 2, attention: 0, held: 0 }, 'normal sequential pending work is not an unresolved conflict');
});

test('old blocked-as-rejected rows require matching proposal evidence; ambiguity stays attention', () => {
  const old = { ...booking(1, 'failed'), errorCode: 'rejected' as const };
  assert.deepEqual(summarizeQueue([old], [evidence(old, 'blocked')]),
    { waiting: 1, pending: 0, attention: 0, held: 1 });
  for (const proposals of [
    [], [evidence(old, 'rejected')],
    [{ ...evidence(old, 'blocked'), userId: 'other-user' }],
    [{ ...evidence(old, 'blocked'), clinicId: 99 }],
    [{ ...evidence(old, 'blocked'), operationId: 'other-operation' }],
  ]) {
    assert.deepEqual(summarizeQueue([old], proposals), { waiting: 1, pending: 0, attention: 1, held: 0 });
  }
  assert.deepEqual(summarizeQueue([old, booking(2)], [evidence(old, 'blocked')]),
    { waiting: 2, pending: 0, attention: 0, held: 2 });
});
