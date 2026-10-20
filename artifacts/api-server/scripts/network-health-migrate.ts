import pg from "pg";
import { readFile } from "node:fs/promises";

// Development only: managed production schema changes are applied by Publish.
if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Development migration prohibited in deployment");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const { rows: [prerequisite] } = await client.query(`SELECT
    to_regclass('operational.sync_device_operations') IS NOT NULL
    AND to_regclass('operational.sync_conflicts') IS NOT NULL
    AND to_regclass('operational.auth_devices') IS NOT NULL AS ready`);
  if (!prerequisite?.ready) throw new Error("Operational sync and auth prerequisites must already exist");
  await client.query(await readFile(new URL("../../../lib/db/migrations/0013_network_health.sql", import.meta.url), "utf8"));
  console.log("Network health migration applied");
} finally { await client.end(); }
