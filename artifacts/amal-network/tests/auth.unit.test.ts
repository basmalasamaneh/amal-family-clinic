import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeApiError, isAuthFailure } from '../src/auth/errors';
import { normalizePin, isValidPin, isPlausibleEmail } from '../src/auth/digits';
import { safeReturnTo, loginHref } from '../src/auth/return-to';
import { readTour, writeTour, tourFor, tourKey, TOUR_VERSION, type KV } from '../src/tour/tours';
import en from '../src/locales/en.json';
import ar from '../src/locales/ar.json';

const err = (status: number, messageKey?: string, params: object = {}) => ({ status, data: messageKey ? { code: 'X', messageKey, params } : null });

test('error envelope maps to known localized keys only', () => {
  assert.equal(describeApiError(err(401, 'error.unauthorized')).key, 'unauthorized');
  assert.equal(describeApiError(err(403, 'error.deviceUntrusted')).key, 'deviceUntrusted');
  const locked = describeApiError(err(423, 'error.pinLocked', { retryAfterSeconds: 900 }));
  assert.deepEqual([locked.key, locked.retryMinutes], ['pinLocked', 15]);
  assert.equal(describeApiError(err(429)).key, 'rateLimited');
  assert.equal(describeApiError(err(500, 'error.<script>')).key, 'internal');
  assert.equal(describeApiError(new TypeError('Failed to fetch')).key, 'network');
  assert.equal(describeApiError('x').key, 'unknown');
  for (const s of [401, 403, 423, 429]) assert.ok(isAuthFailure(err(s)));
  assert.ok(!isAuthFailure(err(500)));
});

test('PIN normalization keeps leading zeros and Arabic-Indic digits; never touches non-PIN', () => {
  assert.equal(normalizePin('٠١٢٣'), '0123');
  assert.equal(normalizePin('۰۰۷۹'), '0079');
  assert.equal(normalizePin('0 0-4a2'), '0042');
  assert.equal(normalizePin('123456'), '1234');
  assert.ok(isValidPin('0000'));
  assert.ok(!isValidPin('١٢٣٤'));
  assert.ok(!isValidPin('123'));
  assert.ok(isPlausibleEmail('a@b.co'));
  assert.ok(!isPlausibleEmail('ab.co'));
});

test('return destinations are internal and role-authorized only', () => {
  assert.equal(safeReturnTo('/doctor/privacy', 'doctor'), '/doctor/privacy');
  assert.equal(safeReturnTo('/admin/audit', 'doctor'), '/doctor/my-day');
  assert.equal(safeReturnTo('//evil.example', 'admin'), '/admin/kpi');
  assert.equal(safeReturnTo('https://evil.example', 'admin'), '/admin/kpi');
  assert.equal(safeReturnTo('/\\evil', 'admin'), '/admin/kpi');
  assert.equal(safeReturnTo('/desk/today?x=1', 'front-desk'), '/desk/today');
  assert.equal(safeReturnTo('/data', 'front-desk'), '/data');
  assert.equal(safeReturnTo(null, 'front-desk'), '/desk/today');
  assert.equal(safeReturnTo('/desk/today', null), '/');
  assert.equal(loginHref('/desk/week', true), '/login?next=%2Fdesk%2Fweek&reason=expired');
  assert.equal(loginHref(null), '/login');
});

test('tour state is per user, role and version, and survives storage failure', () => {
  const m = new Map<string, string>();
  const kv: KV = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
  assert.equal(readTour('account:1', 'front-desk', kv), null);
  writeTour('account:1', 'front-desk', 'dismissed', kv);
  assert.equal(readTour('account:1', 'front-desk', kv), 'dismissed');
  assert.equal(readTour('account:2', 'front-desk', kv), null);
  assert.equal(readTour('account:1', 'doctor', kv), null);
  assert.ok(tourKey('account:1', 'admin').includes(`v${TOUR_VERSION}`));
  m.set(tourKey('account:3', 'admin'), 'garbage');
  assert.equal(readTour('account:3', 'admin', kv), null);
  const broken: KV = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(readTour('a', 'admin', broken), null);
  assert.doesNotThrow(() => writeTour('a', 'admin', 'completed', broken));
  for (const v of m.values()) assert.match(v, /^(completed|dismissed|garbage)$/);
  assert.deepEqual(tourFor(null), []);
});

test('every tour and auth key exists in both locales', () => {
  const get = (o: unknown, k: string) => k.split('.').reduce<unknown>((a, p) => (a && typeof a === 'object' ? (a as Record<string, unknown>)[p] : undefined), o);
  for (const role of ['admin', 'doctor', 'front-desk'] as const) {
    for (const s of tourFor(role)) for (const k of [s.titleKey, s.bodyKey]) { assert.equal(typeof get(en, k), 'string', k); assert.equal(typeof get(ar, k), 'string', k); }
  }
  for (const k of ['unauthorized', 'forbidden', 'rateLimited', 'pinLocked', 'deviceUntrusted', 'network', 'internal', 'unknown']) {
    assert.equal(typeof get(en, `error.${k}`), 'string'); assert.equal(typeof get(ar, `error.${k}`), 'string');
  }
});
