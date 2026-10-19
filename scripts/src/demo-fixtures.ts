import assert from "node:assert/strict";
import type pg from "pg";
import { hash } from "bcryptjs";
import { fromZonedTime } from "date-fns-tz";
import { baseline } from "./baseline";
import { sourceHash, zone } from "./seed-source";

// Deliberately public, synthetic, non-production demo credentials. No real secrets.
export const demoPassword = "Amal-Demo-Only-2026!";
export const demoPin = "2468";
export const fixtureInstant = fromZonedTime("2026-09-08T08:00:00", zone).toISOString();
export const minorAsOf = "2026-09-08";

export function normalizeName(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/ـ/g, "").trim().replace(/\s+/g, " ").toLowerCase();
}

async function account(client: pg.Client, fixtureKey: string, email: string,
  role: string, clinicId: number | null, doctorId: number | null) {
  const existing = await client.query("SELECT id FROM operational.users WHERE fixture_key=$1", [fixtureKey]);
  if (existing.rowCount) return existing.rows[0].id as number;
  const passwordHash = await hash(demoPassword, 12);
  const pinHash = role === "receptionist" ? await hash(demoPin, 12) : null;
  const result = await client.query(`INSERT INTO operational.users
    (fixture_key,email,password_hash,role,clinic_id,doctor_id,pin_hash)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [fixtureKey,email,passwordHash,role,clinicId,doctorId,pinHash]);
  return result.rows[0].id as number;
}

/** Called only under the population transaction/advisory lock. Never updates an existing fixture. */
export async function populateFixtures(client: pg.Client, newDoctorIds: number[]) {
  const clinics = (await client.query("SELECT * FROM public.clinics ORDER BY clinic_id")).rows;
  const doctors = (await client.query("SELECT * FROM public.doctors ORDER BY doctor_id")).rows;
  await account(client, "demo.admin", "admin@amal-demo.example", "administrator", null, null);
  for (const doctor of doctors) {
    const userId = await account(client, `demo.doctor.${doctor.doctor_id}`,
      `doctor.${doctor.doctor_id}@amal-demo.example`, "doctor", doctor.clinic_id, doctor.doctor_id);
    if (newDoctorIds.includes(doctor.doctor_id)) {
      await client.query("UPDATE operational.doctors SET user_id=$1 WHERE doctor_id=$2", [userId, doctor.doctor_id]);
    }
  }
  const reception = new Map<number, number>();
  for (const clinic of clinics) {
    reception.set(clinic.clinic_id, await account(client, `demo.reception.${clinic.clinic_id}`,
      `reception.${clinic.clinic_id}@amal-demo.example`, "receptionist", clinic.clinic_id, null));
    await client.query(`INSERT INTO operational.devices(fixture_key,clinic_id,label,registered_at)
      SELECT $1,$2,'demo.devices.reception',$3 WHERE NOT EXISTS
      (SELECT 1 FROM operational.devices WHERE fixture_key=$1)`,
    [`demo.device.${clinic.clinic_id}`, clinic.clinic_id, fixtureInstant]);
  }

  // This explicit patient ID is a specified demo fixture, never a clinic routing rule.
  const medication = (await client.query(`SELECT * FROM public.patient_visit_history
    WHERE patient_id=15 AND diagnosis_notes ILIKE '%amlodipine%' ORDER BY visit_date,visit_id`)).rows;
  assert.equal(medication.length, 1, "Medication fixture provenance must be unambiguous");
  const visit = medication[0]!;
  assert(reception.has(visit.clinic_id));
  await client.query(`INSERT INTO operational.patient_consents
    (fixture_key,patient_id,level,given_by,given_at,recorded_by_user)
    SELECT 'demo.reem.clinical',15,'clinical','patient',$1,$2
    WHERE NOT EXISTS (SELECT 1 FROM operational.patient_consents WHERE fixture_key='demo.reem.clinical')`,
  [fixtureInstant, reception.get(visit.clinic_id)]);
  await client.query(`INSERT INTO operational.visit_alerts
    (fixture_key,visit_id,patient_id,kind,label,source_note_excerpt)
    SELECT 'demo.reem.medication',$1,15,'medication','demo.alerts.bloodPressureMedication',$2
    WHERE NOT EXISTS (SELECT 1 FROM operational.visit_alerts WHERE fixture_key='demo.reem.medication')`,
  [visit.visit_id, visit.diagnosis_notes]);

  const minor = (await client.query(`SELECT p.patient_id,a.clinic_id
    FROM public.patients p JOIN public.appointments a USING(patient_id)
    WHERE p.dob > $1::date - interval '18 years' ORDER BY p.patient_id,a.appointment_id LIMIT 1`, [minorAsOf])).rows[0];
  assert(minor, "Guardian fixture needs an actual minor");
  await client.query(`INSERT INTO operational.patient_consents
    (fixture_key,patient_id,level,given_by,guardian_name,guardian_relation,given_at,recorded_by_user)
    SELECT 'demo.minor.guardian',$1,'basic','guardian','Synthetic Demo Guardian','parent',$2,$3
    WHERE NOT EXISTS (SELECT 1 FROM operational.patient_consents WHERE fixture_key='demo.minor.guardian')`,
  [minor.patient_id, fixtureInstant, reception.get(minor.clinic_id)]);

  const sameNames = (await client.query(`SELECT a.patient_id a,b.patient_id b FROM public.patients a
    JOIN public.patients b ON a.patient_id<b.patient_id AND a.patient_name=b.patient_name
    WHERE a.dob<>b.dob AND a.phone<>b.phone ORDER BY a.patient_id,b.patient_id`)).rows;
  assert.equal(sameNames.length, 1, "Distinct same-name fixture changed");
  await client.query(`INSERT INTO operational.patient_merge_candidates
    (fixture_key,patient_a,patient_b,score,reason,status)
    SELECT 'demo.distinctSameName',$1,$2,0,'demo.duplicates.differentDobAndPhone','not_a_match'
    WHERE NOT EXISTS (SELECT 1 FROM operational.patient_merge_candidates WHERE fixture_key='demo.distinctSameName')`,
  [sameNames[0]!.a, sameNames[0]!.b]);

  const observations = await baseline(client);
  assert(observations.Q08!.every(r => Number(r.candidate_count) === 1), "Doctor email mapping is ambiguous");
  const clinicIds = [...new Set(observations.Q09!.map(r => r.clinic_id))];
  assert.equal(clinicIds.length, 1, "Calendar batch must have one source clinic");
  assert(clinicIds[0] !== null);
  await client.query(`INSERT INTO operational.import_batches
    (fixture_key,clinic_id,source_name,source_checksum,status,created_at)
    SELECT 'demo.calendar.workbook',$1,'calendar_app_export',$2,'review_required',$3
    WHERE NOT EXISTS (SELECT 1 FROM operational.import_batches WHERE fixture_key='demo.calendar.workbook')`,
  [clinicIds[0], sourceHash, fixtureInstant]);
  const batchId = (await client.query("SELECT id FROM operational.import_batches WHERE fixture_key='demo.calendar.workbook'")).rows[0].id;
  for (const row of observations.Q09!) {
    const suggestions = row.suggested_patient_ids as number[];
    await client.query(`INSERT INTO operational.import_rows
      (batch_id,source_event_id,source_payload,review_state,suggested_patient_id,suggested_doctor_id,confidence)
      SELECT $1,e.event_id,to_jsonb(e),'review_required',$3,$4,$5
      FROM public.calendar_app_export e WHERE e.event_id=$2 AND NOT EXISTS
      (SELECT 1 FROM operational.import_rows WHERE batch_id=$1 AND source_event_id=$2)`,
    [batchId, row.event_id, suggestions.length === 1 ? suggestions[0] : null, row.doctor_id, suggestions.length === 1 ? 0.5 : 0]);
  }
}
