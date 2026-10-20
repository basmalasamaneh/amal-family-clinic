/** Maps the API error envelope {code,messageKey,params} to a known localized key. Never surfaces raw server text. */
export const KNOWN_ERRORS = ['unauthorized', 'forbidden', 'rateLimited', 'pinLocked', 'reauthRequired', 'csrf', 'notFound', 'validation', 'internal', 'deviceUntrusted'] as const;
export type ErrorKey = (typeof KNOWN_ERRORS)[number] | 'network' | 'unknown';
export interface DescribedError { key: ErrorKey; status: number | null; retryMinutes: number | null }

function statusOf(e: unknown): number | null {
  return e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number' ? (e as { status: number }).status : null;
}
export function describeApiError(e: unknown): DescribedError {
  const status = statusOf(e);
  const data = e && typeof e === 'object' && 'data' in e ? (e as { data: unknown }).data : null;
  let key: ErrorKey | null = null;
  let retry: number | null = null;
  if (data && typeof data === 'object') {
    const mk = (data as { messageKey?: unknown }).messageKey;
    if (typeof mk === 'string' && mk.startsWith('error.')) {
      const k = mk.slice(6);
      if ((KNOWN_ERRORS as readonly string[]).includes(k)) key = k as ErrorKey;
    }
    const p = (data as { params?: { retryAfterSeconds?: unknown } }).params;
    if (p && typeof p.retryAfterSeconds === 'number' && p.retryAfterSeconds > 0) retry = Math.ceil(p.retryAfterSeconds / 60);
  }
  if (!key) {
    if (status === null) key = e instanceof TypeError ? 'network' : 'unknown';
    else if (status === 401) key = 'unauthorized';
    else if (status === 403) key = 'forbidden';
    else if (status === 423) key = 'pinLocked';
    else if (status === 429) key = 'rateLimited';
    else if (status >= 500) key = 'internal';
    else key = 'unknown';
  }
  return { key, status, retryMinutes: retry };
}
export const isUnauthorized = (e: unknown) => statusOf(e) === 401;
/** Auth errors must never be retried automatically (prevents expiry retry loops and lockout amplification). */
export const isAuthFailure = (e: unknown) => { const s = statusOf(e); return s === 401 || s === 403 || s === 423 || s === 429; };
