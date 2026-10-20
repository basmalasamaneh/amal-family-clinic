/** Pure helpers for conflict resolution UI. No I/O, no storage. */
import type { Appointment, ConflictItem, SyncConflict } from '@workspace/api-client-react';
import { resolveLocalInterval } from '../booking/time';

export function isConflictItem(r: unknown): r is ConflictItem {
  return !!r && typeof r === 'object' && 'type' in r && 'suggestedSlots' in r;
}

/** Keeps only an optional leading '+' and ASCII digits; anything implausible yields null (no link). */
export function sanitizePhone(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^\+?[0-9\s().-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (digits.length < 6 || digits.length > 15) return null;
  return (trimmed.startsWith('+') ? '+' : '') + digits;
}

export interface OtherRef { appointmentId: number; type: 'doctor-overlap' | 'patient-overlap' }
export type OtherRefState = { kind: 'none' } | { kind: 'hidden' } | { kind: 'ref'; ref: OtherRef };

/** Only an explicit same-clinic doctor/patient overlap reference may become a move-other target. */
export function explicitOtherRef(conflict: Pick<SyncConflict, 'reasons'>, clinicId: number): OtherRefState {
  const refs = conflict.reasons.filter(isConflictItem).filter((i) => i.with);
  if (refs.length === 0) return { kind: 'none' };
  const own = refs.filter((i) => i.with!.clinicId === clinicId && (i.type === 'doctor-overlap' || i.type === 'patient-overlap'));
  const ids = new Set(own.map((i) => i.with!.appointmentId));
  if (own.length === 0 || ids.size !== 1) return { kind: 'hidden' };
  return { kind: 'ref', ref: { appointmentId: own[0].with!.appointmentId, type: own[0].type as OtherRef['type'] } };
}

export interface ProposalIdentity { clinicId: number; doctorId?: number; patientId?: number }

/** The fetched appointment must be the exact referenced, active, same-clinic collision with matching identity. */
export function verifyOther(appt: Appointment | undefined, ref: OtherRef, proposal: ProposalIdentity): Appointment | null {
  if (!appt || appt.id !== ref.appointmentId || appt.clinicId !== proposal.clinicId) return null;
  if (appt.status !== 'booked' && appt.status !== 'double_booked') return null;
  if (!Number.isInteger(appt.version) || appt.version < 1) return null;
  if (ref.type === 'doctor-overlap' && (proposal.doctorId === undefined || appt.doctorId !== proposal.doctorId)) return null;
  if (ref.type === 'patient-overlap' && (proposal.patientId === undefined || appt.patientId !== proposal.patientId)) return null;
  return appt;
}

export type DestError = 'empty' | 'invalid' | 'nonexistent' | 'crossesDay' | 'duration' | 'past' | 'overlapsKept' | 'unchanged';
export type DestResult = { ok: true; startsAt: string; endsAt: string; ambiguous: boolean } | { ok: false; error: DestError };

/** Explicit Asia/Hebron destination for the other appointment, keeping its duration. */
export function validateOtherDestination(
  date: string, time: string, other: Pick<Appointment, 'startsAt' | 'endsAt'>, kept: { startsAt?: string; endsAt?: string }, now: Date = new Date(),
): DestResult {
  if (!date || !time) return { ok: false, error: 'empty' };
  const dur = Math.round((Date.parse(other.endsAt) - Date.parse(other.startsAt)) / 60000);
  const r = resolveLocalInterval(date, time, dur);
  if (!r.ok) return r;
  const s = Date.parse(r.startsAt); const e = Date.parse(r.endsAt);
  if (s <= now.getTime()) return { ok: false, error: 'past' };
  if (r.startsAt === new Date(other.startsAt).toISOString()) return { ok: false, error: 'unchanged' };
  if (kept.startsAt && kept.endsAt && s < Date.parse(kept.endsAt) && Date.parse(kept.startsAt) < e) return { ok: false, error: 'overlapsKept' };
  return r;
}

export type GateReason = null | 'resolved' | 'locked' | 'busy' | 'pendingIntent' | 'noSlots' | 'noOther' | 'otherHidden' | 'otherLoading' | 'otherUnavailable' | 'noSelection';

export interface GateInput {
  resolved: boolean; locked: boolean; busy: boolean; pendingIntent: boolean;
  slotCount: number; moveSelected: boolean;
  otherState: 'none' | 'hidden' | 'loading' | 'unavailable' | 'verified'; destValid: boolean;
}

function common(g: GateInput): GateReason {
  if (g.resolved) return 'resolved';
  if (g.locked) return 'locked';
  if (g.pendingIntent) return 'pendingIntent';
  if (g.busy) return 'busy';
  return null;
}
export function gateMoveSelf(g: GateInput): GateReason {
  return common(g) ?? (g.slotCount === 0 ? 'noSlots' : !g.moveSelected ? 'noSelection' : null);
}
export function gateMoveOther(g: GateInput): GateReason {
  const c = common(g); if (c) return c;
  if (g.otherState === 'none') return 'noOther';
  if (g.otherState === 'hidden') return 'otherHidden';
  if (g.otherState === 'loading') return 'otherLoading';
  if (g.otherState === 'unavailable') return 'otherUnavailable';
  return g.destValid ? null : 'noSelection';
}
export function gateCall(g: GateInput): GateReason { return common(g); }
