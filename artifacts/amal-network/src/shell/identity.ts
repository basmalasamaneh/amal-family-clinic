import { createFixtureAdapter } from './identity-fixture';
import { getMe, listClinics, logout, setCsrfToken, type Identity } from '@workspace/api-client-react';

export type ShellRole = 'admin' | 'doctor' | 'front-desk';
export interface ShellClinic { id: number; name: string }
export interface ShellIdentity {
  id: string;
  name: string;
  role: ShellRole | null;
  clinics: ShellClinic[];
  clinicsState?: 'ready' | 'error';
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
    setCsrfToken(null);
    let identity: Identity;
    try { identity = await getMe(); }
    catch (error) {
      if (error && typeof error === 'object' && 'status' in error && error.status === 401) return null;
      throw error;
    }
    if (!Number.isSafeInteger(identity.id) || identity.id <= 0 || typeof identity.email !== 'string') throw new Error('Invalid identity response');
    setCsrfToken(identity.csrfToken);
    const result: ShellIdentity = { id: `account:${identity.id}`, name: identity.email, role: canonicalRole(identity.role), clinics: [], clinicsState: 'ready' };
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
    } catch {
      // The contract may exist before its endpoint is implemented. Never substitute demo data.
      result.clinics = [];
      result.clinicsState = 'error';
    }
    return result;
  },
  async logout() { await logout(); setCsrfToken(null); },
};

// Explicit opt-in, development build only; never fallback on session/API failure.
const demo = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('shellDemo') : null;
export const identityAdapter: IdentityAdapter = demo ? createFixtureAdapter(demo) : realIdentityAdapter;

/** Keeps the explicit DEV fixture query on in-app links so refresh stays in the fixture. Never stored. */
export function demoPath(path: string): string {
  if (!demo) return path;
  return `${path}${path.includes('?') ? '&' : '?'}shellDemo=${encodeURIComponent(demo)}`;
}
