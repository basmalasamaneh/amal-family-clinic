import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDob, completedYears, hebronToday, isMinor, MINOR_AGE } from '../src/reception/age';
import { EMPTY_DRAFT, isUncertain, reconcileGuardian, serverFieldErrors, validateRegistration } from '../src/reception/registration';
import { activeFuture, createFixtureReceptionApi, toUpcoming } from '../src/reception/api';
import { quickRows } from '../src/reception/slots';
import { createOpKeeper } from '../src/booking/ops';
import { createFixturePatientSearch } from '../src/booking/patients';
import { createInstance } from 'i18next';
import { receptionAr, receptionEn } from '../src/reception/strings';

const today = '2025-06-15';
test('age labels resolve every Arabic plural category and English age without raw keys', async () => {
  const i18n = createInstance();
  await i18n.init({ lng: 'ar', fallbackLng: false, resources: {
    ar: { translation: { rx: receptionAr } }, en: { translation: { rx: receptionEn } },
  } });
  for (const age of [0, 1, 2, 3, 11, 36, 100]) {
    assert.notEqual(i18n.t('rx.detail.ageYears', { count: age }), 'rx.detail.ageYears');
  }
  assert.equal(i18n.t('rx.detail.ageYears', { count: 36 }), '36 سنة');
  await i18n.changeLanguage('en');
  assert.equal(i18n.t('rx.detail.ageYears', { count: 1 }), '1 year');
  assert.equal(i18n.t('rx.detail.ageYears', { count: 36 }), '36 years');
});
test('registration phone validation matches operational formatting without altering source', () => {
  const draft = { ...EMPTY_DRAFT, name: 'Synthetic patient', dob: '1990-01-01', phone: '  (059) 000-1234  ' };
  const result = validateRegistration(draft, today);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.payload.phone, '(059) 000-1234');
  assert.equal(validateRegistration({ ...draft, phone: '12' }, today).ok, false);
  assert.equal(validateRegistration({ ...draft, phone: '123' }, today).ok, true);
  assert.equal(validateRegistration({ ...draft, phone: '1'.repeat(21) }, today).ok, false);
});
test('Hebron today uses Asia/Hebron calendar date, not UTC', () => {
  // 22:30 UTC on 14 June is already 15 June 01:30 in Hebron (UTC+3 summer).
  assert.equal(hebronToday(new Date('2025-06-14T22:30:00Z')), '2025-06-15');
  assert.equal(hebronToday(new Date('2025-06-14T20:59:00Z')), '2025-06-14');
});
test('completed birthdays at the 18th birthday boundary', () => {
  assert.equal(MINOR_AGE, 18);
  assert.equal(completedYears('2007-06-15', today), 18); assert.equal(isMinor('2007-06-15', today), false);
  assert.equal(completedYears('2007-06-16', today), 17); assert.equal(isMinor('2007-06-16', today), true);
  assert.equal(isMinor('2008-02-29', '2026-02-28'), true);
  assert.equal(isMinor('2008-02-29', '2026-03-01'), false);
});
test('DOB is date-only: invalid, future, missing rejected; never guessed', () => {
  assert.equal(checkDob('', today), 'required');
  assert.equal(checkDob('2025-02-30', today), 'invalid');
  assert.equal(checkDob('15/06/2000', today), 'invalid');
  assert.equal(checkDob('2025-06-16', today), 'future');
  assert.equal(checkDob('1899-12-31', today), null);
  assert.equal(checkDob('0001-01-01', today), null);
  assert.equal(checkDob('0000-01-01', today), 'invalid');
  assert.equal(checkDob('0004-02-29', today), null);
  assert.equal(checkDob('0100-02-29', today), 'invalid');
  assert.equal(checkDob('2025-06-15', today), null);
  assert.equal(isMinor('', today), null);
});
test('registration trims, keeps phone leading zero, requires guardian only for minors', () => {
  const adult = validateRegistration({ ...EMPTY_DRAFT, name: '  أحمد  ', phone: ' 0599 412 873 ', dob: '1990-01-01', guardianName: 'x', guardianRelation: 'mother' }, today);
  assert.ok(adult.ok);
  if (adult.ok) { assert.deepEqual(adult.payload, { name: 'أحمد', phone: '0599 412 873', dateOfBirth: '1990-01-01' }); }
  const minor = validateRegistration({ ...EMPTY_DRAFT, name: 'ليلى', phone: '0598650129', dob: '2012-05-08' }, today);
  assert.ok(!minor.ok); if (!minor.ok) { assert.equal(minor.errors.guardianName, 'required'); assert.equal(minor.errors.guardianRelation, 'required'); }
  const ok = validateRegistration({ ...EMPTY_DRAFT, name: 'ليلى', phone: '0598650129', dob: '2012-05-08', guardianName: ' هدى ', guardianRelation: 'mother' }, today);
  assert.ok(ok.ok); if (ok.ok) assert.deepEqual(ok.payload, { name: 'ليلى', phone: '0598650129', dateOfBirth: '2012-05-08', guardianName: 'هدى', guardianRelation: 'mother' });
  const bad = validateRegistration({ ...EMPTY_DRAFT, name: '   ', phone: 'abc', dob: '' }, today);
  assert.ok(!bad.ok); if (!bad.ok) assert.deepEqual(bad.errors, { name: 'required', phone: 'phoneFormat', dob: 'required' });
});
test('guardian values cleared when DOB becomes adult, kept while DOB incomplete', () => {
  const d = { ...EMPTY_DRAFT, dob: '2012-05-08', guardianName: 'هدى', guardianRelation: 'mother' };
  assert.equal(reconcileGuardian(d, today), d);
  assert.equal(reconcileGuardian({ ...d, dob: '' }, today).guardianName, 'هدى');
  const adult = reconcileGuardian({ ...d, dob: '1980-01-01' }, today);
  assert.equal(adult.guardianName, ''); assert.equal(adult.guardianRelation, '');
});
test('server error mapping and uncertain outcomes', () => {
  assert.deepEqual(serverFieldErrors({ kind: 'validation', code: 'x', status: 422 }, { params: { field: 'dateOfBirth' } }), { dob: 'server' });
  assert.deepEqual(serverFieldErrors({ kind: 'conflict', code: 'x', status: 409 }, { params: { field: 'name' } }), {});
  assert.ok(isUncertain({ kind: 'network', code: null, status: null }));
  assert.ok(isUncertain({ kind: 'server', code: null, status: 500 }));
  assert.ok(!isUncertain({ kind: 'validation', code: null, status: 400 }));
});
test('same payload retry reuses clientOpId; fixture create is idempotent and rejects changed payload', async () => {
  const k = createOpKeeper(); const a = k.idFor({ name: 'x' }); assert.equal(k.idFor({ name: 'x' }), a); assert.notEqual(k.idFor({ name: 'y' }), a);
  const api = createFixtureReceptionApi(async () => [], 0);
  const p1 = await api.createPatient({ name: 'A', phone: '0599', dateOfBirth: '1990-01-01', clientOpId: 'op1' });
  const p2 = await api.createPatient({ name: 'A', phone: '0599', dateOfBirth: '1990-01-01', clientOpId: 'op1' });
  assert.equal(p1.id, p2.id);
  await assert.rejects(api.createPatient({ name: 'B', phone: '0599', dateOfBirth: '1990-01-01', clientOpId: 'op1' }), (e: { status: number }) => e.status === 409);
});
test('upcoming projection keeps only scheduling fields, active future, chronological', () => {
  const now = Date.parse('2025-06-15T10:00:00Z');
  const raw = [
    { id: 3, doctorId: 1, startsAt: '2025-06-20T08:00:00Z', endsAt: '2025-06-20T08:20:00Z', status: 'booked', notes: 'secret', patientId: 9 },
    { id: 1, doctorId: 1, startsAt: '2025-06-16T08:00:00Z', endsAt: '2025-06-16T08:20:00Z', status: 'double_booked' },
    { id: 2, doctorId: 1, startsAt: '2025-06-17T08:00:00Z', endsAt: '2025-06-17T08:20:00Z', status: 'cancelled' },
    { id: 4, doctorId: 1, startsAt: '2025-06-14T08:00:00Z', endsAt: '2025-06-14T08:20:00Z', status: 'booked' },
  ];
  const out = activeFuture(raw.map(toUpcoming), now);
  assert.deepEqual(out.map((a) => a.id), [1, 3]);
  assert.deepEqual(Object.keys(out[1]!).sort(), ['doctorId', 'endsAt', 'id', 'startsAt', 'status']);
});
test('quick rows: nearest slot per doctor, never invents a doctor, slotless last', () => {
  const docs = [{ id: 1, clinicId: 5, name: 'A' }, { id: 2, clinicId: 5, name: 'B' }, { id: 3, clinicId: 5, name: 'C' }];
  const rows = quickRows(docs, [
    { doctorId: 2, startsAt: '2025-06-15T09:00:00Z', endsAt: '2025-06-15T09:20:00Z' },
    { doctorId: 1, startsAt: '2025-06-15T10:00:00Z', endsAt: '2025-06-15T10:20:00Z' },
    { doctorId: 1, startsAt: '2025-06-15T09:40:00Z', endsAt: '2025-06-15T10:00:00Z' },
    { doctorId: 99, startsAt: '2025-06-15T08:00:00Z', endsAt: '2025-06-15T08:20:00Z' },
  ]);
  assert.deepEqual(rows.map((r) => [r.doctor.id, r.slot?.startsAt ?? null]), [[2, '2025-06-15T09:00:00Z'], [1, '2025-06-15T09:40:00Z'], [3, null]]);
});
test('fixture search pages with an opaque cursor and keeps same-name patients distinct', async () => {
  const s = createFixturePatientSearch(() => 0);
  const r = await s.search('محمد احمد', 1);
  assert.equal(new Set(r.items.map((p) => p.id)).size, r.items.length);
  assert.ok(r.items.length >= 2);
});
test('registration session pins clientOpId across uncertain outcomes and blocks changed payload', async () => {
  const { createRegSession, opFor, settle } = await import('../src/reception/registration');
  const s = createRegSession(); let n = 0; const gen = () => 'op' + ++n;
  const a = opFor(s, 'k1', gen); settle(s, true);
  assert.equal(opFor(s, 'k1', gen), a);
  assert.equal(opFor(s, 'k2', gen), null);
  settle(s, false);
  assert.equal(opFor(s, 'k2', gen), 'op2');
});
test('quickRows ranks a preferred roster doctor first and ignores unknown ids', async () => {
  const { quickRows } = await import('../src/reception/slots');
  const docs = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] as never;
  const items = [{ doctorId: 1, startsAt: '2030-01-01T08:00:00Z', endsAt: '2030-01-01T08:20:00Z' }, { doctorId: 2, startsAt: '2030-01-01T09:00:00Z', endsAt: '2030-01-01T09:20:00Z' }];
  assert.deepEqual(quickRows(docs, items, 2).map((r) => r.doctor.id), [2, 1]);
  assert.deepEqual(quickRows(docs, items, 99).map((r) => r.doctor.id), [1, 2]);
});
