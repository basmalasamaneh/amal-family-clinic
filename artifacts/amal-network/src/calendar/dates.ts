import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { ar, enGB } from 'date-fns/locale';
import type { AmalLocale, DigitPreference } from '@workspace/amal-ui';

export const CLINIC_TZ = 'Asia/Hebron';
/** Week convention: Saturday-first (Palestinian working week). The shell had no prior convention. */
export const WEEK_STARTS_ON = 6;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isLocalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
/** Current Asia/Hebron calendar date, independent of the browser zone. */
export function todayLocal(now: Date = new Date()): string {
  return formatInTimeZone(now, CLINIC_TZ, 'yyyy-MM-dd');
}
/** Calendar (not instant) arithmetic on YYYY-MM-DD labels; never adds 24h to an instant. */
export function addLocalDays(date: string, days: number): string {
  if (!isLocalDate(date)) throw new RangeError('Expected YYYY-MM-DD');
  const [y, m, d] = date.split('-').map(Number);
  const out = new Date(Date.UTC(y, m - 1, d + days));
  return out.toISOString().slice(0, 10);
}
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
export function weekStart(date: string): string {
  return addLocalDays(date, -((weekdayOf(date) - WEEK_STARTS_ON + 7) % 7));
}
export function weekDates(date: string): string[] {
  const s = weekStart(date);
  return Array.from({ length: 7 }, (_, i) => addLocalDays(s, i));
}
/** UTC instant of a local wall time in Asia/Hebron. */
export function localToUtc(date: string, minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return fromZonedTime(`${date}T${hh}:${mm}:00`, CLINIC_TZ).toISOString();
}
/**
 * Half-open UTC range [from, to): from = local midnight of the first day, to = local midnight
 * of the day after the last. Each boundary is converted independently so DST days are 23/25h.
 */
export function rangeFor(date: string, days: number): { from: string; to: string } {
  return { from: localToUtc(date, 0), to: localToUtc(addLocalDays(date, days), 0) };
}
export const dayRange = (date: string) => rangeFor(date, 1);
export const weekRange = (date: string) => rangeFor(weekStart(date), 7);

export function localDateOf(utcISO: string): string { return formatInTimeZone(utcISO, CLINIC_TZ, 'yyyy-MM-dd'); }
export function localMinutesOf(utcISO: string): number {
  const [h, m] = formatInTimeZone(utcISO, CLINIC_TZ, 'HH:mm').split(':').map(Number);
  return h * 60 + m;
}
const toDigits = (v: string, digits: DigitPreference) => digits === 'latn' ? v : v.replace(/[0-9]/g, (n) => '٠١٢٣٤٥٦٧٨٩'[Number(n)]);
const loc = (l: AmalLocale) => (l === 'ar' ? ar : enGB);
export function formatTime(utcISO: string, locale: AmalLocale, digits: DigitPreference): string {
  return toDigits(formatInTimeZone(utcISO, CLINIC_TZ, 'HH:mm', { locale: loc(locale) }), digits);
}
export function formatMinutes(minutes: number, digits: DigitPreference): string {
  return toDigits(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`, digits);
}
/** Format a calendar label at local noon so the zone never shifts the date. */
export function formatLocalDate(date: string, locale: AmalLocale, digits: DigitPreference, pattern = 'EEEE d MMMM yyyy'): string {
  return toDigits(formatInTimeZone(localToUtc(date, 12 * 60), CLINIC_TZ, pattern, { locale: loc(locale) }), digits);
}
export function formatNum(n: number, digits: DigitPreference): string { return toDigits(String(n), digits); }
