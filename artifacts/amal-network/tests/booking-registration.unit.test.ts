import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completedEmpty, refreshRegisteredPatient, registrationName } from '../src/booking/registration-flow';
import { createRegSession, opFor, settle, validateRegistration, EMPTY_DRAFT } from '../src/reception/registration';

test('registration CTA requires a completed current empty query', () => {
  assert.equal(completedEmpty('  سليم  ', { kind: 'ok', q: 'سليم', items: [] }, true), true);
  assert.equal(completedEmpty('Salma', { kind: 'ok', q: 'Salma', items: [] }, true), true);
});
for (const kind of ['idle', 'loading', 'error']) {
  test(`no registration CTA during ${kind}`, () => {
    assert.equal(completedEmpty('Salma', { kind, q: 'Salma', items: [] }, true), false);
  });
}
test('no CTA for stale query, scope/adapter/refresh, short query or matches', () => {
  assert.equal(completedEmpty('Salma N', { kind: 'ok', q: 'Salma', items: [] }, true), false);
  assert.equal(completedEmpty('Salma', { kind: 'ok', q: 'Salma', items: [] }, false), false);
  assert.equal(completedEmpty('', { kind: 'ok', q: '', items: [] }, true), false);
  assert.equal(completedEmpty('Salma', { kind: 'ok', q: 'Salma', items: [{}] }, true), false);
});
test('only name text prefills; no fabricated DOB or phone', () => {
  for (const query of ['0591234567', '+970 (59) 123-4567', '٠٥٩١٢٣٤٥٦٧', '۰۵۹۱۲۳۴۵۶۷', '059 Salma']) assert.equal(registrationName(query), '');
  assert.equal(registrationName(' سليم ناصر '), 'سليم ناصر');
  assert.equal(registrationName('Salma Nasser'), 'Salma Nasser');
  assert.equal(registrationName('Salma Nasser 8472'), 'Salma Nasser 8472');
  const validation = validateRegistration({ ...EMPTY_DRAFT, name: registrationName('Salma Nasser') }, '2026-01-01');
  assert.equal(validation.ok, false);
  if (!validation.ok) { assert.equal(validation.errors.phone, 'required'); assert.equal(validation.errors.dob, 'required'); }
});
const patient = { id: 817, clinicId: 4, name: 'Salma Nasser', phone: '0591234567', dateOfBirth: '1994-02-17' };
test('refresh failure preserves created patient and operation identity; retry only refreshes', async () => {
  const created = { patient, operationId: 'same-operation' };
  let refreshes = 0;
  let reads = 0;
  const refresh = async () => { if (++refreshes === 1) throw new Error('network'); };
  const read = async () => { reads++; return { patients: [patient] }; };
  await assert.rejects(refreshRegisteredPatient(created, 4, refresh, read, () => true), /network/);
  assert.equal(reads, 0);
  assert.equal(created.operationId, 'same-operation');
  assert.equal(await refreshRegisteredPatient(created, 4, refresh, read, () => true), patient);
  assert.equal(refreshes, 2);
  assert.equal(reads, 1);
});
test('creation response alone cannot select an uncached or other-clinic patient', async () => {
  for (const patients of [[], [{ ...patient, clinicId: 8 }]]) {
    await assert.rejects(refreshRegisteredPatient({ patient, operationId: 'op' }, 4, async () => {}, async () => ({ patients }), () => true), /identity-not-cached/);
  }
});
test('clinic/account invalidation during refresh discards result before cache read', async () => {
  let current = true;
  let reads = 0;
  await assert.rejects(refreshRegisteredPatient({ patient, operationId: 'op' }, 4, async () => { current = false; }, async () => { reads++; return { patients: [patient] }; }, () => current), /stale-context/);
  assert.equal(reads, 0);
});
test('invalidation during cache read discards result', async () => {
  let current = true;
  await assert.rejects(refreshRegisteredPatient({ patient, operationId: 'op' }, 4, async () => {}, async () => { current = false; return { patients: [patient] }; }, () => current), /stale-context/);
});
test('registration uncertain retry preserves operation and blocks changed payload', () => {
  const session = createRegSession();
  assert.equal(opFor(session, 'payload', () => 'original'), 'original');
  settle(session, true);
  assert.equal(opFor(session, 'changed', () => 'duplicate'), null);
  assert.equal(opFor(session, 'payload', () => 'duplicate'), 'original');
});
