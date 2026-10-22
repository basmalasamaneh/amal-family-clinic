import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createPatientSearchHandoff } from '../src/shell/patient-search-handoff';

// Match Vite's app-owned peer resolution without changing workspace dependencies.
const require = createRequire(import.meta.url);
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'react' || specifier.startsWith('react/')) return nextResolve(pathToFileURL(require.resolve(specifier)).href, context);
  return nextResolve(specifier, context);
} });
const { AmalPreferencesProvider } = await import('@workspace/amal-ui');
const { PatientQuickSearch } = await import('../src/booking/PatientQuickSearch');
const { i18n } = await import('../src/i18n');
await import('../src/booking/i18n');

// tsx's Node JSX transform uses the classic runtime; Vite uses the automatic runtime.
Object.assign(globalThis, { React });
const adapter = {
  mode: 'real' as const,
  async search() { throw new Error('Rendering a prefill must not bypass the native search effect'); },
};
const render = (query?: string, key?: number) => renderToStaticMarkup(
  React.createElement(AmalPreferencesProvider, { i18n, userId: null },
    React.createElement(PatientQuickSearch, { key, adapter, clinicId: 7, initialQuery: query, onSelect: () => {} })),
);

test('real quick-search input receives name/phone handoffs on fresh mounts and successive submissions', () => {
  const handoff = createPatientSearchHandoff('front-desk');
  for (const query of ['Lina Haddad', '0595 771 238', '0595 771 238', 'ليلى']) {
    assert.equal(handoff.submit(query), '/desk/patients');
    const request = handoff.getSnapshot().request!;
    const html = render(request.query, request.id);
    assert.ok(html.includes(`value="${query}"`));
    assert.ok(html.includes('data-testid="input-patient-search"'));
    assert.ok(!html.includes('status-patient-empty'), 'prefill is not a fabricated no-results response');
    handoff.acknowledge(request.id);
  }
});

test('booking use without a handoff and a cleared scope both render an empty native input', () => {
  assert.match(render(), /value=""/);
  const handoff = createPatientSearchHandoff('front-desk');
  handoff.submit('Lina');
  handoff.clear();
  assert.match(render(handoff.getSnapshot().request?.query), /value=""/);
  assert.doesNotMatch(render(), /value="Lina"/);
});
