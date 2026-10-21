import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_FILTERS, hebronMidnight, reasonKey, toParams, validateFilters } from '../src/reminders/model';
import { remAr, remEn } from '../src/reminders/strings-data';
import { routesFor, resolve } from '../src/shell/routes';

const keys = (o: object, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]).sort();

test('AR and EN reminder strings are key-for-key identical', () => { assert.deepEqual(keys(remAr), keys(remEn)); });
test('messages route is admin/front-desk only', () => {
  assert.ok(routesFor('admin').some((r) => r.path === '/messages'));
  assert.ok(routesFor('front-desk').some((r) => r.path === '/messages'));
  assert.equal(resolve('/messages', 'doctor').kind, 'forbidden');
});
test('Hebron midnight is DST aware', () => {
  assert.equal(hebronMidnight('2025-01-15'), '2025-01-14T22:00:00.000Z');
  assert.equal(hebronMidnight('2025-07-15'), '2025-07-14T21:00:00.000Z');
});
test('filters become a bounded half-open window', () => {
  const p = toParams(7, { status: 'sent', from: '2025-07-01', to: '2025-07-01' }, 40);
  assert.deepEqual(p, { clinicId: 7, limit: 25, cursor: 40, status: 'sent', from: '2025-06-30T21:00:00.000Z', to: '2025-07-01T21:00:00.000Z' });
  assert.deepEqual(toParams(3, EMPTY_FILTERS, null), { clinicId: 3, limit: 25 });
});
test('filter validation', () => {
  assert.equal(validateFilters({ status: '', from: '2025-02-02', to: '2025-02-01' }), 'errOrder');
  assert.equal(validateFilters({ status: '', from: '2025-01-01', to: '2025-06-01' }), 'errRange');
  assert.equal(validateFilters({ status: '', from: '2025-02-30', to: '' }), 'errDate');
  assert.equal(validateFilters({ status: '', from: '2025-01-01', to: '2025-04-02' }), null);
});
test('reason keys map confirmed codes and never expose raw values', () => {
  for (const c of ['missed_window', 'appointment_changed', 'appointment_inactive', 'clinic_disabled', 'patient_opt_out', 'stale_schedule']) {
    assert.equal(reasonKey(c), `reason.${c}`);
    assert.equal(reasonKey(`messages.reason.${c}`), `reason.${c}`);
    assert.ok((remEn.reason as Record<string, string>)[c] && (remAr.reason as Record<string, string>)[c]);
  }
  assert.equal(reasonKey(null), 'reason.unknown');
  assert.equal(reasonKey('weird'), 'reason.other');
  assert.ok(!remEn.reason.other.includes('{{') && !remAr.reason.other.includes('{{'));
});
