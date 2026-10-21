import { dispatchDueReminders } from "../src/reminders/dispatcher";
import { pool } from "@workspace/db";
try {
  const result = await dispatchDueReminders({
    now: new Date(process.argv[2]!), ...(process.argv[3] ? { limit: Number(process.argv[3]) } : {}),
  });
  process.stdout.write(JSON.stringify(result));
} finally { await pool.end(); }
