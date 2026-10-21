import assert from "node:assert/strict";
import { test } from "node:test";
import { contract, validate } from "./validate-contract.mjs";

test("waitlist operations have clinic-private contracts and valid examples", () => {
  const paths = Object.entries(contract.paths).filter(([path]) => path.startsWith("/waitlist"));
  assert.equal(paths.length, 4);
  for (const [path, methods] of paths) {
    for (const operation of Object.values(methods)) {
      assert.deepEqual(operation["x-roles"], ["front-desk"], path);
      assert.ok(operation.security.some(s => "sessionCookie" in s), path);
      assert.ok(!(operation.parameters ?? []).some(p => p.name === "clinicId"), path);
      const media = [operation.requestBody?.content, ...Object.values(operation.responses).map(r => r.content)];
      for (const content of media) {
        for (const item of Object.values(content ?? {})) {
          assert.notEqual(item.example, undefined, path);
          assert.equal(validate(item.schema, item.example).valid, true, path);
        }
      }
    }
  }
});

test("entry creation rejects supplied clinic, patient names, duplicate weekdays and malformed wall clocks", () => {
  const schema = { $ref: "#/components/schemas/WaitlistEntryInput" };
  const sample = contract.paths["/waitlist/entries"].post.requestBody.content["application/json"].example;
  for (const change of [
    { clinicId: 101 }, { patientName: "Not an identity" }, { weekdays: [1, 1] },
    { weekdays: [] }, { windowStart: "24:00" }, { windowEnd: "9:00" }, { patientId: 0 },
  ]) assert.equal(validate(schema, { ...sample, ...change }).valid, false);
});
