/** Add one owner-approved synthetic history case, without changing existing records. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { addDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { adminClient, requireDemo, seedFingerprint, transaction } from "./operational-support";
import { normalizeName } from "./demo-fixtures";
import { root } from "./seed-source";

async function main() {
  requireDemo();
  const client = adminClient();
  await client.connect();
  try {
    const before = await seedFingerprint(client);
    const result = await transaction(client, async () => {
      await client.query("SELECT pg_advisory_xact_lock_shared(761930)");
      await client.query("SELECT pg_advisory_xact_lock(160005)");
      await client.query("SELECT pg_advisory_xact_lock(761910)");
      const prior = await client.query("SELECT detail FROM operational.audit_log WHERE action='practice.cross-clinic-history.prepared' ORDER BY id DESC LIMIT 1");
      if (prior.rowCount) return prior.rows[0].detail;
      const clinics = (await client.query(`SELECT DISTINCT ON(c.clinic_id)
        c.clinic_id,c.clinic_name,d.doctor_id,d.doctor_name,u.email
        FROM operational.clinics c JOIN operational.doctors d USING(clinic_id)
        JOIN operational.users u ON u.id=d.user_id
        JOIN public.doctors s ON s.doctor_id=d.doctor_id AND s.clinic_id=d.clinic_id
        WHERE c.network_mode='full' AND u.disabled_at IS NULL
        ORDER BY c.clinic_id,d.doctor_id`)).rows;
      assert(clinics.length >= 2, "Two existing Full clinics required; refusing to change membership");
      const selected = clinics.slice(0, 2);
      const home = selected[0]!;
      const recorder = (await client.query(`SELECT id FROM operational.users WHERE
        clinic_id=$1 AND role='receptionist' AND disabled_at IS NULL ORDER BY id LIMIT 1`, [home.clinic_id])).rows[0];
      assert(recorder, "Existing reception recorder required");
      const name = "ميس حمدان", phone = "0598800881", dob = "1992-04-18";
      assert.equal((await client.query("SELECT 1 FROM operational.patients WHERE phone=$1 OR name_normalized=$2", [phone, normalizeName(name)])).rowCount, 0,
        "Scenario identity already used; refusing to modify or merge an existing patient");
      const patient = (await client.query(`INSERT INTO operational.patients
        (patient_name,name_normalized,phone,dob,created_clinic_id) VALUES($1,$2,$3,$4,$5) RETURNING patient_id`,
        [name, normalizeName(name), phone, dob, home.clinic_id])).rows[0];
      const visits = [];
      for (const [index, clinic] of selected.entries()) {
        await client.query("INSERT INTO operational.patient_clinic_access(patient_id,clinic_id) VALUES($1,$2)", [patient.patient_id, clinic.clinic_id]);
        await client.query("INSERT INTO operational.patient_doctor_access(patient_id,clinic_id,doctor_id) VALUES($1,$2,$3)", [patient.patient_id, clinic.clinic_id, clinic.doctor_id]);
        const date = formatInTimeZone(addDays(new Date(), index === 0 ? -8 : -2), "Asia/Hebron", "yyyy-MM-dd");
        const visit = (await client.query(`INSERT INTO operational.patient_visit_history
          (patient_id,clinic_id,doctor_id,visit_date,diagnosis_notes) VALUES($1,$2,$3,$4,$5) RETURNING visit_id`,
          [patient.patient_id, clinic.clinic_id, clinic.doctor_id, date,
            index === 0 ? "Routine blood pressure follow-up. No new symptoms reported." : "Follow-up after the previous clinic visit. Patient reports feeling well."])).rows[0];
        visits.push({ ...clinic, date, visitId: visit.visit_id });
      }
      await client.query(`INSERT INTO operational.patient_consents
        (fixture_key,patient_id,level,given_by,recorded_by_user,recorded_clinic_id,evidence)
        VALUES('practice.cross-clinic-history',$1,'clinical','patient',$2,$3,'verbal')`,
        [patient.patient_id, recorder.id, home.clinic_id]);
      const manifest = { synthetic: true, patientId: patient.patient_id, name, phone, dob, consent: "clinical", visits };
      await client.query(`INSERT INTO operational.audit_log(patient_id,clinic_id,action,detail)
        VALUES($1,$2,'practice.cross-clinic-history.prepared',$3::jsonb)`, [patient.patient_id, home.clinic_id, JSON.stringify(manifest)]);
      assert.equal(await seedFingerprint(client), before, "Immutable seed fingerprint changed");
      return manifest;
    });
    assert.equal(await seedFingerprint(client), before);
    const actual = await client.query(`SELECT v.visit_id,v.clinic_id,v.visit_date,c.network_mode
      FROM operational.patient_visit_history v JOIN operational.clinics c USING(clinic_id)
      WHERE v.patient_id=$1 ORDER BY v.visit_date`, [result.patientId]);
    assert.equal(actual.rows.length, 2);
    assert.equal(new Set(actual.rows.map(r => r.clinic_id)).size, 2);
    assert(actual.rows.every(r => r.network_mode === "full"));
    writeFileSync(`${root}/docs/CROSS_CLINIC_HISTORY_CASE.json`, JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify({ ...result, immutableSeedsUnchanged: true }, null, 2));
  } finally { await client.end(); }
}
main().catch(error => { console.error(error instanceof assert.AssertionError ? error.message : "History scenario setup failed; no credentials emitted."); process.exitCode = 1; });
