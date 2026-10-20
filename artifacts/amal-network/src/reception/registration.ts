import { checkDob, isMinor, type DobError } from './age';
import type { Failure } from '../booking/errors';

export interface RegDraft { name: string; phone: string; dob: string; guardianName: string; guardianRelation: string }
export type RegField = keyof RegDraft;
export type RegError = 'required' | 'tooLong' | 'phoneFormat' | DobError | 'server';
export type RegErrors = Partial<Record<RegField, RegError>>;
export const EMPTY_DRAFT: RegDraft = { name: '', phone: '', dob: '', guardianName: '', guardianRelation: '' };
export const GUARDIAN_RELATIONS = ['mother', 'father', 'grandparent', 'sibling', 'legalGuardian', 'other'] as const;
/** Payload without clientOpId; guardian keys are present only for minors. */
export interface NewPatientPayload { name: string; phone: string; dateOfBirth: string; guardianName?: string; guardianRelation?: string }

// Match the operational service's conservative canonical-phone contract.
// Validate a separate copy; preserve the original phone and its leading zeroes.
const PHONE_RE = /^\+?[0-9]{3,20}$/;

export function validateRegistration(d: RegDraft, today: string): { ok: true; payload: NewPatientPayload; minor: boolean } | { ok: false; errors: RegErrors; minor: boolean | null } {
  const errors: RegErrors = {};
  const name = d.name.trim(); const phone = d.phone.trim(); const dob = d.dob.trim();
  if (!name) errors.name = 'required'; else if (name.length > 200) errors.name = 'tooLong';
  // Phone kept verbatim (leading zeroes, spacing); only shape-checked.
  if (!phone) errors.phone = 'required'; else if (phone.length > 40) errors.phone = 'tooLong';
  else if (!PHONE_RE.test(phone.replace(/[\s().-]/gu, ''))) errors.phone = 'phoneFormat';
  const dobErr = checkDob(dob, today); if (dobErr) errors.dob = dobErr;
  const minor = isMinor(dob, today);
  const gName = d.guardianName.trim(); const gRel = d.guardianRelation.trim();
  if (minor) {
    if (!gName) errors.guardianName = 'required'; else if (gName.length > 200) errors.guardianName = 'tooLong';
    if (!gRel) errors.guardianRelation = 'required';
  }
  if (Object.keys(errors).length) return { ok: false, errors, minor };
  return { ok: true, minor: !!minor, payload: { name, phone, dateOfBirth: dob, ...(minor ? { guardianName: gName, guardianRelation: gRel } : {}) } };
}

/**
 * Safe clearing: once a valid DOB shows an adult, hidden guardian values are wiped so they can
 * never be submitted later. An incomplete/invalid DOB keeps them (no data loss mid-typing).
 */
export function reconcileGuardian(d: RegDraft, today: string): RegDraft {
  if (isMinor(d.dob, today) === false && (d.guardianName || d.guardianRelation)) return { ...d, guardianName: '', guardianRelation: '' };
  return d;
}

const FIELDS: RegField[] = ['name', 'phone', 'dob', 'guardianName', 'guardianRelation'];
const SERVER_FIELD: Record<string, RegField> = { name: 'name', phone: 'phone', dateOfBirth: 'dob', guardianName: 'guardianName', guardianRelation: 'guardianRelation' };
/** Maps a 400/422 ApiFailure (params.field) to a field error; anything else stays general. */
export function serverFieldErrors(f: Failure, data: unknown): RegErrors {
  if (f.kind !== 'validation') return {};
  const p = (data as { params?: Record<string, unknown> } | null)?.params;
  const raw = typeof p?.field === 'string' ? p.field : null;
  const field = raw ? SERVER_FIELD[raw] : undefined;
  return field && FIELDS.includes(field) ? { [field]: 'server' } : {};
}
/** Outcomes that may have been committed server-side: retry must reuse the same clientOpId. */
export const isUncertain = (f: Failure) => f.kind === 'network' || f.kind === 'server' || (f.kind === 'unavailable' && f.status === 503);

/**
 * Registration attempt identity, owned by the page (in memory only, never persisted) so closing
 * the dialog, a Walk-in handoff or unmounting cannot mint a new clientOpId for an unanswered save.
 * While an outcome is uncertain, only the identical payload may be sent (same clientOpId).
 */
export interface RegSession {
  /** clientOpId + payload key of the unresolved attempt, if any. */
  pending: { key: string; clientOpId: string } | null;
  inFlight: boolean;
  /** Draft as it was when the pinned request was sent (to restore it). */
  snapshot: RegDraft | null;
}
export function createRegSession(): RegSession { return { pending: null, inFlight: false, snapshot: null }; }
/** Returns the clientOpId to use, or null when a changed payload must be blocked. */
export function opFor(s: RegSession, key: string, gen: () => string): string | null {
  if (s.pending) return s.pending.key === key ? s.pending.clientOpId : null;
  s.pending = { key, clientOpId: gen() };
  return s.pending.clientOpId;
}
/** Definite outcomes (success or definite rejection) release the identity; uncertain keeps it. */
export function settle(s: RegSession, uncertain: boolean): void { s.inFlight = false; if (!uncertain) { s.pending = null; s.snapshot = null; } }
