import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { CalendarWindow } from './types';

export const CACHE_TIME_ZONE = 'Asia/Hebron' as const;

/** Calendar arithmetic uses date components, NOT fourteen 24-hour durations. */
export function appointmentWindow(now: Date = new Date()): CalendarWindow {
  if (!Number.isFinite(now.getTime())) throw new RangeError('Invalid clock');
  const localStartDate = formatInTimeZone(now, CACHE_TIME_ZONE, 'yyyy-MM-dd');
  const end = new Date(`${localStartDate}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 14);
  const localEndDate = end.toISOString().slice(0, 10);
  return {
    timeZone: CACHE_TIME_ZONE,
    localStartDate,
    localEndDate,
    startUtc: fromZonedTime(`${localStartDate}T00:00:00`, CACHE_TIME_ZONE).toISOString(),
    endUtc: fromZonedTime(`${localEndDate}T00:00:00`, CACHE_TIME_ZONE).toISOString(),
  };
}

export function formatHebronInstant(instant: string, pattern = 'yyyy-MM-dd HH:mm'): string {
  return formatInTimeZone(instant, CACHE_TIME_ZONE, pattern);
}
