import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import pg from "pg";
import { dbValue, readSource, tables } from "./seed-source";

export const operationalLock = 761901;
export const operationalTables = [
  "clinics", "doctors", "users", "devices", "patients", "appointments",
  "patient_visit_history", "patient_consents", "visit_alerts", "audit_log",
  "sync_operations", "import_batches", "import_rows", "patient_merge_candidates",
  "notifications", "kpi_snapshots",
] as const;

export function adminClient() {
  assert(process.env.DATABASE_URL, "Provisioned database required");
  return new pg.Client({ connectionString: process.env.DATABASE_URL });
}

export function requireDemo(args = process.argv.slice(2)) {
  assert(args.includes("--demo"), "Demo-only command requires --demo");
  assert(process.env.NODE_ENV !== "production", "Demo commands prohibited: NODE_ENV production");
  assert(process.env.REPLIT_DEPLOYMENT !== "1", "Demo commands prohibited: active deployment");
  // REPLIT_ENVIRONMENT may describe platform infrastructure even in a workspace.
  // REPLIT_DEPLOYMENT is the documented published-app indicator.
}

export async function lockOperational(client: pg.Client) {
  // Also excludes ordinary app writes during allocation/reset, not just other demo scripts.
  await client.query(`LOCK TABLE ${operationalTables.map(t => `operational.${t}`).join(",")}
    IN SHARE ROW EXCLUSIVE MODE`);
}

/** Validate the prerequisite, never initialize or repair it. */
export async function verifySource(client: pg.Client) {
  const source = readSource();
  for (const t of tables) {
    const columns = await client.query(`SELECT column_name, data_type
      FROM information_schema.columns WHERE table_schema='public' AND table_name=$1
      ORDER BY ordinal_position`, [t.name]);
    assert.deepEqual(columns.rows, t.columns.map(c => ({
      column_name: c.name, data_type: c.type === "timestamptz" ? "timestamp with time zone" : c.type,
    })), `Prerequisite schema mismatch: ${t.name}`);
    const expressions = t.columns.map(c => c.type === "date" ? `${c.name}::text AS ${c.name}` : c.name);
    const actual = await client.query(`SELECT ${expressions.join(",")} FROM public.${t.name} ORDER BY ${t.columns[0]!.name}`);
    const expected = [...source[t.name]!.rows].sort((a, b) => Number(a[0]) - Number(b[0]));
    assert.deepEqual(actual.rows.map(r => t.columns.map(c =>
      c.type === "timestamptz" ? (r[c.name] as Date).toISOString() : r[c.name])),
    expected.map(row => row.map((v, i) => dbValue(t.columns[i]!.type, v))), `Prerequisite content mismatch: ${t.name}`);
    assert.deepEqual((await client.query(`SELECT pg_get_userbyid(c.relowner) owner, t.tgenabled
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_trigger t ON t.tgrelid=c.oid AND t.tgname='immutable_seed'
      WHERE n.nspname='public' AND c.relname=$1`, [t.name])).rows,
    [{ owner: "amal_seed_owner", tgenabled: "A" }], `Prerequisite protection missing: ${t.name}`);
  }
}

/** Includes schema, ACLs, ownership, indexes, triggers and content, not just counts. */
export async function seedFingerprint(client: pg.Client) {
  const evidence = [];
  for (const t of tables) {
    const relation = `public.${t.name}`;
    evidence.push({
      table: t.name,
      rows: (await client.query(`SELECT jsonb_build_array(${t.columns.map(c =>
        c.type === "timestamptz" ? `extract(epoch FROM ${c.name})` : c.name
      ).join(",")}) AS row FROM ${relation} ORDER BY ${t.columns[0]!.name}`)).rows,
      columns: (await client.query(`SELECT attname, atttypid, atttypmod, attnotnull, attidentity
        FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum`, [relation])).rows,
      metadata: (await client.query(`SELECT relowner, relacl, relrowsecurity FROM pg_class WHERE oid=$1::regclass`, [relation])).rows,
      constraints: (await client.query(`SELECT conname, pg_get_constraintdef(oid) definition
        FROM pg_constraint WHERE conrelid=$1::regclass ORDER BY conname`, [relation])).rows,
      indexes: (await client.query(`SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1 ORDER BY indexname`, [t.name])).rows,
      triggers: (await client.query(`SELECT pg_get_triggerdef(oid) definition,tgenabled
        FROM pg_trigger WHERE tgrelid=$1::regclass ORDER BY tgname`, [relation])).rows,
    });
  }
  return createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
}

export async function operationalCounts(client: pg.Client) {
  const counts: Record<string, number> = {};
  for (const table of operationalTables) {
    counts[table] = Number((await client.query(`SELECT count(*) n FROM operational.${table}`)).rows[0].n);
  }
  return counts;
}

export async function transaction<T>(client: pg.Client, fn: () => Promise<T>) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock($1)", [operationalLock]);
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const before = await seedFingerprint(client);
    const result = await fn();
    assert.equal(await seedFingerprint(client), before, "Seeds changed; rolling back");
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
