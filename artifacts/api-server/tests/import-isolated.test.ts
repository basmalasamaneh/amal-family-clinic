import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { withIsolatedAuthDatabase } from "./helpers/auth-isolated";

test("import API suite runs only against a disposable database snapshot", { timeout: 240000 }, async () => {
  await withIsolatedAuthDatabase(async admin => {
    assert(new URL(process.env.DATABASE_URL!).searchParams.get("host")?.includes("amal-auth-security-"),
      "Population and tests require the owned disposable Unix socket");
    const { populate } = await import("../../../scripts/src/demo-populate");
    const { transaction, seedFingerprint } = await import("../../../scripts/src/operational-support");
    const before = await seedFingerprint(admin);
    // A real workspace may be in an empty onboarding state. Restore only the
    // disposable operational baseline from immutable seed SELECTs, never source.
    await transaction(admin, () => populate(admin));
    const { baseline } = await import("../../../scripts/src/baseline");
    // Existing clone doctors may contain edited directory emails. Restore only
    // the export adapter's authentic workbook mapping in this disposable copy.
    for (const row of (await baseline(admin)).Q08!) {
      assert.equal(Number(row.candidate_count), 1);
      await admin.query("UPDATE operational.doctors SET email=$2 WHERE doctor_id=$1", [row.doctor_ids[0], row.doctor_email]);
    }
    const env = { ...process.env };
    // node:test's inherited context would suppress the child runner entirely.
    delete env.NODE_TEST_CONTEXT;
    try {
      const output = execFileSync("pnpm", ["exec", "tsx", "--test", "--test-concurrency=1",
        "tests/import-validation.test.ts", "tests/import-db.test.ts", "tests/import-merge-boundary.test.ts"], {
        cwd: fileURLToPath(new URL("..", import.meta.url)), env, encoding: "utf8",
        timeout: 180000, maxBuffer: 2 * 1024 * 1024,
      });
      assert.match(output, /tests\s+23\b/, "All child tests must actually execute");
      console.log(output);
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string };
      if (failure.stdout) console.log(failure.stdout);
      if (failure.stderr) console.error(failure.stderr);
      throw new Error("Disposable import suite failed; see assertions above");
    } finally {
      assert.equal(await seedFingerprint(admin), before, "All six immutable seed fingerprints remain unchanged");
    }
  });
});
