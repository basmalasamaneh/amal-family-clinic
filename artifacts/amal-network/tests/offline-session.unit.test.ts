import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { issueOfflinePermit, OFFLINE_PERMIT_LIFETIME_MS } from '../../api-server/src/lib/offline-permit';
import type { Auth } from '../../api-server/src/lib/auth';
import { allowSessionAfterLogin, authorizationEpoch, markExplicitSignout, newTabNonce, onPeerRevocation, rememberOfflinePermit, restoreOfflineIdentity, revokeOfflineAuthorization, verifyOfflinePermit } from '../src/auth/offline-permit';
import type { ShellIdentity } from '../src/shell/identity';

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const storage = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); }, clear: () => data.clear() };
};
const local = storage(), session = storage();
Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true });
const clinic = { id: 3, name: 'Clinic' };
const auth = (now: number, role: Auth['role'] = 'doctor'): Auth => ({
  id: 12, email: 'doctor@example.org', role, clinicId: 3, doctorId: 2, locale: 'en', theme: 'light',
  sessionDigest: 'not-persisted', csrfToken: 'not-persisted', device: null,
  expiresAt: new Date(now + 60 * 60 * 1000), absoluteExpiresAt: null, pinVerifiedAt: null,
});
const identity: ShellIdentity = { id: 'account:12', name: 'doctor@example.org', role: 'doctor', clinics: [clinic] };

test('actual server P1363 permits verify locally, expire, and bind user/clinic/tab nonce', async () => {
  const now = Date.now(), nonce = newTabNonce();
  const permit = issueOfflinePermit(auth(now), clinic, nonce, now);
  const claims = await verifyOfflinePermit(permit, nonce, now);
  assert.equal(claims?.userId, 'account:12');
  assert.equal(claims?.clinic.id, 3);
  assert.equal(claims?.expiresAt, now + OFFLINE_PERMIT_LIFETIME_MS);
  assert.equal(await verifyOfflinePermit(permit, newTabNonce(), now), null);
  assert.equal(await verifyOfflinePermit(permit, nonce, now + OFFLINE_PERMIT_LIFETIME_MS), null);
  assert.equal(await verifyOfflinePermit(permit, nonce, now - 1), null);
  assert.equal(await verifyOfflinePermit({ ...permit, payload: `${permit.payload.slice(0, -2)}AA` }, nonce, now), null);
  assert.equal(await verifyOfflinePermit({ ...permit, signature: 'AAAA' }, nonce, now), null);
  const short = { ...auth(now), expiresAt: new Date(now + 5000) };
  assert.equal((await verifyOfflinePermit(issueOfflinePermit(short, clinic, nonce, now), nonce, now))?.expiresAt, now + 5000);
  assert.throws(() => issueOfflinePermit(auth(now, 'admin'), clinic, nonce, now), /scope/);
  assert.throws(() => issueOfflinePermit(auth(now), { ...clinic, id: 4 }, nonce, now), /scope/);
  assert.throws(() => issueOfflinePermit(auth(now), clinic, 'invalid', now), /scope/);
});

test('same tab reload restores only verified identity, revocation and logout immediately prevent reuse', async () => {
  local.clear(); session.clear();
  const now = Date.now(), nonce = newTabNonce(), epoch = authorizationEpoch();
  const permit = issueOfflinePermit(auth(now), clinic, nonce, now);
  assert.equal(await restoreOfflineIdentity(), null);
  assert.equal(await rememberOfflinePermit(permit, nonce, epoch, { ...identity, id: 'account:99' }), null);
  assert.equal(await rememberOfflinePermit(permit, nonce, epoch, { ...identity, clinics: [{ id: 4, name: 'Other' }] }), null);
  assert.ok(await rememberOfflinePermit(permit, nonce, epoch, identity));
  const restored = await restoreOfflineIdentity();
  assert.equal(restored?.id, identity.id);
  assert.equal(restored?.offlineRestored, true);
  assert.equal(restored?.csrfToken, undefined);
  const raw = session.getItem('amal-offline-permit-v1')!;
  assert.ok(!raw.includes('not-persisted'));
  revokeOfflineAuthorization();
  // An in-flight issuance captured before revocation cannot resurrect authority.
  assert.equal(await rememberOfflinePermit(permit, nonce, epoch, identity), null);
  session.setItem('amal-offline-permit-v1', raw);
  assert.equal(await restoreOfflineIdentity(), null);
  assert.ok(await rememberOfflinePermit(permit, nonce, authorizationEpoch(), identity));
  markExplicitSignout();
  assert.equal(await restoreOfflineIdentity(), null);
  allowSessionAfterLogin();
  assert.equal(await restoreOfflineIdentity(), null);
});

test('persisted identity without signature, rolled back clock, and fresh tab all stay locked', async () => {
  local.clear(); session.clear();
  session.setItem('amal-offline-permit-v1', JSON.stringify(identity));
  assert.equal(await restoreOfflineIdentity(), null);
  const now = Date.now(), nonce = newTabNonce();
  await rememberOfflinePermit(issueOfflinePermit(auth(now), clinic, nonce, now), nonce, authorizationEpoch(), identity);
  const raw = JSON.parse(session.getItem('amal-offline-permit-v1')!);
  session.setItem('amal-offline-permit-v1', JSON.stringify({ ...raw, checkedAt: now + 10000 }));
  assert.equal(await restoreOfflineIdentity(), null);
  session.clear();
  assert.equal(await restoreOfflineIdentity(), null);
});

test('peer revocation event locks immediately and cannot be undone by restoring old tab storage', async () => {
  local.clear(); session.clear();
  const target = new EventTarget();
  Object.defineProperty(globalThis, 'window', { value: target, configurable: true });
  const now = Date.now(), nonce = newTabNonce();
  await rememberOfflinePermit(issueOfflinePermit(auth(now), clinic, nonce, now), nonce, authorizationEpoch(), identity);
  const old = session.getItem('amal-offline-permit-v1')!;
  let locked = 0;
  const unsubscribe = onPeerRevocation(() => { locked++; });
  try {
    // Models another tab writing shared storage; this tab gets the native storage event.
    local.setItem('amal-auth-revocation-v1', newTabNonce());
    const event = new Event('storage');
    Object.defineProperty(event, 'key', { value: 'amal-auth-revocation-v1' });
    target.dispatchEvent(event);
    assert.equal(locked, 1);
    assert.equal(session.getItem('amal-offline-permit-v1'), null);
    session.setItem('amal-offline-permit-v1', old);
    assert.equal(await restoreOfflineIdentity(), null);
  } finally { unsubscribe(); }
});
