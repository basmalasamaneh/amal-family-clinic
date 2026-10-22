import { test } from "node:test";
import assert from "node:assert/strict";
import { doctorDateSchema, doctorInterval, doctorViewSchema, dayInterval } from "../src/doctor/calendar";

test("doctor calendar validates strict real Gregorian dates and views", () => {
  for (const date of ["2024-02-29", "2000-02-29", "2025-01-01", "0001-01-01", "9999-12-31"]) {
    assert.equal(doctorDateSchema.parse(date), date);
    for (const view of ["day", "week"] as const) {
      const interval = doctorInterval(date, view);
      assert(Number.isFinite(interval.start.getTime()));
      assert(Number.isFinite(interval.end.getTime()));
      assert(interval.end > interval.start);
    }
  }
  for (const date of ["", "2025-02-29", "1900-02-29", "2100-02-29", "2024-02-30", "2025-04-31",
    "2025-00-01", "2025-13-01", "2025-01-00", "2025-1-01", "0000-01-01",
    "2025-01-01T00:00:00Z", " 2025-01-01", "10000-01-01"]) {
    assert.equal(doctorDateSchema.safeParse(date).success, false, date);
  }
  for (const view of ["", "month", "Day", ["day", "week"]]) {
    assert.equal(doctorViewSchema.safeParse(view).success, false);
  }
});

test("doctor calendar defaults to Hebron today and includes local midnight rollover", () => {
  const now = new Date("2025-01-01T22:30:00Z");
  assert.equal(dayInterval(now).day, "2025-01-02");
  assert.deepEqual(doctorInterval(undefined, undefined, now), dayInterval(now));
  assert.deepEqual(doctorInterval("2025-01-02"), dayInterval(now));
  assert.equal(doctorInterval(undefined, "week", now).day, "2024-12-28");
});

test("doctor weeks start Saturday across month, year and leap boundaries", () => {
  for (const [date, saturday] of [
    ["2025-01-04", "2025-01-04"], ["2025-01-10", "2025-01-04"],
    ["2025-01-11", "2025-01-11"], ["2025-01-01", "2024-12-28"],
    ["2024-03-01", "2024-02-24"], ["0001-01-01", "0000-12-30"],
  ]) {
    const week = doctorInterval(date, "week");
    assert.equal(week.day, saturday);
    const selected = doctorInterval(date);
    assert(selected.start >= week.start && selected.end <= week.end);
  }
});

test("doctor intervals convert independent Hebron midnights through both DST transitions", () => {
  const dayHours = new Set<number>(), weekHours = new Set<number>();
  for (let i = 0; i < 365; i++) {
    const date = new Date(Date.UTC(2025, 0, 1 + i, 12)).toISOString().slice(0, 10);
    const day = doctorInterval(date), week = doctorInterval(date, "week");
    dayHours.add((day.end.getTime() - day.start.getTime()) / 3600000);
    weekHours.add((week.end.getTime() - week.start.getTime()) / 3600000);
    assert.equal(dayInterval(day.start).day, day.day);
    assert.equal(dayInterval(new Date(day.end.getTime() - 1)).day, day.day);
    assert.notEqual(dayInterval(day.end).day, day.day);
    assert(day.start >= week.start && day.end <= week.end);
    assert.equal(doctorInterval(undefined, "week", week.start).day, week.day);
    assert.equal(doctorInterval(undefined, "week", new Date(week.end.getTime() - 1)).day, week.day);
    assert.notEqual(doctorInterval(undefined, "week", week.end).day, week.day);
  }
  assert.deepEqual([...dayHours].sort(), [23, 24, 25]);
  assert.deepEqual([...weekHours].sort(), [167, 168, 169]);
});
