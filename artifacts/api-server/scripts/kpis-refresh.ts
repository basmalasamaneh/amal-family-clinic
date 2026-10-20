import { refreshKpis } from "../src/kpis/service";
import { pool } from "@workspace/db";

// Internal development backfill, no external refresh/mutation route.
if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Development backfill prohibited in deployment");
const [range, date, clinicId] = process.argv.slice(2);
try {
  const result = await refreshKpis({ range, ...(date ? { date } : {}), ...(clinicId ? { clinicId } : {}) });
  console.log(JSON.stringify({ calculationVersion: result.calculationVersion, generatedAt: result.generatedAt,
    scope: result.scope, before: result.before.period, after: result.after.period }));
} finally { await pool.end(); }
