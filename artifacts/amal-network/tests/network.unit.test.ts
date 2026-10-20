import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInstance } from 'i18next';
import type { NetworkPatient, NetworkVisit } from '@workspace/api-client-react';
import { clearSelection, clinicTone, effectiveConsent, findPatient, formatVisitDay, formatVisitTime, getSelection, latestVisit, normalizeQuery, orderVisits, patientAlerts, relativeLabel, relativeParts, setSelection, visitAlerts, visitNote, classifyFailure } from '../src/network/model';
import { networkAr, networkEn } from '../src/network/strings';

const NOW = new Date('2025-06-15T09:00:00Z');
const alert = { kind: 'allergy', labelKey: 'x.k', labelParams: {}, label: 'Penicillin', ruleId: null, dictionaryVersion: null, sourceNoteExcerpt: 'allergic to penicillin', excerptStart: null, excerptEnd: null, sourceVisitId: 1, patientId: 7, sourceClinicId: 2, sourceClinicName: 'B', sourceVisitDate: '2025-05-01', disclaimerKey: 'd', crossClinicDisclaimerKey: 'c' } as const;
const v = (seenAt: string, vis: 'basic' | 'clinical', extra: Partial<NetworkVisit> = {}): NetworkVisit => ({ clinicId: 2, doctorId: 3, clinicName: 'B', doctorName: 'Dr Y', seenAt, visibility: vis, ...extra });
const pt = (id: number, level: unknown, visits: NetworkVisit[]): NetworkPatient => ({ id, name: 'Same Name', identityVerified: false, visits, effectiveConsentLevel: level } as unknown as NetworkPatient);

test('effective consent comes only from server field, never visit visibility', () => {
  assert.equal(effectiveConsent(pt(1, 'clinical', [])), 'clinical');
  assert.equal(effectiveConsent(pt(1, 'none', [v('2025-01-01T00:00:00Z', 'clinical')])), 'none');
  assert.equal(effectiveConsent(pt(1, undefined, [v('2025-01-01T00:00:00Z', 'clinical')])), 'unknown');
  assert.equal(effectiveConsent(pt(1, 'admin', [])), 'unknown');
});
test('basic visits never expose notes or alerts even if present in payload', () => {
  const b = v('2025-01-01T00:00:00Z', 'basic', { complaint: 'leak', alerts: [alert as never] });
  assert.equal(visitNote(b), null); assert.deepEqual(visitAlerts(b), []);
  const c = v('2025-01-01T00:00:00Z', 'clinical', { complaint: 'cough', alerts: [] });
  assert.equal(visitNote(c), 'cough'); assert.deepEqual(visitAlerts(c), []);
  assert.equal(patientAlerts(pt(1, 'clinical', [c, b])).length, 0);
});
test('visits ordered newest first, summary uses disclosed visits only', () => {
  const vs = [v('2024-01-01T10:00:00Z', 'basic'), v('2025-05-25T10:00:00Z', 'basic', { clinicName: 'A' }), v('2024-06-01T10:00:00Z', 'basic')];
  assert.equal(orderVisits(vs)[0].clinicName, 'A');
  assert.equal(latestVisit(pt(1, 'basic', [])), null);
});
test('deterministic relative time with fixed clock in both locales', () => {
  assert.deepEqual(relativeParts('2025-05-25T09:00:00Z', NOW), { value: -3, unit: 'week' });
  assert.equal(relativeLabel('2025-05-25T09:00:00Z', NOW, 'en', 'latn'), '3 weeks ago');
  assert.match(relativeLabel('2025-05-25T09:00:00Z', NOW, 'ar', 'arab'), /٣/);
  assert.equal(relativeLabel('2025-06-15T08:00:00Z', NOW, 'en', 'latn'), 'today');
});
test('UTC instants display in Asia/Hebron across DST; date-only never shifts', () => {
  assert.equal(formatVisitDay('2025-01-15T22:30:00Z', 'en', 'latn'), '16 January 2025');
  assert.equal(formatVisitDay('2025-07-15T21:30:00Z', 'en', 'latn'), '16 July 2025');
  assert.equal(formatVisitDay('2025-07-15T20:30:00Z', 'en', 'latn'), '15 July 2025');
  assert.equal(formatVisitDay('2025-03-01', 'en', 'latn'), '1 March 2025');
});
test('clinic tone stable from id', () => { assert.equal(clinicTone(8), clinicTone(8)); assert.notEqual(clinicTone(1), clinicTone(2)); });
test('query bounds', () => { assert.equal(normalizeQuery(' a '), null); assert.equal(normalizeQuery('  ab  cd '), 'ab cd'); assert.equal(normalizeQuery('x'.repeat(201)), null); });
test('revalidation matches stable id across cursor pages; duplicate names stay distinct', async () => {
  const calls: unknown[] = [];
  const fetchPage = async (p: { cursor?: string }) => { calls.push(p.cursor); return p.cursor ? { items: [pt(9, 'basic', [])], nextCursor: null } : { items: [pt(8, 'basic', [])], nextCursor: 'c1' }; };
  const hit = await findPatient(fetchPage as never, 'Same Name', 9);
  assert.equal(hit?.id, 9); assert.deepEqual(calls, [undefined, 'c1']);
  assert.equal(await findPatient(fetchPage as never, 'Same Name', 99), null);
});
test('selection is memory-only and scoped; scope change clears it', () => {
  setSelection({ scope: 'u1:doctor:1', q: 'ab', id: 3 });
  assert.equal(getSelection('u1:doctor:1')?.id, 3);
  assert.equal(getSelection('u1:doctor:2'), null);
  assert.equal(getSelection('u1:doctor:1'), null);
  setSelection({ scope: 's', q: 'ab', id: 3 }); clearSelection(); assert.equal(getSelection('s'), null);
});
test('failure classification', () => { assert.equal(classifyFailure({ status: 403 }), 'denied'); assert.equal(classifyFailure({ status: 401 }), 'session'); assert.equal(classifyFailure(new TypeError('x')), 'error'); });
test('strings resolve in Arabic and English incl. cross-clinic disclaimer', async () => {
  const i = createInstance();
  await i.init({ lng: 'ar', fallbackLng: false, resources: { ar: { translation: { net: networkAr } }, en: { translation: { net: networkEn } } } });
  assert.equal(i.t('net.alert.crossClinic'), 'تنبيه من عيادة أخرى: تأكد مع المريض');
  for (const c of [1, 2, 3, 11, 100]) assert.notEqual(i.t('net.card.visits', { count: c }), 'net.card.visits');
  await i.changeLanguage('en');
  assert.equal(i.t('net.alert.crossClinic'), 'Flag from another clinic: confirm with the patient');
});

test('legacy Hebron start-of-day instants never show a fake 00:00 time', () => {
  assert.equal(formatVisitTime('2024-03-09T22:00:00Z', 'latn'), '');
  assert.equal(formatVisitTime('2024-07-09T21:00:00Z', 'latn'), '');
  assert.equal(formatVisitTime('2025-05-20T08:30:00Z', 'latn'), '11:30');
});
test('alert label keys from server dictionary resolve in both locales', async () => {
  const { alertLabelsAr, alertLabelsEn } = await import('../src/network/strings');
  const i = createInstance();
  await i.init({ lng: 'ar', fallbackLng: false, interpolation: { escapeValue: false }, resources: { ar: { translation: { alerts: alertLabelsAr } }, en: { translation: { alerts: alertLabelsEn } } } });
  for (const k of ['alerts.allergy.penicillin', 'alerts.allergy.latex', 'alerts.condition.diabetes', 'alerts.condition.asthma', 'alerts.condition.hypertension']) assert.ok(i.exists(k), k);
  assert.equal(i.t('alerts.bloodPressureMedication', { name: 'Amlodipine', doseSuffix: ' 5 mg' }), 'دواء ضغط الدم (Amlodipine 5 mg)');
  await i.changeLanguage('en');
  assert.equal(i.t('alerts.medication', { name: 'Metformin', doseSuffix: '' }), 'Metformin');
});
