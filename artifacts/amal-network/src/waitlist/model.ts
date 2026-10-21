/** Pure waitlist UI logic (no React, no network) so it can be unit tested. */
export const WAITLIST_PATH = '/api/waitlist';
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const; // 0 = Sunday
export const HHMM = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
export const POLL_MS = 15000;

export interface EntryDraft { patientId: number | null; doctorId: number | null; weekdays: number[]; windowStart: string; windowEnd: string }
export type EntryError = 'patient' | 'doctor' | 'weekdays' | 'time' | 'order';
export interface EntryPayload { patientId: number; doctorId: number; weekdays: number[]; windowStart: string; windowEnd: string }

const validId = (n: number | null): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 2147483647;
const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

export function validateEntry(d: EntryDraft): EntryError | null {
  if (!validId(d.patientId)) return 'patient';
  if (!validId(d.doctorId)) return 'doctor';
  if (!d.weekdays.length || d.weekdays.some((w) => !Number.isInteger(w) || w < 0 || w > 6)) return 'weekdays';
  if (!HHMM.test(d.windowStart) || !HHMM.test(d.windowEnd)) return 'time';
  if (mins(d.windowEnd) <= mins(d.windowStart)) return 'order';
  return null;
}

/** Explicit IDs only; clinic is derived server-side and never sent. */
export function toEntryPayload(d: EntryDraft): EntryPayload | null {
  if (validateEntry(d)) return null;
  return { patientId: d.patientId!, doctorId: d.doctorId!, weekdays: [...new Set(d.weekdays)].sort((a, b) => a - b), windowStart: d.windowStart, windowEnd: d.windowEnd };
}

/** Actor + clinic scoped key so a clinic switch or another account never sees a cached snapshot. */
export function waitlistKey(actor: string, clinicId: number) { return [WAITLIST_PATH, { actor, clinicId }] as const; }
export const isWaitlistKey = (k: readonly unknown[]) => k[0] === WAITLIST_PATH;
const CHANGED_PREFIXES = ['/api/appointments', '/api/waitlist', '/api/reminders', '/api/calendar', '/api/availability'];
export const isAffectedByDecision = (k: readonly unknown[]) => typeof k[0] === 'string' && CHANGED_PREFIXES.some((p) => (k[0] as string).startsWith(p));

/** Server clock offset measured at receipt. */
export function clockOffset(serverNow: string, receivedAt: number): number {
  const s = Date.parse(serverNow);
  return Number.isFinite(s) && receivedAt > 0 ? s - receivedAt : 0;
}

export interface OfferLike { status: string; expiresAt: string; startsAt: string }
export type OfferGate = 'ok' | 'notActive' | 'expired' | 'started' | 'offline';
export function offerGate(o: OfferLike, serverNowMs: number, online: boolean): OfferGate {
  if (o.status !== 'active') return 'notActive';
  if (Date.parse(o.expiresAt) <= serverNowMs) return 'expired';
  if (Date.parse(o.startsAt) <= serverNowMs) return 'started';
  if (!online) return 'offline';
  return 'ok';
}

/** Uncertain = the server may have applied it; the exact UUID/payload must be replayed. */
export function isUncertain(status: number | null): boolean { return status === null || status >= 500; }

export function notificationWarning(o: { notificationStatus: string }): 'suppressed' | 'cancelled' | 'pending' | null {
  return o.notificationStatus === 'suppressed' || o.notificationStatus === 'cancelled' || o.notificationStatus === 'pending' ? o.notificationStatus : null;
}

/** Exact backend notificationReason codes. */
export const KNOWN_REASONS = ['clinic_disabled', 'patient_opt_out', 'offer_accepted', 'offer_declined', 'offer_expired', 'offer_unavailable'] as const;
export const notificationReasonKey = (r: string | null) => (r && (KNOWN_REASONS as readonly string[]).includes(r) ? `notifReason.${r}` : 'notifReason.other');

export function remainingSeconds(expiresAt: string, serverNowMs: number): number { return Math.max(0, Math.ceil((Date.parse(expiresAt) - serverNowMs) / 1000)); }
