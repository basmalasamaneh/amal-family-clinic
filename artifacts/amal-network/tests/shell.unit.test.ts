import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHELL_ROUTES, resolve, routesFor, landingFor } from '../src/shell/routes';
import { formatDateOnly, formatInstant, formatNumber } from '../src/shell/formatting';
import { browserPreferenceStorage, DEFAULT_DISPLAY } from '../../../lib/amal-ui/src/preferences/account-storage';

test('every direct route is allowed only for its listed role', () => {
  for (const role of ['admin', 'doctor', 'front-desk'] as const) {
    assert.equal(resolve('/', role).kind, 'landing');
    assert.equal(landingFor(role), routesFor(role)[0].path);
    for (const route of SHELL_ROUTES) {
      assert.equal(resolve(route.path, role).kind, route.roles.includes(role) ? 'page' : 'forbidden');
      assert.equal(resolve(`${route.path}/`, role).kind, route.roles.includes(role) ? 'page' : 'forbidden');
    }
  }
  for (const role of [null, 'administrator', 'reception', ''] as const) {
    assert.deepEqual(routesFor(role as null), []);
    for (const route of SHELL_ROUTES) assert.equal(resolve(route.path, role as null).kind, 'noRole');
  }
  assert.equal(resolve('/missing', 'admin').kind, 'notFound');
  assert.equal(new Set(SHELL_ROUTES.map(r => r.path)).size, 18);
});

test('display preferences isolate stable identities, invalid fields and storage failures', () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
  } } });
  assert.deepEqual(browserPreferenceStorage.read('a'), DEFAULT_DISPLAY);
  const custom = { locale: 'en', theme: 'dark', digitPreference: 'arab' } as const;
  browserPreferenceStorage.write('a', custom);
  assert.deepEqual(browserPreferenceStorage.read('a'), custom);
  assert.deepEqual(browserPreferenceStorage.read('b'), DEFAULT_DISPLAY);
  assert.deepEqual(browserPreferenceStorage.read('a/b'), DEFAULT_DISPLAY);
  values.set('amal.display.v1:b', '{bad');
  assert.deepEqual(browserPreferenceStorage.read('b'), DEFAULT_DISPLAY);
  values.set('amal.display.v1:b', '{"locale":"xx","theme":"bright","digitPreference":"unknown"}');
  assert.deepEqual(browserPreferenceStorage.read('b'), DEFAULT_DISPLAY);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { get localStorage() { throw new Error('denied'); } } });
  assert.doesNotThrow(() => browserPreferenceStorage.write('a', custom));
  assert.deepEqual(browserPreferenceStorage.read('a'), DEFAULT_DISPLAY);
});

test('numbers honor digits in both locales without mutating source strings', () => {
  for (const locale of ['ar', 'en'] as const) {
    assert.match(formatNumber(1234.5, locale, 'latn'), /1/);
    assert.doesNotMatch(formatNumber(1234.5, locale, 'latn'), /[٠-٩]/);
    assert.match(formatNumber(1234.5, locale, 'arab'), /١/);
  }
  const phone = '+970599000001';
  formatNumber(Number(phone), 'ar', 'arab');
  assert.equal(phone, '+970599000001');
});

test('Hebron date presentation crosses UTC midnight and uses seasonal timezone rules', () => {
  assert.match(formatInstant('2026-09-08T22:30:00Z', 'en', 'latn'), /9 September 2026 · 01:30/);
  assert.match(formatInstant('2026-01-08T22:30:00Z', 'en', 'latn'), /9 January 2026 · 00:30/);
  assert.match(formatInstant('2026-09-08T22:30:00Z', 'ar', 'arab'), /٠١:٣٠/);
  assert.throws(() => formatInstant('2026-09-08T10:00:00', 'en', 'latn'));
  assert.throws(() => formatInstant('badZ', 'en', 'latn'));
  assert.match(formatDateOnly('2026-09-08', 'en', 'latn'), /September 8, 2026/);
  assert.match(formatDateOnly('2026-09-08', 'ar', 'arab'), /٨/);
  assert.throws(() => formatDateOnly('2026-02-30', 'en', 'latn'));
});
