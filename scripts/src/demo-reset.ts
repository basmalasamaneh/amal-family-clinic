import assert from "node:assert/strict";
import type pg from "pg";
import { populate } from "./demo-populate";
import { adminClient, lockOperational, requireDemo, transaction, verifySource } from "./operational-support";

export const resetConfirmation = "--confirm=RESET-OPERATIONAL-DEMO-DATA";
// Explicit child-first allowlist; no CASCADE, schema drops, TRUNCATE or public targets.
const deleteOrder = [
  "notifications", "import_rows", "import_batches", "sync_operations", "audit_log",
  "visit_alerts", "patient_consents", "patient_merge_candidates", "kpi_snapshots",
  "appointments", "patient_visit_history", "devices", "users", "doctors", "patients", "clinics",
] as const;

export async function clearOperational(client: pg.Client) {
  await lockOperational(client);
  await client.query("SET CONSTRAINTS ALL DEFERRED");
  await client.query("SET LOCAL ROLE amal_demo_reset");
  for (const table of deleteOrder) await client.query(`DELETE FROM operational.${table}`);
  await client.query("RESET ROLE");
}

export async function runReset() {
  requireDemo();
  assert(process.argv.includes(resetConfirmation),
    `Reset deletes ALL operational demo edits and audit data. Confirm with ${resetConfirmation}`);
  const client = adminClient();
  await client.connect();
  try {
    await verifySource(client);
    return await transaction(client, async () => {
      await clearOperational(client);
      return populate(client);
    });
  } finally { await client.end(); }
}
if (process.argv[1]?.endsWith("/demo-reset.ts")) console.log(await runReset());
