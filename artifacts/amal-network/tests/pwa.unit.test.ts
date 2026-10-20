import assert from 'node:assert/strict';
import test from 'node:test';
import { isAppDocument } from '../src/pwa/navigation';

const documentRequest = { mode: 'navigate', destination: 'document' } as const;
for (const mount of ['/', '/amal/']) {
  const base = new URL(mount, 'https://amal.example');
  test(`only app document navigation falls back at ${mount}`, () => {
    for (const path of ['', 'login', 'data', 'ui-kit', 'desk/today', 'doctor/privacy', 'admin/audit?tab=1']) {
      assert.equal(isAppDocument(documentRequest, new URL(path, base), base), true, path);
    }
    for (const path of ['api', 'api/patients', 'auth/callback', 'docs', '__mockup', 'canvas/a', 'admin/docs', 'assets/main.js', 'login.json', 'other', 'doctor/patient-card/file']) {
      assert.equal(isAppDocument(documentRequest, new URL(path, base), base), false, path);
    }
    assert.equal(isAppDocument({ mode: 'cors', destination: '' }, new URL('login', base), base), false);
    assert.equal(isAppDocument({ mode: 'navigate', destination: 'iframe' }, new URL('login', base), base), false);
    assert.equal(isAppDocument(documentRequest, new URL('login', 'https://other.example/'), base), false);
    if (mount !== '/') assert.equal(isAppDocument(documentRequest, new URL('/login', base), base), false);
  });
}
