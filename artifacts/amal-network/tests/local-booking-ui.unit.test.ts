import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coversCalendarRange, mergeLocalCalendar, showCalendarProposal } from '../src/calendar/local-schedule';
import { createAttemptKeeper } from '../src/booking/ops';
import type { CalendarAppointment } from '../src/calendar/adapter';

const appointment = (id: number, extras: Partial<CalendarAppointment> = {}): CalendarAppointment => ({
  id, clinicId: 1, doctorId: 2, patientName: 'Patient', startsAt: '2026-05-01T08:00:00.000Z',
  endsAt: '2026-05-01T08:30:00.000Z', lifecycle: 'booked', conflict: false, syncPending: false, ...extras,
});

test('rejected, conflicting and blocked local requests never become calendar appointments', () => {
  for (const outcome of ['conflict', 'rejected', 'blocked', 'applied'] as const) {
    const proposal = Object.freeze({ outcome, canonical: null });
    assert.equal(showCalendarProposal(proposal), false);
    assert.equal(proposal.outcome, outcome); // Projection must not clear the durable queue.
  }
  assert.equal(showCalendarProposal({ outcome: 'pending', canonical: null }), true);
});

test('a failed request cannot hide or overwrite the original server booking', () => {
  const original = appointment(15, { version: 4 });
  const rejected = { canonical: null, outcome: 'conflict' as const };
  const local = showCalendarProposal(rejected) ? [appointment(-1)] : [];
  assert.deepEqual(mergeLocalCalendar([original], local), [original]);
  // A previously committed canonical result is not a new rejected booking.
  const canonical = { id: 15 } as NonNullable<Parameters<typeof showCalendarProposal>[0]['canonical']>;
  assert.equal(showCalendarProposal({ outcome: 'conflict', canonical }), true);
});

test('calendar merge preserves local proposals, canonical identities and their independent sync state', () => {
  const pending = appointment(-1, { syncPending: true });
  const cached = appointment(1, { patientName: 'Cached authorized name', version: 3 });
  const result = mergeLocalCalendar([appointment(1), appointment(2)], [cached, pending]);
  assert.equal(result.length, 3);
  assert.equal(result.find((item) => item.id === 1), cached);
  assert.equal(result.find((item) => item.id === -1), pending);
  assert.equal(pending.version, undefined);
  assert.equal(pending.lifecycle, 'booked');
  assert.equal(pending.syncPending, true);
});

test('coverage uses actual instants and fails closed without metadata', () => {
  const coverage = { coverageStartUtc: '2026-04-30T21:00:00Z', coverageEndUtc: '2026-05-14T21:00:00Z' };
  assert.ok(coversCalendarRange(coverage, coverage.coverageStartUtc, coverage.coverageEndUtc));
  assert.ok(coversCalendarRange(coverage, '2026-05-01T00:00:00Z', '2026-05-02T00:00:00Z'));
  assert.equal(coversCalendarRange(coverage, '2026-04-30T20:59:59Z', '2026-05-02T00:00:00Z'), false);
  assert.equal(coversCalendarRange(null, '2026-05-01T00:00:00Z', '2026-05-02T00:00:00Z'), false);
});

test('a failed local save can retry with the same operation and payload until selection changes', () => {
  let sequence = 0;
  const attempts = createAttemptKeeper<{ patientId: number }>(() => `attempt-${++sequence}`);
  const first = attempts.begin('selection-1', () => ({ patientId: 11 }));
  const retry = attempts.begin('selection-1', () => ({ patientId: 99 }));
  assert.equal(retry, first);
  assert.deepEqual(retry.payload, { patientId: 11 });
  assert.equal(sequence, 1);
  attempts.clear();
  const changed = attempts.begin('selection-2', () => ({ patientId: 99 }));
  assert.notEqual(changed.clientOpId, first.clientOpId);
});
