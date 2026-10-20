import 'fake-indexeddb/auto';
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import type { Appointment, ResolutionInput, SyncConflict, SyncOperation, SyncOutcome, SyncPushResult } from '@workspace/api-client-react';
import { LocalCacheController } from '../src/offline/controller';
import { LocalCacheDatabase } from '../src/offline/database';
import { appointmentWindow } from '../src/offline/calendar';
import type { BookingProposal, Result } from '../src/offline/types';
import { SyncRunner, type QueueLock, type SyncSnapshot, type SyncTransport } from '../src/sync/runner';

// All identities, transport responses and locks below are explicit synthetic test
// doubles. Each test owns a random IndexedDB database; no production seed is read.
const now = new Date('2026-10-20T08:00:00Z');
const auth = { userId: '71', clinicId: 701, authorizedUntil: '2026-10-20T16:00:00Z' };
const deviceId = 4001;
function value<T>(r: Result<T>): T {
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw new Error(r.error);
  return r.value;
}
function deferred<T = void>() {
  let resolve!: (v: T | PromiseLike<T>) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('sync test event did not arrive within 3s')), 3000);
    })]);
  } finally { clearTimeout(timer); }
}
async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 3000;
  while (!await check()) {
    assert.ok(Date.now() < deadline, 'sync test condition did not become true within 3s');
    await nextTurn();
  }
}
async function snapshot(runner: SyncRunner, check: (s: SyncSnapshot) => boolean) {
  if (check(runner.getSnapshot())) return;
  const event = deferred();
  const unsubscribe = runner.subscribe(() => { if (check(runner.getSnapshot())) event.resolve(); });
  try { await bounded(event.promise); }
  catch (error) { throw new Error(`Snapshot wait failed: ${JSON.stringify(runner.getSnapshot())}`, { cause: error }); }
  finally { unsubscribe(); }
}

// Fake browser lock: one FIFO tail per device, shared by all test runners. An
// aborted waiter never enters work, and an aborted owner retains the lock until
// its in-flight work settles (matching navigator.locks).
function serializedLock() {
  const tails = new Map<number, Promise<void>>();
  const stats = { active: 0, maximum: 0, entries: 0, waiting: 0 };
  const lock: QueueLock = async (id, signal, work) => {
    const previous = tails.get(id) ?? Promise.resolve();
    const done = deferred();
    const tail = previous.catch(() => {}).then(() => done.promise);
    tails.set(id, tail);
    stats.waiting++;
    await previous.catch(() => {});
    stats.waiting--;
    try {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      stats.entries++;
      stats.maximum = Math.max(stats.maximum, ++stats.active);
      try { return await work(); } finally { stats.active--; }
    } finally {
      done.resolve();
      if (tails.get(id) === tail) tails.delete(id);
    }
  };
  return { lock, stats };
}
function applied(op: SyncOperation): SyncOutcome {
  assert.equal(op.type, 'create');
  if (op.type !== 'create') throw new Error('synthetic transport only accepts creates');
  const result: Appointment = { ...op.input, id: 8000 + op.sequence, version: 1, status: 'booked' };
  return { status: 'applied', clientOpId: op.input.clientOpId, sequence: op.sequence, result };
}
function conflictFor(p: BookingProposal): SyncConflict {
  return { id: randomUUID(), clientOpId: p.operationId, operation: { target: 'create', payload: p.input },
    targetId: null, baseVersion: null, serverState: null, reasons: [], status: 'open', version: 1,
    createdAt: now.toISOString(), updatedAt: now.toISOString(), history: [] };
}
function conflictOutcome(conflict: SyncConflict, sequence: number): SyncOutcome {
  return { status: 'conflict', clientOpId: conflict.clientOpId, sequence, conflictId: conflict.id,
    code: 'DOCTOR_OVERLAP', messageKey: 'synthetic.doctorOverlap', params: {} };
}
function mockTransport(overrides: Partial<SyncTransport> = {}) {
  const calls = { states: 0, pushes: [] as SyncOperation[][], pulls: [] as (string | null)[], resolutions: [] as ResolutionInput[] };
  const transport: SyncTransport = {
    state: async () => { calls.states++; return { deviceId, nextSequence: 1 }; },
    push: async operations => {
      calls.pushes.push(structuredClone(operations));
      return { outcomes: operations.map(applied) };
    },
    pull: async since => { calls.pulls.push(since); return { changes: [], nextCursor: null, since: 'synthetic-cursor' }; },
    conflicts: async () => ({ items: [], nextCursor: null }),
    resolve: async input => {
      calls.resolutions.push(structuredClone(input));
      return { status: 'follow-up', conflictId: input.conflictId, version: input.expectedVersion + 1, patientId: 901, phone: null, called: false };
    },
    ...overrides,
  };
  return { transport, calls };
}
async function setup(t: TestContext, count = 1) {
  const db = new LocalCacheDatabase(`sync-runner-test-${randomUUID()}`);
  const cache = new LocalCacheController({ database: db, now: () => now });
  value(await cache.setContext(auth));
  const ticket = value(cache.captureScope());
  const window = appointmentWindow(now);
  value(await cache.replaceSnapshot(ticket, { ...auth,
    doctors: [{ id: 801, clinicId: 701, name: 'Synthetic doctor' }],
    patients: [{ id: 901, clinicId: 701, name: 'Synthetic patient', phone: '000000', dateOfBirth: '1990-01-01' }],
    appointments: [], coverage: { startUtc: window.startUtc, endUtc: window.endUtc } }));
  value(await cache.prepareBookingStream(ticket, { deviceId, nextSequence: 1 }));
  const enqueue = async (index: number) => value(await cache.saveBooking(ticket, {
    clientOpId: randomUUID(), clinicId: 701, doctorId: 801, patientId: 901, source: 'phone',
    startsAt: `2026-10-20T${String(10 + index).padStart(2, '0')}:00:00.000Z`,
    endsAt: `2026-10-20T${String(10 + index).padStart(2, '0')}:30:00.000Z`,
  }));
  const proposals: BookingProposal[] = [];
  for (let i = 0; i < count; i++) proposals.push(await enqueue(i));
  const runners: SyncRunner[] = [];
  const caches = [cache];
  const databases = [db];
  t.after(async () => {
    runners.forEach(r => r.close());
    caches.forEach(c => c.close());
    databases.forEach(d => d.close());
    await db.delete();
  });
  const locks = serializedLock();
  let online = true;
  let unauthorized = 0;
  function runner(api: SyncTransport, c = cache, lock = locks.lock) {
    const r = new SyncRunner(c, api, lock, () => online, () => { unauthorized++; });
    runners.push(r);
    return r;
  }
  async function reopen() {
    const reopenedDb = new LocalCacheDatabase(db.name);
    const reopened = new LocalCacheController({ database: reopenedDb, now: () => now });
    databases.push(reopenedDb); caches.push(reopened);
    value(await reopened.setContext(auth));
    return { cache: reopened, db: reopenedDb, ticket: value(reopened.captureScope()) };
  }
  return { db, cache, ticket, proposals, enqueue, runner, locks, reopen,
    setOnline: (v: boolean) => { online = v; }, unauthorized: () => unauthorized };
}

test('three durable offline bookings drain in sequence; third conflict retains original evidence', async t => {
  const f = await setup(t, 3);
  const conflict = conflictFor(f.proposals[2]);
  const sent: SyncOperation[] = [];
  const { transport } = mockTransport({
    push: async operations => {
      sent.push(...structuredClone(operations));
      const op = operations[0];
      return { outcomes: [op.sequence === 3 ? conflictOutcome(conflict, 3) : applied(op)] };
    },
    conflicts: async () => ({ items: sent.length === 3 ? [conflict] : [], nextCursor: null }),
  });
  const runner = f.runner(transport);
  f.setOnline(false);
  runner.start(f.ticket, true);
  await snapshot(runner, s => s.phase === 'offline' && s.bookings.length === 3);
  assert.equal(sent.length, 0);
  f.setOnline(true);
  runner.refresh();
  runner.refresh();
  await snapshot(runner, s => s.phase === 'idle' && s.bookings.some(p => p.sequence === 3 && p.outcome === 'conflict'));
  assert.deepEqual(sent.map(op => op.sequence), [1, 2, 3]);
  assert.deepEqual((await f.db.outbox.toArray()).sort((a, b) => a.booking!.sequence - b.booking!.sequence).map(o => o.status),
    ['succeeded', 'succeeded', 'conflict']);
  assert.deepEqual((await f.db.proposals.toArray()).sort((a, b) => a.sequence - b.sequence).map(p => p.input), f.proposals.map(p => p.input));
  assert.equal(runner.getSnapshot().conflicts[0].id, conflict.id);
});

test('startup/reconnect duplicate refreshes serialize delivery and newly enqueued work refreshes without waiting for timer', async t => {
  const f = await setup(t);
  const entered = deferred();
  const release = deferred();
  const { transport, calls } = mockTransport();
  const push = transport.push;
  transport.push = async (ops, signal) => { entered.resolve(); await release.promise; return push(ops, signal); };
  const runner = f.runner(transport);
  runner.start(f.ticket, true);
  await bounded(entered.promise);
  for (let i = 0; i < 5; i++) runner.refresh();
  release.resolve();
  await snapshot(runner, s => s.phase === 'idle' && s.bookings[0]?.outcome === 'applied');
  await until(() => f.locks.stats.active === 0);
  const added = await f.enqueue(1);
  runner.refresh(); // Explicit enqueue notification used by the booking UI.
  await snapshot(runner, s => s.phase === 'idle' && s.bookings.some(p => p.operationId === added.operationId && p.outcome === 'applied'));
  assert.deepEqual(calls.pushes.flat().map(op => op.sequence), [1, 2]);
  assert.equal(f.locks.stats.maximum, 1);
});

test('lost successful push acknowledgement survives reopen and replays exact operation once', async t => {
  const f = await setup(t);
  const received: SyncOperation[][] = [];
  const committed = new Map<string, SyncOutcome>();
  let loseResponse = true;
  const { transport } = mockTransport({
    push: async ops => {
      received.push(structuredClone(ops));
      const op = ops[0];
      assert.equal(op.type, 'create');
      if (op.type !== 'create') throw new Error('unexpected update');
      if (!committed.has(op.input.clientOpId)) committed.set(op.input.clientOpId, applied(op));
      if (loseResponse) { loseResponse = false; throw new TypeError('synthetic lost acknowledgement'); }
      return { outcomes: [committed.get(op.input.clientOpId)!] };
    },
  });
  const first = f.runner(transport);
  first.start(f.ticket, true);
  await snapshot(first, s => s.phase === 'error');
  first.close();
  f.cache.close();
  const reopened = await f.reopen();
  const second = f.runner(transport, reopened.cache);
  second.start(reopened.ticket, true);
  await snapshot(second, s => s.phase === 'idle' && s.bookings[0]?.outcome === 'applied');
  assert.equal(committed.size, 1);
  assert.equal(received.length, 2);
  assert.deepEqual(received[1], received[0]);
  assert.equal((await reopened.db.outbox.toArray())[0].attempts, 2);
});

for (const malformed of ['missing outcomes', 'empty outcomes', 'null outcome', 'extra outcome', 'wrong operation', 'wrong sequence', 'invalid canonical', 'unknown status'] as const) {
  test(`malformed push (${malformed}) never acknowledges or deletes durable proposal`, async t => {
    const f = await setup(t);
    const { transport } = mockTransport({
      push: async ops => {
        const outcome = applied(ops[0]);
        const responses: Record<typeof malformed, unknown> = {
          'missing outcomes': {}, 'empty outcomes': { outcomes: [] },
          'null outcome': { outcomes: [null] }, 'extra outcome': { outcomes: [outcome, outcome] },
          'wrong operation': { outcomes: [{ ...outcome, clientOpId: randomUUID() }] },
          'wrong sequence': { outcomes: [{ ...outcome, sequence: 999 }] },
          'invalid canonical': { outcomes: [{ ...outcome, result: null }] },
          'unknown status': { outcomes: [{ ...outcome, status: 'made-up' }] },
        };
        return responses[malformed] as SyncPushResult;
      },
    });
    const runner = f.runner(transport);
    runner.start(f.ticket, true);
    await snapshot(runner, s => s.phase === 'error');
    assert.equal(runner.getSnapshot().error, 'invalid-data');
    const proposals = await f.db.proposals.toArray();
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].outcome, 'pending');
    assert.equal(proposals[0].canonical, null);
    assert.equal((await f.db.outbox.toArray())[0].status, 'failed');
    assert.deepEqual(proposals[0].input, f.proposals[0].input);
  });
}

test('partial transport failure commits first booking only and retains failed and unattempted successors', async t => {
  const f = await setup(t, 3);
  const sent: number[] = [];
  const { transport } = mockTransport({
    push: async ops => {
      sent.push(ops[0].sequence);
      if (ops[0].sequence === 2) throw new TypeError('synthetic disconnection');
      return { outcomes: [applied(ops[0])] };
    },
  });
  const runner = f.runner(transport);
  runner.start(f.ticket, true);
  await snapshot(runner, s => s.phase === 'error');
  assert.deepEqual(sent, [1, 2]);
  const rows = (await f.db.outbox.toArray()).sort((a, b) => a.booking!.sequence - b.booking!.sequence);
  assert.deepEqual(rows.map(o => o.status), ['succeeded', 'failed', 'pending']);
  assert.deepEqual(rows.map(o => o.attempts), [1, 1, 0]);
  assert.equal(await f.db.proposals.count(), 3);
});

test('dependency block outcome retains successors and never sends past unresolved predecessor', async t => {
  const f = await setup(t, 3);
  const sent: number[] = [];
  const { transport } = mockTransport({
    push: async ops => {
      const op = ops[0]; sent.push(op.sequence);
      return { outcomes: [{ status: 'blocked', sequence: op.sequence, clientOpId: f.proposals[0].operationId,
        code: 'PREDECESSOR_UNRESOLVED', messageKey: 'synthetic.predecessorUnresolved', params: {} }] };
    },
  });
  const runner = f.runner(transport);
  runner.start(f.ticket, true);
  await snapshot(runner, s => s.phase === 'idle' && s.bookings.some(p => p.sequence === 1 && p.outcome === 'blocked'));
  assert.deepEqual(sent, [1]);
  assert.deepEqual((await f.db.outbox.toArray()).sort((a, b) => a.booking!.sequence - b.booking!.sequence).map(o => o.attempts), [1, 0, 0]);
  assert.equal(await f.db.proposals.count(), 3);
});

test('pending resolution with lost response is replayed after reopen with identical decision id and payload', async t => {
  const f = await setup(t);
  const conflict = conflictFor(f.proposals[0]);
  value(await f.cache.acknowledgeBooking(f.ticket, conflict.clientOpId, conflictOutcome(conflict, 1)));
  value(await f.cache.reconcileConflicts(f.ticket, [conflict]));
  const received: ResolutionInput[] = [];
  const { transport } = mockTransport({
    resolve: async input => {
      received.push(structuredClone(input));
      if (received.length === 1) throw new TypeError('synthetic lost resolution response');
      return { status: 'follow-up', conflictId: input.conflictId, version: 2, patientId: 901, phone: null, called: false };
    },
  });
  const first = f.runner(transport);
  first.start(f.ticket, true);
  await snapshot(first, s => s.phase === 'idle');
  const input: ResolutionInput = { action: 'call', clientOpId: randomUUID(), conflictId: conflict.id, expectedVersion: 1 };
  await assert.rejects(first.resolve(input), /synthetic lost resolution response/);
  assert.equal(value(await f.cache.readSyncState(f.ticket)).intents[0].status, 'pending');
  first.close(); f.cache.close();
  const reopened = await f.reopen();
  const second = f.runner(transport, reopened.cache);
  second.start(reopened.ticket, true);
  await snapshot(second, s => s.phase === 'idle' && s.intents[0]?.status === 'finished');
  assert.deepEqual(received, [input, input]);
  assert.equal(await reopened.db.proposals.count(), 1);
  assert.equal((await reopened.db.proposals.toArray())[0].outcome, 'conflict');
});

test('explicit stale-version resolution rejection retains proposal and refreshes authoritative conflict', async t => {
  const f = await setup(t);
  const conflict = conflictFor(f.proposals[0]);
  value(await f.cache.acknowledgeBooking(f.ticket, conflict.clientOpId, conflictOutcome(conflict, 1)));
  value(await f.cache.reconcileConflicts(f.ticket, [conflict]));
  let rejected = false;
  const { transport } = mockTransport({
    resolve: async () => { rejected = true; throw { status: 409, data: { code: 'STALE_VERSION' } }; },
    conflicts: async () => ({ items: [{ ...conflict, version: rejected ? 2 : 1 }], nextCursor: null }),
  });
  const runner = f.runner(transport);
  runner.start(f.ticket, true);
  await snapshot(runner, s => s.phase === 'idle');
  await assert.rejects(runner.resolve({ action: 'call', clientOpId: randomUUID(), conflictId: conflict.id, expectedVersion: 1 }));
  const state = value(await f.cache.readSyncState(f.ticket));
  assert.equal(state.intents[0].status, 'rejected');
  assert.equal(state.conflicts[0].version, 2);
  assert.equal((await f.db.proposals.toArray())[0].outcome, 'conflict');
  assert.deepEqual((await f.db.proposals.toArray())[0].input, f.proposals[0].input);
});

for (const failure of ['http', 'outcome'] as const) {
  test(`authorization failure (${failure}) locks private snapshot and retains durable queue`, async t => {
    const f = await setup(t);
    const { transport } = mockTransport({
      push: async ops => {
        if (failure === 'http') throw { status: 401 };
        return { outcomes: [{ status: 'rejected', sequence: ops[0].sequence, clientOpId: f.proposals[0].operationId,
          error: { code: 'DEVICE_UNTRUSTED', messageKey: 'synthetic.deviceUntrusted', params: {} } }] };
      },
    });
    const runner = f.runner(transport);
    runner.start(f.ticket, true);
    await until(() => f.unauthorized() === 1);
    assert.equal(runner.getSnapshot().phase, 'locked');
    assert.deepEqual(runner.getSnapshot().bookings, []);
    assert.equal(f.cache.captureScope().ok, false);
    assert.equal(await f.db.proposals.count(), 1);
    assert.notEqual((await f.db.outbox.toArray())[0].status, 'succeeded');
  });
}

for (const stage of ['state', 'push', 'resolve'] as const) {
  test(`late ${stage} success after stop cannot restore private snapshot or acknowledge work`, async t => {
    const f = await setup(t);
    const entered = deferred();
    const release = deferred();
    const { transport } = mockTransport();
    if (stage === 'state') {
      const state = transport.state;
      transport.state = async signal => { entered.resolve(); await release.promise; return state(signal); };
    } else if (stage === 'push') {
      const push = transport.push;
      transport.push = async (ops, signal) => { entered.resolve(); await release.promise; return push(ops, signal); };
    } else {
      const conflict = conflictFor(f.proposals[0]);
      value(await f.cache.acknowledgeBooking(f.ticket, conflict.clientOpId, conflictOutcome(conflict, 1)));
      value(await f.cache.reconcileConflicts(f.ticket, [conflict]));
      const resolve = transport.resolve;
      transport.resolve = async (input, signal) => { entered.resolve(); await release.promise; return resolve(input, signal); };
    }
    const runner = f.runner(transport);
    runner.start(f.ticket, true);
    let decision: Promise<unknown> | undefined;
    if (stage === 'resolve') {
      await snapshot(runner, s => s.phase === 'idle');
      const conflict = value(await f.cache.readSyncState(f.ticket)).conflicts[0];
      decision = assert.rejects(runner.resolve({ action: 'call', clientOpId: randomUUID(), conflictId: conflict.id, expectedVersion: 1 }));
    }
    await bounded(entered.promise);
    runner.stop();
    let laterPublications = 0;
    const unsubscribe = runner.subscribe(() => { laterPublications++; });
    release.resolve();
    if (decision) await decision;
    await until(() => f.locks.stats.active === 0);
    await nextTurn();
    unsubscribe();
    assert.equal(laterPublications, 0);
    assert.equal(runner.getSnapshot().phase, 'locked');
    assert.deepEqual(runner.getSnapshot().bookings, []);
    assert.equal((await f.db.proposals.toArray())[0].canonical, null);
    if (stage === 'resolve') assert.equal(value(await f.cache.readSyncState(f.ticket)).intents[0].status, 'pending');
  });
}

test('late explicit resolution rejection after stop leaves uncertain intent pending and does not fetch conflicts', async t => {
  const f = await setup(t);
  const conflict = conflictFor(f.proposals[0]);
  value(await f.cache.acknowledgeBooking(f.ticket, conflict.clientOpId, conflictOutcome(conflict, 1)));
  value(await f.cache.reconcileConflicts(f.ticket, [conflict]));
  const entered = deferred();
  const release = deferred();
  let conflictRequests = 0;
  const { transport } = mockTransport({
    conflicts: async () => { conflictRequests++; return { items: [], nextCursor: null }; },
    resolve: async () => {
      entered.resolve();
      await release.promise; // Deliberately ignores AbortSignal like a late network response.
      throw { status: 409, data: { code: 'STALE_VERSION' } };
    },
  });
  const runner = f.runner(transport);
  runner.start(f.ticket, true);
  await snapshot(runner, s => s.phase === 'idle');
  const decision = assert.rejects(runner.resolve({
    action: 'call', clientOpId: randomUUID(), conflictId: conflict.id, expectedVersion: 1,
  }));
  await bounded(entered.promise);
  runner.stop();
  const before = conflictRequests;
  release.resolve();
  await decision;
  assert.equal(conflictRequests, before, 'stopped session must not start another authenticated request');
  assert.equal(value(await f.cache.readSyncState(f.ticket)).intents[0].status, 'pending',
    'stopped session must not commit a late rejection');
  assert.equal(runner.getSnapshot().phase, 'locked');
});

test('two runners sharing a per-device lock never overlap or duplicate acknowledged deliveries', async t => {
  const f = await setup(t, 2);
  const entered = deferred();
  const release = deferred();
  const { transport, calls } = mockTransport();
  const push = transport.push;
  transport.push = async (ops, signal) => { entered.resolve(); await release.promise; return push(ops, signal); };
  const first = f.runner(transport);
  const second = f.runner(transport);
  first.start(f.ticket, true);
  await bounded(entered.promise);
  second.start(f.ticket, true);
  await until(() => f.locks.stats.waiting === 1);
  assert.equal(f.locks.stats.maximum, 1);
  assert.equal(f.locks.stats.entries, 1);
  release.resolve();
  await snapshot(first, s => s.phase === 'idle');
  await snapshot(second, s => s.phase === 'idle');
  assert.deepEqual(calls.pushes.flat().map(op => op.sequence), [1, 2]);
  assert.equal(f.locks.stats.maximum, 1);
  assert.equal((await f.db.outbox.toArray()).every(o => o.status === 'succeeded'), true);
});

test('cross-tab reauthorization invalidates old owner; shared lock prevents new owner overtaking in-flight push', async t => {
  const f = await setup(t);
  const entered = deferred();
  const release = deferred();
  const received: SyncOperation[][] = [];
  const { transport } = mockTransport({
    push: async ops => {
      received.push(structuredClone(ops));
      if (received.length === 1) { entered.resolve(); await release.promise; }
      return { outcomes: ops.map(applied) };
    },
  });
  const first = f.runner(transport);
  first.start(f.ticket, true);
  await bounded(entered.promise);
  const peer = await f.reopen();
  const second = f.runner(transport, peer.cache);
  second.start(peer.ticket, true);
  await until(() => f.locks.stats.waiting === 1);
  assert.equal(received.length, 1);
  release.resolve();
  await snapshot(second, s => s.phase === 'idle' && s.bookings[0]?.outcome === 'applied');
  assert.equal(f.locks.stats.maximum, 1);
  assert.equal(received.length, 2); // Uncertain old owner must replay exact id.
  assert.deepEqual(received[0], received[1]);
  assert.equal(first.getSnapshot().phase, 'locked');
  assert.equal(await peer.db.proposals.count(), 1);
});
