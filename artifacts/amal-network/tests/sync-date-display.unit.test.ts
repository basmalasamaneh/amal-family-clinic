import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSyncWhen } from '../src/sync/format-when';

test('full dates include weekday, month, year and Hebron time in both languages', () => {
  const iso = '2026-10-22T07:00:00Z';
  assert.equal(formatSyncWhen(iso, 'en', 'latn'), 'Thursday 22 October 2026, 10:00');
  const arabic = formatSyncWhen(iso, 'ar', 'latn');
  assert.match(arabic, /الخميس/);
  assert.match(arabic, /أكتوبر/);
  assert.match(arabic, /2026, 10:00/);
});

test('empty and invalid dates stay empty', () => {
  for (const iso of [null, undefined, '', 'invalid']) {
    assert.equal(formatSyncWhen(iso, 'ar', 'latn'), '');
  }
});
