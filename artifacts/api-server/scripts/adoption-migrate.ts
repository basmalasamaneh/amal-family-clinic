import pg from "pg";
import { readFile } from "node:fs/promises";
if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1")
  throw new Error("Development migration prohibited in deployment");
const client = new pg.Client({connectionString:process.env.DATABASE_URL});
try {
  await client.connect();
  const {rows:[row]}=await client.query(`SELECT to_regclass('operational.patient_doctor_access') IS NOT NULL
    AND to_regclass('operational.patient_consents') IS NOT NULL
    AND to_regclass('operational.audit_log') IS NOT NULL AS ready`);
  if (!row.ready) throw new Error("Completed consent prerequisite required");
  await client.query(await readFile(new URL("../../../lib/db/migrations/0014_adoption.sql",import.meta.url),"utf8"));
  console.log("Adoption migration applied; legacy permissions preserved.");
} finally {await client.end();}
