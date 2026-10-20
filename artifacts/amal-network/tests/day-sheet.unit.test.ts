import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScope, sameTicket, ticketMatchesScope, buildRows, clampDay, countRows, dayBounds, dayCoverage, formatLocalTime, isLocalDate, selectableDays } from '../src/day-sheet/model';
import type { CalendarAppointment } from '../src/calendar/adapter';
import { affectsSheet } from '../src/day-sheet/storage-observer';

test('dayBounds uses Hebron local midnights incl. DST', () => {
  assert.deepEqual(dayBounds('2030-01-10'), { startUtc: '2030-01-09T22:00:00.000Z', endUtc: '2030-01-10T22:00:00.000Z' });
  assert.deepEqual(dayBounds('2030-07-10'), { startUtc: '2030-07-09T21:00:00.000Z', endUtc: '2030-07-10T21:00:00.000Z' });
  for (const d of ['2025-03-29', '2025-10-25']) {
    const b = dayBounds(d);
    const h = (Date.parse(b.endUtc) - Date.parse(b.startUtc)) / 3_600_000;
    assert.ok(h === 23 || h === 24 || h === 25);
  }
  assert.throws(() => dayBounds('2030-02-30'));
  assert.equal(isLocalDate('2030-13-01'), false);
});

test('selectableDays is bounded by the cache window', () => {
  const days = selectableDays({ localStartDate: '2030-01-01', localEndDate: '2030-01-15' });
  assert.equal(days.length, 14);
  assert.equal(days[13], '2030-01-14');
  assert.equal(clampDay('2030-02-01', days), '2030-01-01');
  assert.equal(clampDay('2030-01-05', days), '2030-01-05');
  assert.equal(clampDay(null, []), null);
});

const w = { startUtc: '2029-12-31T22:00:00.000Z', endUtc: '2030-01-14T22:00:00.000Z' };
test('coverage distinguishes complete, partial and missing', () => {
  const meta = { coverageStartUtc: w.startUtc, coverageEndUtc: w.endUtc, refreshedAt: '2030-01-01T05:00:00Z' };
  assert.equal(dayCoverage('2030-01-03', { metadata: meta, window: w, fullyCovered: true }), 'complete');
  assert.equal(dayCoverage('2030-01-03', { metadata: meta, window: w, fullyCovered: false }), 'partial',
    'Full-range metadata cannot hide dropped appointments with missing patient/doctor records');
  assert.equal(dayCoverage('2030-01-03', { metadata: null, window: w, fullyCovered: false }), 'missing');
  assert.equal(dayCoverage('2030-01-03', null), 'missing');
  assert.equal(dayCoverage('2030-01-03', { metadata: { ...meta, coverageEndUtc: '2030-01-03T10:00:00.000Z' }, window: w, fullyCovered: false }), 'partial');
  assert.equal(dayCoverage('2030-02-01', { metadata: meta, window: w, fullyCovered: true }), 'missing');
});

test('sheet observes relevant committed cache mutations without trusting event scope', () => {
  const parts = (key: string) => ({ [key]: {} });
  assert.equal(affectsSheet(parts('idb://amal-private-cache/appointments/')), true);
  assert.equal(affectsSheet(parts('idb://amal-private-cache/proposals/')), true);
  assert.equal(affectsSheet(parts('idb://amal-private-cache/metadata/')), true);
  assert.equal(affectsSheet(parts('idb://another-db/appointments/')), false);
  assert.equal(affectsSheet(parts('idb://amal-private-cache/streams/')), false);
});

const a = (o: Partial<CalendarAppointment>): CalendarAppointment => ({ id: 1, clinicId: 1, doctorId: 3, patientName: 'Huda', startsAt: '2030-01-03T07:00:00.000Z', endsAt: '2030-01-03T07:20:00.000Z', lifecycle: 'booked', conflict: false, syncPending: false, ...o });
test('buildRows filters day/doctor, dedupes and flags provisional', () => {
  const b = dayBounds('2030-01-03');
  const rows = buildRows([
    a({ id: 2, startsAt: '2030-01-03T09:00:00.000Z' }),
    a({ id: 1 }),
    a({ id: -5, clientOpId: 'op', syncPending: true, patientName: ' ' }),
    a({ id: -5, clientOpId: 'op', syncPending: true }),
    a({ id: 7, conflict: true, doctorId: 4 }),
    a({ id: 8, startsAt: '2030-01-02T21:59:00.000Z' }),
    a({ id: 9, startsAt: '2030-01-03T22:00:00.000Z' }),
  ], [{ id: 3, name: 'Dr. Salem' }], b, null);
  assert.equal(rows.length, 4);
  assert.equal(rows.at(-1)!.key, 'id:2');
  const op = rows.find(r => r.key === 'op:op')!;
  assert.equal(op.provisional, true); assert.equal(op.patientName, null);
  const c = rows.find(r => r.key === 'id:7')!;
  assert.equal(c.attention, true); assert.equal(c.provisional, false); assert.equal(c.doctorName, null);
  assert.deepEqual(countRows(rows), { total: 4, provisional: 1, attention: 1, cancelled: 0 });
  assert.equal(buildRows([a({ id: 7, doctorId: 4 }), a({})], [], b, 4).length, 1);
});

test('formatLocalTime renders Hebron time with digit preference', () => {
  assert.equal(formatLocalTime('2030-01-03T07:05:00.000Z', 'latn'), '09:05');
  assert.equal(formatLocalTime('2030-01-03T07:05:00.000Z', 'arab'), '٠٩:٠٥');
});

test('canonical double-booked is attention-only, never provisional', () => {
  const [r] = buildRows([a({ lifecycle: 'double_booked', conflict: true })], [], dayBounds('2030-01-03'), null);
  assert.equal(r.provisional, false); assert.equal(r.attention, true);
  const [p] = buildRows([a({ clientOpId: 'x', syncPending: true, conflict: true })], [], dayBounds('2030-01-03'), null);
  assert.equal(p.provisional, true); assert.equal(p.attention, true);
});

test('scope parsing and ticket matching', () => {
  assert.deepEqual(parseScope('acct:7:front-desk:12'), { userId: 'acct:7', clinicId: 12 });
  assert.equal(parseScope('u1:front-desk:none'), null);
  assert.equal(parseScope('bad'), null);
  const t = { userId: 'acct:7', clinicId: 12, generation: 3 };
  assert.equal(ticketMatchesScope(t, parseScope('acct:7:front-desk:12')), true);
  assert.equal(ticketMatchesScope(t, parseScope('acct:7:front-desk:13')), false);
  assert.equal(sameTicket(t, { ...t }), true);
  assert.equal(sameTicket(t, { ...t, generation: 4 }), false);
  assert.equal(sameTicket(t, null), false);
});
