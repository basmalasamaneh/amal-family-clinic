import { landingFor, resolve } from '../shell/routes';
import type { ShellRole } from '../shell/identity';

export const PUBLIC_PATHS = ['/data'] as const;
/** Accept only same-origin, internal, shell-authorized paths. Anything else falls back to the role landing. */
export function safeReturnTo(raw: string | null | undefined, role: ShellRole | null): string {
  const fallback = landingFor(role) ?? '/';
  if (!raw || raw.length > 200 || !/^\/[A-Za-z0-9\-/]*$/.test(raw) || raw.startsWith('//')) return fallback;
  const path = raw.replace(/\/+$/, '') || '/';
  if ((PUBLIC_PATHS as readonly string[]).includes(path)) return path;
  const res = resolve(path, role);
  return res.kind === 'page' ? res.route.path : fallback;
}
export function loginHref(next: string | null, expired = false): string {
  const p = new URLSearchParams();
  if (next && next !== '/' && next !== '/login') p.set('next', next);
  if (expired) p.set('reason', 'expired');
  const q = p.toString();
  return q ? `/login?${q}` : '/login';
}
