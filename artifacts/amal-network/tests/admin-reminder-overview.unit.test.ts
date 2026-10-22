import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGlobalReminderAdmin, overviewCopy, overviewInstant, overviewTotals } from '../src/reminders/admin-overview-model';
import { messagesClinicFor } from '../src/reminders/model';

test('overview is only global admin; log clinic scope stays unchanged', () => {
  for (const role of ['admin', 'doctor', 'front-desk', null] as const) {
    for (const homeClinicId of [undefined, null, 7]) {
      assert.equal(isGlobalReminderAdmin({ role, homeClinicId }), role === 'admin' && homeClinicId == null);
      const selected = { id: 9, name: 'Selected' };
      const own = messagesClinicFor({ id: 'a', name: 'A', role, homeClinicId, clinics: [selected] }, selected);
      assert.equal(own?.id ?? null, role === 'front-desk' ? 9 : (role === 'admin' || role === 'doctor') && homeClinicId ? 7 : null);
    }
  }
});
test('totals sum every returned clinic rather than a page; zero stays zero', () => {
  const rows = Array.from({ length: 31 }, (_, index) => ({ scheduledCount: index, sentCount: index * 2, cancelledCount: index % 3 }));
  assert.deepEqual(overviewTotals(rows), { scheduledCount: 465, sentCount: 930, cancelledCount: 30 });
  assert.deepEqual(overviewTotals([]), { scheduledCount: 0, sentCount: 0, cancelledCount: 0 });
  assert.deepEqual(overviewTotals([{ scheduledCount: 0, sentCount: 0, cancelledCount: 0 }]), { scheduledCount: 0, sentCount: 0, cancelledCount: 0 });
});
test('null next due is not an invented timestamp; valid instants use Hebron', () => {
  assert.equal(overviewInstant(null, 'en', 'latn'), null);
  assert.equal(overviewInstant('invalid', 'en', 'latn'), null);
  assert.match(overviewInstant('2025-01-15T10:17:00Z', 'en', 'latn')!, /12:17/);
  assert.match(overviewInstant('2025-07-15T10:17:00Z', 'en', 'latn')!, /13:17/);
});
test('copy is bilingual, all-history, and uses trial sent label', () => {
  assert.deepEqual(Object.keys(overviewCopy.ar), Object.keys(overviewCopy.en));
  assert.equal(overviewCopy.ar.sent, 'أُرسلت (تجريبي)');
  assert.equal(overviewCopy.ar.scheduled, 'بانتظار وقت الإرسال');
  assert.match(overviewCopy.en.summary, /All clinics.*All history/);
  assert.doesNotMatch(JSON.stringify(overviewCopy), /محاكاة|simulation/i);
});
