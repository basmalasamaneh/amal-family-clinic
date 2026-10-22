import pg from "pg";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { seedFingerprint } from "../../../scripts/src/operational-support";

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1")
  throw new Error("Development migration prohibited in deployment");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const sql = await readFile(new URL("../../../lib/db/migrations/0019_clinical_authoring.sql", import.meta.url), "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock_shared(761930)");
    await client.query("SELECT pg_advisory_xact_lock(160005)");
    const before = await seedFingerprint(client);
    const existing = await client.query("SELECT checksum FROM operational_meta.migrations WHERE version='0019'");
    if (existing.rowCount) assert.equal(existing.rows[0].checksum, checksum, "Applied clinical migration changed");
    else {
      await client.query(sql);
      await client.query("INSERT INTO operational_meta.migrations(version,checksum) VALUES('0019',$1)", [checksum]);
    }
    assert.equal(await seedFingerprint(client), before, "Seed fingerprint changed; rolling back");
    await client.query("COMMIT");
    console.log(`Clinical migration verified; six seed schema/content/protection fingerprints unchanged (${before}).`);
  } catch (error) { await client.query("ROLLBACK"); throw error; }
} finally { await client.end(); }
