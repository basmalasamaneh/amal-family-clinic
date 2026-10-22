import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPatientSearchHandoff, patientSearchDestination } from '../src/shell/patient-search-handoff';

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('name and phone submissions hand off the actual prefill with a query-free destination', () => {
  for (const [role, path] of [['front-desk', '/desk/patients'], ['doctor', '/doctor/network-search']]) {
    const store = createPatientSearchHandoff(role);
    for (const query of ['ليلى حداد', 'Lina Haddad', '0595 771 238']) {
      assert.equal(store.submit(` ${query} `), path);
      assert.equal(store.getSnapshot().request?.query, query);
      assert.ok(!path.includes(query));
      assert.ok(!/[?#]/.test(path));
    }
  }
});

test('minimum two trimmed characters; admin and unknown roles cannot submit', () => {
  const store = createPatientSearchHandoff('front-desk');
  for (const query of ['', ' ', ' a ', 'م']) assert.equal(store.submit(query), null);
  assert.equal(store.getSnapshot().request, null);
  assert.equal(store.submit('ab'), '/desk/patients');
  for (const role of ['admin', 'unknown', null]) {
    assert.equal(patientSearchDestination(role), null);
    assert.equal(createPatientSearchHandoff(role).submit('Lina'), null);
  }
});

test('repeated identical or different queries notify mounted consumers with a fresh submission key', () => {
  const store = createPatientSearchHandoff('front-desk');
  const received: { id: number; query: string }[] = [];
  const stop = store.subscribe(() => { const request = store.getSnapshot().request; if (request) received.push(request); });
  for (const query of ['Lina', 'Lina', '0595']) store.submit(query);
  assert.deepEqual(received.map(r => r.query), ['Lina', 'Lina', '0595']);
  assert.equal(new Set(received.map(r => r.id)).size, 3);
  stop();
});

test('consumption releases the mailbox without changing the page reset key or discarding a newer submission', () => {
  const store = createPatientSearchHandoff('doctor');
  store.submit('Lina');
  const first = store.getSnapshot().request!;
  store.submit('Haddad');
  store.acknowledge(first.id);
  assert.equal(store.getSnapshot().request?.query, 'Haddad');
  store.acknowledge(store.getSnapshot().request!.id);
  assert.equal(store.getSnapshot().request, null);
  assert.equal(store.getSnapshot().revision, 0);
});

test('auth/cache clear synchronously drops pending handoff and resets page/input consumers', () => {
  const store = createPatientSearchHandoff('front-desk');
  store.submit('Lina');
  let observed = false;
  store.subscribe(() => {
    observed = true;
    assert.equal(store.getSnapshot().request, null);
    assert.equal(store.getSnapshot().revision, 1);
  });
  store.clear();
  assert.equal(observed, true);
});

test('fresh identity, role, or clinic provider instances never inherit a query', () => {
  const previous = createPatientSearchHandoff('front-desk');
  previous.submit('Lina');
  for (const role of ['front-desk', 'doctor', 'admin', null]) {
    assert.equal(createPatientSearchHandoff(role).getSnapshot().request, null);
  }
  const shell = source('shell/AppShell.tsx');
  assert.match(shell, /PatientSearchProvider key=\{`\$\{identity.id\}:\$\{role\}:\$\{clinic\?\.id/);
  assert.match(shell, /identity\.offlineRestored/);
  assert.match(shell, /identity\.clinicsState !== 'error'/);
  const provider = source('shell/PatientSearchProvider.tsx');
  assert.match(provider, /localCache\.subscribeContext\(store\.clear\)/);
  assert.match(provider, /Fragment key=\{snapshot\.revision\}/);
});

test('existing authorized search consumers receive prefill; booking defaults and authority stay unchanged', () => {
  const reception = source('reception/PatientsPage.tsx');
  assert.match(reception, /usePatientSearchRequest\(\)/);
  assert.match(reception, /key=\{request\?\.id \?\? 'native'\} initialQuery=\{request\?\.query\}/);
  assert.match(reception, /: cachedPatientSearch/);
  const quick = source('booking/PatientQuickSearch.tsx');
  assert.match(quick, /initialQuery = ''/);
  assert.match(quick, /useState\(\(\) => initialQuery\.slice\(0, 120\)\)/);
  assert.match(quick, /adapter\.search\(query, clinicId, ctl\.signal\)/);
  const doctor = source('network/NetworkSearchPage.tsx');
  assert.match(doctor, /run\(request\.query, undefined, true\)/);
  assert.match(doctor, /lookupNetwork\(/);
  assert.match(doctor, /clinicalDataBlocked\(\)/);
  assert.match(doctor, /navigate\(demoPath\('\/doctor\/patient-card'\)\)/);
  assert.doesNotMatch(reception, /lookupNetwork|lookupPatientCard/);
});

test('header never writes sensitive query to browser storage or URL and retains existing test ids', () => {
  const header = source('shell/AppShell.tsx').split('function GlobalSearch()')[1].split('function UserMenu')[0];
  assert.match(header, /store\?\.submit\(q\)/);
  assert.match(header, /navigate\(demoPath\(destination\)\)/);
  assert.match(header, /data-testid="input-global-search"/);
  assert.match(header, /data-testid="button-global-search"/);
  assert.doesNotMatch(header, /shell\.search\.result|URLSearchParams|localStorage|sessionStorage/);
  for (const file of ['shell/patient-search-handoff.ts', 'shell/PatientSearchProvider.tsx']) {
    assert.doesNotMatch(source(file), /localStorage|sessionStorage|URLSearchParams|fetch\(/);
  }
});
