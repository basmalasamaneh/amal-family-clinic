import assert from "node:assert/strict";
import pg from "pg";
import { populate } from "./demo-populate";
import { requireDemo, transaction, verifySource } from "./operational-support";

export const seedConfirmation = "--confirm=POPULATE-ISOLATED-DEMO";

/** This entry point never defaults to DATABASE_URL and has no reset/migration path. */
export function guardedDemoTarget(args = process.argv.slice(2)) {
  requireDemo(args);
  assert(args.includes(seedConfirmation), "Explicit isolated-demo population confirmation required");
  assert(args.every(arg => arg === "--demo" || arg === seedConfirmation), "Unknown demo population argument");
  const target = process.env.AMAL_DEMO_DATABASE_URL;
  assert(target && process.env.DATABASE_URL, "Separate source and demo database URLs required");
  const demo = new URL(target);
  const source = new URL(process.env.DATABASE_URL);
  assert(["127.0.0.1", "[::1]"].includes(demo.hostname), "Only isolated loopback demo clusters allowed");
  assert(demo.port && demo.port !== "5432" && demo.port !== (source.port || "5432"),
    "Demo cluster requires a non-default port separate from the source");
  assert.match(decodeURIComponent(demo.pathname.slice(1)), /^amal_demo_[a-z0-9_]{8,80}$/, "Only explicitly named disposable demo databases allowed");
  // Reject the source database name even on another host (conservative by design).
  assert.notEqual(decodeURIComponent(demo.pathname), decodeURIComponent(source.pathname), "Source database prohibited");
  // pg gives query-string host/port/database credentials precedence over the
  // authority. A literal loopback authority alone would not enforce isolation.
  assert.equal(demo.search, "", "Connection query overrides prohibited");
  assert.equal(demo.hash, "", "Connection fragments prohibited");
  return target;
}

/** Shared transactional P1-01 population, executed with its existing restricted allowlist. */
export async function populateGuarded(client: pg.Client) {
  return transaction(client, async () => {
    await client.query("SET LOCAL ROLE amal_reset_login");
    await verifySource(client);
    const counts = await populate(client, { restrictedReset: true });
    await client.query("RESET ROLE");
    return counts;
  });
}

export async function runGuardedSeed(args = process.argv.slice(2)) {
  const connectionString = guardedDemoTarget(args);
  const expected = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  const client = new pg.Client({ connectionString, application_name: "amal-guarded-demo-population" });
  try {
    await client.connect();
    const { rows: [identity] } = await client.query(`SELECT current_database() AS name,
      pg_is_in_recovery() AS recovery,
      shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()`);
    assert.equal(identity.name, expected, "Unexpected connected database");
    assert.equal(identity.recovery, false, "Recovery target prohibited");
    assert.equal(identity.marker, "AMAL_ISOLATED_DEMO_ONLY", "Database must be explicitly marked as isolated demo");
    return await populateGuarded(client);
  } finally { await client.end(); }
}

if (process.argv[1]?.endsWith("/security-demo-seed.ts")) {
  try {
    const counts = await runGuardedSeed();
    console.log(JSON.stringify({ demoPopulation: "committed", counts, sourceUnchanged: true }));
  } catch {
    console.error("Guarded demo population refused or rolled back; no database diagnostics or credentials emitted.");
    process.exitCode = 1;
  }
}
