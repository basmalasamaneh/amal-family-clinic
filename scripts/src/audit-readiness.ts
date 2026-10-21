/**
 * Read-only audit evidence. No source rows, credentials or personal data emitted.
 * Run with: pnpm --filter @workspace/scripts exec tsx src/audit-readiness.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import pg from "pg";
import { runtimeConnectionString } from "@workspace/db/runtime-connection";
import { baseline } from "./baseline";
import { tables } from "./seed-source";

const client = new pg.Client({ connectionString: runtimeConnectionString() });
try {
  await client.connect();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL statement_timeout = '10s'");
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  const fingerprints = [];
  for (const table of tables) {
    // Identifiers come solely from the checked-in immutable seed allowlist.
    const { rows: [row] } = await client.query(`
      SELECT count(*)::integer AS count,
        md5(string_agg(row_to_json(t)::text, E'\\n' ORDER BY row_to_json(t)::text)) AS content
      FROM public.${table.name} t`);
    assert.equal(row.count, table.count, `Seed count mismatch: ${table.name}`);
    const { rows: columns } = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_schema='public' AND table_name=$1
      ORDER BY ordinal_position`, [table.name]);
    fingerprints.push({ table: table.name, ...row,
      schema: createHash("sha256").update(JSON.stringify(columns)).digest("hex") });
  }
  const utc = await baseline(client);
  await client.query("SET LOCAL TIME ZONE 'America/Los_Angeles'");
  assert.deepEqual(await baseline(client), utc, "Source baseline depends on connection timezone");
  assert.equal(utc.Q09?.length, 24);
  assert(utc.Q09?.every(row => row.requires_manual_review), "Every export row requires identity review");
  const { rows: [readiness] } = await client.query(`
    SELECT to_regclass('operational_meta.demo_state') IS NOT NULL AS demo_state,
      to_regclass('operational.users') IS NOT NULL AS users,
      to_regclass('operational.appointments') IS NOT NULL AS appointments`);
  await client.query("ROLLBACK");
  console.log(JSON.stringify({ fingerprints, readiness, exportRowsRequiringReview: 24,
    baselineTimezoneInvariant: true, transaction: "repeatable read, read only" }, null, 2));
} catch {
  // Driver exceptions may contain connection details or source values.
  console.error("Read-only audit readiness failed; no source values emitted.");
  process.exitCode = 1;
} finally {
  await client.end();
}
