import assert from "node:assert/strict";
import pg from "pg";
import { resetConnectionString } from "@workspace/db/reset-connection";
import { populate } from "./demo-populate";
import { lockOperational, requireDemo, transaction, verifySource } from "./operational-support";

export const resetConfirmation = "--confirm=RESET-OPERATIONAL-DEMO-DATA";
// Explicit child-first allowlist; no CASCADE, schema drops, TRUNCATE or public targets.
export const deleteOrder = [
  "notifications", "import_rows", "import_batches", "sync_operations", "audit_log",
  "visit_alerts", "patient_consents", "patient_merge_candidates", "kpi_snapshots",
  "patient_visit_history", "appointments", "devices", "users", "doctors", "patients", "clinics",
] as const;

export async function clearOperational(client: pg.Client) {
  await client.query("SELECT pg_advisory_xact_lock(761930)");
  await client.query("SELECT pg_advisory_xact_lock(160005)");
  await lockOperational(client);
  // Serialize the explicit whole-demo reset with appointment/sync writers.
  await client.query("SELECT pg_advisory_xact_lock(761910)");
  await client.query("SET CONSTRAINTS ALL DEFERRED");
  await client.query("SET LOCAL ROLE amal_demo_reset");
  // Optional service children must precede their users/appointments/patients.
  // Keep the explicit reset compatible before or after the additive service
  // migrations; operational:test exercises this only in a rollback transaction.
  for (const table of [
    "clinical_write_operations", "visit_addenda",
    "network_coordinator_scope", "developer_outages", "clinic_managers", "device_network_health",
    "auth_sessions", "auth_devices", "auth_pin_state", "auth_throttles",
    "import_reviews", "import_operations", "import_source_links",
    "patient_merge_moves", "patient_merge_operations", "consent_operations",
    "patient_doctor_access",
    "sync_resolution_history", "sync_device_operations", "sync_conflicts",
    "appointment_holds", "appointment_operations", "patient_create_receipts", "patient_clinic_access",
  ] as const) {
    const { rows: [present] } = await client.query("SELECT to_regclass($1) IS NOT NULL AS ready", [`operational.${table}`]);
    if (present.ready) await client.query(`DELETE FROM operational.${table}`);
  }
  // Waitlist history remains immutable to runtime callers. The existing,
  // explicitly authorized whole-demo reset clears its operational records only.
  const { rows: [waitlist] } = await client.query("SELECT to_regclass('operational.waitlist_entries') IS NOT NULL AS ready");
  if (waitlist.ready) {
    await client.query("DELETE FROM operational.notifications WHERE waitlist_offer_id IS NOT NULL");
    for (const table of ["waitlist_transitions", "waitlist_operations", "waitlist_offers", "waitlist_opportunities", "waitlist_entries"]) {
      await client.query(`DELETE FROM operational.${table}`);
    }
  }
  // Adoption's left_by references users and is intentionally not cascading.
  const { rows: [adoption] } = await client.query(`SELECT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='operational'
    AND table_name='clinics' AND column_name='left_by') AS ready`);
  if (adoption.ready) await client.query(`UPDATE operational.clinics
    SET left_by=NULL,left_at=NULL,membership_status='active',adoption_state=network_mode::text`);
  for (const table of deleteOrder) await client.query(`DELETE FROM operational.${table}`);
  // The reset role suppresses only its appointment DELETE feed triggers.
  // Remove the old feed after all referenced operational entities are gone.
  const { rows: [feed] } = await client.query("SELECT to_regclass('operational.sync_changes') IS NOT NULL AS ready");
  if (feed.ready) await client.query("DELETE FROM operational.sync_changes");
  await client.query("RESET ROLE");
}

export async function runReset() {
  requireDemo();
  assert.equal(process.env.AMAL_DEVELOPER_TOOLS, "1", "Reset requires AMAL_DEVELOPER_TOOLS=1");
  assert(process.argv.includes(resetConfirmation),
    `Reset deletes ALL operational demo edits and audit data. Confirm with ${resetConfirmation}`);
  const client = new pg.Client({ connectionString: resetConnectionString() });
  await client.connect();
  try {
    await verifySource(client);
    return await transaction(client, async () => {
      await clearOperational(client);
      const counts = await populate(client, { restrictedReset: true });
      // CLI resets also fence returning/offline browsers. This state is never
      // part of clearOperational's allowlist.
      await client.query(`UPDATE operational_meta.demo_state
        SET generation=gen_random_uuid(),changed_at=clock_timestamp() WHERE singleton`);
      return counts;
    });
  } finally { await client.end(); }
}
if (process.argv[1]?.endsWith("/demo-reset.ts")) console.log(await runReset());
