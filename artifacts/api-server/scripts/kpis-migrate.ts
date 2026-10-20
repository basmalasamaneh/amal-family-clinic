import pg from "pg";
import { readFile } from "node:fs/promises";

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Development migration prohibited in deployment");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const { rows: [row] } = await client.query(`SELECT
    to_regclass('operational.sync_resolution_history') IS NOT NULL
    AND to_regclass('operational.kpi_snapshots') IS NOT NULL AS ready`);
  if (!row?.ready) throw new Error("Appointment/sync and snapshot prerequisites must already exist");
  await client.query(await readFile(new URL("../../../lib/db/migrations/0010_kpis.sql", import.meta.url), "utf8"));
  console.log("KPI migration applied");
} finally { await client.end(); }
