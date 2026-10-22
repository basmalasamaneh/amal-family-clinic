import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import type { NetworkVisit } from '@workspace/api-client-react';
import { disclosedAddenda, localVisitNow, mayAppend, VisitOperation, visitTimeUTC } from '../src/network/visit-authoring-model';
import { localToUtc } from '../src/calendar/dates';
import { clearSelection, getSelection, setSelection } from '../src/network/model';

test('Hebron conversion roundtrips and uses existing calendar overlap policy', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  assert.equal(visitTimeUTC('2026-10-23T01:30', now), localToUtc('2026-10-23', 90));
  assert.equal(localVisitNow(new Date(visitTimeUTC('2026-06-15T12:42', now))), '2026-06-15T12:42');
  assert.throws(() => visitTimeUTC('2026-02-30T12:00', now));
  assert.throws(() => visitTimeUTC('2026-11-02T23:00', now));
  assert.throws(() => visitTimeUTC('2026-11-02T24:00', now));
  assert.throws(() => visitTimeUTC('not-a-date', now));
});
test('single pending operation; uncertain retries preserve immutable payload and id', () => {
  const op = new VisitOperation();
  const input = { clientOpId: 'operation-1', note: 'Original clinical text', seenAt: '2026-06-15T09:42:00Z' };
  const first = op.begin(input);
  input.note = 'Changed';
  assert.equal(first?.note, 'Original clinical text');
  assert.equal(op.begin({ clientOpId: 'operation-2', note: 'other' }), null);
  op.uncertain();
  const retry = op.begin({ clientOpId: 'operation-2', note: 'other' });
  assert.equal(first, retry);
  assert.ok(Object.isFrozen(retry));
  op.reset();
  assert.equal(op.payload, null);
  assert.equal(op.pending, false);
});
test('capability network/5xx failures preserve frozen operation; authority failures clear it', () => {
  for (const error of [new TypeError('network'), { status: 500 }, { status: 503 }]) {
    const op = new VisitOperation();
    const original = op.begin({ clientOpId: 'same-id', note: 'Draft' });
    op.saveFailed(new TypeError('network'));
    assert.equal(op.capabilityFailed(error), 'preserve');
    assert.equal(op.payload, original);
    assert.equal(op.begin({ clientOpId: 'different-id', note: 'Changed' }), original);
  }
  for (const status of [401, 403, 404]) {
    const op = new VisitOperation();
    op.begin({ clientOpId: 'id', note: 'Draft' });
    assert.equal(op.capabilityFailed({ status }), 'clear');
    assert.equal(op.payload, null);
    assert.equal(op.pending, false);
  }
});
test('definite validation failures permit correction; conflict and unknown preserve exact retry', () => {
  for (const status of [400, 422]) {
    const op = new VisitOperation();
    op.begin({ clientOpId: 'old-id', note: 'Invalid request' });
    assert.equal(op.saveFailed({ status }), 'validation');
    assert.equal(op.payload, null);
    const corrected = op.begin({ clientOpId: 'new-id', note: 'Corrected draft' });
    assert.equal(corrected?.clientOpId, 'new-id');
  }
  for (const status of [409, 500, 502]) {
    const op = new VisitOperation();
    const original = op.begin({ clientOpId: 'same-id', note: 'Draft' });
    assert.equal(op.saveFailed({ status }), status === 409 ? 'conflict' : 'uncertain');
    assert.equal(op.pending, false);
    assert.equal(op.begin({ clientOpId: 'other-id', note: 'Other' }), original);
  }
});
test('scope changes and expiry clear the transient patient selection', () => {
  setSelection({ scope: 'doctor:clinic1', id: 42, appointmentId: 12 });
  assert.equal(getSelection('doctor:clinic1')?.appointmentId, 12);
  assert.equal(getSelection('other:clinic1'), null);
  assert.equal(getSelection('doctor:clinic1'), null);
  setSelection({ scope: 'doctor:clinic1', id: 42 });
  clearSelection();
  assert.equal(getSelection('doctor:clinic1'), null);
});
test('basic projections never expose addenda or append actions even with accidental fields', () => {
  const visit = { visibility: 'basic', visitId: 19, canAddendum: true, addenda: [{ id: 7, note: 'protected' }] } as NetworkVisit;
  assert.deepEqual(disclosedAddenda(visit), []);
  assert.equal(mayAppend(visit), false);
  assert.equal(mayAppend({ ...visit, visibility: 'clinical' }), true);
  assert.equal(mayAppend({ ...visit, visibility: 'clinical', visitId: undefined }), false);
  assert.equal(mayAppend({ ...visit, visibility: 'clinical', canAddendum: false }), false);
});

test('composer lifetime is independent of polling projection and resets on authority loss', () => {
  const page = readFileSync(new URL('../src/network/PatientCardPage.tsx', import.meta.url), 'utf8');
  const editor = readFileSync(new URL('../src/network/VisitAuthoring.tsx', import.meta.url), 'utf8');
  assert.match(page, /patient=\{state.kind === 'ok' \? state.p : null\}/);
  assert.match(page, /key=\{`\$\{scope\}:\$\{getSelection\(scope\)!\.id\}`\}/);
  assert.match(editor, /if \(denied \|\| clinicalDataBlocked\(\)\) \{ resetRef.current\(\); return; \}/);
  assert.match(editor, /if \(!online \|\| !patient/);
  assert.match(editor, /if \(ac.signal.aborted \|\| !alive.current/);
  assert.match(editor, /version !== epoch.current/);
  assert.doesNotMatch(editor, /localStorage|sessionStorage|useQuery|console\./);
});
