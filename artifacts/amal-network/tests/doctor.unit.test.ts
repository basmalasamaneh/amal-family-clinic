import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendPage, createGate, fetchThrough, formatScheduleTime, hebronDayInterval, hebronToday, msUntilHebronMidnight, orderDay, privacyView, statusKey } from '../src/doctor/model';
import { doctorAr, doctorEn, NO_PERFORMANCE_AR, NO_PERFORMANCE_EN } from '../src/doctor/strings';
import { clearSelection, getSelection, setSelection } from '../src/network/model';

test('exact bilingual no-performance statement', () => {
  assert.equal(NO_PERFORMANCE_EN, 'There are no doctor-performance analytics. Doctors are not ranked or measured.');
  assert.equal(NO_PERFORMANCE_AR, 'لا توجد تحليلات لأداء الأطباء. لا يتم ترتيب الأطباء أو قياس أدائهم.');
});
test('every English string has a non-empty Arabic counterpart', () => {
  const walk = (en: Record<string, unknown>, ar: Record<string, unknown>, path: string) => {
    for (const k of Object.keys(en)) {
      if (typeof en[k] === 'string') assert.ok(typeof ar[k] === 'string' && (ar[k] as string).trim(), `${path}.${k}`);
      else walk(en[k] as Record<string, unknown>, ar[k] as Record<string, unknown>, `${path}.${k}`);
    }
  };
  walk(doctorEn, doctorAr, 'doc');
});
test('Hebron day, half-open DST-safe interval and midnight rollover', () => {
  assert.equal(hebronToday(new Date('2025-06-14T21:30:00Z')), '2025-06-15');
  assert.equal(hebronToday(new Date('2025-06-14T20:59:00Z')), '2025-06-14');
  const s = hebronDayInterval('2025-06-15');
  assert.equal(s.start.toISOString(), '2025-06-14T21:00:00.000Z');
  assert.equal(s.end.toISOString(), '2025-06-15T21:00:00.000Z');
  const w = hebronDayInterval('2025-01-15');
  assert.equal(w.end.getTime() - w.start.getTime(), 24 * 3600e3);
  assert.equal(msUntilHebronMidnight(new Date('2025-06-15T20:59:00Z')), 60_000);
});
test('schedule time shows Hebron midnight and uses digit preference', () => {
  assert.equal(formatScheduleTime('2025-06-14T21:00:00Z', 'latn'), '00:00');
  assert.equal(formatScheduleTime('2025-01-15T08:05:00Z', 'arab'), '١٠:٠٥');
  assert.equal(formatScheduleTime('2025-06-15', 'latn'), '');
});
test('day ordering and status fallback', () => {
  const o = orderDay([{ id: 3, startsAt: 'bad' }, { id: 2, startsAt: '2025-06-15T08:00:00Z' }, { id: 1, startsAt: '2025-06-15T08:00:00Z' }]);
  assert.deepEqual(o.map((i) => i.id), [1, 2, 3]);
  assert.equal(statusKey('no_show'), 'no_show'); assert.equal(statusKey('weird'), 'unknown');
});
test('privacy view never defaults to Full', () => {
  assert.deepEqual(privacyView({ mode: 'full', effectiveSharing: 'consent', trialStateAvailable: false }), { mode: 'full', sharing: 'consent' });
  assert.deepEqual(privacyView({ mode: 'lite', effectiveSharing: 'consent' }), { mode: 'lite', sharing: 'localOnly' });
  assert.deepEqual(privacyView({ mode: 'trial', effectiveSharing: 'consent', trialStateAvailable: false }), { mode: 'trialUnavailable', sharing: 'localOnly' });
  assert.deepEqual(privacyView({ mode: 'unknown', effectiveSharing: 'consent' }), { mode: 'unknown', sharing: 'localOnly' });
  assert.deepEqual(privacyView({ mode: 'network' }), { mode: 'unknown', sharing: 'localOnly' });
  assert.deepEqual(privacyView(null), { mode: 'unknown', sharing: 'localOnly' });
});
test('request gate discards stale and invalidated responses (races)', () => {
  const g = createGate();
  const a = g.begin(); const b = g.begin();
  assert.equal(g.isCurrent(a), false); assert.equal(g.isCurrent(b), true);
  g.invalidate(); assert.equal(g.isCurrent(b), false);
});
test('bounded pagination dedupes and caps; empty is not end-of-proof', () => {
  const r1 = appendPage([], { items: [{ id: 1 }], nextCursor: 'c' }, 1, 2);
  assert.equal(r1.nextCursor, 'c');
  const r2 = appendPage(r1.items, { items: [{ id: 1 }, { id: 2 }], nextCursor: 'd' }, 2, 2);
  assert.deepEqual(r2.items.map((i) => i.id), [1, 2]);
  assert.equal(r2.capped, true); assert.equal(r2.nextCursor, null);
});
test('stable own-patient selection: id only, scoped, and search selection preserved', () => {
  setSelection({ scope: 's1', id: 62 });
  assert.deepEqual(getSelection('s1'), { scope: 's1', id: 62 });
  assert.equal(getSelection('s2'), null);
  assert.equal(getSelection('s1'), null);
  setSelection({ scope: 's1', q: 'Name', id: 5 });
  assert.equal(getSelection('s1')?.q, 'Name');
  clearSelection(); assert.equal(getSelection('s1'), null);
});
test('doctor CSS works in both themes: tokens only, logical properties only', () => {
  const css = readFileSync(new URL('../src/doctor/doctor.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /#[0-9a-f]{3,6}\b|rgb\(|hsl\(/i);
  assert.doesNotMatch(css, /(margin|padding)-(left|right)|\b(left|right):/);
});

test('load more re-reads from page 1: withdrawal between pages leaves no prior payload', async () => {
  let phase = 'clinical'; const seen: (string | undefined)[] = [];
  const fp = async (cursor: string | undefined) => {
    seen.push(cursor);
    if (phase === 'clinical') return cursor ? { items: [{ id: 2, alert: 'old2' }], nextCursor: null } : { items: [{ id: 1, alert: 'old1' }], nextCursor: 'c1' };
    return cursor ? { items: [{ id: 2, alert: null }], nextCursor: null } : { items: [{ id: 1, alert: null }], nextCursor: 'n1' };
  };
  const sig = new AbortController().signal;
  const a = await fetchThrough(fp, 1, 5, sig);
  assert.equal(a.items[0].alert, 'old1');
  phase = 'none';
  const b = await fetchThrough(fp, 2, 5, sig);
  assert.deepEqual(b.items.map((i) => i.alert), [null, null]);
  assert.deepEqual(seen, [undefined, undefined, 'n1']); // old cursor c1 never reused
  const capped = await fetchThrough(fp, 9, 1, sig);
  assert.equal(capped.pages, 1); assert.equal(capped.capped, true);
  await assert.rejects(fetchThrough(async () => { throw Object.assign(new Error('x'), { status: 403 }); }, 2, 5, sig));
});
