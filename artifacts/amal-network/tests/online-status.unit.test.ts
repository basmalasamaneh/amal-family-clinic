import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserOnline, subscribeOnlineStatus } from '../src/hooks/use-online-status';

test('connectivity subscription updates and removes both listeners', () => {
  const target = new EventTarget();
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  try {
    let calls = 0;
    const dispose = subscribeOnlineStatus(() => calls++);
    assert.equal(browserOnline(), true);
    target.dispatchEvent(new Event('offline'));
    target.dispatchEvent(new Event('online'));
    assert.equal(calls, 2);
    dispose();
    target.dispatchEvent(new Event('offline'));
    target.dispatchEvent(new Event('online'));
    assert.equal(calls, 2);
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});

test('non-browser subscription is safe', () => {
  assert.doesNotThrow(() => subscribeOnlineStatus(() => {})());
});
