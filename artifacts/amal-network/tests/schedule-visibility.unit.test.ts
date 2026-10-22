import assert from 'node:assert/strict';
import { test } from 'node:test';
import { visibleOnSchedule } from '../src/calendar/visibility';

test('only confirmed cancellations disappear; pending or failed cancellation stays booked', () => {
  assert.equal(visibleOnSchedule('cancelled'), false);
  for (const status of ['booked', 'double_booked', 'completed', 'no_show', 'unknown']) {
    assert.equal(visibleOnSchedule(status), true);
  }
});

test('filtering schedules leaves cancelled history unchanged and restores reverted bookings', () => {
  const stored = [{ id: 1, status: 'cancelled' }, { id: 2, status: 'booked' }];
  const original = JSON.stringify(stored);
  assert.deepEqual(stored.filter(a => visibleOnSchedule(a.status)).map(a => a.id), [2]);
  assert.equal(JSON.stringify(stored), original);
  const reverted = stored.map(a => ({ ...a, status: 'booked' }));
  assert.equal(reverted.filter(a => visibleOnSchedule(a.status)).length, 2);
});
