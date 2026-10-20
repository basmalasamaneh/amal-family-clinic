import type { ImportBatch, ImportConflict, ImportRow, ImportRowReview } from '@workspace/api-client-react';

/** Pure, server-derived view logic for the import wizard. Counts always come from the returned batch. */
export const STEPS = ['upload', 'doctors', 'patients', 'status', 'conflicts', 'commit'] as const;
export type StepId = (typeof STEPS)[number];
export const STATUS_MAP: Readonly<Record<string, 'booked' | 'completed' | 'cancelled'>> = { confirmed: 'booked', completed: 'completed', cancelled: 'cancelled' };
export const DOCTOR_ISSUES = ['MISSING_DOCTOR', 'AMBIGUOUS_DOCTOR', 'DOCTOR_OUT_OF_SCOPE'];
export const BLOCKING_SOURCE_ISSUES = ['INVALID_COLUMNS', 'UNSUPPORTED_STATUS'];

const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
export const srcEmail = (r: ImportRow) => str(r.source.doctor_email).trim().toLowerCase();
export const srcName = (r: ImportRow) => str(r.source.patient_name_typed);
export const srcStatus = (r: ImportRow) => str(r.source.event_status);
export const srcStart = (r: ImportRow) => str(r.source.start_time);
export const srcEnd = (r: ImportRow) => str(r.source.end_time);
export const hasIssue = (r: ImportRow, codes: string[]) => r.errors.some((e) => codes.includes(e.code));

export type DoctorChoices = Record<string, number>;
export interface EmailGroup { email: string; rowIds: number[]; serverDoctorId: number | null; issue: string | null }

/** One group per source email; serverDoctorId only when every mapped row agrees. */
export function emailGroups(batch: ImportBatch): EmailGroup[] {
  const m = new Map<string, EmailGroup & { ids: Set<number> }>();
  for (const r of batch.rows) {
    const e = srcEmail(r);
    const g = m.get(e) ?? { email: e, rowIds: [], serverDoctorId: null, issue: null, ids: new Set<number>() };
    g.rowIds.push(r.id);
    if (r.mapping) g.ids.add(r.mapping.doctorId);
    const iss = r.errors.find((x) => DOCTOR_ISSUES.includes(x.code));
    if (iss) g.issue = iss.code;
    m.set(e, g);
  }
  return [...m.values()].map(({ ids, ...g }) => ({ ...g, serverDoctorId: ids.size === 1 ? [...ids][0]! : null }));
}

/** Explicit choice wins; otherwise a unique server match. Only doctors actually authorized are accepted. */
export function effectiveDoctor(g: EmailGroup, choices: DoctorChoices, allowed: ReadonlySet<number>): number | null {
  const c = choices[g.email];
  if (c && allowed.has(c)) return c;
  if (g.serverDoctorId && allowed.has(g.serverDoctorId) && !g.issue) return g.serverDoctorId;
  return null;
}

export type RowState = 'open' | 'include' | 'skip' | 'stale';
/** An included row is stale if its saved doctor no longer equals the mapping chosen for its email. */
export function rowState(r: ImportRow, doctorFor: (email: string) => number | null): RowState {
  if (!r.review) return 'open';
  if (r.review.action === 'skip') return 'skip';
  const d = doctorFor(srcEmail(r));
  if (r.mapping && d !== null && r.mapping.doctorId !== d) return 'stale';
  return 'include';
}

export interface Counts { total: number; open: number; include: number; skip: number; stale: number; autoLinked: number }
export function counts(batch: ImportBatch, doctorFor: (email: string) => number | null): Counts {
  const c: Counts = { total: batch.rows.length, open: 0, include: 0, skip: 0, stale: 0, autoLinked: batch.totals.autoLinked };
  for (const r of batch.rows) c[rowState(r, doctorFor)]++;
  return c;
}

/** Conflicts needing action: blocking or unacknowledged warnings. Info and acknowledged never block. */
export const openConflicts = (cs: ImportConflict[]) => cs.filter((c) => c.severity === 'blocking' || c.severity === 'warning');
export function groupConflicts(cs: ImportConflict[]) {
  return {
    intra: cs.filter((c) => c.kind === 'intra-export'),
    existing: cs.filter((c) => c.kind === 'existing-appointment'),
    policy: cs.filter((c) => c.kind === 'policy'),
    coincidence: cs.filter((c) => c.kind === 'source-coincidence'),
  };
}

export function statusSummary(batch: ImportBatch) {
  const m = new Map<string, { source: string; target: string | null; rows: number; open: number }>();
  for (const r of batch.rows) {
    const s = srcStatus(r);
    const e = m.get(s) ?? { source: s, target: STATUS_MAP[s] ?? null, rows: 0, open: 0 };
    e.rows++;
    if (!STATUS_MAP[s] && r.review?.action !== 'skip') e.open++;
    m.set(s, e);
  }
  return [...m.values()];
}

/** Per-step open-decision counts. Returns 0 when the step is complete. */
export function stepOpen(batch: ImportBatch | null, groups: EmailGroup[], doctorFor: (email: string) => number | null): Record<StepId, number> {
  if (!batch) return { upload: 1, doctors: 1, patients: 1, status: 1, conflicts: 1, commit: 1 };
  const committed = batch.status === 'committed';
  const c = counts(batch, doctorFor);
  const doctors = committed ? 0 : groups.filter((g) => {
    if (doctorFor(g.email) !== null) return false;
    return g.rowIds.some((id) => batch.rows.find((r) => r.id === id)?.review?.action !== 'skip');
  }).length;
  const status = committed ? 0 : statusSummary(batch).reduce((n, s) => n + s.open, 0);
  const patients = committed ? 0 : c.open + c.stale;
  const conflicts = committed ? 0 : openConflicts(batch.conflicts).length;
  const commit = committed ? 0 : doctors + patients + status + conflicts + (batch.status === 'reviewed' ? 0 : 1);
  return { upload: 0, doctors, patients, status, conflicts, commit };
}

/** Forward navigation needs every earlier step complete; going back is always allowed. */
export function canEnter(target: number, open: Record<StepId, number>, hasBatch: boolean): boolean {
  if (target === 0) return true;
  if (!hasBatch) return false;
  for (let i = 0; i < target; i++) if (open[STEPS[i]!] > 0) return false;
  return true;
}

export const commitReady = (batch: ImportBatch | null, open: Record<StepId, number>) => !!batch && batch.status === 'reviewed' && open.commit === 0;

/* ---------- Confidence: name evidence only, never identity ---------- */
export const normName = (s: string) => s.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
export function nameConfidence(source: string, candidate: string): 'exact' | 'partial' | 'weak' {
  const a = normName(source), b = normName(candidate);
  if (a && a === b) return 'exact';
  const ta = new Set(a.split(' ')), tb = b.split(' ');
  const shared = tb.filter((t) => t && ta.has(t)).length;
  return shared > 0 ? 'partial' : 'weak';
}

/* ---------- Review drafts → contract body ---------- */
export type Draft =
  | { kind: 'skip'; reason: string }
  | { kind: 'existing'; patientId: number | null; method: 'phone' | 'dob'; value: string }
  | { kind: 'create'; name: string; phone: string; dob: string; guardianName: string; guardianRelation: string };
export interface Extras { startLocal: string; endLocal: string; associateAppointmentId: number | null; overrideReason: string }
export type DraftError = 'errPick' | 'errVerify' | 'errName' | 'errPhone' | 'errDob' | 'errReason' | 'errTimes' | 'errDoctor';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function validDateOnly(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
/** datetime-local yields HH:mm or HH:mm:ss; contract requires seconds. No zone conversion happens client-side. */
export function toWall(v: string): string { const t = v.trim(); return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t) ? `${t}:00` : t; }

export function validate(d: Draft, x: Extras, doctorId: number | null): DraftError[] {
  const e: DraftError[] = [];
  if (d.kind === 'skip') { if (!d.reason.trim()) e.push('errReason'); return e; }
  if (!doctorId) e.push('errDoctor');
  if (d.kind === 'existing') {
    if (!d.patientId) e.push('errPick');
    if (!d.value.trim() || (d.method === 'dob' && !validDateOnly(d.value.trim()))) e.push('errVerify');
  } else {
    if (!d.name.trim()) e.push('errName');
    if (!d.phone.trim()) e.push('errPhone');
    if (!validDateOnly(d.dob.trim())) e.push('errDob');
  }
  if (!!x.startLocal.trim() !== !!x.endLocal.trim()) e.push('errTimes');
  return e;
}

export function buildReview(rowId: number, d: Draft, x: Extras, doctorId: number | null): ImportRowReview {
  if (d.kind === 'skip') return { rowId, action: 'skip', reason: d.reason.trim() };
  const identity = d.kind === 'existing'
    ? { kind: 'existing' as const, patientId: d.patientId!, verification: { method: d.method, value: d.value.trim() } }
    : { kind: 'new' as const, patient: {
      name: d.name.trim(), phone: d.phone.trim(), dateOfBirth: d.dob.trim(),
      ...(d.guardianName.trim() ? { guardianName: d.guardianName.trim() } : {}),
      ...(d.guardianRelation.trim() ? { guardianRelation: d.guardianRelation.trim() } : {}),
    } };
  return {
    rowId, action: 'include', doctorId: doctorId!, identity,
    ...(x.startLocal.trim() && x.endLocal.trim() ? { startLocal: toWall(x.startLocal), endLocal: toWall(x.endLocal) } : {}),
    ...(x.associateAppointmentId && d.kind === 'existing' ? { associateAppointmentId: x.associateAppointmentId } : {}),
    ...(x.overrideReason.trim() ? { overrideReason: x.overrideReason.trim() } : {}),
  };
}

/** Override reason is shown only when the server returned an unacknowledged/acknowledged patient warning for the row. */
export const rowWarnings = (batch: ImportBatch, rowId: number) =>
  batch.conflicts.filter((c) => c.rowIds.includes(rowId) && (c.severity === 'warning' || c.severity === 'acknowledged'));
export const rowAssociations = (batch: ImportBatch, rowId: number) =>
  [...new Set(batch.conflicts.filter((c) => c.rowIds.includes(rowId) && c.kind !== 'intra-export' && c.appointmentId).map((c) => c.appointmentId!))];

/* ---------- Errors ---------- */
export type FailKind = 'stale' | 'conflict' | 'validation' | 'denied' | 'notFound' | 'session' | 'network' | 'server' | 'unknown';
export function failure(e: unknown): { kind: FailKind; code: string | null; status: number | null; params: Record<string, unknown> } {
  const status = e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number' ? (e as { status: number }).status : null;
  const data = e && typeof e === 'object' && 'data' in e ? (e as { data: unknown }).data : null;
  const code = data && typeof data === 'object' && typeof (data as { code?: unknown }).code === 'string' ? (data as { code: string }).code : null;
  const params = data && typeof data === 'object' && (data as { params?: unknown }).params && typeof (data as { params: unknown }).params === 'object' ? (data as { params: Record<string, unknown> }).params : {};
  let kind: FailKind = 'unknown';
  if (status === null) kind = 'network';
  else if (status === 401) kind = 'session';
  else if (status === 403) kind = 'denied';
  else if (status === 404) kind = 'notFound';
  else if (status === 409) kind = code === 'VERSION_CONFLICT' || code === 'MERGE_STALE' ? 'stale' : 'conflict';
  else if (status === 400 || status === 413 || status === 422) kind = 'validation';
  else if (status >= 500) kind = 'server';
  return { kind, code, status, params };
}
/**
 * Uncertain = the request may have been applied: no HTTP status, any 5xx, or a 2xx/3xx whose body
 * could not be parsed (ResponseParseError). Only definitive 4xx answers are treated as rejections.
 */
export function isUncertain(e: unknown): boolean {
  if (e && typeof e === 'object' && (e as { name?: unknown }).name === 'ResponseParseError') return true;
  const s = failure(e).status;
  return s === null || s >= 500 || s < 400;
}

/* ---------- Commit idempotency ---------- */
/**
 * The exact commit body. Once written it is reused byte-for-byte until the outcome is resolved
 * (committed, or a definitive 4xx). A fresher batch version never rotates an unresolved key.
 * Mirrored in memory so a storage failure never silently drops the pending request while mounted.
 */
export interface PendingCommit { clientOpId: string; expectedVersion: number }
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const store = (): Store | null => { try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; } };
const commitKey = (scope: string, batchId: number) => `amal.import.commit.${scope}.${batchId}`;
const memPending = new Map<string, PendingCommit>();
const valid = (v: unknown): v is PendingCommit => !!v && typeof (v as PendingCommit).clientOpId === 'string' && Number.isInteger((v as PendingCommit).expectedVersion);
export function readPending(scope: string, batchId: number, s: Store | null = store()): PendingCommit | null {
  const k = commitKey(scope, batchId);
  const mem = memPending.get(k) ?? null;
  try { const v: unknown = JSON.parse(s?.getItem(k) ?? 'null'); if (valid(v)) return { clientOpId: v.clientOpId, expectedVersion: v.expectedVersion }; } catch { /* fall back */ }
  return mem;
}
/** Returns false when durable storage failed (the in-memory copy is still kept). */
export function writePending(scope: string, batchId: number, p: PendingCommit | null, s: Store | null = store()): boolean {
  const k = commitKey(scope, batchId);
  if (p) memPending.set(k, { ...p }); else memPending.delete(k);
  try { if (!s) return false; if (p) s.setItem(k, JSON.stringify(p)); else s.removeItem(k); return true; } catch { return false; }
}
/** Unresolved pending body wins regardless of the current version; otherwise mint one for this version. */
export function commitBody(scope: string, batchId: number, version: number, gen: () => string, s: Store | null = store()): { body: PendingCommit; durable: boolean } {
  const prior = readPending(scope, batchId, s);
  if (prior) return { body: prior, durable: true };
  const next = { clientOpId: gen(), expectedVersion: version };
  return { body: next, durable: writePending(scope, batchId, next, s) };
}
export const _resetPendingMemory = () => memPending.clear();

/* ---------- Saved batch per user scope + clinic (IDs only, no patient data) ---------- */
const lastKey = (scope: string) => `amal.import.last.${scope}`;
export function readLastBatch(scope: string, s: Store | null = store()): number | null {
  try { const v = Number(s?.getItem(lastKey(scope)) ?? NaN); return Number.isInteger(v) && v > 0 ? v : null; } catch { return null; }
}
export function writeLastBatch(scope: string, id: number | null, s: Store | null = store()): boolean {
  try { if (!s) return false; if (id) s.setItem(lastKey(scope), String(id)); else s.removeItem(lastKey(scope)); return true; } catch { return false; }
}

/* ---------- Upload file parsing ---------- */
export const MAX_BYTES = 131072;
export type ParseResult = { ok: true; rows: Record<string, unknown>[] } | { ok: false; error: 'errType' | 'errSize' | 'errParse' | 'errShape' };
export function parseExport(name: string, text: string, bytes: number): ParseResult {
  if (!/\.json$/i.test(name)) return { ok: false, error: 'errType' };
  if (bytes > MAX_BYTES) return { ok: false, error: 'errSize' };
  let v: unknown;
  try { v = JSON.parse(text); } catch { return { ok: false, error: 'errParse' }; }
  if (!Array.isArray(v) || v.length < 1 || v.length > 100 || !v.every((r) => r && typeof r === 'object' && !Array.isArray(r))) return { ok: false, error: 'errShape' };
  return { ok: true, rows: v as Record<string, unknown>[] };
}
