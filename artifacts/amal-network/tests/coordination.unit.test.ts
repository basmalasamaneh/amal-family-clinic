import assert from 'node:assert/strict';
import test from 'node:test';
import { mayCheckCoordination, mayShowCoordination } from '../src/coordination/model';
import { resolve, routesFor, landingFor } from '../src/shell/routes';

const doctor = { id: 'account:17', role: 'doctor' };
const grant = { accountId: doctor.id, canCoordinate: true, validUntil: 200 };
test('default deny and explicit doctor-only navigation/direct URL guard', () => {
  assert.equal(resolve('/doctor/coordination', 'doctor').kind, 'forbidden');
  assert.equal(routesFor('doctor').some(r => r.id === 'coordination'), false);
  assert.equal(resolve('/doctor/coordination', 'doctor', true).kind, 'page');
  assert.equal(resolve('/doctor/coordination', 'admin', true).kind, 'forbidden');
  assert.equal(resolve('/doctor/coordination', 'front-desk', true).kind, 'forbidden');
  assert.equal(landingFor('doctor'), '/doctor/my-day');
  assert.equal(routesFor('doctor', true).some(r => r.path.startsWith('/admin/')), false);
});
test('fresh grant is bound to account, role, online connection and expiry', () => {
  assert.equal(mayShowCoordination(doctor, true, false, grant, 100), true);
  assert.equal(mayShowCoordination(doctor, true, false, null, 100), false);
  assert.equal(mayShowCoordination(doctor, true, false, { ...grant, canCoordinate: false }, 100), false);
  assert.equal(mayShowCoordination({ ...doctor, id: 'account:18' }, true, false, grant, 100), false);
  assert.equal(mayShowCoordination({ ...doctor, role: 'admin' }, true, false, grant, 100), false);
  assert.equal(mayShowCoordination(doctor, false, false, grant, 100), false);
  assert.equal(mayShowCoordination(doctor, true, false, grant, 200), false);
});
test('offline restored sessions, expired sessions and fixtures cannot request authority', () => {
  assert.equal(mayCheckCoordination({ ...doctor, offlineRestored: true }, true, false), false);
  assert.equal(mayCheckCoordination({ ...doctor, expiresAt: '1970-01-01T00:00:00Z' }, true, false), false);
  assert.equal(mayCheckCoordination(doctor, true, true), false);
  assert.equal(mayCheckCoordination(doctor, false, false), false);
});
