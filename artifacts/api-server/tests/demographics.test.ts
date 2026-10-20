import assert from "node:assert/strict";
import { test } from "node:test";
import { hebronDay, isMinor, validBirthDate } from "../src/patients/demographics";

test("date-only DOB validation uses Hebron today, not UTC, including midnight and DST boundaries", () => {
  const now = new Date("2026-06-10T21:30:00Z");
  assert.equal(hebronDay(now), "2026-06-11");
  assert.equal(validBirthDate("2026-06-11", now), true);
  assert.equal(validBirthDate("2026-06-12", now), false);
  assert.equal(validBirthDate("0001-01-01", now), true);
  assert.equal(validBirthDate("0000-01-01", now), false);
  for (const invalid of ["2025-02-29", "1900-02-29", "2026-04-31", "2026-00-01", "2026-13-01",
    "2026-01-00", "2026-1-01", "2026-06-11T00:00:00Z", "2026-06-11 "]) {
    assert.equal(validBirthDate(invalid, now), false, invalid);
  }
  assert.equal(validBirthDate("2000-02-29", now), true);
  assert.equal(hebronDay(new Date("2026-01-01T22:30:00Z")), "2026-01-02");
  for (const instant of ["2026-03-27T22:59:00Z", "2026-03-28T00:01:00Z", "2026-10-23T22:59:00Z"]) {
    const clock = new Date(instant), day = hebronDay(clock);
    assert.equal(validBirthDate(day, clock), true);
    assert.equal(validBirthDate("2999-01-01", clock), false);
  }
});

test("minor policy counts completed birthdays, including birthday today and leap-day birthdays", () => {
  assert.equal(isMinor("2008-06-12", "2026-06-11"), true);
  assert.equal(isMinor("2008-06-11", "2026-06-11"), false);
  assert.equal(isMinor("2008-06-10", "2026-06-11"), false);
  assert.equal(isMinor("2008-02-29", "2026-02-28"), true);
  assert.equal(isMinor("2008-02-29", "2026-03-01"), false);
  assert.equal(isMinor("2026-06-11", "2026-06-11"), true);
});
