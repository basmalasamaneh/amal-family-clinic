import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_FILTERS, freshReminderCapability, hebronMidnight, messagesClinicFor, reasonKey, toParams, validateFilters } from '../src/reminders/model';
import type { ShellIdentity } from '../src/shell/identity';
import { remAr, remEn } from '../src/reminders/strings-data';
import { routesFor, resolve } from '../src/shell/routes';

const keys = (o: object, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]).sort();

test('AR and EN reminder strings are key-for-key identical', () => { assert.deepEqual(keys(remAr), keys(remEn)); });
test('messages route keeps admin/front-desk access and defaults doctor to denied', () => {
  assert.ok(routesFor('admin').some((r) => r.path === '/messages'));
  assert.ok(routesFor('front-desk').some((r) => r.path === '/messages'));
  assert.equal(resolve('/messages', 'doctor').kind, 'forbidden');
});
test('manager capability is independent of coordinator capability', () => {
  assert.equal(resolve('/messages', 'doctor', true).kind, 'forbidden');
  assert.equal(resolve('/messages', 'doctor', true, false).kind, 'forbidden');
  assert.equal(resolve('/messages', 'doctor', false, true).kind, 'page');
  assert.equal(resolve('/doctor/coordination', 'doctor', false, true).kind, 'forbidden');
  assert.equal(resolve('/doctor/coordination', 'doctor', true, false).kind, 'page');
  assert.ok(!routesFor('doctor', true).some((r) => r.id === 'messages'));
  assert.ok(routesFor('doctor', false, true).some((r) => r.id === 'messages'));
  for (const role of ['front-desk', 'admin'] as const) assert.equal(resolve('/messages', role, false, false).kind, 'page');
});
test('doctor and admin use explicit home clinic only, reception retains selected scope', () => {
  const clinics = [{ id: 7, name: 'Home' }, { id: 9, name: 'Other' }];
  const identity: ShellIdentity = { id: 'manager-a', name: 'Manager', role: 'doctor', clinics, homeClinicId: 7 };
  assert.deepEqual(messagesClinicFor(identity, clinics[1]), clinics[0]);
  assert.equal(messagesClinicFor({ ...identity, homeClinicId: null }, clinics[1]), null);
  assert.deepEqual(messagesClinicFor({ ...identity, role: 'front-desk' }, clinics[1]), clinics[1]);
  assert.deepEqual(messagesClinicFor({ ...identity, role: 'admin' }, clinics[1]), clinics[0]);
  assert.equal(messagesClinicFor({ ...identity, role: 'admin', homeClinicId: null }, clinics[1]), null);
});
test('capability requires online explicit true and expires at sixty seconds', () => {
  assert.equal(freshReminderCapability(true, true, 100, 60_099), true);
  assert.equal(freshReminderCapability(true, true, 100, 60_100), false);
  assert.equal(freshReminderCapability(false, true, 100, 101), false);
  assert.equal(freshReminderCapability(true, false, 100, 101), false);
  assert.equal(freshReminderCapability(true, undefined, 100, 101), false);
  assert.equal(freshReminderCapability(true, true, 0, 101), false);
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
