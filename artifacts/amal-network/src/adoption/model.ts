/** Pure adoption-journey logic: failure classification, action mutex, results parsing. */

export type ActionKind = 'full' | 'lite' | 'leave' | 'export';
export type ActionTarget = { kind: ActionKind; clinicId: number };

export type FailureKind = 'offline' | 'uncertain' | 'denied' | 'session' | 'left' | 'busy' | 'tooLarge' | 'unavailable' | 'invalid';

/** Classifies a mutation/query failure. Network failures and 5xx are uncertain: the server may have applied it. */
/** Called only after a request was sent: a lost response is uncertain even if the device is now offline. */
export function classifyFailure(err: unknown): FailureKind {
  const status = typeof err === 'object' && err !== null && 'status' in err && typeof (err as { status: unknown }).status === 'number'
    ? (err as { status: number }).status : null;
  const code = typeof err === 'object' && err !== null && 'data' in err ? readCode((err as { data: unknown }).data) : null;
  if (code === 'EXPORT_TIMEOUT' || code === 'EXPORT_RESOURCE_UNAVAILABLE') return 'unavailable';
  // Any network failure or 5xx (including 503) may have committed: readback can race the commit.
  if (status === null || status === 0 || status >= 500) return 'uncertain';
  if (status === 401) return 'session';
  if (status === 403 || status === 404) return 'denied';
  if (status === 413) return 'tooLarge';
  if (status === 409) return code === 'CLINIC_LEFT' ? 'left' : 'busy';
  if (status === 423 || status === 429) return 'busy';
  return 'invalid';
}

function readCode(data: unknown): string | null {
  return typeof data === 'object' && data !== null && typeof (data as { code?: unknown }).code === 'string' ? (data as { code: string }).code : null;
}

/** Lifecycle mutations whose outcome is uncertain must be retried exactly (same target) before anything else. */
export function isLifecycle(kind: ActionKind): boolean { return kind !== 'export'; }

/** Single-action mutex: one ref-backed lock so double clicks within a render can never start two operations. */
export function createMutex() {
  let held: ActionTarget | null = null;
  return {
    acquire(t: ActionTarget): boolean { if (held) return false; held = t; return true; },
    release(): void { held = null; },
    get current(): ActionTarget | null { return held; },
  };
}

/** Whether a new action may start given an unresolved uncertain lifecycle action. Only the exact retry is allowed. */
export function mayStart(next: ActionTarget, unresolved: ActionTarget | null): boolean {
  if (!unresolved) return true;
  return unresolved.kind === next.kind && unresolved.clinicId === next.clinicId;
}

/** Query-key prefixes holding cross-clinic or network-derived data that must vanish on leave/uncertainty. */
export const CROSS_CLINIC_PREFIXES = ['/api/network', '/api/doctor', '/api/patients', '/api/consent', '/api/adoption/results'];
export function isCrossClinicKey(key: readonly unknown[]): boolean {
  const head = key[0];
  return typeof head === 'string' && CROSS_CLINIC_PREFIXES.some((p) => head.startsWith(p));
}

/** Metric keys are stable; explanations are localized per key, never echoing server English prose. */
export type MetricKey = 'preventedBlocks' | 'medianLookupSeconds';
export const METRIC_KEYS: readonly MetricKey[] = ['preventedBlocks', 'medianLookupSeconds'];
export function reasonKey(reason: string | null | undefined): string {
  return reason === 'NO_PREVENTION_EVIDENCE' || reason === 'NO_LOOKUP_SAMPLES' || reason === 'SCENARIO_UNCONFIGURED' || reason === 'SCENARIO_CLINICS_UNAVAILABLE' ? reason : 'UNKNOWN';
}

/* Unresolved lifecycle marker: persisted before sending, scoped to account + clinic. */
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const store = (): Store | null => { try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; } };
export const markerKey = (accountId: string, clinicId: number) => `amal:adoption:unresolved:${accountId}:${clinicId}`;
export function readMarker(accountId: string, clinicId: number, s: Store | null = store()): ActionTarget | null {
  try {
    const raw = s?.getItem(markerKey(accountId, clinicId)); if (!raw) return null;
    const v = JSON.parse(raw) as { kind?: unknown; clinicId?: unknown };
    return (v.kind === 'full' || v.kind === 'lite' || v.kind === 'leave') && v.clinicId === clinicId ? { kind: v.kind, clinicId } : null;
  } catch { return null; }
}
export function writeMarker(accountId: string, t: ActionTarget, s: Store | null = store()): void {
  try { s?.setItem(markerKey(accountId, t.clinicId), JSON.stringify(t)); } catch { /* storage unavailable: in-memory state still guards */ }
}
export function clearMarker(accountId: string, clinicId: number, s: Store | null = store()): void {
  try { s?.removeItem(markerKey(accountId, clinicId)); } catch { /* ignore */ }
}
/** Definitive outcomes clear the marker; uncertain keeps it for exact retry. */
export const keepsMarker = (why: FailureKind) => why === 'uncertain';
/** Transitions that end remote sharing must drop cross-clinic caches. */
export const dropsRemote = (kind: ActionKind) => kind === 'lite' || kind === 'leave';
