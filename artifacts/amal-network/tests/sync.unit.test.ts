import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Appointment, SyncConflict } from '@workspace/api-client-react';
import {
  explicitOtherRef, gateCall, gateMoveOther, gateMoveSelf, sanitizePhone, validateOtherDestination, verifyOther, type GateInput,
} from '../src/sync/resolution-model';

test('sanitizePhone keeps plus and digits, rejects unsafe input', () => {
  assert.equal(sanitizePhone(' +970 (59) 123-4567 '), '+970591234567');
  assert.equal(sanitizePhone('0599123456'), '0599123456');
  assert.equal(sanitizePhone('javascript:alert(1)'), null);
  assert.equal(sanitizePhone('0599;ext=1'), null);
  assert.equal(sanitizePhone('12'), null);
  assert.equal(sanitizePhone(null), null);
  assert.equal(sanitizePhone('1234567890123456'), null);
});

const item = (type: string, w: { appointmentId: number; clinicId: number } | null) => ({ type, with: w, severity: 'blocking', suggestedSlots: [] });
const c = (reasons: unknown[]) => ({ reasons } as unknown as Pick<SyncConflict, 'reasons'>);

test('explicitOtherRef only accepts a single same-clinic overlap reference', () => {
  assert.deepEqual(explicitOtherRef(c([item('outside-hours', null)]), 1), { kind: 'none' });
  assert.deepEqual(explicitOtherRef(c([item('doctor-overlap', { appointmentId: 9, clinicId: 2 })]), 1), { kind: 'hidden' });
  assert.deepEqual(explicitOtherRef(c([item('same-day-other-clinic', { appointmentId: 9, clinicId: 1 })]), 1), { kind: 'hidden' });
  assert.deepEqual(explicitOtherRef(c([item('doctor-overlap', { appointmentId: 9, clinicId: 1 }), item('patient-overlap', { appointmentId: 8, clinicId: 1 })]), 1), { kind: 'hidden' });
  assert.deepEqual(explicitOtherRef(c([item('doctor-overlap', { appointmentId: 9, clinicId: 1 })]), 1), { kind: 'ref', ref: { appointmentId: 9, type: 'doctor-overlap' } });
});

const appt = (o: Partial<Appointment> = {}): Appointment => ({ id: 9, clinicId: 1, doctorId: 3, patientId: 4, startsAt: '2030-01-01T08:00:00.000Z', endsAt: '2030-01-01T08:20:00.000Z', source: 'phone', clientOpId: null, status: 'booked', version: 5, ...o });

test('verifyOther requires exact id, clinic, active status and matching identity', () => {
  const ref = { appointmentId: 9, type: 'doctor-overlap' as const };
  assert.ok(verifyOther(appt(), ref, { clinicId: 1, doctorId: 3 }));
  assert.equal(verifyOther(appt({ id: 10 }), ref, { clinicId: 1, doctorId: 3 }), null);
  assert.equal(verifyOther(appt({ clinicId: 2 }), ref, { clinicId: 1, doctorId: 3 }), null);
  assert.equal(verifyOther(appt({ doctorId: 7 }), ref, { clinicId: 1, doctorId: 3 }), null);
  assert.equal(verifyOther(appt({ status: 'cancelled' }), ref, { clinicId: 1, doctorId: 3 }), null);
  assert.equal(verifyOther(appt(), { appointmentId: 9, type: 'patient-overlap' }, { clinicId: 1, patientId: 5 }), null);
  assert.equal(verifyOther(undefined, ref, { clinicId: 1, doctorId: 3 }), null);
});

test('validateOtherDestination converts Asia/Hebron wall clock and rejects bad input', () => {
  const now = new Date('2029-12-31T00:00:00Z');
  const kept = { startsAt: '2030-01-01T08:00:00.000Z', endsAt: '2030-01-01T08:20:00.000Z' };
  assert.deepEqual(validateOtherDestination('', '', appt(), kept, now), { ok: false, error: 'empty' });
  const r = validateOtherDestination('2030-01-01', '12:00', appt(), kept, now);
  assert.ok(r.ok && r.startsAt === '2030-01-01T10:00:00.000Z' && r.endsAt === '2030-01-01T10:20:00.000Z');
  assert.deepEqual(validateOtherDestination('2030-01-01', '10:10', appt(), kept, now), { ok: false, error: 'overlapsKept' });
  assert.deepEqual(validateOtherDestination('2020-01-01', '12:00', appt(), kept, now), { ok: false, error: 'past' });
  assert.deepEqual(validateOtherDestination('2030-01-01', '25:00', appt(), kept, now), { ok: false, error: 'invalid' });
});

const g = (o: Partial<GateInput> = {}): GateInput => ({ resolved: false, locked: false, busy: false, pendingIntent: false, slotCount: 1, moveSelected: true, otherState: 'verified', destValid: true, ...o });

test('action gating: pending intent and lock block new payloads; selections never implied', () => {
  assert.equal(gateMoveSelf(g()), null);
  assert.equal(gateMoveSelf(g({ moveSelected: false })), 'noSelection');
  assert.equal(gateMoveSelf(g({ slotCount: 0 })), 'noSlots');
  assert.equal(gateMoveOther(g()), null);
  assert.equal(gateMoveOther(g({ destValid: false })), 'noSelection');
  assert.equal(gateMoveOther(g({ otherState: 'hidden' })), 'otherHidden');
  assert.equal(gateMoveOther(g({ otherState: 'unavailable' })), 'otherUnavailable');
  assert.equal(gateMoveOther(g({ otherState: 'loading' })), 'otherLoading');
  for (const fn of [gateMoveSelf, gateMoveOther, gateCall]) {
    assert.equal(fn(g({ pendingIntent: true })), 'pendingIntent');
    assert.equal(fn(g({ locked: true })), 'locked');
    assert.equal(fn(g({ resolved: true })), 'resolved');
  }
});
