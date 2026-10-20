import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LookupTiming, observePaintedCard } from '../src/network/lookup-timing';

test('search wiring starts on change (paste/IME included), guards submit debounce, and excludes automatic work', () => {
  const src = readFileSync(new URL('../src/network/NetworkSearchPage.tsx', import.meta.url), 'utf8');
  assert.match(src, /onChange=\{\(e\) => \{[\s\S]*?timing\.current\.input/);
  assert.match(src, /if \(typed\.current\) run\(text, undefined, true\)/);
  assert.match(src, /if \(!userInitiated \|\| document\.visibilityState !== 'visible'\) timing\.current\.cancel/);
  assert.match(src, /seq\.current === state\.requestId/);
  assert.match(src, /body => recordLookupDuration\(body\)/);
  assert.doesNotMatch(src, /onKeyDown.*timing/);
});

test('first input includes edits, debounce, response and delayed paint; submit does not reset', () => {
  let now = 10;
  const bodies: unknown[] = [];
  const timer = new LookupTiming(() => now, async body => { bodies.push(body); });
  timer.input(true); now = 100; timer.input(true); now = 350; timer.submit();
  const token = timer.request()!;
  now = 950; timer.complete(token); timer.complete(token);
  assert.deepEqual(bodies, [{ durationMs: 940 }]);
  now = 1000; timer.input(true);
  const second = timer.request()!;
  now = 1100; timer.complete(second);
  assert.deepEqual(bodies, [{ durationMs: 940 }, { durationMs: 100 }]);
});

test('submission fallback, stale request/edit, cancellation, restoration and duplicate effects', () => {
  let now = 0;
  const bodies: unknown[] = [];
  const timer = new LookupTiming(() => now, async body => { bodies.push(body); });
  assert.equal(timer.request(), null); // restore/revalidation has no starting input
  timer.submit();
  const stale = timer.request()!;
  now = 20; timer.input(true); timer.complete(stale);
  const current = timer.request()!;
  now = 40; timer.complete(current); timer.complete(current);
  assert.deepEqual(bodies, [{ durationMs: 40 }]);
  for (const cancel of [() => timer.input(false), () => timer.cancel()]) {
    timer.input(true); const token = timer.request()!;
    cancel(); now += 10; timer.complete(token);
  }
  assert.equal(bodies.length, 1);
});

test('transport rejection or synchronous throw is consumed without retry or clinical failure', async () => {
  for (const throws of [true, false]) {
    let calls = 0, now = 0;
    const timer = new LookupTiming(() => now, () => {
      calls++;
      if (throws) throw new Error('offline');
      return Promise.reject(new Error('offline'));
    });
    timer.input(true); const token = timer.request()!; now = 12.6;
    assert.doesNotThrow(() => timer.complete(token));
    timer.complete(token); await Promise.resolve();
    assert.equal(calls, 1);
  }
});

test('paint waits for viewport intersection, unobscured card, animation completion and two frames; cleanup cancels', () => {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: unknown) => {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  let callback: (entries: unknown[]) => void = () => {};
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0, animated = true, hidden = false, covered = true, emitted = 0;
  const parent = { parentElement: null, getAnimations: () => animated ? [{ playState: 'running' }] : [] };
  const card = {
    isConnected: true, parentElement: parent, getAnimations: () => [],
    getBoundingClientRect: () => ({ left: 0, right: 200, top: 0, bottom: 100 }),
    contains: (el: unknown) => el === card,
  };
  const root = { querySelectorAll: () => [card] } as unknown as HTMLElement;
  const tick = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(cb => cb(0)); };
  try {
    install('IntersectionObserver', class {
      constructor(cb: typeof callback) { callback = cb; }
      observe() {} disconnect() {}
    });
    install('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++id, cb); return id; });
    install('cancelAnimationFrame', (n: number) => frames.delete(n));
    install('getComputedStyle', () => ({ visibility: 'visible', display: 'block', opacity: '1' }));
    install('innerWidth', 1000); install('innerHeight', 800);
    install('document', { get visibilityState() { return hidden ? 'hidden' : 'visible'; }, elementFromPoint: () => covered ? {} : card });
    const stop = observePaintedCard(root, () => emitted++);
    tick(); tick(); assert.equal(emitted, 0);
    callback([{ target: card, isIntersecting: true, intersectionRect: { width: 200, height: 100 } }]);
    covered = false; tick(); tick(); assert.equal(emitted, 0); // entry animation
    animated = false; covered = true; tick(); tick(); assert.equal(emitted, 0);
    covered = false; tick(); assert.equal(emitted, 0);
    tick(); assert.equal(emitted, 1); tick(); assert.equal(emitted, 1); stop();
    const cleanup = observePaintedCard(root, () => emitted++);
    callback([{ target: card, isIntersecting: true, intersectionRect: { width: 200, height: 100 } }]);
    tick(); cleanup(); tick(); assert.equal(emitted, 1); // stale/unmount
    observePaintedCard(root, () => emitted++);
    hidden = true; tick(); assert.equal(emitted, 1);
  } finally {
    for (const [key, desc] of saved) {
      if (desc) Object.defineProperty(globalThis, key, desc);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
