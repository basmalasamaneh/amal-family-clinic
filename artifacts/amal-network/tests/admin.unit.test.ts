import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AdminAuditAction } from '@workspace/api-client-react';
import { EMPTY_DRAFT, toPayload, validateDetails, validateSchedule, classify, OfflineError, validTimezone } from '../src/admin/model';
import { admAr, admEn } from '../src/admin/strings';

const t = (key: string) => key;
const valid = () => ({ ...EMPTY_DRAFT, workingDays: [...EMPTY_DRAFT.workingDays],
  name: ' عيادة جديدة ', city: 'Test city', bookingMethod: 'phone' });

test('clinic validation accepts arbitrary names, all days and supported schedule limits', () => {
  assert.deepEqual(validateDetails(valid(), t), []);
  assert.deepEqual(validateSchedule(valid(), t), []);
  assert.deepEqual([...EMPTY_DRAFT.workingDays].sort(), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(EMPTY_DRAFT.slotMinutes, '30');
  assert.equal(EMPTY_DRAFT.timezone, 'Asia/Hebron');
  assert.equal(toPayload(valid()).name, 'عيادة جديدة');
  for (const slotMinutes of ['1', '1440']) assert.deepEqual(validateSchedule({ ...valid(), slotMinutes }, t), []);
  for (const slotMinutes of ['0', '1441', '1.5', '', 'abc']) {
    assert(validateSchedule({ ...valid(), slotMinutes }, t).some(e => e.id === 'clinic-slot'));
  }
});

test('overnight hours, absent days, invalid times and timezone match upstream policy', () => {
  assert(validateSchedule({ ...valid(), workingDays: [] }, t).some(e => e.id === 'clinic-day-0'));
  for (const closeTime of ['07:59', '08:00', '25:00']) {
    assert(validateSchedule({ ...valid(), openTime: '08:00', closeTime }, t).some(e => e.id === 'clinic-close'));
  }
  assert.equal(validTimezone('Asia/Hebron'), true);
  assert.equal(validTimezone('+02:00'), false);
  assert.equal(validTimezone('Invalid/Zone'), false);
});

test('mutation failure classification distinguishes definitive validation, expiry and unknown outcome', () => {
  assert.equal(classify(new OfflineError()).ambiguous, false);
  for (const status of [400, 403, 409, 422, 429]) assert.equal(classify({ status }).ambiguous, false);
  for (const status of [408, 500, 503]) assert.equal(classify({ status }).ambiguous, true);
  assert.equal(classify(new TypeError('Network error')).ambiguous, true);
  assert.equal(classify({ status: 401 }).session, true);
  assert.equal(classify({ status: 409, data: { code: 'LAST_ADMIN' } }).key, 'adm.err.LAST_ADMIN');
});

function paths(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === 'object' ? paths(child, path) : [path];
  }).sort();
}
test('Arabic and English cover the same authored messages and every supported audit action', () => {
  assert.deepEqual(paths(admAr), paths(admEn));
  const keys = paths(admEn);
  for (const action of Object.values(AdminAuditAction)) {
    assert(keys.some(k => k.endsWith(action.replaceAll('.', '_'))), `Missing audit action: ${action}`);
  }
});

test('admin CSS uses only logical authored directional properties', () => {
  const css = readFileSync(new URL('../src/admin/admin.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert(!/(?:^|[;{])\s*(?:left|right|top|bottom|margin-(?:left|right|top|bottom)|padding-(?:left|right|top|bottom)|border-(?:left|right|top|bottom)(?:-\w+)?)\s*:/m.test(css));
  assert(!/text-align:\s*(left|right)/.test(css));
});
