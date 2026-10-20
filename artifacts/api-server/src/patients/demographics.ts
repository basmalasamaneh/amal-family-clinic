import { formatInTimeZone } from "date-fns-tz";

/** Date-only demographics never round-trip through a UTC birth instant. */
export function hebronDay(now = new Date()): string {
  return formatInTimeZone(now, "Asia/Hebron", "yyyy-MM-dd");
}

export function validBirthDate(value: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 &&
    day <= days[month - 1]! && value <= hebronDay(now);
}

/** Default minor policy: under 18 completed birthdays; Feb 29 completes on Mar 1 in non-leap years. */
export function isMinor(dateOfBirth: string, today = hebronDay()): boolean {
  const age = Number(today.slice(0, 4)) - Number(dateOfBirth.slice(0, 4)) -
    (today.slice(5) < dateOfBirth.slice(5) ? 1 : 0);
  return age < 18;
}
