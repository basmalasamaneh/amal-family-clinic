import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { withIsolatedAuthDatabase } from "./helpers/auth-isolated";

test("offline registration API guarantees use only a disposable database", { timeout: 240_000 }, async () => {
  await withIsolatedAuthDatabase(async admin => {
    const { seedFingerprint } = await import("../../../scripts/src/operational-support");
    const before = await seedFingerprint(admin);
    const env: NodeJS.ProcessEnv = {
      ...process.env, OFFLINE_REGISTRATION_ISOLATED: "1",
      NODE_ENV: "test", LOG_LEVEL: "silent",
      SECURITY_RATE_GENERAL: "100000", SECURITY_RATE_LOOKUP: "10000",
      SECURITY_RATE_EXPENSIVE: "10000", SECURITY_RATE_SYNC: "10000",
    };
    delete env.NODE_TEST_CONTEXT;
    try {
      const output = execFileSync(process.execPath, [
        "--import", "tsx", "--test", "--test-reporter=tap", "--test-concurrency=1",
        new URL("offline-registration-api.test.ts", import.meta.url).pathname,
      ], { env, encoding: "utf8", timeout: 210_000, maxBuffer: 2 * 1024 * 1024 });
      assert.match(output, /# tests \d+/);
      console.log(output);
    } catch (error) {
      const failure = error as { stdout?: string };
      if (failure.stdout) console.log(failure.stdout);
      throw new Error("Isolated offline registration API assertions failed");
    } finally {
      assert.equal(await seedFingerprint(admin), before,
        "Cloned seed content, schema and protection fingerprint remains unchanged");
      console.log("Offline registration: seed fingerprint unchanged.");
    }
  });
});
