import assert from "node:assert/strict";
import type pg from "pg";
import { baseline } from "./baseline";
import { fixtureInstant, minorAsOf, normalizeName, populateFixtures } from "./demo-fixtures";
import { adminClient, lockOperational, operationalCounts, requireDemo, transaction, verifySource } from "./operational-support";

/** Shared entry point for initial population, rerun and reset, in caller's locked transaction. */
export async function populate(client: pg.Client) {
  await lockOperational(client);
  const observations = await baseline(client);
  const mapping = new Map<number, string>();
  for (const row of observations.Q08!) {
    assert.equal(Number(row.candidate_count), 1, "Unverified doctor mapping");
    mapping.set(row.doctor_ids[0], row.doctor_email);
  }
  // The onboarding clinic is selected from the safety-story source visit, not a clinic ID/name.
  const lite = (await client.query(`SELECT DISTINCT clinic_id FROM public.patient_visit_history
    WHERE patient_id=15 AND diagnosis_notes ILIKE '%dizziness%'`)).rows;
  assert.equal(lite.length, 1, "Onboarding fixture clinic provenance is ambiguous");
  await client.query(`INSERT INTO operational.clinics
    (clinic_id,clinic_name,city,booking_method,network_mode,joined_at)
    SELECT clinic_id,clinic_name,city,booking_method,
      (CASE WHEN clinic_id=$1 THEN 'lite' ELSE 'full' END)::operational.network_mode,$2 FROM public.clinics
    ON CONFLICT (clinic_id) DO NOTHING`, [lite[0].clinic_id, fixtureInstant]);
  const newDoctors: number[] = [];
  for (const doctor of (await client.query("SELECT * FROM public.doctors ORDER BY doctor_id")).rows) {
    const result = await client.query(`INSERT INTO operational.doctors
      (doctor_id,doctor_name,clinic_id,specialty,email)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT (doctor_id) DO NOTHING RETURNING doctor_id`,
    [doctor.doctor_id, doctor.doctor_name, doctor.clinic_id, doctor.specialty,
      mapping.get(doctor.doctor_id) ?? `doctor.${doctor.doctor_id}@amal-demo.example`]);
    if (result.rowCount) newDoctors.push(doctor.doctor_id);
  }
  for (const patient of (await client.query("SELECT *,dob::text AS birth_date FROM public.patients ORDER BY patient_id")).rows) {
    await client.query(`INSERT INTO operational.patients
      (patient_id,patient_name,phone,dob,name_normalized,minor_as_of)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (patient_id) DO NOTHING`,
    [patient.patient_id, patient.patient_name, patient.phone, patient.birth_date, normalizeName(patient.patient_name), minorAsOf]);
  }
  await client.query(`INSERT INTO operational.appointments
    (appointment_id,clinic_id,doctor_id,patient_id,scheduled_at,booking_method,status,
     duration_minutes,source_ref,conflict_state,created_at,updated_at)
    SELECT appointment_id,clinic_id,doctor_id,patient_id,scheduled_at,booking_method,status,30,
      'public.appointments/'||appointment_id,
      (CASE WHEN status='double_booked' THEN 'flagged' ELSE 'none' END)::operational.conflict_state,$1,$1
    FROM public.appointments ON CONFLICT (appointment_id) DO NOTHING`, [fixtureInstant]);
  await client.query(`INSERT INTO operational.patient_visit_history
    (visit_id,patient_id,clinic_id,doctor_id,visit_date,diagnosis_notes)
    SELECT visit_id,patient_id,clinic_id,doctor_id,visit_date,diagnosis_notes
    FROM public.patient_visit_history ON CONFLICT (visit_id) DO NOTHING`);
  // PostgreSQL setval is nontransactional: ALTER SEQUENCE RESTART is transactional.
  // Never move a sequence backwards on reruns, even after operational deletes.
  for (const [table, key] of [
    ["clinics", "clinic_id"], ["doctors", "doctor_id"], ["patients", "patient_id"],
    ["appointments", "appointment_id"], ["patient_visit_history", "visit_id"],
  ]) {
    const sequence = (await client.query("SELECT pg_get_serial_sequence($1,$2) name", [`operational.${table}`, key])).rows[0].name as string;
    assert.match(sequence, /^operational\.[a-z_]+$/);
    const state = (await client.query(`SELECT last_value::integer,is_called FROM ${sequence}`)).rows[0];
    const max = Number((await client.query(`SELECT coalesce(max(${key}),0) n FROM operational.${table}`)).rows[0].n);
    const next = Math.max(max + 1, Number(state.last_value) + (state.is_called ? 1 : 0));
    await client.query(`ALTER SEQUENCE ${sequence} RESTART WITH ${next}`);
  }
  await populateFixtures(client, newDoctors);
  // Optional consent-service authority metadata must survive the existing
  // reset/populate lifecycle. Only immutable source identities establish links.
  // This adds no seed writes or reset exception.
  for (const kind of ["clinic", "doctor"] as const) {
    const table = `patient_${kind}_access`;
    const { rows: [present] } = await client.query("SELECT to_regclass($1) IS NOT NULL AS ready", [`operational.${table}`]);
    if (!present.ready) continue;
    const columns = kind === "doctor" ? "patient_id,clinic_id,doctor_id" : "patient_id,clinic_id";
    await client.query(`INSERT INTO operational.${table} (${columns})
      SELECT DISTINCT ${kind === "doctor" ? "s.patient_id,s.clinic_id,s.doctor_id" : "s.patient_id,s.clinic_id"}
      FROM (
        SELECT patient_id,clinic_id,doctor_id FROM public.appointments
        UNION SELECT patient_id,clinic_id,doctor_id FROM public.patient_visit_history
      ) s
      JOIN operational.patients p ON p.patient_id=s.patient_id
      JOIN operational.doctors d ON d.doctor_id=s.doctor_id AND d.clinic_id=s.clinic_id
      ON CONFLICT DO NOTHING`);
  }
  return operationalCounts(client);
}

export async function runPopulation() {
  requireDemo();
  const client = adminClient();
  await client.connect();
  try {
    await verifySource(client);
    return await transaction(client, () => populate(client));
  } finally { await client.end(); }
}
if (process.argv[1]?.endsWith("/demo-populate.ts")) console.log(await runPopulation());
