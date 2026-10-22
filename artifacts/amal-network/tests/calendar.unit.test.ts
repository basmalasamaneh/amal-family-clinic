import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addLocalDays, dayRange, localDateOf, localToUtc, todayLocal, weekDates, weekRange, weekStart, WEEK_STARTS_ON, formatTime } from '../src/calendar/dates';
import { displayStatus } from '../src/calendar/status';
import { placeOverlaps } from '../src/calendar/layout';
import { bookingQuery, parseBooking } from '../src/calendar/booking';
import { createLatestGuard } from '../src/calendar/use-schedule';
import { createMockSchedulingAdapter, fromApiAppointment, mockDay, resolveSchedulingAdapter, realSchedulingAdapter, type CalendarAppointment } from '../src/calendar/adapter';

test('today is the Asia/Hebron date regardless of host zone', () => {
  // 22:30Z on 9 Mar is already 10 Mar 00:30 in Hebron (UTC+2 winter).
  assert.equal(todayLocal(new Date('2025-03-09T22:30:00Z')), '2025-03-10');
  assert.equal(todayLocal(new Date('2025-03-09T21:59:00Z')), '2025-03-09');
});

test('local day boundaries convert to UTC; DST days are 23 and 25 hours', () => {
  assert.deepEqual(dayRange('2025-01-15'), { from: '2025-01-14T22:00:00.000Z', to: '2025-01-15T22:00:00.000Z' });
  const lengths = new Set<number>();
  for (let d = '2025-01-01'; d < '2026-01-01'; d = addLocalDays(d, 1)) {
    const r = dayRange(d);
    lengths.add((Date.parse(r.to) - Date.parse(r.from)) / 3600000);
    assert.equal(localDateOf(r.from), d);
    assert.equal(localDateOf(new Date(Date.parse(r.to) - 1).toISOString()), d);
  }
  assert.deepEqual([...lengths].sort(), [23, 24, 25]);
});

test('calendar arithmetic crosses month/year and week starts on the documented day', () => {
  assert.equal(addLocalDays('2024-12-31', 1), '2025-01-01');
  assert.equal(addLocalDays('2024-03-01', -1), '2024-02-29');
  const w = weekDates('2025-03-12');
  assert.equal(w.length, 7);
  assert.equal(new Date(`${w[0]}T12:00:00Z`).getUTCDay(), WEEK_STARTS_ON);
  assert.ok(w.includes('2025-03-12'));
  assert.equal(weekStart(w[6]), w[0]);
  const r = weekRange('2025-03-12');
  assert.equal(r.from, localToUtc(w[0], 0));
  assert.equal(r.to, localToUtc(addLocalDays(w[6], 1), 0));
});

test('times display in Asia/Hebron with digit preference', () => {
  assert.equal(formatTime('2025-07-01T06:30:00Z', 'en', 'latn'), '09:30');
  assert.equal(formatTime('2025-07-01T06:30:00Z', 'ar', 'arab'), '٠٩:٣٠');
});

test('six display statuses map from distinct lifecycle/conflict/sync metadata; unknown is not booked', () => {
  const base = { conflict: false, syncPending: false } as const;
  assert.equal(displayStatus({ ...base, lifecycle: 'booked' }), 'booked');
  assert.equal(displayStatus({ ...base, lifecycle: 'completed' }), 'completed');
  assert.equal(displayStatus({ ...base, lifecycle: 'no_show' }), 'noshow');
  assert.equal(displayStatus({ ...base, lifecycle: 'double_booked' }), 'conflict');
  assert.equal(displayStatus({ ...base, lifecycle: 'booked', conflict: true }), 'conflict');
  assert.equal(displayStatus({ ...base, lifecycle: 'booked', syncPending: true }), 'sync');
  assert.equal(displayStatus({ ...base, lifecycle: 'cancelled' }), 'cancelled');
  assert.equal(displayStatus({ ...base, lifecycle: 'unknown' }), null);
  assert.equal(fromApiAppointment({ id: 1, clinicId: 1, doctorId: 1, patientId: 1, clientOpId: null, startsAt: 'a', endsAt: 'b', source: 'phone', version: 1, status: 'archived' as never }).lifecycle, 'unknown');
});

test('overlapping appointments get separate lanes', () => {
  const mk = (id: number, s: string, e: string): CalendarAppointment => ({ id, clinicId: 1, doctorId: 1, patientName: null, startsAt: s, endsAt: e, lifecycle: 'booked', conflict: false, syncPending: false });
  const p = placeOverlaps([mk(1, '2025-01-01T08:00:00Z', '2025-01-01T08:30:00Z'), mk(2, '2025-01-01T08:15:00Z', '2025-01-01T08:45:00Z'), mk(3, '2025-01-01T09:00:00Z', '2025-01-01T09:30:00Z')]);
  const byId = Object.fromEntries(p.map((x) => [x.appt.id, x]));
  assert.notEqual(byId[1].lane, byId[2].lane);
  assert.equal(byId[1].lanes, 2);
  assert.equal(byId[3].lanes, 1);
});

test('booking context round-trips and is dropped for another clinic', () => {
  const q = bookingQuery({ clinicId: 7, doctorId: 3, source: 'phone', localDate: '2025-03-10', startsAt: '2025-03-10T08:00:00.000Z', endsAt: '2025-03-10T08:30:00.000Z' });
  const search = q.split('?')[1];
  assert.deepEqual(parseBooking(search, 7), { clinicId: 7, doctorId: 3, source: 'phone', localDate: '2025-03-10', startsAt: '2025-03-10T08:00:00.000Z', endsAt: '2025-03-10T08:30:00.000Z' });
  assert.equal(parseBooking(search, 8), null);
  assert.equal(parseBooking(bookingQuery({ clinicId: 7, source: 'walk-in' }).split('?')[1], 7)?.source, 'walk-in');
});

test('late responses are rejected by the latest guard', () => {
  const g = createLatestGuard();
  const a = g.next(); const b = g.next();
  assert.equal(g.isCurrent(a), false);
  assert.equal(g.isCurrent(b), true);
});

test('mock adapter is explicit, deterministic and clinic-scoped', async () => {
  assert.equal(resolveSchedulingAdapter('', false, true), realSchedulingAdapter);
  assert.equal(resolveSchedulingAdapter('?calendarDemo=empty', false, false), realSchedulingAdapter);
  assert.equal(resolveSchedulingAdapter('?calendarDemo=error', false, true).scenario, 'error');
  assert.equal(resolveSchedulingAdapter('', true, true).scenario, 'standard');
  const m = createMockSchedulingAdapter('standard', { latency: () => 0 });
  const docs = await m.listDoctors(42);
  assert.ok(docs.every((d) => d.clinicId === 42));
  const r = dayRange('2025-03-10');
  const a1 = await m.listAppointments({ clinicId: 42, ...r });
  const a2 = await m.listAppointments({ clinicId: 42, ...r });
  assert.deepEqual(a1, a2);
  assert.ok(a1.length > 0 && a1.every((a) => a.clinicId === 42 && a.startsAt.endsWith('Z') && a.startsAt >= r.from && a.startsAt < r.to));
  const one = await m.listAppointments({ clinicId: 42, ...r, doctorId: docs[0].id });
  assert.ok(one.every((a) => a.doctorId === docs[0].id));
  assert.deepEqual(mockDay(42, '2025-03-10', []), []);
  await assert.rejects(createMockSchedulingAdapter('error', { latency: () => 0 }).listAppointments({ clinicId: 1, ...r }));
  assert.equal(await createMockSchedulingAdapter('no-hours', { latency: () => 0 }).clinicHours(1), null);
  assert.deepEqual(await createMockSchedulingAdapter('no-doctors', { latency: () => 0 }).listDoctors(1), []);
});

test('booking context keeps the selected local date; slot date wins', () => {
  const q = bookingQuery({ clinicId: 7, source: 'walk-in', localDate: '2025-03-10', doctorId: 2 }).split('?')[1];
  assert.deepEqual(parseBooking(q, 7), { clinicId: 7, source: 'walk-in', doctorId: 2, localDate: '2025-03-10' });
  const s = bookingQuery({ clinicId: 7, source: 'phone', localDate: '2025-03-09', startsAt: '2025-03-09T22:30:00.000Z' }).split('?')[1];
  assert.equal(parseBooking(s, 7)?.localDate, '2025-03-10');
  assert.equal(parseBooking('clinic=7&date=2025-02-30', 7)?.localDate, undefined);
});

test('carried calendar context keeps only valid date/doctor and explicit demo', async () => {
  const { withCarry } = await import('../src/calendar/carry');
  assert.equal(withCarry('/desk/week', '?date=2025-03-10&doctor=4&calendarDemo=empty&x=1'), '/desk/week?date=2025-03-10&doctor=4&calendarDemo=empty');
  assert.equal(withCarry('/desk/week', '?date=bad&doctor=-1'), '/desk/week');
});

test('row-quantized short appointments never share a lane', () => {
  const mk = (id: number, s: string, e: string): CalendarAppointment => ({ id, clinicId: 1, doctorId: 1, patientName: null, startsAt: s, endsAt: e, lifecycle: 'booked', conflict: false, syncPending: false });
  // 08:00-08:05 and 08:10-08:15 do not overlap in time but render in the same 30-min row.
  const rows = (a: CalendarAppointment): [number, number] => { const m = new Date(a.startsAt).getUTCMinutes(); const r = Math.floor(m / 30); return [r, r + 1]; };
  const p = placeOverlaps([mk(1, '2025-01-01T08:00:00Z', '2025-01-01T08:05:00Z'), mk(2, '2025-01-01T08:10:00Z', '2025-01-01T08:15:00Z')], rows);
  assert.notEqual(p[0].lane, p[1].lane);
});

test('unknown lifecycle stays explicit even with pending sync', () => {
  assert.equal(displayStatus({ lifecycle: 'unknown', conflict: false, syncPending: true }), null);
});

test('DEMO_DATE exposes all six display statuses', async () => {
  const { DEMO_DATE } = await import('../src/calendar/adapter');
  const m = createMockSchedulingAdapter('standard', { latency: () => 0 });
  for (const clinicId of [1, 2, 99, 12345]) {
    const docs = await m.listDoctors(clinicId);
    const set = new Set(mockDay(clinicId, DEMO_DATE, docs).map(displayStatus));
    for (const s of ['booked', 'completed', 'noshow', 'conflict', 'sync', 'cancelled']) assert.ok(set.has(s as never), `${clinicId}:${s}`);
  }
});
