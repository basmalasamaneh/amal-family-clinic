import { formatInTimeZone } from 'date-fns-tz';
import { ar, enGB } from 'date-fns/locale';
import type { AmalLocale, DigitPreference } from '@workspace/amal-ui';
import type { Consent, ConsentInput } from '@workspace/api-client-react';
import { stableKey } from '@/booking/ops';

/**
 * Consent + access-history domain helpers. Pure; memory only. Nothing here touches URLs, Web Storage,
 * IndexedDB, caches or logs. Age status is always the server's; the browser never computes age.
 */
export type Level = 'none' | 'basic' | 'clinical';
export const LEVELS: readonly Level[] = ['none', 'basic', 'clinical'];
export type AgeStatus = 'adult' | 'minor' | 'unknown';
export type Evidence = 'verbal' | 'signed';

export interface ConsentView {
  current: Consent | null;
  history: Consent[];
  effectiveLevel: Level;
  patient: { id: number; name: string };
  eligibility: { dateOfBirth: string | null; ageStatus: AgeStatus; asOfDate: string };
  canWithdraw: boolean;
}

const isLevel = (v: unknown): v is Level => v === 'none' || v === 'basic' || v === 'clinical';
/** Strict shape check; anything unexpected is rejected rather than guessed (fails closed). */
export function parseConsentView(raw: unknown, patientId: number): ConsentView {
  const r = raw as Partial<ConsentView> | null;
  if (!r || typeof r !== 'object') throw new TypeError('bad consent state');
  const p = r.patient, e = r.eligibility;
  if (!p || p.id !== patientId || typeof p.name !== 'string') throw new TypeError('patient mismatch');
  if (!e || (e.ageStatus !== 'adult' && e.ageStatus !== 'minor' && e.ageStatus !== 'unknown') || typeof e.asOfDate !== 'string') throw new TypeError('bad eligibility');
  if (!isLevel(r.effectiveLevel) || !Array.isArray(r.history)) throw new TypeError('bad level');
  return {
    current: r.current ?? null,
    history: r.history.filter((c) => c && c.patientId === patientId),
    effectiveLevel: r.effectiveLevel,
    patient: { id: p.id, name: p.name },
    eligibility: { dateOfBirth: typeof e.dateOfBirth === 'string' ? e.dateOfBirth : null, ageStatus: e.ageStatus, asOfDate: e.asOfDate },
    canWithdraw: r.canWithdraw === true,
  };
}

/** Row status label. Only the server's current record with status active and a non-none effective level is "in effect". */
export type RowState = 'inEffect' | 'withdrawn' | 'superseded' | 'recordedNone';
export function rowState(c: Consent, view: ConsentView): RowState {
  if (c.status === 'withdrawn') return 'withdrawn';
  const isCurrent = view.current?.id === c.id;
  if (!isCurrent) return 'superseded';
  if (c.level === 'none' || view.effectiveLevel === 'none') return 'recordedNone';
  return 'inEffect';
}

export const rank = (l: Level) => LEVELS.indexOf(l);
/** Narrowing sharing (or any withdrawal) must clear protected client views immediately. */
export const isDowngrade = (from: Level, to: Level) => rank(to) < rank(from);

export interface Draft { level: Level | null; evidence: Evidence | null; guardianName: string; guardianRelation: string }
export const EMPTY_DRAFT: Draft = { level: null, evidence: null, guardianName: '', guardianRelation: '' };
export type DraftError = 'level' | 'evidence' | 'guardianName' | 'guardianRelation' | 'ageUnknown';

/** Unknown age never allows a grant (no silent adult self-consent). Minors need trimmed nonblank guardian, even for None. */
export function validateDraft(d: Draft, age: AgeStatus): DraftError[] {
  const errs: DraftError[] = [];
  if (!d.level) errs.push('level');
  if (!d.evidence) errs.push('evidence');
  if (age === 'unknown' && d.level && d.level !== 'none') errs.push('ageUnknown');
  if (age === 'minor') {
    if (!d.guardianName.trim() || d.guardianName.trim().length > 200) errs.push('guardianName');
    if (!d.guardianRelation.trim() || d.guardianRelation.trim().length > 100) errs.push('guardianRelation');
  }
  return errs;
}
export function buildBody(d: Draft, age: AgeStatus, clientOpId: string): ConsentInput {
  const body: ConsentInput = { level: d.level!, evidence: d.evidence!, clientOpId };
  if (age === 'minor') body.guardian = { name: d.guardianName.trim(), relationship: d.guardianRelation.trim() };
  return body;
}

/* ---- Exact-operation memory for ambiguous outcomes (no queue, no storage, no auto retry) ---- */
export type PendingOp =
  | { kind: 'record'; scope: string; patientId: number; body: ConsentInput; ambiguous: boolean }
  | { kind: 'withdraw'; scope: string; patientId: number; consentId: number; body: { clientOpId: string }; ambiguous: boolean };

export type Outcome = 'ok' | 'ambiguous' | 'rejected' | 'needsPin';
/**
 * No HTTP status (network/abort/timeout), 408, 429 or 5xx = we cannot know if the server applied it.
 * Reauth/CSRF errors mean the write was refused before processing. Other 4xx = definite rejection.
 */
export function classifyOutcome(e: unknown): Outcome {
  const s = typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : null;
  if (s === null || s === 408 || s === 429 || s >= 500) return 'ambiguous';
  const mk = (e as { data?: { messageKey?: unknown } })?.data?.messageKey;
  if (mk === 'error.reauthRequired' || mk === 'error.csrf' || s === 423) return 'needsPin';
  return 'rejected';
}
/** A replay of an ambiguous op stays unresolved on refusal-before-processing; otherwise follows the outcome. */
export function settle(op: PendingOp | null, outcome: Outcome): PendingOp | null {
  if (!op) return null;
  if (outcome === 'ok') return null;
  if (outcome === 'ambiguous') return { ...op, ambiguous: true };
  return op.ambiguous ? op : null;
}
export const sameOp = (a: PendingOp, b: PendingOp) => stableKey(a) === stableKey(b);

/* ---- Access history ---- */
export interface AccessItem { id: number; at: string; viewerName: string | null; viewerRole: string | null; viewerClinicName: string | null; action: 'patient-view' }
export interface AccessPage { items: AccessItem[]; nextCursor: string | null }
export const ACCESS_LIMIT = 20;
export const ACCESS_MAX_PAGES = 10;

export function parseAccessPage(raw: unknown): AccessPage {
  const r = raw as { items?: unknown; nextCursor?: unknown } | null;
  if (!r || !Array.isArray(r.items)) throw new TypeError('bad access page');
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  const items = r.items.filter((i): i is AccessItem => !!i && typeof i.id === 'number' && typeof i.at === 'string' && i.action === 'patient-view')
    .map((i) => ({ id: i.id, at: i.at, viewerName: str(i.viewerName), viewerRole: str(i.viewerRole), viewerClinicName: str(i.viewerClinicName), action: 'patient-view' as const }));
  return { items, nextCursor: typeof r.nextCursor === 'string' && r.nextCursor ? r.nextCursor : null };
}
/** Appends a page, dropping duplicates; newest-first order is preserved. */
export function appendAccess(prev: AccessItem[], next: AccessItem[]): AccessItem[] {
  const seen = new Set(prev.map((i) => i.id));
  return [...prev, ...next.filter((i) => !seen.has(i.id))].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id - a.id);
}

const toDigits = (s: string, d: DigitPreference) => (d === 'latn' ? s : s.replace(/[0-9]/g, (n) => '٠١٢٣٤٥٦٧٨٩'[Number(n)]));
/** UTC instant shown in Asia/Hebron with the user's digit preference. Invalid instants render null. */
export function formatAt(iso: string | null | undefined, locale: AmalLocale, digits: DigitPreference): string | null {
  if (!iso || !/(Z|[+-]\d{2}:\d{2})$/i.test(iso) || !Number.isFinite(Date.parse(iso))) return null;
  return toDigits(formatInTimeZone(iso, 'Asia/Hebron', 'd MMM yyyy · HH:mm', { locale: locale === 'ar' ? ar : enGB }), digits);
}

/* ---- Explicit selection from Patients (module memory only, scoped to clinic) ---- */
let selected: { clinicId: number; patientId: number } | null = null;
export function selectConsentPatient(clinicId: number, patientId: number): void { selected = { clinicId, patientId }; }
export function isConsentSelected(clinicId: number, patientId: number): boolean { return !!selected && selected.clinicId === clinicId && selected.patientId === patientId; }
export function clearConsentSelection(): void { selected = null; forgetUnresolved(); }
export function parsePatientId(search: string): number | null {
  const v = new URLSearchParams(search).get('patientId');
  return v && /^[1-9][0-9]{0,9}$/.test(v) ? Number(v) : null;
}

/* ---- Unresolved-operation memory (module memory only; survives in-app navigation, not reloads) ---- */
/**
 * Keyed by identity:role:clinic + patient. Holds the exact unresolved op and the open invalidation token.
 * `op` null with a token means the result is known but the authoritative reread has not completed yet.
 * Dropping entries (identity/clinic switch, logout) forgets the sensitive op but NEVER completes the token:
 * the protected block stays until a full reload, which discards all client memory and refetches from the server.
 */
export interface Unresolved { op: PendingOp | null; token: string }
const unresolved = new Map<string, Unresolved>();
export const unresolvedKey = (scope: string, patientId: number) => `${scope}#${patientId}`;
export function getUnresolved(key: string): Unresolved | null { const u = unresolved.get(key); return u ? { ...u } : null; }
export function putUnresolved(key: string, u: Unresolved): void { unresolved.set(key, { ...u }); }
export function resolveUnresolved(key: string): string | null { const u = unresolved.get(key); unresolved.delete(key); return u?.token ?? null; }
export function hasUnresolvedOp(): boolean { for (const u of unresolved.values()) if (u.op) return true; return false; }
export function forgetUnresolved(): void { unresolved.clear(); }

/** Did the authoritative reread actually reflect the accepted op? Otherwise someone replaced it concurrently. */
export function confirms(op: PendingOp, v: ConsentView): boolean {
  const c = v.current;
  if (!c) return false;
  if (op.kind === 'withdraw') return c.id === op.consentId && c.status === 'withdrawn';
  return c.status === 'active' && c.level === op.body.level && v.effectiveLevel === op.body.level;
}
