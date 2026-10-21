import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  clockOffset, isAffectedByDecision, isUncertain, isWaitlistKey, notificationReasonKey, notificationWarning, offerGate,
  toEntryPayload, validateEntry, waitlistKey,
} from '../src/waitlist/model';
import { wlAr, wlEn } from '../src/waitlist/strings-data';
import { createAttemptKeeper, stableKey } from '../src/booking/ops';
import { resolve, routesFor } from '../src/shell/routes';

const keys = (o: object, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]).sort();
const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('AR and EN waitlist strings are key-for-key identical', () => { assert.deepEqual(keys(wlAr), keys(wlEn)); });
test('waitlist route is reception only', () => {
  assert.ok(routesFor('front-desk').some((r) => r.path === '/desk/waitlist'));
  assert.equal(resolve('/desk/waitlist', 'doctor').kind, 'forbidden');
  assert.equal(resolve('/desk/waitlist', 'admin').kind, 'forbidden');
});
test('query keys are actor + clinic scoped', () => {
  const a = waitlistKey('u1:front-desk:3', 3), b = waitlistKey('u1:front-desk:4', 4), c = waitlistKey('u2:front-desk:3', 3);
  assert.notEqual(stableKey(a), stableKey(b)); assert.notEqual(stableKey(a), stableKey(c));
  assert.ok(isWaitlistKey(a)); assert.ok(!isWaitlistKey(['/api/appointments']));
  for (const k of ['/api/appointments', '/api/waitlist', '/api/reminders/log']) assert.ok(isAffectedByDecision([k]));
});
test('entry form requires explicit IDs, weekdays, HH:mm and end > start; payload has no clinic', () => {
  const ok = { patientId: 12, doctorId: 4, weekdays: [3, 0, 3], windowStart: '08:00', windowEnd: '12:30' };
  assert.equal(validateEntry(ok), null);
  assert.equal(validateEntry({ ...ok, patientId: null }), 'patient');
  assert.equal(validateEntry({ ...ok, patientId: 1.5 }), 'patient');
  assert.equal(validateEntry({ ...ok, doctorId: 0 }), 'doctor');
  assert.equal(validateEntry({ ...ok, weekdays: [] }), 'weekdays');
  assert.equal(validateEntry({ ...ok, weekdays: [7] }), 'weekdays');
  assert.equal(validateEntry({ ...ok, windowEnd: '8:00' }), 'time');
  assert.equal(validateEntry({ ...ok, windowEnd: '08:00' }), 'order');
  assert.equal(validateEntry({ ...ok, windowEnd: '07:59' }), 'order');
  const p = toEntryPayload(ok)!;
  assert.deepEqual(p, { patientId: 12, doctorId: 4, weekdays: [0, 3], windowStart: '08:00', windowEnd: '12:30' });
  assert.ok(!('clinicId' in p) && !('patientName' in p));
});
test('expired, started, closed and offline offers cannot be decided', () => {
  const now = Date.parse('2025-07-01T08:00:00Z');
  const o = { status: 'active', expiresAt: '2025-07-01T08:10:00Z', startsAt: '2025-07-01T09:00:00Z' };
  assert.equal(offerGate(o, now, true), 'ok');
  assert.equal(offerGate(o, now, false), 'offline');
  assert.equal(offerGate({ ...o, expiresAt: '2025-07-01T08:00:00Z' }, now, true), 'expired');
  assert.equal(offerGate({ ...o, startsAt: '2025-07-01T07:59:00Z' }, now, true), 'started');
  assert.equal(offerGate({ ...o, status: 'expired' }, now, true), 'notActive');
});
test('server clock offset drives display, not the device clock', () => {
  assert.equal(clockOffset('2025-07-01T08:00:10.000Z', Date.parse('2025-07-01T08:00:00Z')), 10000);
  assert.equal(clockOffset('garbage', 5), 0);
});
test('uncertain failures keep the exact UUID and payload for replay', () => {
  assert.ok(isUncertain(null)); assert.ok(isUncertain(503)); assert.ok(!isUncertain(409)); assert.ok(!isUncertain(422));
  let n = 0; const k = createAttemptKeeper<{ decision: string }>(() => `op-${++n}`);
  const a = k.begin('accept|', () => ({ decision: 'accept' }));
  const b = k.begin('accept|', () => ({ decision: 'decline' }));
  assert.equal(a, b); assert.equal(b.clientOpId, 'op-1'); assert.deepEqual(b.payload, { decision: 'accept' });
});
test('notification warnings are explicit', () => {
  assert.equal(notificationWarning({ notificationStatus: 'suppressed' }), 'suppressed');
  assert.equal(notificationWarning({ notificationStatus: 'simulated' }), null);
  for (const c of ['clinic_disabled', 'patient_opt_out', 'offer_accepted', 'offer_declined', 'offer_expired', 'offer_unavailable']) {
    assert.equal(notificationReasonKey(c), `notifReason.${c}`); assert.ok(c in wlEn.notifReason && c in wlAr.notifReason);
  }
  assert.equal(notificationReasonKey('opted-out'), 'notifReason.other');
  assert.equal(notificationReasonKey('<script>'), 'notifReason.other');
});
test('cancellation undo has no premature client waitlist hook', () => {
  for (const f of ['calendar/cancellation-store.ts', 'calendar/CancellationProvider.tsx']) assert.ok(!/waitlist/i.test(src(f)), f);
});
test('waitlist UI never sends a clinic and never persists data', () => {
  const d = src('waitlist/AddToWaitlistDialog.tsx'), p = src('waitlist/WaitlistPage.tsx');
  assert.ok(!/clinicId:\s*clinicId,\s*clientOpId|data:\s*\{[^}]*clinicId/.test(d));
  assert.ok(!/localStorage|indexedDB|localCache/.test(d + p));
  assert.ok(/gcTime: 0/.test(p) && /removeQueries/.test(p));
});
test('unconfirmed attempts are owner-held, survive unmount/poll removal, and server outcome wins', () => {
  const d = src('waitlist/AddToWaitlistDialog.tsx'), p = src('waitlist/WaitlistPage.tsx'), b = src('booking/BookingDrawer.tsx');
  assert.ok(/retained=\{createRetained\} onRetain=\{setCreateRetained\}/.test(p));
  assert.ok(/retained=\{waitlistRetained\} onRetain=\{setWaitlistRetained\}/.test(b));
  assert.ok(/retainRef\.current\?\.\(a\)/.test(d));
  assert.ok(/memoRef\.current\(\{ offer, pending: attempt \}\)/.test(p));
  assert.ok(/outcome: res \}/.test(p) && /const shown = outcome \?\? offer/.test(p));
  assert.ok(/kept = Object\.values\(decisions\)/.test(p));
  assert.ok(!/id: '' \}\)\.trim\(\)/.test(p));
});
test('unconfirmed create blocks silent drawer close and guards page unload without persisting', () => {
  const b = src('booking/BookingDrawer.tsx'), p = src('waitlist/WaitlistPage.tsx'), g = src('waitlist/use-unconfirmed-guard.ts');
  assert.ok(/if \(waitlistRetained && !force\) \{ setCloseWarn\(true\); return; \}/.test(b));
  assert.ok(/close\(true\)/.test(b) && /useUnconfirmedGuard\(!!waitlistRetained\)/.test(b));
  assert.ok(/useUnconfirmedGuard\(unconfirmed\)/.test(p) && /status-waitlist-unconfirmed/.test(p));
  assert.ok(/beforeunload/.test(g) && !/localStorage|sessionStorage|indexedDB/.test(g));
  assert.deepEqual(keys(wlAr.guard), keys(wlEn.guard));
});
