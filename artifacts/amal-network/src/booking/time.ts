import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { CLINIC_TZ, isLocalDate, localDateOf } from '../calendar/dates';

export type IntervalError = 'invalid' | 'nonexistent' | 'crossesDay' | 'duration';
export type IntervalResult =
  | { ok: true; startsAt: string; endsAt: string; ambiguous: boolean }
  | { ok: false; error: IntervalError };
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const FMT = "yyyy-MM-dd'T'HH:mm:ss";

/**
 * Converts an Asia/Hebron wall-clock start + duration into UTC instants.
 * Nonexistent (spring-forward gap) times are rejected rather than shifted;
 * ambiguous (fall-back) times resolve to the earliest instant and are flagged.
 */
export function resolveLocalInterval(date: string, time: string, durationMin: number): IntervalResult {
  if (!isLocalDate(date) || !TIME_RE.test(time)) return { ok: false, error: 'invalid' };
  if (!Number.isInteger(durationMin) || durationMin < 1 || durationMin > 1440) return { ok: false, error: 'duration' };
  const local = `${date}T${time}:00`;
  const guess = fromZonedTime(local, CLINIC_TZ);
  const same = (d: Date) => formatInTimeZone(d, CLINIC_TZ, FMT) === local;
  if (!same(guess)) return { ok: false, error: 'nonexistent' };
  const earlier = new Date(guess.getTime() - 3600000);
  const later = new Date(guess.getTime() + 3600000);
  let start = guess; let ambiguous = false;
  if (same(earlier)) { start = earlier; ambiguous = true; } else if (same(later)) ambiguous = true;
  const end = new Date(start.getTime() + durationMin * 60000);
  if (localDateOf(new Date(end.getTime() - 1).toISOString()) !== date) return { ok: false, error: 'crossesDay' };
  return { ok: true, startsAt: start.toISOString(), endsAt: end.toISOString(), ambiguous };
}
export function localTimeOf(utc: string): string { return formatInTimeZone(utc, CLINIC_TZ, 'HH:mm'); }
export function minutesBetween(a: string, b: string): number { return Math.round((Date.parse(b) - Date.parse(a)) / 60000); }
/** Next 5-minute local wall-clock time, for walk-ins. */
export function nextLocalTime(now: Date = new Date(), step = 5): { date: string; time: string } {
  const t = new Date(Math.ceil(now.getTime() / (step * 60000)) * step * 60000);
  return { date: formatInTimeZone(t, CLINIC_TZ, 'yyyy-MM-dd'), time: formatInTimeZone(t, CLINIC_TZ, 'HH:mm') };
}
/** Server hold expiry shown as Asia/Hebron wall-clock HH:mm:ss. */
export function formatExpiry(utc: string, digits: 'latn' | 'arab' | string = 'latn'): string {
  const v = formatInTimeZone(utc, CLINIC_TZ, 'HH:mm:ss');
  return digits === 'latn' ? v : v.replace(/[0-9]/g, (n) => '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669'[Number(n)]!);
}
/** A server/calendar-provided UTC interval kept verbatim until the user edits date/time. */
export interface ExactSlot { startsAt: string; endsAt?: string }
/**
 * Uses the exact UTC slot when present (no local round-trip, so the second occurrence of a
 * repeated DST hour is preserved); otherwise converts the local inputs.
 */
export function effectiveInterval(exact: ExactSlot | null, date: string, time: string, durationMin: number): IntervalResult {
  if (!exact) return resolveLocalInterval(date, time, durationMin);
  if (!Number.isInteger(durationMin) || durationMin < 1 || durationMin > 1440) return { ok: false, error: 'duration' };
  const endsAt = exact.endsAt ?? new Date(Date.parse(exact.startsAt) + durationMin * 60000).toISOString();
  if (localDateOf(new Date(Date.parse(endsAt) - 1).toISOString()) !== localDateOf(exact.startsAt)) return { ok: false, error: 'crossesDay' };
  return { ok: true, startsAt: exact.startsAt, endsAt, ambiguous: false };
}
