import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { withIsolatedAuthDatabase } from "./helpers/auth-isolated";

test("focused route regressions run only in a disposable cloned database", { timeout: 240_000 }, async () => {
  await withIsolatedAuthDatabase(async admin => {
    const isolated = new URL(process.env.DATABASE_URL!);
    assert(isolated.searchParams.get("host")?.includes("amal-auth-security-"),
      "Child tests require the helper's disposable Unix socket");
    const { seedFingerprint } = await import("../../../scripts/src/operational-support");
    const seedsBefore = await seedFingerprint(admin);
    const suites = [
      "kpis-api.test.ts",
      "import-validation.test.ts",
      "import-db.test.ts",
      "import-merge-boundary.test.ts",
      "merge-identity.test.ts",
      "merge-db.test.ts",
      "adoption-api.test.ts",
      "sync-api.test.ts",
      "security-routes-validation.test.ts",
      "security-routes-scope.test.ts",
      "security-routes-bounds.test.ts",
    ];
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "test", LOG_LEVEL: "silent", REPLIT_DEPLOYMENT: "0", AMAL_DEVELOPER_TOOLS: "0",
      AUTH_ALLOWED_ORIGINS: "http://lookup.test,http://import-boundary.test,http://adoption.test,http://sync-test.local",
      AUTH_PROXY_HOPS: "0",
      // Functional regressions are not a rate-limit load test. Shared counters
      // persist across child processes, so give this isolated run explicit room.
      SECURITY_RATE_GENERAL: "100000", SECURITY_RATE_LOOKUP: "10000",
      SECURITY_RATE_EXPENSIVE: "10000", SECURITY_RATE_SYNC: "10000",
    };
    // A nested Node test runner must not inherit the parent's worker protocol.
    delete env.NODE_TEST_CONTEXT;
    try {
      const output = execFileSync(process.execPath, [
        "--import", "tsx", "--test", "--test-reporter=spec", "--test-concurrency=1",
        ...suites.map(name => new URL(name, import.meta.url).pathname),
      ], {
        cwd: new URL("../", import.meta.url).pathname,
        env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        timeout: 210_000, maxBuffer: 2 * 1024 * 1024,
      });
      assert.match(output, /tests\s+\d+/, "Nested test runner must report actually executed child tests");
      console.log(output);
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string };
      if (failure.stdout) console.log(failure.stdout);
      if (failure.stderr) console.error(failure.stderr);
      throw new Error("Focused isolated route regression child failed; see test assertions above");
    } finally {
      assert.equal(await seedFingerprint(admin), seedsBefore,
        "All six cloned source tables, schema and protection metadata must remain unchanged");
      console.log("All six cloned source tables: content/schema/protection fingerprint unchanged.");
    }
  });
});
