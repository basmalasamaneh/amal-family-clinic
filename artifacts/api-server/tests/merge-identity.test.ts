import { test } from "node:test";
import assert from "node:assert/strict";
import { duplicateIdentity, mergeInput } from "../src/patients/merge";

test("merge identity is exact normalized name AND date-only DOB AND canonical phone, all required", () => {
  const a = { patient_name: "أحمد  علي", dob: "1990-01-01", phone: "059-123-4567" };
  const key = duplicateIdentity(a);
  assert(key);
  assert.equal(key, duplicateIdentity({ ...a, patient_name: "احمد علي", phone: "0591234567" }));
  for (const changes of [
    { patient_name: null }, { patient_name: " " }, { dob: null }, { phone: null },
    { phone: "letters" }, { dob: "1990-01-01T00:00:00Z" }, { dob: "1990-02-30" },
  ]) assert.equal(duplicateIdentity({ ...a, ...changes }), null);
  for (const changes of [{ dob: "1991-01-01" }, { phone: "0591234568" }, { patient_name: "احمد عمر" }]) {
    assert.notEqual(duplicateIdentity({ ...a, ...changes }), key);
  }
});
test("merge requires explicit bounded versions, source/target, reason, confirmation and operation ID", () => {
  const body = { sourceId: 1, targetId: 2, sourceVersion: 1, targetVersion: 1,
    confirmed: true, reason: "Reviewed duplicate", clientOpId: "573f53e0-5b66-4a2e-b979-7002f63ca5ad" };
  assert(mergeInput.safeParse(body).success);
  for (const patch of [{ confirmed: false }, { reason: " " }, { reason: "x".repeat(1001) },
    { sourceVersion: 0 }, { targetVersion: 1.5 }, { clientOpId: "not-a-uuid" }, { override: true }]) {
    assert.equal(mergeInput.safeParse({ ...body, ...patch }).success, false);
  }
});
