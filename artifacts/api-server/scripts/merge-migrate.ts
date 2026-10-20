import pg from "pg";
import { readFile } from "node:fs/promises";
if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Development migration prohibited in deployment");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const { rows: [ready] } = await client.query("SELECT to_regclass('operational.patient_doctor_access') IS NOT NULL AND to_regclass('operational.import_reviews') IS NOT NULL AS ready");
  if (!ready?.ready) throw new Error("Patient, consent and import prerequisites must already exist");
  await client.query(await readFile(new URL("../../../lib/db/migrations/0008_patient_merge.sql", import.meta.url), "utf8"));
  console.log("Patient merge migration applied");
} finally { await client.end(); }
