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
  // Serialize the explicit whole-demo reset with appointment/sync writers.
  await client.query("SELECT pg_advisory_xact_lock(761910)");
  await client.query("SET CONSTRAINTS ALL DEFERRED");
  await client.query("SET LOCAL ROLE amal_demo_reset");
  // Optional service children must precede their users/appointments/patients.
  // Keep the explicit reset compatible before or after the additive service
  // migrations; operational:test exercises this only in a rollback transaction.
  for (const table of [
    "sync_resolution_history", "sync_device_operations", "sync_conflicts",
    "appointment_holds", "appointment_operations", "patient_create_receipts", "patient_clinic_access",
  ] as const) {
    const { rows: [present] } = await client.query("SELECT to_regclass($1) IS NOT NULL AS ready", [`operational.${table}`]);
    if (present.ready) await client.query(`DELETE FROM operational.${table}`);
  }
  for (const table of deleteOrder) await client.query(`DELETE FROM operational.${table}`);
  // The reset role suppresses only its appointment DELETE feed triggers.
  // Remove the old feed after all referenced operational entities are gone.
  const { rows: [feed] } = await client.query("SELECT to_regclass('operational.sync_changes') IS NOT NULL AS ready");
  if (feed.ready) await client.query("DELETE FROM operational.sync_changes");
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
