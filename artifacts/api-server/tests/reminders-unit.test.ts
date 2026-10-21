import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderReminder } from "../src/reminders/templates";
import { simulator } from "../src/reminders/simulator";

test("templates allow only configured name and Hebron date/time, including DST", () => {
  const winter = renderReminder({ clinicDisplayName: "Configured clinic", startsAt: new Date("2030-01-15T10:00:00Z") });
  const summer = renderReminder({ clinicDisplayName: "Configured clinic", startsAt: new Date("2030-07-15T10:00:00Z") });
  assert.match(winter.en, /Time: 12:00/);
  assert.match(summer.en, /Time: 13:00/);
  assert.match(winter.ar, /الوقت: 12:00/);
  assert.throws(() => renderReminder({
    clinicDisplayName: "Configured clinic", startsAt: new Date(), patientName: "PRIVATE_SENTINEL",
  } as Parameters<typeof renderReminder>[0]));
  assert.deepEqual(Object.keys(winter).sort(), ["ar", "en"]);
});

test("sole simulator rejects extra payload data and performs no external IO", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("Network messaging forbidden"); }) as typeof fetch;
  try {
    const input = { idempotencyKey: "reminder:1:1:1", message: { ar: "العيادة", en: "Clinic" } };
    assert.deepEqual(await simulator.deliver(input), await simulator.deliver(input));
    await assert.rejects(simulator.deliver({ ...input, phone: "PRIVATE_SENTINEL" } as typeof input));
    const source = readFileSync(new URL("../src/reminders/simulator.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /fetch\s*\(|node:https|node:http|process\.env|axios|twilio/);
    assert.equal((await simulator.deliver(input)).simulated, true);
  } finally { globalThis.fetch = originalFetch; }
});
