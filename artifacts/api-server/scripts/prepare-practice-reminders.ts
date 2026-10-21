import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { scheduleAppointmentReminders, setClinicReminderPreference } from "../src/reminders/lifecycle";
import { extractVisit } from "../src/alerts/service";

async function main() {
  assert(process.argv.includes("--practice") && process.env.NODE_ENV !== "production" && process.env.REPLIT_DEPLOYMENT !== "1");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock_shared(761930)");
    await client.query("SELECT pg_advisory_xact_lock(761910)");
    const prior = await client.query("SELECT 1 FROM operational.audit_log WHERE action='practice.reminders.prepared' LIMIT 1");
    if (!prior.rowCount) {
      const clinics = await client.query("SELECT DISTINCT clinic_id FROM operational.appointments WHERE source_ref LIKE 'practice/%'");
      for (const row of clinics.rows) await setClinicReminderPreference(client, row.clinic_id, true, new Date());
      await client.query("INSERT INTO operational.audit_log(action,detail) VALUES('practice.reminders.prepared','{}')");
    }
    const { rows } = await client.query("SELECT appointment_id FROM operational.appointments WHERE source_ref LIKE 'practice/%' AND scheduled_at>now() AND status='booked'");
    for (const row of rows) await scheduleAppointmentReminders(client, row.appointment_id, new Date());
    await client.query("COMMIT");
    const visits = await client.query(`SELECT DISTINCT v.visit_id FROM operational.patient_visit_history v
      JOIN operational.appointments a ON a.patient_id=v.patient_id WHERE a.source_ref LIKE 'practice/%'`);
    for (const visit of visits.rows) await extractVisit(visit.visit_id);
    console.log("Practice reminders and visit alerts prepared; no external messages sent.");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); await pool.end(); }
}
main().catch(() => { console.error("Practice reminder scheduling failed; no credentials or database details emitted."); process.exitCode = 1; });
