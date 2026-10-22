import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { withIsolatedAuthDatabase } from "./helpers/auth-isolated";

test("patient collision regressions use a disposable database only", { timeout: 240_000 }, async () => {
  await withIsolatedAuthDatabase(async () => {
    const env = { ...process.env, NODE_ENV: "test", LOG_LEVEL: "silent",
      SECURITY_RATE_GENERAL: "100000", SECURITY_RATE_LOOKUP: "10000",
      SECURITY_RATE_EXPENSIVE: "10000", SECURITY_RATE_SYNC: "10000" };
    delete env.NODE_TEST_CONTEXT;
    try {
      console.log(execFileSync(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1",
        ...["appointments-engine", "appointments-api", "merge-identity", "sync-api"].map(
          name => new URL(`${name}.test.ts`, import.meta.url).pathname)], {
        env, encoding: "utf8", timeout: 210000, maxBuffer: 4 * 1024 * 1024,
      }));
    } catch (error) {
      console.log((error as { stdout?: string }).stdout);
      throw error;
    }
  });
});
