import assert from "node:assert/strict";
import { test } from "node:test";
import { duplicateIdentity, equivalentPatientIds } from "../src/patients/identity";
import { evaluate, type EvaluationInput } from "../src/appointments/engine";

test("safety equivalence requires every canonical field; invalid and missing fields never match", () => {
  const original = { patient_name: "Exact Name", phone: "0599123456", dob: "1980-01-01" };
  const key = duplicateIdentity(original);
  assert(key);
  assert.equal(duplicateIdentity({ ...original, patient_name: "  Exact   Name  " }), key);
  for (const change of [{ patient_name: "Different Name" }, { phone: "0599123457" }, { dob: "1980-01-02" },
    { patient_name: null }, { phone: null }, { dob: null }, { phone: "invalid" }, { dob: "1980-02-30" }]) {
    assert.notEqual(duplicateIdentity({ ...original, ...change }), key);
  }
  assert.deepEqual(equivalentPatientIds(new Map([[1, key], [2, key], [3, null], [4, null]]), 1), [1, 2]);
  assert.deepEqual(equivalentPatientIds(new Map([[3, null], [4, null]]), 3), [3]);
});

test("equivalent IDs block overrides, hide multiplicity and allow touching endpoints", () => {
  const appointment = { id: 1, patientId: 1, clinicId: 1, doctorId: 1,
    startAt: "2090-01-01T10:00:00.000Z", durationMinutes: 30, status: "booked" };
  const input: EvaluationInput = { appointment, appointments: [2, 3].map(id => ({
    ...appointment, id, patientId: id, doctorId: id,
  })), equivalentPatientIds: [1, 2, 3], holds: [], now: new Date("2090-01-01T09:00:00Z"),
  settings: { workingDays: [0, 1, 2, 3, 4, 5, 6], openTime: "00:00", closeTime: "23:59", timezone: "UTC", slotMinutes: 30 },
  ownerId: 1, canOverride: true, overrideReason: "Approved", visible: () => true };
  const result = evaluate(input);
  assert.equal(result.ok, false);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0]!.with, null);
  assert.equal(result.conflicts[0]!.severity, "blocking");
  assert.equal(evaluate({ ...input, appointment: { ...appointment, startAt: "2090-01-01T10:30:00.000Z" } }).ok, true);
  assert.equal(evaluate({ ...input, equivalentPatientIds: [] }).ok, true);
});
