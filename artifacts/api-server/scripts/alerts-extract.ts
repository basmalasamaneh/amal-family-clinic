import { pool } from "@workspace/db";
import { backfillAlerts, extractVisit, initializeAlerts, ExtractionError } from "../src/alerts/service";
try {
  const [mode, value, limit] = process.argv.slice(2);
  if (mode === "--initialize" && !value) console.log(await initializeAlerts());
  else if (mode === "--visit" && value && !limit) console.log({ flags: await extractVisit(Number(value)) });
  else if (mode === "--backfill") console.log(await backfillAlerts(Number(value ?? 0), Number(limit ?? 100)));
  else throw new ExtractionError("alerts.error.invalidInput");
} catch (error) {
  // Never serialize SQL errors, source text, credentials or clinical parameters.
  console.error({ messageKey: error instanceof ExtractionError ? error.messageKey : "alerts.error.failed" });
  process.exitCode = 1;
} finally { await pool.end(); }
