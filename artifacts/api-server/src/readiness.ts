import pg from "pg";
import { runtimeConnectionString } from "@workspace/db/runtime-connection";

/**
 * Separate operator readiness command; never imported by server startup.
 * Reads through the restricted login, with no migration, population or repair.
 * SELECT ... LIMIT 0 checks core schema/read authority without reading records.
 * This is not a full migration/authorization or application-readiness audit.
 */
async function main() {
  const deadline = setTimeout(() => {
    process.stdout.write('{"database":"unavailable"}\n');
    process.exit(1);
  }, 5000);
  let client: pg.Client | undefined;
  let ready = false;
  try {
    client = new pg.Client({
      connectionString: runtimeConnectionString(),
      connectionTimeoutMillis: 1500,
      query_timeout: 1500,
      statement_timeout: 1500,
      application_name: "amal-readiness",
    });
    // Never emit connection diagnostics, including asynchronous socket errors.
    client.on("error", () => {});
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT id FROM operational.users LIMIT 0");
    await client.query("SELECT * FROM operational.auth_sessions LIMIT 0");
    await client.query("SELECT * FROM operational.auth_throttles LIMIT 0");
    await client.query("ROLLBACK");
    ready = true;
  } catch {
    ready = false;
  } finally {
    try { await client?.end(); } catch { ready = false; }
    clearTimeout(deadline);
  }
  process.stdout.write(JSON.stringify({ database: ready ? "ready" : "unavailable" }) + "\n");
  process.exitCode = ready ? 0 : 1;
}

void main();
