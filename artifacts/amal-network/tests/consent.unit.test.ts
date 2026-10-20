import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendAccess, buildBody, classifyOutcome, clearConsentSelection, EMPTY_DRAFT, formatAt, isConsentSelected, isDowngrade,
  parseAccessPage, parseConsentView, confirms, getUnresolved, putUnresolved, resolveUnresolved, unresolvedKey, hasUnresolvedOp, parsePatientId, rowState, selectConsentPatient, settle, validateDraft, type PendingOp,
} from '../src/consent/model';
import { consentAr, consentEn } from '../src/consent/strings';
import { resolve, routesFor, landingFor } from '../src/shell/routes';

const c = (id: number, level: 'none' | 'basic' | 'clinical', status: 'active' | 'withdrawn' = 'active') => ({ id, patientId: 7, level, status, recordedAt: '2025-06-14T21:30:00Z' });
const raw = (over: Record<string, unknown> = {}) => ({ current: c(3, 'basic'), history: [c(3, 'basic'), c(2, 'clinical'), c(1, 'basic', 'withdrawn')], effectiveLevel: 'basic',
  patient: { id: 7, name: 'Rana' }, eligibility: { dateOfBirth: '2010-02-01', ageStatus: 'minor', asOfDate: '2025-06-15' }, canWithdraw: true, ...over });

test('bilingual strings complete', () => {
  const walk = (en: Record<string, unknown>, ar: Record<string, unknown>, p: string) => { for (const k of Object.keys(en)) {
    if (typeof en[k] === 'string') assert.ok(typeof ar[k] === 'string' && (ar[k] as string).trim(), `${p}.${k}`);
    else walk(en[k] as Record<string, unknown>, ar[k] as Record<string, unknown>, `${p}.${k}`); } };
  walk(consentEn, consentAr, 'cs');
});
test('server state parsed strictly; patient mismatch fails closed', () => {
  assert.equal(parseConsentView(raw(), 7).eligibility.ageStatus, 'minor');
  assert.throws(() => parseConsentView(raw(), 8));
  assert.throws(() => parseConsentView(raw({ eligibility: { ageStatus: 'teen', asOfDate: 'x' } }), 7));
  assert.equal(parseConsentView(raw({ canWithdraw: 'yes' }), 7).canWithdraw, false);
});
test('only current active row is in effect; older grants never look active', () => {
  const v = parseConsentView(raw(), 7);
  assert.deepEqual(v.history.map((h) => rowState(h, v)), ['inEffect', 'superseded', 'withdrawn']);
  const w = parseConsentView(raw({ current: c(3, 'basic', 'withdrawn'), history: [c(3, 'basic', 'withdrawn'), c(2, 'clinical')], effectiveLevel: 'none' }), 7);
  assert.deepEqual(w.history.map((h) => rowState(h, w)), ['withdrawn', 'superseded']);
});
test('minor guardian required (trimmed) even for none; adult omits guardian; unknown age blocks grants', () => {
  const d = { ...EMPTY_DRAFT, level: 'none' as const, evidence: 'verbal' as const, guardianName: '   ', guardianRelation: 'Mother' };
  assert.deepEqual(validateDraft(d, 'minor'), ['guardianName']);
  const ok = { ...d, guardianName: '  Huda  ' };
  assert.deepEqual(validateDraft(ok, 'minor'), []);
  assert.deepEqual(buildBody(ok, 'minor', 'op').guardian, { name: 'Huda', relationship: 'Mother' });
  assert.equal(buildBody(ok, 'adult', 'op').guardian, undefined);
  assert.deepEqual(validateDraft({ ...d, level: 'basic' }, 'unknown'), ['ageUnknown']);
  assert.deepEqual(validateDraft({ ...d, level: 'none' }, 'unknown'), []);
  assert.deepEqual(validateDraft(EMPTY_DRAFT, 'adult'), ['level', 'evidence']);
});
test('downgrade detection', () => { assert.ok(isDowngrade('clinical', 'basic')); assert.ok(!isDowngrade('basic', 'clinical')); assert.ok(isDowngrade('basic', 'none')); });
test('ambiguous ops are retained until an exact replay resolves them', () => {
  const op: PendingOp = { kind: 'withdraw', scope: 's', patientId: 7, consentId: 3, body: { clientOpId: 'u1' }, ambiguous: false };
  assert.equal(classifyOutcome(new TypeError('fetch')), 'ambiguous');
  assert.equal(classifyOutcome({ status: 503 }), 'ambiguous');
  assert.equal(classifyOutcome({ status: 403, data: { messageKey: 'error.reauthRequired' } }), 'needsPin');
  assert.equal(classifyOutcome({ status: 422 }), 'rejected');
  const amb = settle(op, 'ambiguous')!;
  assert.equal(amb.ambiguous, true); assert.equal(amb.body.clientOpId, 'u1');
  assert.equal(settle(amb, 'needsPin'), amb);
  assert.equal(settle(amb, 'rejected'), amb);
  assert.equal(settle(amb, 'ok'), null);
  assert.equal(settle(op, 'rejected'), null);
  assert.equal(settle(op, 'needsPin'), null);
});
test('access page: safe nulls, dedupe, newest first', () => {
  const p = parseAccessPage({ items: [{ id: 2, at: '2025-06-14T10:00:00Z', viewerName: ' ', viewerRole: null, viewerClinicName: 'B', action: 'patient-view' }, { id: 9, at: 'x', action: 'other' }], nextCursor: '' });
  assert.equal(p.items.length, 1); assert.equal(p.items[0].viewerName, null); assert.equal(p.nextCursor, null);
  const m = appendAccess(p.items, [{ ...p.items[0] }, { ...p.items[0], id: 3, at: '2025-06-15T10:00:00Z' }]);
  assert.deepEqual(m.map((i) => i.id), [3, 2]);
});
test('Hebron times with digit preference', () => {
  assert.equal(formatAt('2025-06-14T21:30:00Z', 'en', 'latn'), '15 Jun 2025 · 00:30');
  assert.match(formatAt('2025-06-14T21:30:00Z', 'ar', 'arab')!, /١٥/);
  assert.equal(formatAt('2025-06-14', 'en', 'latn'), null);
});
test('route guard: explicit clinic-scoped selection, front-desk only, hidden from nav', () => {
  assert.equal(parsePatientId('?patientId=12'), 12); assert.equal(parsePatientId('?patientId=0'), null); assert.equal(parsePatientId('?patientId=1e3'), null);
  clearConsentSelection(); assert.ok(!isConsentSelected(1, 12));
  selectConsentPatient(1, 12); assert.ok(isConsentSelected(1, 12)); assert.ok(!isConsentSelected(2, 12)); assert.ok(!isConsentSelected(1, 13));
  clearConsentSelection(); assert.ok(!isConsentSelected(1, 12));
  assert.equal(resolve('/desk/consent', 'doctor').kind, 'forbidden');
  assert.equal(resolve('/desk/consent', 'admin').kind, 'forbidden');
  assert.equal(resolve('/desk/consent', 'front-desk').kind, 'page');
  assert.equal(landingFor('front-desk'), '/desk/today');
  assert.ok(routesFor('front-desk').find((r) => r.id === 'consent')?.navHidden);
});

test('unresolved op survives navigation, scoped per identity+clinic+patient, cleared on scope switch without completing token', () => {
  const op: PendingOp = { kind: 'record', scope: 'u1:front-desk:1', patientId: 7, body: { level: 'none', evidence: 'verbal', clientOpId: 'x' }, ambiguous: true };
  const k = unresolvedKey('u1:front-desk:1', 7);
  putUnresolved(k, { op, token: 't1' });
  assert.equal(getUnresolved(unresolvedKey('u1:front-desk:2', 7)), null);
  assert.equal(getUnresolved(unresolvedKey('u2:front-desk:1', 7)), null);
  assert.deepEqual(getUnresolved(k)?.op, op);
  assert.ok(hasUnresolvedOp());
  clearConsentSelection();
  assert.equal(getUnresolved(k), null);
  putUnresolved(k, { op: null, token: 't2' });
  assert.equal(resolveUnresolved(k), 't2'); assert.equal(getUnresolved(k), null);
});
test('receipt is confirmed only by matching authoritative state (concurrent replacement detected)', () => {
  const rec: PendingOp = { kind: 'record', scope: 's', patientId: 7, body: { level: 'basic', evidence: 'verbal', clientOpId: 'a' }, ambiguous: false };
  assert.ok(confirms(rec, parseConsentView(raw(), 7)));
  assert.ok(!confirms(rec, parseConsentView(raw({ current: c(4, 'clinical'), effectiveLevel: 'clinical' }), 7)));
  const wd: PendingOp = { kind: 'withdraw', scope: 's', patientId: 7, consentId: 3, body: { clientOpId: 'b' }, ambiguous: false };
  assert.ok(!confirms(wd, parseConsentView(raw(), 7)));
  assert.ok(confirms(wd, parseConsentView(raw({ current: c(3, 'basic', 'withdrawn'), effectiveLevel: 'none' }), 7)));
  assert.ok(!confirms(wd, parseConsentView(raw({ current: c(5, 'basic'), effectiveLevel: 'basic' }), 7)));
});
