import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('online sync bootstrap requires trusted device authority, not merely login or an offline permit', () => {
  const identity = readFileSync(new URL('../src/shell/identity.ts', import.meta.url), 'utf8');
  const lifecycle = readFileSync(new URL('../src/shell/private-cache-lifecycle.tsx', import.meta.url), 'utf8');
  assert.match(identity, /syncDeviceAuthorized: identity\.device !== null && identity\.device\.clinicId === identity\.clinicId/);
  assert.match(lifecycle, /identity\.syncDeviceAuthorized \|\| identity\.offlineRestored/);
  assert.match(lifecycle, /syncClient\.start\(ticket\.value, !identity\.offlineRestored && identity\.syncDeviceAuthorized === true\)/);
});
