import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectionState, summarizeQueue } from '../src/shell/connection-model';
import type { OutboxRecord } from '../src/offline/types';
test('all unacknowledged outcomes count; attention wins offline and online', () => {
  const rows = [
    { status: 'pending' }, { status: 'processing' }, { status: 'failed', errorCode: 'network' },
    { status: 'conflict' }, { status: 'failed', errorCode: 'rejected' }, { status: 'succeeded' },
  ] as OutboxRecord[];
  const counts = summarizeQueue(rows);
  assert.deepEqual(counts, { waiting: 5, attention: 2 });
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
  const counts = { waiting: 3, attention: 0 };
  assert.equal(connectionState(false, 'ready', counts), 'offline');
  assert.equal(connectionState(true, 'ready', counts), 'online');
  assert.equal(counts.waiting, 3);
  assert.deepEqual(summarizeQueue([]), { waiting: 0, attention: 0 });
});
