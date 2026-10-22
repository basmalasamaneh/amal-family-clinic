import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { previewReducer, previewText } from '../src/reminders/phone-preview-model';
import { remAr, remEn } from '../src/reminders/strings-data';

const source = (name: string) => readFileSync(new URL(`../src/reminders/${name}`, import.meta.url), 'utf8');

test('simulation is a pure local state machine, never a delivery status', () => {
  assert.equal(previewReducer('ready', 'finish'), 'ready');
  assert.equal(previewReducer('ready', 'simulate'), 'animating');
  assert.equal(previewReducer('animating', 'simulate'), 'animating');
  assert.equal(previewReducer('animating', 'finish'), 'simulated');
  assert.equal(previewReducer('simulated', 'simulate'), 'simulated');
  for (const phase of ['ready', 'animating', 'simulated'] as const) assert.equal(previewReducer(phase, 'reset'), 'ready');
});
test('current language selects authorized row text without mutating it', () => {
  const row = Object.freeze({ textAr: 'موعد تجريبي', textEn: 'Demo appointment', status: 'scheduled' });
  assert.equal(previewText(row, 'ar'), row.textAr);
  assert.equal(previewText(row, 'ar-PS'), row.textAr);
  assert.equal(previewText(row, 'en'), row.textEn);
  previewReducer('animating', 'finish');
  assert.equal(row.status, 'scheduled');
});
test('phone preview has no transport, cache write, persistence, or delivery receipt capability', () => {
  const code = source('PhonePreview.tsx') + source('phone-preview-model.ts');
  assert.doesNotMatch(code, /\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|mutate|setQueryData|invalidateQueries)\b|api-client|https?:\/\//);
  assert.match(code, /clearTimeout\(timer\)/);
  assert.match(code, /dispatch\('finish'\)/);
  assert.match(code, /Dialog\.Description/);
  assert.match(code, /trigger\.isConnected/);
});
test('demo notice distinguishes dispatcher events and unchanged current-page counts in both languages', () => {
  assert.equal(remEn.phone.result, 'Simulated, not sent to a phone');
  assert.equal(remAr.phone.result, 'تمت المحاكاة — لم تُرسل للهاتف');
  assert.match(remEn.phone.notice, /separate from dispatcher/);
  assert.match(remEn.phone.notice, /current-page counts stay unchanged/);
  assert.match(remAr.phone.notice, /لا تتغير حالات السجل/);
  assert.deepEqual(Object.keys(remEn.phone).sort(), Object.keys(remAr.phone).sort());
  const page = source('MessagesPage.tsx');
  assert.match(page, /data\.items\.filter\(\(m\) => m\.status === s\)\.length/);
  assert.match(page, /data-testid=\{`row-message-\$\{m.id\}`\}/);
});
test('scope, offline, permission, query invalidation and refetch fence the portal', () => {
  const page = source('MessagesPage.tsx');
  assert.match(page, /identity\.id.*identity\.role.*own\.id.*clinic\?\.id.*canManageReminders/);
  assert.match(page, /addEventListener\(REMINDER_REVOKED, revoke\)/);
  assert.match(page, /addEventListener\('offline', close\)/);
  assert.match(page, /event\.query\.state\.isInvalidated/);
  assert.match(page, /!log\.isFetching && !revoked && navigator\.onLine/);
  assert.match(page, /selected && previewEntry && <PhonePreview/);
  assert.match(page, /data\?\.items\.find/);
});
