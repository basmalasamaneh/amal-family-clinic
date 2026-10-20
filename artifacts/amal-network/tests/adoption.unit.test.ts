import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFailure, clearMarker, createMutex, dropsRemote, keepsMarker, readMarker, writeMarker, isCrossClinicKey, mayStart, reasonKey } from '../src/adoption/model';
import { adoptionAr, adoptionEn } from '../src/adoption/strings';

test('failure classification', () => {
  assert.equal(classifyFailure(new TypeError('x')), 'uncertain');
  assert.equal(classifyFailure({ status: 502 }), 'uncertain');
  assert.equal(classifyFailure({ status: 403 }), 'denied');
  assert.equal(classifyFailure({ status: 409, data: { code: 'CLINIC_LEFT' } }), 'left');
  assert.equal(classifyFailure({ status: 409, data: { code: 'LIFECYCLE_RETRY' } }), 'busy');
  assert.equal(classifyFailure({ status: 413 }), 'tooLarge');
});
test('mutex blocks duplicates; unresolved permits exact retry only', () => {
  const m = createMutex();
  assert.ok(m.acquire({ kind: 'full', clinicId: 2 }));
  assert.ok(!m.acquire({ kind: 'leave', clinicId: 2 }));
  m.release(); assert.ok(m.acquire({ kind: 'leave', clinicId: 2 }));
  const u = { kind: 'leave' as const, clinicId: 2 };
  assert.ok(mayStart({ kind: 'leave', clinicId: 2 }, u));
  assert.ok(!mayStart({ kind: 'full', clinicId: 2 }, u));
  assert.ok(!mayStart({ kind: 'export', clinicId: 2 }, u));
});
test('cross-clinic keys', () => {
  assert.ok(isCrossClinicKey(['/api/network/patients']));
  assert.ok(!isCrossClinicKey(['/api/clinics/2/adoption']));
});
test('reason keys are stable and unknown maps safely', () => {
  assert.equal(reasonKey('NO_LOOKUP_SAMPLES'), 'NO_LOOKUP_SAMPLES');
  assert.equal(reasonKey('Something else'), 'UNKNOWN');
  assert.equal(reasonKey(null), 'UNKNOWN');
  for (const k of ['SCENARIO_UNCONFIGURED', 'SCENARIO_CLINICS_UNAVAILABLE', 'NO_PREVENTION_EVIDENCE', 'NO_LOOKUP_SAMPLES', 'UNKNOWN'] as const) assert.ok(adoptionEn.results.reasons[k] && adoptionAr.results.reasons[k]);
});
test('503 and other 5xx are uncertain', () => {
  assert.equal(classifyFailure({ status: 503 }), 'uncertain');
  assert.equal(classifyFailure({ status: 503, data: { code: 'EXPORT_RESOURCE_UNAVAILABLE' } }), 'unavailable');
});
test('AR/EN parity, no emoji, no-monitoring title', () => {
  const walk = (en: Record<string, unknown>, ar: Record<string, unknown>, p: string) => { for (const k of Object.keys(en)) {
    if (typeof en[k] === 'string') { assert.ok(typeof ar[k] === 'string' && (ar[k] as string).trim(), p + k); assert.ok(!/\p{Extended_Pictographic}/u.test(en[k] as string + ar[k])); }
    else walk(en[k] as Record<string, unknown>, ar[k] as Record<string, unknown>, p + k + '.'); } };
  walk(adoptionEn, adoptionAr, '');
  assert.equal(adoptionEn.monitoring.title, 'No monitoring of individual doctors');
});

test('marker persists per account+clinic, validates and clears', () => {
  const m = new Map<string, string>();
  const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  writeMarker('u1', { kind: 'leave', clinicId: 2 }, st);
  assert.deepEqual(readMarker('u1', 2, st), { kind: 'leave', clinicId: 2 });
  assert.equal(readMarker('u2', 2, st), null);
  assert.equal(readMarker('u1', 3, st), null);
  m.set('amal:adoption:unresolved:u1:4', '{"kind":"export","clinicId":4}');
  assert.equal(readMarker('u1', 4, st), null);
  clearMarker('u1', 2, st); assert.equal(readMarker('u1', 2, st), null);
  assert.ok(keepsMarker('uncertain')); assert.ok(!keepsMarker('denied')); assert.ok(!keepsMarker('left'));
  assert.ok(dropsRemote('lite') && dropsRemote('leave') && !dropsRemote('full') && !dropsRemote('export'));
});
