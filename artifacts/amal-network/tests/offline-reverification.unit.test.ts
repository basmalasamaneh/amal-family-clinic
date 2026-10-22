import test from 'node:test';
import assert from 'node:assert/strict';
import { ONLINE_REVERIFY_INTERVAL, startOfflineReverification, type ReverificationThrottle } from '../src/shell/offline-reverification';

class FakeClock {
  time = 0;
  sequence = 0;
  timers = new Map<number, { at: number; callback: () => void }>();
  now = () => this.time;
  setTimeout = (callback: () => void, delay: number) => {
    const id = ++this.sequence;
    this.timers.set(id, { at: this.time + delay, callback });
    return id;
  };
  clearTimeout = (id: number) => { this.timers.delete(id); };
  async advance(ms: number) {
    const end = this.time + ms;
    while (true) {
      const next = [...this.timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.time = next[1].at;
      this.timers.delete(next[0]);
      next[1].callback();
      await this.flush();
    }
    this.time = end;
    await this.flush();
  }
  async flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
}

test('missed online event: reachable subscription starts verification, failed first /me retries with backoff', async () => {
  const clock = new FakeClock();
  const throttle: ReverificationThrottle = { nextAttemptAt: 30_000, inFlight: false };
  let reachable = false, attempts = 0, deliveries = 0;
  const start = () => startOfflineReverification({
    clock, throttle, expiresAt: 300_000, canVerify: () => reachable,
    verify: async () => { attempts++; return attempts === 1 ? { offlineRestored: true } : { offlineRestored: false }; },
    onVerified: next => { if (!next.offlineRestored) deliveries++; },
    onError: () => assert.fail('unexpected error'),
  });
  let stop = start();
  await clock.advance(40_000);
  assert.equal(attempts, 0);
  // Browser online already happened; only HTTP reachability changes.
  reachable = true;
  stop(); stop = start();
  await clock.advance(0);
  assert.equal(attempts, 1);
  assert.equal(deliveries, 0);
  await clock.advance(ONLINE_REVERIFY_INTERVAL - 1);
  assert.equal(attempts, 1);
  await clock.advance(1);
  assert.equal(attempts, 2);
  assert.equal(deliveries, 1);
  stop();
  assert.equal(clock.timers.size, 0);
});

test('transport rejection and effect restarts cannot reset throttle or busy loop', async () => {
  const clock = new FakeClock();
  const throttle: ReverificationThrottle = { nextAttemptAt: 0, inFlight: false };
  let attempts = 0, errors = 0;
  const start = () => startOfflineReverification({
    clock, throttle, expiresAt: 300_000, canVerify: () => true,
    verify: async () => { attempts++; throw new TypeError('temporary outage'); },
    onVerified: () => assert.fail('must not grant'),
    onError: () => { errors++; },
  });
  let stop = start();
  await clock.advance(0);
  for (let i = 0; i < 10; i++) { stop(); stop = start(); await clock.advance(1); }
  assert.equal(attempts, 1);
  await clock.advance(29_990);
  assert.equal(attempts, 2);
  assert.equal(errors, 2);
  stop();
});

test('offline, revoked, missing or expired continuation never initiates a grant', async () => {
  for (const [expiresAt, eligible] of [[0, true], [NaN, true], [100_000, false]] as const) {
    const clock = new FakeClock();
    const stop = startOfflineReverification({
      clock, expiresAt, throttle: { nextAttemptAt: 0, inFlight: false }, canVerify: () => eligible,
      verify: async () => assert.fail('must not request /me'),
      onVerified: () => assert.fail('must not grant'),
      onError: () => assert.fail('must not fail'),
    });
    await clock.advance(200_000);
    assert.equal(clock.timers.size, 0);
    stop();
  }
});

test('scope cancellation, signout/revocation, and expiry suppress stale successful /me responses', async () => {
  for (const reason of ['cancel', 'revoked', 'expired'] as const) {
    const clock = new FakeClock();
    let current = true, grants = 0;
    let resolve!: (value: string) => void;
    const stop = startOfflineReverification({
      clock, expiresAt: 1000, throttle: { nextAttemptAt: 0, inFlight: false },
      canVerify: () => current,
      verify: () => new Promise<string>(done => { resolve = done; }),
      onVerified: () => { grants++; },
      onError: () => assert.fail('unexpected error'),
    });
    await clock.advance(0);
    if (reason === 'cancel') stop();
    if (reason === 'revoked') current = false;
    if (reason === 'expired') await clock.advance(1000);
    resolve('online authority');
    await clock.flush();
    assert.equal(grants, 0, reason);
    assert.equal(clock.timers.size, 0, reason);
    stop();
  }
});

test('null /me authority ends continuation, never promoting a restored permit or starting sync', async () => {
  const clock = new FakeClock();
  let current = true, expired = 0;
  const stop = startOfflineReverification({
    clock, expiresAt: 300_000, throttle: { nextAttemptAt: 0, inFlight: false },
    canVerify: () => current,
    verify: async () => null,
    onVerified: () => { expired++; current = false; },
    onError: () => assert.fail('unexpected error'),
  });
  await clock.advance(90_000);
  assert.equal(expired, 1);
  assert.equal(clock.timers.size, 0);
  stop();
});

test('/me revoking its own permit still delivers a denial after the authorization epoch changes', async () => {
  const clock = new FakeClock();
  let epoch = 'original', expired = 0;
  const stop = startOfflineReverification({
    clock, expiresAt: 300_000, throttle: { nextAttemptAt: 0, inFlight: false },
    canVerify: () => epoch === 'original',
    isCurrent: () => true,
    // Real identityAdapter revokes the permit on 401, then returns null.
    verify: async () => { epoch = 'revoked'; return null; },
    onVerified: next => { assert.equal(next, null); expired++; },
    onError: () => assert.fail('unexpected error'),
  });
  await clock.advance(90_000);
  assert.equal(expired, 1);
  assert.equal(clock.timers.size, 0);
  stop();
});

test('reachability/scope effect restarts never overlap an in-flight verification', async () => {
  const clock = new FakeClock();
  const throttle: ReverificationThrottle = { nextAttemptAt: 0, inFlight: false };
  let resolve!: (value: string) => void;
  let attempts = 0, staleGrants = 0, currentGrants = 0;
  const stopOld = startOfflineReverification({
    clock, expiresAt: 300_000, throttle, canVerify: () => true,
    verify: () => { attempts++; return new Promise<string>(done => { resolve = done; }); },
    onVerified: () => { staleGrants++; }, onError: () => assert.fail('unexpected error'),
  });
  await clock.advance(0);
  stopOld();
  const stopNew = startOfflineReverification({
    clock, expiresAt: 300_000, throttle, canVerify: () => true,
    verify: async () => { attempts++; return 'fresh /me'; },
    onVerified: () => { currentGrants++; }, onError: () => assert.fail('unexpected error'),
  });
  await clock.advance(90_000);
  assert.equal(attempts, 1);
  resolve('stale /me');
  await clock.flush();
  assert.equal(staleGrants, 0);
  await clock.advance(30_000);
  assert.equal(attempts, 2);
  assert.equal(currentGrants, 1);
  stopNew();
  assert.equal(clock.timers.size, 0);
});
