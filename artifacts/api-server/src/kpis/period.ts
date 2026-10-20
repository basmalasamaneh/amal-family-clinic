import { z } from "zod/v4";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { fail } from "../lib/auth-errors";

export const KPI_VERSION = "amal-kpi-1";
export const ZONE = "Asia/Hebron";
const querySchema = z.object({
  range: z.enum(["day", "week", "month"]),
  // A reproducible local anchor, not an unbounded arbitrary interval.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  clinicId: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(2147483647)).optional(),
}).strict();

export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function period(startDate: string, endDateExclusive: string) {
  return {
    startDate, endDateExclusive,
    start: fromZonedTime(`${startDate}T00:00:00`, ZONE).toISOString(),
    end: fromZonedTime(`${endDateExclusive}T00:00:00`, ZONE).toISOString(),
    days: Math.round((Date.parse(`${endDateExclusive}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) / 86400000),
    timezone: ZONE,
  };
}
export const BASELINE_PERIOD = period("2026-09-08", "2026-09-14");
export function parseKpiQuery(raw: unknown, now = new Date()) {
  const query = querySchema.parse(raw);
  const day = query.date ?? formatInTimeZone(now, ZONE, "yyyy-MM-dd");
  const date = new Date(`${day}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day || day < "2000-01-01" || day > "2100-12-31") {
    throw fail(400, "VALIDATION", "validation");
  }
  let start = day, end = shiftDay(day, 1);
  if (query.range === "week") {
    start = shiftDay(day, -((date.getUTCDay() + 6) % 7));
    end = shiftDay(start, 7);
  } else if (query.range === "month") {
    start = `${day.slice(0, 7)}-01`;
    const next = new Date(`${start}T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    end = next.toISOString().slice(0, 10);
  }
  return { range: query.range, clinicId: query.clinicId ?? null, period: period(start, end) };
}
