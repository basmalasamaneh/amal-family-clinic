import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { matchesPatient, normalizeForSearch } from '../src/booking/normalize';
import { resolveLocalInterval, nextLocalTime, formatExpiry, effectiveInterval } from '../src/booking/time';
import { returnFocusTargets } from '../src/booking/focus';
import { commitAllowed, summarize } from '../src/booking/conflicts';
import { createAttemptKeeper, createLatest, createOpKeeper, stableKey } from '../src/booking/ops';
import { classifyError } from '../src/booking/errors';
import { createFixturePatientSearch, FIXTURE_ROSTER } from '../src/booking/patients';
import { createFixtureBookingApi } from '../src/booking/api';
import type { ConflictPreview } from '@workspace/api-client-react';

test('Arabic normalization: hamza forms, ta marbuta, alef maqsura, diacritics, case, whitespace', () => {
  assert.equal(normalizeForSearch('  أحمد   إبراهيم '), 'احمد ابراهيم');
  assert.equal(normalizeForSearch('آمنة'), 'امنه');
  assert.equal(normalizeForSearch('مُصْطَفَى'), 'مصطفي');
  assert.equal(normalizeForSearch('LINA  Haddad'), 'lina haddad');
  assert.equal(normalizeForSearch('٠٥٩٩'), '0599');
  const src = 'فاطمة'; normalizeForSearch(src); assert.equal(src, 'فاطمة');
});
test('patient matching by name or phone digits', () => {
  assert.ok(matchesPatient({ name: 'فاطمة الزهراء', phone: '' }, 'فاطمه'));
  assert.ok(matchesPatient({ name: 'x', phone: '0599 412 873' }, '412873'));
  assert.ok(!matchesPatient({ name: 'x', phone: '0599 412 873' }, '41'));
});
test('fixture search keeps same-name patients separate and distinguishable', async () => {
  const s = createFixturePatientSearch(() => 0);
  const r = await s.search('محمد احمد', 3);
  assert.equal(r.items.length, 2);
  assert.notEqual(r.items[0]!.id, r.items[1]!.id);
  assert.notEqual(r.items[0]!.dateOfBirth, r.items[1]!.dateOfBirth);
  assert.ok(r.items.every((p) => p.clinicId === 3));
  assert.equal(FIXTURE_ROSTER.find((p) => p.id === 9001)!.name, 'محمد أحمد');
  await assert.rejects(s.search('error', 3));
});
test('fixture search is abortable', async () => {
  const s = createFixturePatientSearch(() => 50); const c = new AbortController();
  const p = s.search('محمد', 1, c.signal); c.abort();
  await assert.rejects(p, (e: Error) => e.name === 'AbortError');
});

function findTransitions() {
  let gap: { date: string; time: string } | null = null; let amb: { date: string; time: string } | null = null;
  for (let t = Date.parse('2025-01-01T00:00:00Z'); t < Date.parse('2026-01-01T00:00:00Z'); t += 30 * 60000) {
    const date = formatInTimeZone(t, 'Asia/Hebron', 'yyyy-MM-dd');
    for (const time of ['00:30', '01:30', '02:30', '03:30']) {
      const local = `${date}T${time}:00`; const u = fromZonedTime(local, 'Asia/Hebron');
      if (!gap && formatInTimeZone(u, 'Asia/Hebron', "yyyy-MM-dd'T'HH:mm:ss") !== local) gap = { date, time };
      if (!amb && [u.getTime() - 3600000, u.getTime() + 3600000].some((x) => formatInTimeZone(x, 'Asia/Hebron', "yyyy-MM-dd'T'HH:mm:ss") === local)) amb = { date, time };
    }
  }
  return { gap, amb };
}
test('Asia/Hebron local interval → UTC, standard and summer offsets', () => {
  const w = resolveLocalInterval('2025-01-15', '10:00', 30);
  assert.deepEqual(w, { ok: true, startsAt: '2025-01-15T08:00:00.000Z', endsAt: '2025-01-15T08:30:00.000Z', ambiguous: false });
  const s = resolveLocalInterval('2025-07-15', '10:00', 45);
  assert.ok(s.ok && s.startsAt === '2025-07-15T07:00:00.000Z' && s.endsAt === '2025-07-15T07:45:00.000Z');
  assert.deepEqual(resolveLocalInterval('2025-01-15', '23:45', 30), { ok: false, error: 'crossesDay' });
  assert.deepEqual(resolveLocalInterval('2025-02-30', '10:00', 30), { ok: false, error: 'invalid' });
  assert.deepEqual(resolveLocalInterval('2025-01-15', '10:00', 0), { ok: false, error: 'duration' });
});
test('DST gap rejected, DST overlap resolves to earliest instant', () => {
  const { gap, amb } = findTransitions();
  assert.ok(gap && amb, 'tz data has transitions in 2025');
  assert.deepEqual(resolveLocalInterval(gap!.date, gap!.time, 30), { ok: false, error: 'nonexistent' });
  const r = resolveLocalInterval(amb!.date, amb!.time, 30);
  assert.ok(r.ok && r.ambiguous);
  if (r.ok) assert.equal(formatInTimeZone(Date.parse(r.startsAt) + 3600000, 'Asia/Hebron', 'HH:mm'), amb!.time);
});
test('walk-in default rounds up to 5 local minutes', () => {
  assert.deepEqual(nextLocalTime(new Date('2025-01-15T08:01:10Z')), { date: '2025-01-15', time: '10:05' });
});

const pv = (c: ConflictPreview['conflicts'], ok = false): ConflictPreview => ({ ok, conflicts: c });
const slot = (h: number) => ({ startsAt: `2025-01-15T${String(h).padStart(2, '0')}:00:00.000Z`, endsAt: `2025-01-15T${String(h).padStart(2, '0')}:30:00.000Z` });
test('blocking conflicts never commit, even with a reason', () => {
  for (const type of ['doctor-overlap', 'outside-hours', 'slot-held'] as const)
    assert.equal(commitAllowed(pv([{ type, with: null, severity: 'blocking', suggestedSlots: [] }]), 'please'), false);
});
test('patient warning requires trimmed nonblank reason', () => {
  const p = pv([{ type: 'patient-overlap', with: null, severity: 'warning', suggestedSlots: [] }]);
  assert.equal(commitAllowed(p, ''), false);
  assert.equal(commitAllowed(p, '   '), false);
  assert.equal(commitAllowed(p, ' family request '), true);
  assert.equal(summarize(p).overrideable, true);
});
test('info alone does not block; no preview never allows; unknown severity blocks', () => {
  assert.equal(commitAllowed(pv([{ type: 'same-day-other-clinic', with: null, severity: 'info', suggestedSlots: [] }], true), ''), true);
  assert.equal(commitAllowed(null, ''), false);
  assert.equal(commitAllowed(pv([], true), ''), true);
  assert.equal(commitAllowed(pv([{ type: 'brand-new' as never, with: null, severity: 'warning', suggestedSlots: [] }]), 'x'), false);
});
test('suggestions: server order, max three, fewer and none honest', () => {
  const d = (s: ReturnType<typeof slot>[]) => summarize(pv([{ type: 'doctor-overlap', with: null, severity: 'blocking', suggestedSlots: s }])).suggestions;
  assert.deepEqual(d([slot(12), slot(9), slot(11), slot(13)]), [slot(12), slot(9), slot(11)]);
  assert.deepEqual(d([slot(12)]), [slot(12)]);
  assert.deepEqual(d([]), []);
  assert.deepEqual(d([slot(9), slot(9)]), [slot(9)]);
});
test('clientOpId reused for identical retry, new for changed payload', () => {
  let n = 0; const k = createOpKeeper(() => `op${++n}`);
  const a = k.idFor({ a: 1, b: 2 });
  assert.equal(k.idFor({ b: 2, a: 1 }), a);
  assert.notEqual(k.idFor({ a: 1, b: 3 }), a);
  assert.equal(stableKey({ x: undefined, y: 1 }), stableKey({ y: 1 }));
});
test('latest guard rejects stale responses', () => {
  const l = createLatest(); const t1 = l.next(); const t2 = l.next();
  assert.equal(l.isCurrent(t1), false); assert.equal(l.isCurrent(t2), true);
});
test('error classification', () => {
  assert.equal(classifyError(new TypeError('fetch failed')).kind, 'network');
  assert.equal(classifyError({ status: 409, data: { code: 'X' } }).code, 'X');
  assert.equal(classifyError({ status: 404 }).kind, 'unavailable');
  assert.equal(classifyError({ status: 401 }).kind, 'auth');
});
test('fixture booking api: idempotent create, commit-time conflict, overlap suggestions', async () => {
  const api = createFixtureBookingApi();
  const base = { clinicId: 1, doctorId: 2, patientId: 9001, source: 'phone' as const };
  const ok = resolveLocalInterval('2025-01-15', '12:00', 30); assert.ok(ok.ok);
  if (!ok.ok) return;
  const input = { ...base, startsAt: ok.startsAt, endsAt: ok.endsAt, clientOpId: 'op-1' };
  const a1 = await api.create(input); const a2 = await api.create(input);
  assert.equal(a1.id, a2.id);
  const busy = resolveLocalInterval('2025-01-15', '10:15', 30); if (!busy.ok) return;
  const p = await api.check({ ...base, startsAt: busy.startsAt, endsAt: busy.endsAt });
  assert.equal(summarize(p).suggestions.length, 3);
  await assert.rejects(api.create({ ...base, startsAt: busy.startsAt, endsAt: busy.endsAt, clientOpId: 'op-2' }), (e: { status: number }) => e.status === 409);
});

test('commitAllowed fails closed on ok:false with no conflicts and on misclassified severities', () => {
  assert.equal(commitAllowed(pv([], false), ''), false);
  assert.equal(commitAllowed(pv([{ type: 'same-day-other-clinic', with: null, severity: 'info', suggestedSlots: [] }], false), ''), false);
  for (const type of ['doctor-overlap', 'outside-hours', 'slot-held'] as const)
    for (const severity of ['warning', 'info'] as const)
      assert.equal(commitAllowed(pv([{ type, with: null, severity, suggestedSlots: [] }], true), 'reason'), false, `${type}/${severity}`);
  assert.equal(commitAllowed(pv([{ type: 'same-day-other-clinic', with: null, severity: 'warning', suggestedSlots: [] }]), 'reason'), false);
  assert.equal(commitAllowed(pv([{ type: 'patient-overlap', with: null, severity: 'blocking', suggestedSlots: [] }]), 'reason'), false);
  assert.equal(commitAllowed(pv([{ type: 'patient-overlap', with: null, severity: 'info', suggestedSlots: [] }]), ''), false);
  assert.equal(commitAllowed(pv([{ type: 'patient-overlap', with: null, severity: 'warning', suggestedSlots: [] }, { type: 'same-day-other-clinic', with: null, severity: 'info', suggestedSlots: [] }]), 'ok'), true);
});

test('attempt keeper replays exact payload and id (incl. original holdToken) for same context', () => {
  let n = 0; const k = createAttemptKeeper<{ holdToken?: string }>(() => `op${++n}`);
  const first = k.begin('ctx|r', () => ({ holdToken: 'tok-1' }));
  // hold expired and renewed: same context must still replay the original attempt
  const again = k.begin('ctx|r', () => ({ holdToken: 'tok-2' }));
  assert.equal(again.clientOpId, first.clientOpId);
  assert.deepEqual(again.payload, { holdToken: 'tok-1' });
  assert.equal(k.current('ctx|other'), null);
  const changed = k.begin('ctx|other', () => ({}));
  assert.notEqual(changed.clientOpId, first.clientOpId);
  k.clear(); assert.equal(k.current('ctx|other'), null);
  assert.notEqual(k.begin('ctx|other', () => ({})).clientOpId, changed.clientOpId);
});

test('latest guard invalidate makes in-flight tokens stale (unmount)', () => {
  const l = createLatest(); const t = l.next(); l.invalidate(); assert.equal(l.isCurrent(t), false);
});

test('hold expiry formatted in Asia/Hebron with seconds and digit preference', () => {
  assert.equal(formatExpiry('2025-01-15T08:00:30.000Z', 'latn'), '10:00:30');
  assert.equal(formatExpiry('2025-07-15T08:00:30.000Z', 'latn'), '11:00:30');
  assert.equal(formatExpiry('2025-01-15T08:00:30.000Z', 'arab'), '١٠:٠٠:٣٠');
});

test('return focus targets prefer created card, then slot, then entry link, then heading', () => {
  const start = resolveLocalInterval('2025-03-10', '08:00', 30); if (!start.ok) throw new Error();
  assert.deepEqual(returnFocusTargets({ clinicId: 1, doctorId: 7, startsAt: start.startsAt, source: 'phone' }, 55), [
    '[data-testid="card-appointment-55"]', '[data-testid="slot-7-480"]', '[data-testid="link-new-booking"]', '#page-title']);
  assert.deepEqual(returnFocusTargets({ clinicId: 1, source: 'walk-in' }, null), ['[data-testid="link-walk-in"]', '#page-title']);
});

test('exact UTC slot (second occurrence of repeated DST hour) is preserved, local edit re-resolves', () => {
  const { amb } = findTransitions(); assert.ok(amb);
  const first = resolveLocalInterval(amb!.date, amb!.time, 30); assert.ok(first.ok);
  if (!first.ok) return;
  const second = { startsAt: new Date(Date.parse(first.startsAt) + 3600000).toISOString(), endsAt: new Date(Date.parse(first.endsAt) + 3600000).toISOString() };
  assert.equal(formatInTimeZone(second.startsAt, 'Asia/Hebron', 'HH:mm'), amb!.time);
  assert.deepEqual(effectiveInterval(second, amb!.date, amb!.time, 30), { ok: true, ...second, ambiguous: false });
  // duration edit keeps the exact start, recomputes end
  const d = effectiveInterval({ startsAt: second.startsAt }, amb!.date, amb!.time, 45);
  assert.ok(d.ok && d.startsAt === second.startsAt && Date.parse(d.endsAt) - Date.parse(d.startsAt) === 45 * 60000);
  // manual date/time edit clears exact → local conversion (earliest occurrence)
  assert.deepEqual(effectiveInterval(null, amb!.date, amb!.time, 30), first);
});
