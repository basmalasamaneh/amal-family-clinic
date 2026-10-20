import { reportUnauthorized } from '../auth/session-events';
export type FailureKind = 'network' | 'auth' | 'unavailable' | 'conflict' | 'validation' | 'server';
export interface Failure { kind: FailureKind; code: string | null; status: number | null }
export function classifyError(e: unknown): Failure {
  const status = typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : null;
  const data = (e as { data?: unknown })?.data as { code?: unknown } | null | undefined;
  const code = data && typeof data.code === 'string' ? data.code : null;
  if (status === null) return { kind: 'network', code, status };
  if (status === 401 || status === 403) return { kind: 'auth', code, status };
  if (status === 404 || status === 501 || status === 503) return { kind: 'unavailable', code, status };
  if (status === 409) return { kind: 'conflict', code, status };
  if (status === 400 || status === 422) return { kind: 'validation', code, status };
  return { kind: 'server', code, status };
}
export const isAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError';
/** Direct generated-client calls bypass the QueryClient caches, so 401 must be reported here. */
export async function withAuthReport<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) { if ((e as { status?: unknown })?.status === 401) reportUnauthorized(); throw e; }
}
