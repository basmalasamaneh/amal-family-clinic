import { formatInTimeZone } from 'date-fns-tz';
import { ar, enGB } from 'date-fns/locale';
import type { AmalLocale, DigitPreference } from '@workspace/amal-ui';

export function formatNumber(value: number, locale: AmalLocale, digits: DigitPreference): string {
  return new Intl.NumberFormat(locale, { numberingSystem: digits }).format(value);
}
const displayDigits = (value: string, digits: DigitPreference) => digits === 'latn' ? value : value.replace(/[0-9]/g, n => '٠١٢٣٤٥٦٧٨٩'[Number(n)]);
/** Only formatted presentation text is transformed, never IDs, phones or stored data. */
export function formatInstant(utcISO: string, locale: AmalLocale, digits: DigitPreference): string {
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(utcISO) || !Number.isFinite(Date.parse(utcISO))) throw new RangeError('An explicit-offset instant is required');
  return displayDigits(formatInTimeZone(utcISO, 'Asia/Hebron', 'd MMMM yyyy · HH:mm', { locale: locale === 'ar' ? ar : enGB }), digits);
}
/** Calendar dates do not represent instants and must never be shifted across zones. */
export function formatDateOnly(value: string, locale: AmalLocale, digits: DigitPreference): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('Expected YYYY-MM-DD');
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new RangeError('Invalid calendar date');
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', numberingSystem: digits, year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}
