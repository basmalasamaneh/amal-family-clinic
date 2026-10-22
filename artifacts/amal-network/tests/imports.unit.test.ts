import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ImportBatch, ImportRow } from '@workspace/api-client-react';
import { importAr, importEn } from '../src/imports/strings';
import {
  _resetPendingMemory, buildReview, canEnter, commitBody, commitReady, conflictSeverity, counts, emailGroups, effectiveDoctor, failure, isUncertain, openConflicts, parseExport, readLastBatch, readPending, rowState, stepOpen, toWall, validDateOnly, validate, writeLastBatch, writePending,
  type Draft, type Extras,
} from '../src/imports/model';
import { diff, verdict } from '../src/duplicates/model';
import { formatInstant } from '../src/shell/formatting';
import { SHELL_ROUTES, resolve } from '../src/shell/routes';
import { createOpKeeper } from '../src/booking/ops';

const leaves = (o: unknown, p = ''): string[] => typeof o === 'object' && o !== null ? Object.entries(o).flatMap(([k, v]) => leaves(v, p ? `${p}.${k}` : k)) : [p];
const get = (o: unknown, path: string) => path.split('.').reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Record<string, unknown>)[k] : undefined), o);

test('English and Arabic strings are complete, non-empty and emoji-free', () => {
  const en = leaves(importEn).sort(), ar = leaves(importAr).sort();
  assert.deepEqual(ar, en);
  for (const k of en) {
    for (const s of [get(importEn, k), get(importAr, k)]) {
      assert.ok(typeof s === 'string' && s.trim().length > 0, k);
      assert.ok(!/\p{Extended_Pictographic}/u.test(s as string), k);
    }
  }
});

test('every literal im.* key used in source exists', () => {
  const files = ['src/imports/ImportPage.tsx', 'src/imports/RowDialog.tsx', 'src/imports/ui.tsx', 'src/duplicates/DuplicatesPage.tsx', 'src/imports/i18n.ts'];
  const root = { im: importEn };
  for (const f of files) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/t\('(im\.[A-Za-z0-9_.]+)'/g)) {
      const k = m[1]!;
      const v = get(root, k) ?? get(root, `${k}_one`) ?? get(root, `${k}_other`);
      assert.ok(v !== undefined, `${f}: ${k}`);
    }
  }
});

const row = (id: number, over: Partial<ImportRow> = {}): ImportRow => ({
  id, source: { event_id: `ev-${id}`, doctor_email: 'dr.a@clinic.ps', patient_name_typed: `Patient ${id}`, start_time: '2025-03-29T09:00:00', end_time: '2025-03-29T09:20:00', event_status: 'confirmed' },
  errors: [], suggestedPatientIds: [id + 100], confirmedPatientId: null, review: null, mapping: { doctorId: 7, startsAt: '2025-07-15T07:00:00Z', endsAt: '2025-03-29T07:20:00Z' }, availableActions: ['include', 'skip'],
  ...over,
} as unknown as ImportRow);
const batchOf = (rows: ImportRow[], status = 'staged'): ImportBatch => ({ id: 1, version: 1, status, rows, conflicts: [], totals: { autoLinked: 0, intraExportPairs: 0, existingOverlaps: 0, existingCoincidences: 0 } } as unknown as ImportBatch);
const X: Extras = { startLocal: '', endLocal: '', associateAppointmentId: null, overrideReason: '' };

test('24 synthetic rows all start open with zero auto-links and each needs its own decision', () => {
  const b = batchOf(Array.from({ length: 24 }, (_, i) => row(i + 1)));
  const allowed = new Set([7]);
  const g = emailGroups(b);
  const doc = (e: string) => effectiveDoctor(g.find((x) => x.email === e)!, {}, allowed);
  const c = counts(b, doc);
  assert.equal(c.open, 24); assert.equal(c.autoLinked, 0); assert.equal(c.include, 0);
  const open = stepOpen(b, g, doc);
  assert.equal(open.patients, 24);
  assert.equal(canEnter(3, open, true), false);
  assert.equal(commitReady(b, open), false);
});

test('identity verification and new-patient rules', () => {
  const base: Draft = { kind: 'existing', patientId: 5, method: 'phone', value: '' };
  assert.deepEqual(validate(base, X, 7), ['errVerify']);
  assert.deepEqual(validate({ ...base, method: 'dob', value: '1990-02-30' }, X, 7), ['errVerify']);
  assert.deepEqual(validate({ ...base, method: 'dob', value: '1990-02-28' }, X, 7), []);
  assert.deepEqual(validate({ ...base, patientId: null, value: '0599' }, X, 7), ['errPick']);
  const create: Draft = { kind: 'create', name: 'Lina', phone: '', dob: '', guardianName: '', guardianRelation: '' };
  assert.deepEqual(validate(create, X, 7).sort(), ['errDob', 'errPhone']);
  const body = buildReview(3, { ...create, phone: '+970599000111', dob: '2001-04-05' }, X, 7);
  assert.equal(body.action, 'include');
  assert.deepEqual(validate({ kind: 'skip', reason: ' ' }, X, 7), ['errReason']);
  assert.deepEqual(validate(create, { ...X, startLocal: '2025-03-30T10:00' }, 7).includes('errTimes'), true);
  assert.equal(toWall('2025-03-30T10:00'), '2025-03-30T10:00:00');
  assert.equal(validDateOnly('2024-02-29'), true);
});

test('legacy overlap acknowledgements cannot clear import conflicts or forward a reason', () => {
  for (const code of ['patient-overlap', 'PATIENT_OVERLAP']) {
    for (const severity of ['blocking', 'warning', 'info', 'acknowledged'] as const) {
      const c = { kind: 'existing-appointment' as const, code, messageKey: 'conflict.patientOverlap', severity, rowIds: [1] };
      assert.equal(conflictSeverity(c), 'blocking');
      assert.deepEqual(openConflicts([c]), [c]);
    }
  }
  const info = { kind: 'policy' as const, code: 'same-day-other-clinic', messageKey: 'conflict.sameDayOtherClinic', severity: 'info' as const, rowIds: [1] };
  assert.equal(conflictSeverity(info), 'info');
  assert.deepEqual(openConflicts([info]), []);
  const d: Draft = { kind: 'existing', patientId: 5, method: 'phone', value: '0599000111' };
  assert.equal('overrideReason' in buildReview(1, d, { ...X, overrideReason: 'legacy approval' }, 7), false);
  const source = readFileSync(new URL('../src/imports/RowDialog.tsx', import.meta.url), 'utf8');
  assert.equal(source.includes('input-override-reason'), false);
});

test('unmapped doctor with no authorized doctors can be individually skipped from mapping and reach commit', () => {
  const r = row(1, { mapping: null, suggestedPatientIds: [], errors: [] });
  const b = batchOf([r]);
  const doc = () => null;
  assert.equal(stepOpen(b, emailGroups(b), doc).doctors, 1);
  assert.equal(canEnter(1, stepOpen(b, emailGroups(b), doc), true), true);
  const source = readFileSync(new URL('../src/imports/ImportPage.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('button-unmapped-review-${row.id}'), 'doctor step exposes individual review without a doctor');
  assert.deepEqual(validate({ kind: 'skip', reason: '' }, X, null), ['errReason']);
  const choice = buildReview(1, { kind: 'skip', reason: 'Unknown source doctor' }, X, null);
  assert.deepEqual(choice, { rowId: 1, action: 'skip', reason: 'Unknown source doctor' });
  r.review = { action: 'skip', reason: 'Unknown source doctor' } as ImportRow['review'];
  const saved = batchOf([r], 'reviewed');
  const open = stepOpen(saved, emailGroups(saved), doc);
  assert.equal(open.doctors, 0);
  assert.equal(canEnter(5, open, true), true);
  assert.equal(commitReady(saved, open), true);
});

test('changing the mapped doctor makes included rows stale', () => {
  const r = row(1, { review: { rowId: 1, action: 'include' } as never });
  assert.equal(rowState(r, () => 7), 'include');
  assert.equal(rowState(r, () => 8), 'stale');
  const g = emailGroups(batchOf([r]))[0]!;
  assert.equal(effectiveDoctor(g, { [g.email]: 99 }, new Set([7])), 7, 'unauthorized choice ignored');
});

const memStore = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } };

test('unresolved commit body is reused exactly across version change and reopen; resolved rotates', () => {
  _resetPendingMemory();
  const s = memStore(); let n = 0; const gen = () => `op-${++n}`;
  const a = commitBody('u1:front-desk:3', 9, 3, gen, s).body;
  const reopened = commitBody('u1:front-desk:3', 9, 4, gen, s).body; // refetch bumped version
  assert.deepEqual(reopened, a, 'exact original body retained');
  assert.deepEqual(readPending('u1:front-desk:3', 9, s), a);
  assert.equal(readPending('u2:doctor:3', 9, s), null, 'scoped per user');
  writePending('u1:front-desk:3', 9, null, s);
  const c = commitBody('u1:front-desk:3', 9, 4, gen, s).body;
  assert.notEqual(c.clientOpId, a.clientOpId); assert.equal(c.expectedVersion, 4);
});

test('storage failure keeps the exact pending request in memory and reports non-durable', () => {
  _resetPendingMemory();
  let n = 0; const gen = () => `op-${++n}`;
  const first = commitBody('s', 5, 2, gen, broken);
  assert.equal(first.durable, false);
  const again = commitBody('s', 5, 7, gen, broken);
  assert.deepEqual(again.body, first.body);
  assert.equal(writePending('s', 5, null, broken), false);
  assert.equal(readPending('s', 5, broken), null);
});

test('last batch is keyed by user scope and survives storage exceptions', () => {
  const s = memStore();
  writeLastBatch('u1:doctor:3', 12, s);
  assert.equal(readLastBatch('u1:doctor:3', s), 12);
  assert.equal(readLastBatch('u2:doctor:3', s), null);
  assert.equal(readLastBatch('u1:doctor:4', s), null);
  assert.equal(readLastBatch('x', broken), null);
  assert.equal(writeLastBatch('x', 3, broken), false);
});

test('uncertainty: every 5xx, no status and parse errors; 4xx are definitive', () => {
  for (const st of [500, 501, 502, 503, 504, 599]) assert.equal(isUncertain({ status: st }), true, String(st));
  assert.equal(isUncertain(new TypeError('fetch failed')), true);
  assert.equal(isUncertain(Object.assign(new Error('x'), { name: 'ResponseParseError', status: 200 })), true);
  for (const st of [400, 401, 403, 404, 409, 422]) assert.equal(isUncertain({ status: st }), false, String(st));
  assert.equal(failure({ status: 409, data: { code: 'VERSION_CONFLICT' } }).kind, 'stale');
  assert.equal(failure({ status: 409, data: { code: 'MERGE_STALE' } }).kind, 'stale');
  assert.equal(failure({ status: 404 }).kind, 'notFound');
  assert.equal(failure({ status: 403 }).kind, 'denied');
});

test('24 rows resolved individually: counts, skips, conflicts and commit readiness', () => {
  const rows = Array.from({ length: 24 }, (_, i) => row(i + 1));
  const allowed = new Set([7]);
  const mk = (rs: ImportRow[], status = 'staged', conflicts: unknown[] = []) => ({ ...batchOf(rs, status), conflicts } as unknown as ImportBatch);
  let b = mk(rows);
  const doc = (e: string) => effectiveDoctor(emailGroups(b).find((x) => x.email === e)!, {}, allowed);
  for (let i = 0; i < 24; i++) {
    const r = b.rows[i]!;
    const d: Draft = i % 4 === 0 ? { kind: 'skip', reason: `duplicate entry ${i}` }
      : i % 4 === 1 ? { kind: 'existing', patientId: r.id + 100, method: 'phone', value: '0599000' + i }
      : i % 4 === 2 ? { kind: 'existing', patientId: r.id + 100, method: 'dob', value: '1980-01-0' + ((i % 9) + 1) }
      : { kind: 'create', name: `New ${i}`, phone: '+97059900' + String(i).padStart(4, '0'), dob: '2000-05-1' + (i % 10), guardianName: '', guardianRelation: '' };
    assert.deepEqual(validate(d, X, 7), [], `row ${r.id}`);
    const review = buildReview(r.id, d, X, 7);
    assert.equal(review.rowId, r.id);
    if (d.kind === 'existing') assert.deepEqual((review as { identity: { verification: unknown } }).identity.verification, { method: d.method, value: d.value });
    if (d.kind === 'create') assert.equal((review as { identity: { patient: { dateOfBirth: string } } }).identity.patient.dateOfBirth, d.dob);
    const next = b.rows.map((x) => (x.id === r.id ? { ...x, review } as ImportRow : x));
    b = mk(next, i === 23 ? 'reviewed' : 'staged');
    const c = counts(b, doc);
    assert.equal(c.open, 23 - i); assert.equal(c.include + c.skip, i + 1);
    assert.equal(commitReady(b, stepOpen(b, emailGroups(b), doc)), i === 23);
  }
  const c = counts(b, doc);
  assert.deepEqual([c.skip, c.include, c.stale, c.autoLinked], [6, 18, 0, 0]);
  const blocking = mk(b.rows, 'reviewed', [{ kind: 'existing-appointment', code: 'DOCTOR_OVERLAP', severity: 'blocking', rowIds: [2] }]);
  const ob = stepOpen(blocking, emailGroups(blocking), doc);
  assert.equal(ob.conflicts, 1); assert.equal(commitReady(blocking, ob), false); assert.equal(canEnter(5, ob, true), false);
  const acked = mk(b.rows, 'reviewed', [{ kind: 'existing-appointment', code: 'PATIENT_OVERLAP', severity: 'acknowledged', rowIds: [2] }, { kind: 'source-coincidence', code: 'X', severity: 'info', rowIds: [3] }]);
  assert.equal(commitReady(acked, stepOpen(acked, emailGroups(acked), doc)), false);
  assert.equal(stepOpen(acked, emailGroups(acked), doc).conflicts, 1);
  // Doctor remap invalidates all 18 included rows (skips stay resolved).
  const remap = (e: string) => effectiveDoctor(emailGroups(b).find((x) => x.email === e)!, { 'dr.a@clinic.ps': 8 }, new Set([7, 8]));
  const rc = counts(b, remap);
  assert.deepEqual([rc.stale, rc.skip, rc.include], [18, 6, 0]);
  assert.equal(commitReady(b, stepOpen(b, emailGroups(b), remap)), false);
});

test('status not reviewed or unsupported status blocks commit', () => {
  const allowed = new Set([7]);
  const r = row(1, { review: { rowId: 1, action: 'include' } as never });
  const b = batchOf([r], 'staged');
  const doc = (e: string) => effectiveDoctor(emailGroups(b).find((x) => x.email === e)!, {}, allowed);
  assert.equal(commitReady(b, stepOpen(b, emailGroups(b), doc)), false);
  const u = batchOf([row(1, { source: { ...row(1).source, event_status: 'tentative' }, review: { rowId: 1, action: 'include' } as never })], 'reviewed');
  assert.equal(stepOpen(u, emailGroups(u), doc).status, 1);
});

test('merge retry key: identical payload keeps key, any change rotates', () => {
  let n = 0; const k = createOpKeeper(() => `m-${++n}`);
  const p = { sourceId: 1, targetId: 2, sourceVersion: 3, targetVersion: 4, confirmed: true, reason: 'same person' };
  const id = k.idFor(p);
  assert.equal(k.idFor({ ...p }), id);
  assert.notEqual(k.idFor({ ...p, targetVersion: 5 }), id);
});

test('templated keys resolve in both languages', () => {
  const keys = [
    ...['notMatch', 'eligible', 'unlisted', 'samePatient'].map((v) => `dup.verdict.${v}`),
    ...['both', 'dob', 'phone', 'name'].map((v) => `dup.reasons.${v}`),
    'dup.inaccessible', 'dup.staleSelection', 'dup.frozen', 'commit.unknown', 'commit.memOnly', 'commit.uncertain',
    ...['upload', 'doctors', 'patients', 'status', 'conflicts', 'commit'].map((v) => `wizard.steps.${v}`),
    ...['booked', 'completed', 'cancelled'].map((v) => `statusName.${v}`),
    ...['errType', 'errSize', 'errParse', 'errShape'].map((v) => `upload.${v}`),
    'err.MERGE_IDENTITY', 'err.MERGE_RESTRICTED',
  ];
  for (const k of keys) { assert.ok(get(importEn, k), `en ${k}`); assert.ok(get(importAr, k), `ar ${k}`); }
  assert.ok(!('alreadyMerged' in importEn.dup), 'no claim that 404 means merged');
  assert.doesNotMatch(importEn.dup.inaccessible, /already merged/i);
});

test('parseExport rejects bad files', () => {
  assert.deepEqual(parseExport('a.csv', '[]', 2), { ok: false, error: 'errType' });
  assert.deepEqual(parseExport('a.json', '', 200000), { ok: false, error: 'errSize' });
  assert.deepEqual(parseExport('a.json', '{', 1), { ok: false, error: 'errParse' });
  assert.deepEqual(parseExport('a.json', '[]', 2), { ok: false, error: 'errShape' });
  assert.equal(parseExport('a.json', '[{"event_id":"1"}]', 18).ok, true);
});

test('Samer Khoury pair is not a match for both reasons; eligibility never loosened', () => {
  const a = { id: 1, name: 'Samer Khoury', dateOfBirth: '1984-06-12', phone: '+970 599 123 456' };
  const b = { id: 2, name: 'Samer Khoury', dateOfBirth: '1991-01-03', phone: '+970 598 777 001' };
  assert.deepEqual(verdict(a, b, true), { kind: 'notMatch', reasons: ['both'] });
  assert.equal(importEn.dup.reasons.both, 'Different date of birth and phone number');
  assert.equal(importEn.dup.verdict.notMatch, 'Not a match');
  const twin = { ...a, id: 3, phone: '00970599123456' };
  assert.equal(diff(a, twin).phone, false);
  assert.equal(verdict(a, twin, false).kind, 'unlisted');
  assert.equal(verdict(a, twin, true).kind, 'eligible');
});

test('Asia/Hebron formatting across DST', () => {
  assert.match(formatInstant('2025-01-15T07:00:00Z', 'en', 'latn'), /9:00/);
  assert.match(formatInstant('2025-07-15T07:00:00Z', 'en', 'latn'), /10:00/);
});

test('import and duplicates are doctor/front-desk only', () => {
  for (const id of ['import', 'duplicates']) {
    const r = SHELL_ROUTES.find((x) => x.id === id)!;
    assert.deepEqual([...r.roles].sort(), ['doctor', 'front-desk']);
    assert.equal(resolve(r.path, 'admin').kind, 'forbidden');
    assert.equal(resolve(r.path, 'doctor').kind, 'page');
  }
});
