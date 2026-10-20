import { formatInTimeZone } from 'date-fns-tz';
import { CLINIC_TZ } from '../calendar/dates';

/**
 * Age policy: reuses the established under-18 rule (completed years, enforced server-side too). Age is counted in completed birthdays against the current Asia/Hebron
 * calendar date, never from elapsed milliseconds or a fixed birth year.
 */
export const MINOR_AGE = 18;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Proleptic Gregorian calendar maths (no Date, so years 0001-0099 are not remapped). */
export const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export function daysInMonth(y: number, m: number): number { return m === 2 ? (isLeapYear(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31; }

export function hebronToday(now: Date = new Date()): string { return formatInTimeZone(now, CLINIC_TZ, 'yyyy-MM-dd'); }

export type DobError = 'required' | 'invalid' | 'future';
/** Date-only validation. The value is never converted through UTC or a time zone. */
export function checkDob(value: string, today: string): DobError | null {
  const v = value.trim();
  if (!v) return 'required';
  const m = DATE_RE.exec(v);
  if (!m) return 'invalid';
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return 'invalid';
  if (y < 1) return 'invalid';
  const dim = daysInMonth(y, mo);
  if (d > dim) return 'invalid';
  if (v > today) return 'future';
  return null;
}

/**
 * Completed birthdays on `today` (both YYYY-MM-DD). A 29 February birthday is completed on
 * 1 March in non-leap years (string month-day comparison).
 */
export function completedYears(dob: string, today: string): number {
  const years = Number(today.slice(0, 4)) - Number(dob.slice(0, 4));
  return today.slice(5) < dob.slice(5) ? years - 1 : years;
}
/** null when DOB is missing or invalid: minor status is never guessed. */
export function isMinor(dob: string, today: string): boolean | null {
  if (checkDob(dob, today)) return null;
  return completedYears(dob, today) < MINOR_AGE;
}
