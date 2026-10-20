import pg from "pg";
import { readFile } from "node:fs/promises";
import { normalizeName } from "@workspace/db/patient-search";

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Development migration prohibited in deployment");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const { rows: [ready] } = await client.query("SELECT to_regclass('operational.auth_sessions') IS NOT NULL AND to_regclass('operational.patients') IS NOT NULL AS ready");
  if (!ready?.ready) throw new Error("Operational/auth prerequisites must already exist");
  await client.query(await readFile(new URL("../../../lib/db/migrations/0004_patients.sql", import.meta.url), "utf8"));
  await client.query("BEGIN");
  // Lock writers while reconciling derived values. Never change display or seed data.
  await client.query("LOCK TABLE operational.patients IN SHARE ROW EXCLUSIVE MODE");
  const { rows } = await client.query("SELECT patient_id,patient_name,name_normalized FROM operational.patients");
  for (const row of rows) {
    const name = normalizeName(row.patient_name);
    if (name !== row.name_normalized) await client.query("UPDATE operational.patients SET name_normalized=$2 WHERE patient_id=$1", [row.patient_id, name]);
  }
  await client.query("COMMIT");
  console.log("Patient migration and derived-name backfill applied");
} finally { await client.end(); }
