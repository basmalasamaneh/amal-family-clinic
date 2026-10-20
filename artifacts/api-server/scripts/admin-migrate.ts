import pg from "pg";
import { readFile } from "node:fs/promises";

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Development migration prohibited in deployment");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const { rows: [row] } = await client.query(`SELECT
    to_regclass('operational.users') IS NOT NULL
    AND to_regclass('operational.doctors') IS NOT NULL
    AND to_regclass('operational.auth_sessions') IS NOT NULL
    AND to_regclass('operational.auth_devices') IS NOT NULL
    AND to_regclass('operational.audit_log') IS NOT NULL AS ready`);
  if (!row?.ready) throw new Error("Operational core and authentication prerequisites must already exist");
  await client.query(await readFile(new URL("../../../lib/db/migrations/0011_admin.sql", import.meta.url), "utf8"));
  console.log("Administration migration applied");
} finally { await client.end(); }
