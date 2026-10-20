import { describe, expect, it } from "vitest";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { addCalendarDays, dateOnly, demoZone, hebronDate, hebronInstant, isMinor, utcInstant } from "../builders/time";

describe("UTC instants, date-only values and Asia/Hebron DST", () => {
  it("preserves already-UTC instants, without a second local-time conversion", () => {
    const original = new Date("2026-09-08T05:00:00Z");
    const result = utcInstant(original);
    expect(result).not.toBe(original);
    expect(result.toISOString()).toBe("2026-09-08T05:00:00.000Z");
    expect(utcInstant("2026-09-08T08:00:00+03:00")).toEqual(result);
    expect(() => utcInstant("2026-09-08T08:00:00")).toThrow(/explicit UTC offset/);
    expect(() => utcInstant("invalidZ")).toThrow(/Invalid instant/);
  });

  it.each(["1990-01-02", "2012-02-29", "2026-10-25"])("retains date-only %s exactly", value => {
    expect(dateOnly(value)).toBe(value);
    expect(typeof dateOnly(value)).toBe("string");
  });

  it.each(["2026-02-29", "2026-04-31", "2026-13-01", "2026-01-01T00:00:00Z"])("rejects invalid SQL date %s", value => {
    expect(() => dateOnly(value)).toThrow();
  });

  it.each([
    ["2026-03-27", "2026-03-28", 23],
    ["2026-10-23", "2026-10-24", 25],
  ])("adds calendar days across %s → %s, not 24-hour durations", (before, after, hours) => {
    const a = hebronInstant(before, "12:00");
    const b = hebronInstant(after, "12:00");
    expect(addCalendarDays(before, 1)).toBe(after);
    expect((b.getTime() - a.getTime()) / 3_600_000).toBe(hours);
    expect(formatInTimeZone(a, demoZone, "yyyy-MM-dd HH:mm")).toBe(`${before} 12:00`);
    expect(formatInTimeZone(b, demoZone, "yyyy-MM-dd HH:mm")).toBe(`${after} 12:00`);
    expect(hebronDate(b)).toBe(after);
  });

  it.each([
    ["2026-03-28", "02:30"],
    ["2026-10-24", "01:30"],
  ])("delegates gap/fold semantics to date-fns-tz for %s %s", (day, time) => {
    expect(hebronInstant(day, time)).toEqual(fromZonedTime(`${day}T${time}`, "Asia/Hebron"));
  });

  it("uses the clinic's local date for a UTC instant near midnight", () => {
    expect(hebronDate(utcInstant("2026-09-08T22:30:00Z"))).toBe("2026-09-09");
    expect(() => hebronInstant("2026-09-08", "25:00")).toThrow(/wall-clock/);
  });

  it("handles 18th birthdays and PostgreSQL leap-day anniversary clamping", () => {
    expect(isMinor("2008-09-08", "2026-09-07")).toBe(true);
    expect(isMinor("2008-09-08", "2026-09-08")).toBe(false);
    expect(isMinor("2008-02-29", "2026-02-27")).toBe(true);
    expect(isMinor("2008-02-29", "2026-02-28")).toBe(false);
    expect(() => isMinor("2030-01-01", "2026-09-08")).toThrow(/Birth date/);
  });
});
