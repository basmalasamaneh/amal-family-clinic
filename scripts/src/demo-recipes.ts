import assert from "node:assert/strict";
import pg from "pg";
import { runtimeConnectionString } from "@workspace/db/runtime-connection";
import { baseline } from "./baseline";

// Read-only scenario inputs, not a booking engine, sync processor or consent bypass.
export async function demoRecipes(client: pg.Client) {
  const observations = await baseline(client);
  const story = (await client.query(`SELECT v.visit_id,v.patient_id,v.clinic_id,v.doctor_id,c.network_mode
    FROM operational.patient_visit_history v JOIN operational.clinics c USING(clinic_id)
    WHERE v.patient_id=15 AND v.diagnosis_notes ILIKE '%dizziness%'`)).rows;
  assert.equal(story.length, 1);
  const receiver = story[0]!;
  const device = (await client.query(`SELECT id FROM operational.devices
    WHERE clinic_id=$1 ORDER BY id LIMIT 1`, [receiver.clinic_id])).rows[0];
  assert(device);
  const existing = (await client.query(`SELECT * FROM operational.appointments
    WHERE doctor_id=$1 AND status IN ('booked','double_booked')
    ORDER BY scheduled_at,appointment_id LIMIT 1`, [receiver.doctor_id])).rows[0];
  assert(existing, "Outage conflict recipe needs an active appointment");
  const patients = (await client.query("SELECT patient_id FROM operational.patients WHERE merged_into_id IS NULL ORDER BY patient_id LIMIT 3")).rows;
  assert.equal(patients.length, 3);
  const future = (await client.query(`SELECT
    ((max(scheduled_at) AT TIME ZONE 'Asia/Hebron')::date+7+time '10:00') AT TIME ZONE 'Asia/Hebron' AS start
    FROM operational.appointments`)).rows[0].start as Date;
  const operations = [0, 1, 2].map(i => ({
    client_op_id: `demo.outage.${i + 1}`,
    clinic_id: receiver.clinic_id,
    device_id: device.id,
    type: "appointment.create",
    expected_outcome: i < 2 ? "applied" : "conflict",
    payload: {
      doctor_id: receiver.doctor_id, patient_id: patients[i]!.patient_id,
      scheduled_at: i < 2 ? new Date(future.getTime() + i * 60 * 60_000).toISOString() : (existing.scheduled_at as Date).toISOString(),
      duration_minutes: 30, booking_method: "amal_network",
    },
  }));
  return {
    message_key: "demo.recipes.notExecuted",
    doctor_collisions: observations.Q03,
    cross_clinic_collisions: observations.Q04,
    clinical_story: {
      ...receiver, required_network_mode: "full", current_mode: receiver.network_mode,
      consent_fixture_key: "demo.reem.clinical", alert_fixture_key: "demo.reem.medication",
    },
    outage: { operations, conflicts_with_appointment: existing.appointment_id, required_working_hours: "10:00-11:30", note_key: "demo.outage.useIsolatedWorkingDay" },
    calendar: { total: 24, automatic_patient_links: 0, review_required: 24 },
    duplicate_fixture_key: "demo.distinctSameName",
    guardian_fixture_key: "demo.minor.guardian",
    onboarding: { clinic_id: receiver.clinic_id, initial_network_mode: "lite", upgrade_requires_explicit_choice: true },
  };
}
if (process.argv[1]?.endsWith("/demo-recipes.ts")) {
  const client = new pg.Client({ connectionString: runtimeConnectionString() });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    console.log(JSON.stringify(await demoRecipes(client), null, 2));
    await client.query("COMMIT");
  } finally { await client.end(); }
}
