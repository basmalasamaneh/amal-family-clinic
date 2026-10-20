import { test } from "node:test";
import assert from "node:assert/strict";
import { wallToUtc, localTime, interval, newPatientInput, mapInput } from "../src/imports/validation";
test("Hebron wall-clock summer/winter conversion, immutable UTC, gaps, repeats and dates", () => {
  assert.equal(wallToUtc("2026-09-13T09:00:00"), "2026-09-13T06:00:00.000Z");
  assert.equal(wallToUtc("2026-01-13T09:00:00"), "2026-01-13T07:00:00.000Z");
  for (const local of ["2026-09-13T09:00:00", "2026-01-13T09:00:00"]) assert.equal(localTime(wallToUtc(local)), local);
  assert.throws(() => wallToUtc("2026-03-28T02:30:00"), /INVALID_LOCAL_TIME/);
  assert.throws(() => wallToUtc("2026-10-24T01:30:00"), /AMBIGUOUS_LOCAL_TIME/);
  assert.throws(() => wallToUtc("2026-02-30T09:00:00"));
  assert.throws(() => wallToUtc("2026-09-13T09:00:00Z"));
  assert.equal(interval("2026-09-13T06:00:00Z", "2026-09-13T06:30:00Z", true).startsAt, "2026-09-13T06:00:00.000Z");
  assert.throws(() => interval("2026-09-13T09:00:00", "2026-09-13T08:30:00", false));
});
test("new patients and replacements cannot omit confirmation or required demographics", () => {
  assert.equal(newPatientInput.safeParse({ name: "Name", phone: "", dateOfBirth: "1990-01-01" }).success, false);
  assert.equal(newPatientInput.safeParse({ name: "Name", phone: "0599000000" }).success, false);
  assert.equal(newPatientInput.safeParse({ name: "Name", phone: "0599000000", dateOfBirth: "2020-01-01" }).success, false);
  assert.equal(newPatientInput.safeParse({ name: "Name", phone: "0599000000", dateOfBirth: "2020-01-01", guardianName: "Parent", guardianRelation: "Mother" }).success, true);
  assert.equal(mapInput.safeParse({ expectedVersion: 1, rows: [{ rowId: 1, action: "include", doctorId: 1, patientId: 1 }] }).success, false);
});
