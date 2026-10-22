import { formatInTimeZone } from 'date-fns-tz';
import { arSA, enUS } from 'date-fns/locale';

/** Full, unambiguous clinic-local date for comparison cards and their history. */
export function formatSyncWhen(iso: string | null | undefined, locale: string, digits: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const text = formatInTimeZone(date, 'Asia/Hebron', 'EEEE d MMMM yyyy, HH:mm', {
    locale: locale === 'ar' ? arSA : enUS,
  });
  return digits === 'latn' || locale === 'en'
    ? text.replace(/[\u0660-\u0669]/g, c => String(c.charCodeAt(0) - 0x0660))
    : text;
}
