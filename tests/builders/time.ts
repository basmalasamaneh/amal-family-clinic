import { addDays, format } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const demoZone = "Asia/Hebron";

/** SQL date values are strings, never host-local midnight instants. */
export function dateOnly(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Expected YYYY-MM-DD");
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid calendar date");
  }
  return value;
}

/** Add calendar days, not elapsed 24-hour periods across a DST boundary. */
export function addCalendarDays(value: string, days: number): string {
  const [year, month, day] = dateOnly(value).split("-").map(Number);
  return format(addDays(new Date(year!, month! - 1, day!, 12), days), "yyyy-MM-dd");
}

export function utcInstant(value: string | Date): Date {
  if (typeof value === "string" && !/(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error("An instant requires an explicit UTC offset");
  }
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw new Error("Invalid instant");
  return result;
}

/** date-fns-tz owns gap/fold policy; no guessed Palestinian UTC offsets. */
export function hebronInstant(date: string, time = "10:00:00"): Date {
  dateOnly(date);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) {
    throw new Error("Invalid wall-clock time");
  }
  return fromZonedTime(`${date}T${time}`, demoZone);
}

export function hebronDate(instant: Date): string {
  return formatInTimeZone(instant, demoZone, "yyyy-MM-dd");
}

export function isMinor(dob: string, asOf: string): boolean {
  dateOnly(dob);
  dateOnly(asOf);
  if (dob > asOf) throw new Error("Birth date must not follow as-of date");
  const eighteenthBirthday = `${Number(dob.slice(0, 4)) + 18}${dob.slice(4)}`;
  // PostgreSQL's date + interval clamps a leap-day birthday in a non-leap year.
  const anniversary = eighteenthBirthday.endsWith("-02-29")
    && new Date(`${eighteenthBirthday}T12:00:00Z`).toISOString().slice(0, 10) !== eighteenthBirthday
    ? `${eighteenthBirthday.slice(0, 4)}-02-28` : eighteenthBirthday;
  return asOf < anniversary;
}
