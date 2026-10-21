import { formatInTimeZone } from "date-fns-tz";

/** Recurring wall-clock preferences, not UTC offsets. Check the whole interval,
 * including repeated clocks at DST fall-back, not only its two endpoints. */
export function matchesWindow(entry: { weekdays: number[]; window_start: string; window_end: string }, start: Date, end: Date) {
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start ||
    end.getTime() - start.getTime() > 86400000) return false;
  const day = formatInTimeZone(start, "Asia/Hebron", "yyyy-MM-dd");
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  if (!entry.weekdays.includes(weekday)) return false;
  const milliseconds = (value: string) => {
    const [h, m, s] = value.split(":").map(Number);
    return ((h! * 60 + m!) * 60 + (s ?? 0)) * 1000;
  };
  const low = milliseconds(entry.window_start), high = milliseconds(entry.window_end);
  for (let at = start.getTime(); at < end.getTime(); at = Math.min(at + 60000, end.getTime())) {
    if (formatInTimeZone(at, "Asia/Hebron", "yyyy-MM-dd") !== day) return false;
    const clock = milliseconds(formatInTimeZone(at, "Asia/Hebron", "HH:mm:ss.SSS"));
    if (clock < low || clock >= high) return false;
  }
  const last = end.getTime() - 1;
  return formatInTimeZone(last, "Asia/Hebron", "yyyy-MM-dd") === day &&
    milliseconds(formatInTimeZone(last, "Asia/Hebron", "HH:mm:ss.SSS")) < high &&
    milliseconds(formatInTimeZone(last, "Asia/Hebron", "HH:mm:ss.SSS")) >= low;
}
