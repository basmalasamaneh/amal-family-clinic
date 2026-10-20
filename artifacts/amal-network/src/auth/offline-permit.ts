import type { ShellIdentity } from '../shell/identity';

export interface OfflinePermit { payload: string; signature: string; publicKey: string }
export interface OfflineClaims {
  version: 1; audience: 'amal-offline-tab'; nonce: string; userId: string; name: string;
  role: 'doctor' | 'front-desk'; clinic: { id: number; name: string }; issuedAt: number; expiresAt: number;
}
const MAX_LIFETIME = 30 * 60 * 1000;
const key = 'amal-offline-permit-v1';
const epochKey = 'amal-auth-revocation-v1';
const channelName = 'amal-auth-revocation';
const signedOutKey = 'amal-explicit-signout-v1';
// In-memory per-document identity: unlike sessionStorage it is not copied into
// a newly opened tab. Multiple channel objects in this document share it.
const senderId = crypto.randomUUID();
interface StoredPermit { permit: OfflinePermit; nonce: string; epoch: string; checkedAt: number }
const bytes = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

/** Verify the signed bytes before parsing identity; persisted display identity never grants access. */
export async function verifyOfflinePermit(permit: OfflinePermit, nonce: string, now = Date.now()): Promise<OfflineClaims | null> {
  try {
    const publicKey = await crypto.subtle.importKey('spki', bytes(permit.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, bytes(permit.signature), new TextEncoder().encode(permit.payload))) return null;
    const c = JSON.parse(new TextDecoder().decode(bytes(permit.payload))) as OfflineClaims;
    if (c.version !== 1 || c.audience !== 'amal-offline-tab' || c.nonce !== nonce ||
      !/^account:[1-9]\d*$/.test(c.userId) || typeof c.name !== 'string' ||
      !['doctor', 'front-desk'].includes(c.role) || !Number.isSafeInteger(c.clinic?.id) || c.clinic.id <= 0 ||
      typeof c.clinic.name !== 'string' || !Number.isSafeInteger(c.issuedAt) || !Number.isSafeInteger(c.expiresAt) ||
      c.issuedAt > now || c.expiresAt <= now || c.expiresAt <= c.issuedAt || c.expiresAt - c.issuedAt > MAX_LIFETIME) return null;
    return c;
  } catch { return null; }
}

export function authorizationEpoch(): string | null {
  try { return localStorage.getItem(epochKey) ?? 'initial'; } catch { return null; }
}
export function isExplicitlySignedOut(): boolean {
  try { return localStorage.getItem(signedOutKey) === 'true'; } catch { return true; }
}
export function markExplicitSignout() {
  try { localStorage.setItem(signedOutKey, 'true'); } catch { /* denied storage also fails closed above */ }
  revokeOfflineAuthorization();
}
/** Called only after successful online credential submission, never by reload/reconnect. */
export function allowSessionAfterLogin() {
  localStorage.removeItem(signedOutKey);
}
export function newTabNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('');
}
export function forgetOfflinePermit() {
  try { sessionStorage.removeItem(key); } catch { /* No authority can be recovered from denied storage. */ }
}
/** Synchronous local revocation precedes network logout; peer tabs receive both storage and channel events. */
export function revokeOfflineAuthorization() {
  forgetOfflinePermit();
  try { localStorage.setItem(epochKey, newTabNonce()); } catch { /* Current tab still locks. */ }
  try { const channel = new BroadcastChannel(channelName); channel.postMessage({ type: 'revoke', senderId }); channel.close(); } catch { /* storage event is the fallback */ }
}
export function onPeerRevocation(listener: () => void): () => void {
  const revoke = () => { forgetOfflinePermit(); listener(); };
  const storage = (event: StorageEvent) => { if (event.key === epochKey || event.key === null) revoke(); };
  window.addEventListener('storage', storage);
  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel(channelName);
    channel.onmessage = (event: MessageEvent) => {
      if (event.data?.senderId === senderId) return;
      if (event.data === 'revoke' || event.data?.type === 'revoke') revoke();
    };
  } catch { /* fallback above */ }
  return () => { window.removeEventListener('storage', storage); channel?.close(); };
}
export async function rememberOfflinePermit(permit: OfflinePermit, nonce: string, epoch: string | null, identity: ShellIdentity): Promise<string | null> {
  const claims = await verifyOfflinePermit(permit, nonce);
  if (!claims || epoch === null || epoch !== authorizationEpoch() || claims.userId !== identity.id ||
    claims.role !== identity.role || !identity.clinics.some(c => c.id === claims.clinic.id)) return null;
  try {
    sessionStorage.setItem(key, JSON.stringify({ permit, nonce, epoch, checkedAt: Date.now() } satisfies StoredPermit));
    return new Date(claims.expiresAt).toISOString();
  } catch { return null; }
}
export async function restoreOfflineIdentity(): Promise<ShellIdentity | null> {
  try {
    if (isExplicitlySignedOut()) return null;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredPermit;
    const epoch = authorizationEpoch();
    const now = Date.now();
    if (epoch === null || stored.epoch !== epoch || !Number.isSafeInteger(stored.checkedAt) || now < stored.checkedAt) return null;
    const c = await verifyOfflinePermit(stored.permit, stored.nonce, now);
    if (!c || epoch !== authorizationEpoch()) return null;
    // High-water mark detects clock rollback across reloads in this permitted tab.
    sessionStorage.setItem(key, JSON.stringify({ ...stored, checkedAt: now }));
    return { id: c.userId, name: c.name, role: c.role, clinics: [c.clinic], clinicsState: 'ready',
      expiresAt: new Date(c.expiresAt).toISOString(), offlineAuthorizedUntil: new Date(c.expiresAt).toISOString(), offlineRestored: true };
  } catch { return null; }
}
