import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { root } from "./seed-source";
import { adminClient, transaction, verifySource } from "./operational-support";

// Explicit, additive SQL only. Never drizzle push against the immutable source schema.
export async function migrate() {
  const client = adminClient();
  await client.connect();
  try {
    await verifySource(client);
    return await transaction(client, async () => {
      await client.query(`CREATE SCHEMA IF NOT EXISTS operational_meta;
        REVOKE ALL ON SCHEMA operational_meta FROM PUBLIC;
        CREATE TABLE IF NOT EXISTS operational_meta.migrations (
          version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
        )`);
      const sql = readFileSync(root + "lib/db/migrations/0001_operational.sql", "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query("SELECT checksum FROM operational_meta.migrations WHERE version='0001'");
      if (existing.rowCount) {
        assert.equal(existing.rows[0].checksum, checksum, "Applied migration changed; add a new migration instead");
        return "Migration already applied; checksum verified.";
      }
      assert.equal((await client.query("SELECT to_regnamespace('operational') AS schema")).rows[0].schema, null,
        "Untracked operational schema exists; refusing to replace it");
      await client.query(sql);
      await client.query("INSERT INTO operational_meta.migrations(version,checksum) VALUES ('0001',$1)", [checksum]);
      return "Operational migration committed; seeds unchanged.";
    });
  } finally { await client.end(); }
}

if (process.argv[1]?.endsWith("/operational-migrate.ts")) console.log(await migrate());
