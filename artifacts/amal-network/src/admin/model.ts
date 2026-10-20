/** Pure admin model: no React, UI or browser-only imports so Node unit tests can load it. */

/* ---------- errors ---------- */
const KNOWN = ['VALIDATION', 'INVALID_ASSIGNMENT', 'DOCTOR_ALREADY_LINKED', 'ALREADY_EXISTS', 'INVALID_RELATIONSHIP', 'LAST_ADMIN', 'INVALID_CREDENTIALS',
  'PASSWORD_REQUIRED', 'PIN_REQUIRED', 'PIN_ROLE_REQUIRED', 'CONFLICT', 'NOT_FOUND', 'FORBIDDEN', 'CSRF', 'UNAUTHORIZED', 'RATE_LIMITED', 'INTERNAL'];
export class OfflineError extends Error { constructor() { super('offline'); } }
export interface AdminFailure { key: string; ambiguous: boolean; session: boolean }
/** Definitive 4xx answers allow correction; transport failures and 5xx leave the outcome unknown. */
export function classify(e: unknown): AdminFailure {
  if (e instanceof OfflineError) return { key: 'adm.err.offline', ambiguous: false, session: false };
  const status = e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number' ? (e as { status: number }).status : null;
  const data = e && typeof e === 'object' && 'data' in e ? (e as { data: unknown }).data : null;
  const code = data && typeof data === 'object' && typeof (data as { code?: unknown }).code === 'string' ? (data as { code: string }).code : null;
  if (status === 401) return { key: 'adm.err.UNAUTHORIZED', ambiguous: false, session: true };
  if (status === null) return { key: 'adm.err.network', ambiguous: true, session: false };
  const ambiguous = status >= 500 || status === 408;
  if (code && KNOWN.includes(code)) return { key: `adm.err.${code}`, ambiguous, session: false };
  if (status === 403) return { key: 'adm.err.FORBIDDEN', ambiguous: false, session: false };
  if (status === 404) return { key: 'adm.err.NOT_FOUND', ambiguous: false, session: false };
  if (status === 409) return { key: 'adm.err.CONFLICT', ambiguous: false, session: false };
  if (status === 400 || status === 422) return { key: 'adm.err.VALIDATION', ambiguous: false, session: false };
  if (status === 429) return { key: 'adm.err.RATE_LIMITED', ambiguous: false, session: false };
  return { key: ambiguous ? 'adm.err.INTERNAL' : 'adm.err.unknown', ambiguous: true, session: false };
}


export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const LABEL_RE = /^[a-z][A-Za-z0-9_.-]*$/;
export function validTimezone(tz: string): boolean {
  // Mirrors the API: IANA names only (no numeric offsets), then runtime recognition.
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(tz)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz.trim().length > 0 && tz.length <= 100; } catch { return false; } }

export interface ClinicDraft { name: string; city: string; bookingMethod: string; slotMinutes: string; workingDays: number[]; openTime: string; closeTime: string; mode: 'full' | 'lite'; timezone: string }
export const EMPTY_DRAFT: ClinicDraft = { name: '', city: '', bookingMethod: '', slotMinutes: '30', workingDays: [0, 1, 2, 3, 4, 5, 6], openTime: '08:00', closeTime: '17:00', mode: 'lite', timezone: 'Asia/Hebron' };
export type FieldErr = { id: string; text: string };

const len = (s: string) => s.trim().length >= 1 && s.trim().length <= 200;
export function validateDetails(d: ClinicDraft, t: (k: string) => string): FieldErr[] {
  const e: FieldErr[] = [];
  if (!len(d.name)) e.push({ id: 'clinic-name', text: t('adm.wizard.nameReq') });
  if (!len(d.city)) e.push({ id: 'clinic-city', text: t('adm.wizard.cityReq') });
  if (!len(d.bookingMethod)) e.push({ id: 'clinic-booking', text: t('adm.wizard.bookingReq') });
  return e;
}
export function validateSchedule(d: ClinicDraft, t: (k: string) => string): FieldErr[] {
  const e: FieldErr[] = [];
  const slot = Number(d.slotMinutes);
  if (!/^\d+$/.test(d.slotMinutes) || slot < 1 || slot > 1440) e.push({ id: 'clinic-slot', text: t('adm.wizard.slotInvalid') });
  if (d.workingDays.length === 0) e.push({ id: 'clinic-day-0', text: t('adm.wizard.daysReq') });
  if (!TIME_RE.test(d.openTime)) e.push({ id: 'clinic-open', text: t('adm.wizard.timeInvalid') });
  if (!TIME_RE.test(d.closeTime)) e.push({ id: 'clinic-close', text: t('adm.wizard.timeInvalid') });
  else if (TIME_RE.test(d.openTime) && d.openTime >= d.closeTime) e.push({ id: 'clinic-close', text: t('adm.wizard.order') });
  if (!validTimezone(d.timezone)) e.push({ id: 'clinic-tz', text: t('adm.wizard.tzInvalid') });
  return e;
}
export function toPayload(d: ClinicDraft) {
  // Adoption is clinic-owned: create uses the server's Trial/Lite default;
  // settings updates must never include mode.
  return { name: d.name.trim(), city: d.city.trim(), bookingMethod: d.bookingMethod.trim(), slotMinutes: Number(d.slotMinutes),
    workingDays: [...d.workingDays].sort((a, b) => a - b), openTime: d.openTime, closeTime: d.closeTime, timezone: d.timezone.trim() };
}

