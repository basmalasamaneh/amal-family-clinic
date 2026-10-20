import pg from "pg";
import { readFile } from "node:fs/promises";

// Development only: managed production migrations are applied by Publish.
if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Development migration prohibited in deployment");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const { rows: [prerequisite] } = await client.query(`SELECT
    to_regclass('operational.appointment_operations') IS NOT NULL
    AND to_regclass('operational.auth_devices') IS NOT NULL
    AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='operational'
      AND table_name='appointments' AND column_name='version') AS ready`);
  if (!prerequisite?.ready) throw new Error("Operational appointment and auth prerequisites must already exist");
  await client.query(await readFile(new URL("../../../lib/db/migrations/0009_sync.sql", import.meta.url), "utf8"));
  console.log("Sync migration applied");
} finally { await client.end(); }
