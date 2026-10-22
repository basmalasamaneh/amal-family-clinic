import { z } from "zod/v4";
import { fromZonedTime } from "date-fns-tz";
import { hebronDay } from "../patients/demographics";

/** Calendar dates, not instants: reject normalization such as February 30. */
export const doctorDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return value.slice(0, 4) !== "0000" && Number.isFinite(parsed.getTime())
    && parsed.toISOString().split("T")[0] === value;
});
export const doctorViewSchema = z.enum(["day", "week"]);
export type DoctorView = z.infer<typeof doctorViewSchema>;

function shift(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split("T")[0]!;
}

function midnight(day: string) {
  // A week containing 0001-01-01 can start in ISO year 0000. date-fns-tz
  // misreads Intl's BCE era there; Hebron's pre-standardization offset is
  // constant, so anchor those few days to the independently converted CE edge.
  if (day.startsWith("0000-")) {
    const edge = fromZonedTime("0001-01-01T00:00:00", "Asia/Hebron");
    return new Date(edge.getTime() + new Date(`${day}T00:00:00Z`).getTime()
      - new Date("0001-01-01T00:00:00Z").getTime());
  }
  return fromZonedTime(`${day}T00:00:00`, "Asia/Hebron");
}

/** Convert each midnight independently; neither days nor weeks are fixed UTC durations. */
export function doctorInterval(date?: string, view: DoctorView = "day", now = new Date()) {
  const selected = date === undefined ? hebronDay(now) : doctorDateSchema.parse(date);
  const weekday = new Date(`${selected}T12:00:00Z`).getUTCDay();
  const day = view === "week" ? shift(selected, -((weekday + 1) % 7)) : selected;
  const nextDay = shift(day, view === "week" ? 7 : 1);
  return {
    day,
    start: midnight(day),
    end: midnight(nextDay),
  };
}

/** Backward-compatible helper for callers selecting Hebron today from an instant. */
export function dayInterval(now = new Date()) {
  return doctorInterval(undefined, "day", now);
}
