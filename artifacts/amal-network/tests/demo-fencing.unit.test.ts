import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customFetch, configureDemoTransport, setDemoGeneration, invalidateDemoResponses } from '../../../lib/api-client-react/src/custom-fetch';
import { LocalCacheController } from '../src/offline/controller';
import { LocalCacheDatabase } from '../src/offline/database';

test('operational requests carry epoch; auth recovery never receives epoch', async () => {
  const original = globalThis.fetch;
  const headers: Headers[] = [];
  globalThis.fetch = async (_url, init) => {
    headers.push(new Headers(init?.headers));
    return Response.json({ ok: true });
  };
  try {
    setDemoGeneration('old');
    await customFetch('/api/sync/push', { method: 'POST' });
    await customFetch('/api/auth/login', { method: 'POST' });
    await customFetch('/api/auth/devices');
    assert.equal(headers[0].get('X-Amal-Demo-Generation'), 'old');
    assert.equal(headers[1].get('X-Amal-Demo-Generation'), null);
    assert.equal(headers[2].get('X-Amal-Demo-Generation'), 'old');
  } finally { globalThis.fetch = original; setDemoGeneration(null); }
});

test('late successful responses cannot restore pre-reset data', async () => {
  const original = globalThis.fetch;
  let finish!: (response: Response) => void;
  globalThis.fetch = () => new Promise(resolve => { finish = resolve; });
  try {
    setDemoGeneration('old');
    const request = customFetch('/api/patients');
    invalidateDemoResponses();
    finish(Response.json({ items: [{ id: 123 }] }));
    await assert.rejects(request, (e: any) => e.data.code === 'DEMO_RESET_REQUIRED');
  } finally { globalThis.fetch = original; setDemoGeneration(null); }
});

test('reset errors recover without retrying a mutation; clinic outage signals connectivity', async () => {
  const original = globalThis.fetch;
  let recovered = 0, outage = 0, calls = 0;
  configureDemoTransport(async () => { recovered++; }, () => { outage++; });
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ code: calls === 1 ? 'DEMO_RESET_REQUIRED' : 'CLINIC_OUTAGE' }, { status: calls === 1 ? 409 : 503 });
  };
  try {
    await assert.rejects(customFetch('/api/sync/push', { method: 'POST' }));
    assert.equal(calls, 1);
    assert.equal(recovered, 1);
    await assert.rejects(customFetch('/api/sync/push', { method: 'POST' }));
    assert.equal(outage, 1);
  } finally { globalThis.fetch = original; }
});

test('confirmed demo reset clears operational database and invalidates tickets', async () => {
  const db = new LocalCacheDatabase(`demo-reset-${Date.now()}`);
  const cache = new LocalCacheController({ database: db });
  try {
    assert.equal((await cache.setContext({ userId: 'account:1', clinicId: 1, authorizedUntil: '2099-01-01T00:00:00Z' })).ok, true);
    const ticket = cache.captureScope();
    assert.equal(ticket.ok, true);
    assert.equal((await cache.clearDemoGeneration()).ok, true);
    assert.equal(cache.captureScope().ok, false);
    for (const table of db.tables) if (table.name !== 'lifecycle') assert.equal(await table.count(), 0);
    if (ticket.ok) assert.equal((await cache.readSnapshot(ticket.value)).ok, false);
  } finally { cache.close(); await db.delete(); }
});

test('unversioned retained work is discarded before binding; peer reconciliation preserves new work', async () => {
  const name = `demo-legacy-${Date.now()}`;
  const db = new LocalCacheDatabase(name);
  const peerDb = new LocalCacheDatabase(name);
  const cache = new LocalCacheController({ database: db });
  const peer = new LocalCacheController({ database: peerDb });
  let warnings = 0;
  try {
    await cache.probe();
    await db.streams.put({ deviceId: 11, nextSequence: 9 });
    assert.deepEqual(await cache.reconcileDemoGeneration('generation-a', () => warnings++), { ok: true, value: true });
    assert.equal(warnings, 1);
    assert.equal(await db.streams.count(), 0);
    assert.equal((await db.lifecycle.get('demo-generation'))?.demoGeneration, 'generation-a');
    await db.streams.put({ deviceId: 22, nextSequence: 2 });
    assert.deepEqual(await peer.reconcileDemoGeneration('generation-a', () => warnings++), { ok: true, value: false });
    assert.equal(await db.streams.count(), 1);
    assert.deepEqual(await peer.reconcileDemoGeneration('generation-b', () => warnings++), { ok: true, value: true });
    assert.equal(await db.streams.count(), 0);
    assert.equal(warnings, 2);
    await db.streams.put({ deviceId: 33, nextSequence: 3 });
    assert.deepEqual(await cache.reconcileDemoGeneration('generation-b', () => warnings++), { ok: true, value: false });
    assert.equal(await db.streams.count(), 1);
  } finally { cache.close(); peer.close(); await db.delete(); }
});

test('force-fresh context ignores a pre-reset polling response and performs a new probe', async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } });
  const { ensureDemoContext } = await import('../src/auth/demo-context');
  const { localCache } = await import('../src/offline');
  let finish!: (response: Response) => void;
  let calls = 0;
  const next = '00000000-0000-4000-8000-000000000002';
  globalThis.fetch = () => {
    calls++;
    if (calls === 1) return new Promise(resolve => { finish = resolve; });
    return Promise.resolve(Response.json({ enabled: true, generation: next, clinicId: null, outage: false }));
  };
  try {
    const old = ensureDemoContext();
    const fresh = ensureDemoContext(true);
    finish(Response.json({ enabled: true, generation: '00000000-0000-4000-8000-000000000001', clinicId: null, outage: false }));
    await Promise.all([old, fresh]);
    assert.equal(calls, 2);
    assert.equal(values.get('amal-demo-generation'), next);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
    localCache.close();
  }
});
