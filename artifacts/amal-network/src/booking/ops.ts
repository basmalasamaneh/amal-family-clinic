/** Stable JSON with sorted keys and undefined dropped. */
export function stableKey(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(stableKey).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stableKey(o[k])).join(',') + '}';
}
export const newOpId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : 'op-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
/** Same payload reuses the same clientOpId (safe retry); any change mints a new one. */
export function createOpKeeper(gen: () => string = newOpId) {
  let key: string | null = null; let id: string | null = null;
  return {
    idFor(payload: unknown): string { const k = stableKey(payload); if (k !== key || !id) { key = k; id = gen(); } return id; },
    reset() { key = null; id = null; },
  };
}
/** Monotonic token: only the newest request may apply its result. */
export function createLatest() {
  let n = 0;
  return { next: () => ++n, isCurrent: (t: number) => t === n, invalidate: () => { n++; } };
}

export interface Attempt<P> { context: string; payload: P; clientOpId: string }
/**
 * Keeps the exact attempted create payload + clientOpId for a booking context (selection + reason).
 * A retry of the same context replays it byte-for-byte (including the original holdToken) so the
 * server's idempotent replay can return an earlier committed result. Cleared only when the context
 * changes, on success, or on a definite conflict/validation/auth rejection.
 */
export function createAttemptKeeper<P>(gen: () => string = newOpId) {
  let a: Attempt<P> | null = null;
  return {
    current(context: string): Attempt<P> | null { return a && a.context === context ? a : null; },
    begin(context: string, build: () => P): Attempt<P> {
      if (a && a.context === context) return a;
      a = { context, payload: build(), clientOpId: gen() }; return a;
    },
    clear() { a = null; },
  };
}
