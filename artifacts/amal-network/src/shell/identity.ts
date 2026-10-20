import { createFixtureAdapter } from './identity-fixture';
import { getMe, getOfflinePermit, listClinics, logout, type Identity } from '@workspace/api-client-react';
import { authorizationEpoch, forgetOfflinePermit, isExplicitlySignedOut, newTabNonce, rememberOfflinePermit, restoreOfflineIdentity, revokeOfflineAuthorization } from '../auth/offline-permit';

export type ShellRole = 'admin' | 'doctor' | 'front-desk';
export interface ShellClinic { id: number; name: string }
export interface ShellIdentity {
  id: string;
  name: string;
  role: ShellRole | null;
  clinics: ShellClinic[];
  clinicsState?: 'ready' | 'error';
  /** Server session expiry (UTC ISO); used only to re-check GET /me, never trusted for authority. */
  expiresAt?: string | null;
  /** In-memory only, applied by the session owner after stale-load checks. */
  csrfToken?: string;
  /** Locally verified signed continuation expiry; never derived from persisted identity. */
  offlineAuthorizedUntil?: string;
  offlineRestored?: boolean;
}
export interface IdentityAdapter {
  mode: 'real' | 'fixture';
  load(): Promise<ShellIdentity | null>;
  logout(): Promise<void>;
}
export function canonicalRole(value: unknown): ShellRole | null {
  return value === 'admin' || value === 'doctor' || value === 'front-desk' ? value : null;
}
export function authorizedClinics(identity: Pick<Identity, 'role' | 'clinicId'>, clinics: ShellClinic[]): ShellClinic[] {
  const role = canonicalRole(identity.role);
  return !role ? [] : clinics.filter(c => role === 'admin' || c.id === identity.clinicId);
}
export const realIdentityAdapter: IdentityAdapter = {
  mode: 'real',
  async load() {
    if (isExplicitlySignedOut()) return null;
    if (!navigator.onLine) return restoreOfflineIdentity();
    const epoch = authorizationEpoch();
    let identity: Identity;
    try { identity = await getMe(); }
    catch (error) {
      if (error && typeof error === 'object' && 'status' in error && error.status === 401) { revokeOfflineAuthorization(); return null; }
      if (error instanceof TypeError) {
        const restored = await restoreOfflineIdentity();
        if (restored) return restored;
      }
      throw error;
    }
    forgetOfflinePermit();
    if (!Number.isSafeInteger(identity.id) || identity.id <= 0 || typeof identity.email !== 'string') throw new Error('Invalid identity response');
    const result: ShellIdentity = { id: `account:${identity.id}`, name: identity.email, role: canonicalRole(identity.role), clinics: [], clinicsState: 'ready', expiresAt: identity.session?.expiresAt ?? null, csrfToken: identity.csrfToken };
    if (!result.role) return result;
    try {
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const page = await listClinics({ limit: 100, ...(cursor ? { cursor } : {}) });
        if (!Array.isArray(page.items) || page.items.some(c => !Number.isSafeInteger(c.id) || typeof c.name !== 'string')) throw new Error('Invalid clinic response');
        result.clinics.push(...authorizedClinics(identity, page.items));
        cursor = page.nextCursor ?? undefined;
        if (cursor && seen.has(cursor)) throw new Error('Repeated clinic cursor');
        if (cursor) seen.add(cursor);
      } while (cursor);
      result.clinics = [...new Map(result.clinics.map(c => [c.id, c])).values()];
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && error.status === 401) { revokeOfflineAuthorization(); return null; }
      // The contract may exist before its endpoint is implemented. Never substitute demo data.
      result.clinics = [];
      result.clinicsState = 'error';
    }
    if (result.role === 'doctor' || result.role === 'front-desk') {
      try {
        const nonce = newTabNonce();
        const permit = await getOfflinePermit({ nonce });
        result.offlineAuthorizedUntil = await rememberOfflinePermit(permit, nonce, epoch, result) ?? undefined;
      } catch (error) {
        if (error && typeof error === 'object' && 'status' in error && error.status === 401) { revokeOfflineAuthorization(); return null; }
        // Online work remains available; without a verified permit offline records stay locked.
      }
    }
    return result;
  },
  // Shell clears CSRF synchronously; a late response must not clear a newer sign-in's token.
  async logout() { await logout(); },
};

// Explicit opt-in, development build only; never fallback on session/API failure.
const demo = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('shellDemo') : null;
export const identityAdapter: IdentityAdapter = demo ? createFixtureAdapter(demo) : realIdentityAdapter;

/** Keeps the explicit DEV fixture query on in-app links so refresh stays in the fixture. Never stored. */
export function demoPath(path: string): string {
  if (!demo) return path;
  return `${path}${path.includes('?') ? '&' : '?'}shellDemo=${encodeURIComponent(demo)}`;
}
