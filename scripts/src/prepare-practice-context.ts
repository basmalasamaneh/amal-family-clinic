import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { hash } from "bcryptjs";
import { adminClient, requireDemo, seedFingerprint } from "./operational-support";
import { root } from "./seed-source";

async function main() {
  requireDemo();
  const password = process.env.AMAL_PRODUCTION_DEMO_ADMIN_PASSWORD;
  assert(password && password.length >= 12 && Buffer.byteLength(password) <= 72);
  const client = adminClient();
  await client.connect();
  try {
    const before = await seedFingerprint(client);
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(761930)");
    await client.query("SELECT pg_advisory_xact_lock(31030,1)");
    await client.query("SELECT pg_advisory_xact_lock(160005)");
    await client.query("SELECT pg_advisory_xact_lock(761910)");
    const clinics = (await client.query(`SELECT c.* FROM operational.clinics c JOIN public.clinics s USING(clinic_id) ORDER BY clinic_id`)).rows;
    const accounts = [];
    for (const clinic of clinics) {
      const key = `practice.clinic-admin.${clinic.clinic_id}`;
      const email = `manager.${clinic.clinic_id}@amal.example`;
      const existing = await client.query("SELECT id FROM operational.users WHERE fixture_key=$1", [key]);
      if (!existing.rowCount) {
        await client.query(`INSERT INTO operational.users(fixture_key,email,password_hash,role,clinic_id)
          VALUES($1,$2,$3,'administrator',$4)`, [key, email, await hash(password,12), clinic.clinic_id]);
      }
      accounts.push({ role: "administrator", email, clinicId: clinic.clinic_id, doctorId: null });
      // Explicit operator delegation for the principal seeded physician only.
      const { rows: [doctor] } = await client.query(`SELECT d.doctor_id,d.user_id FROM operational.doctors d
        JOIN public.doctors s USING(doctor_id) JOIN operational.users u ON u.id=d.user_id
        WHERE d.clinic_id=$1 AND u.fixture_key='demo.doctor.'||d.doctor_id::text
        ORDER BY d.doctor_id LIMIT 1`, [clinic.clinic_id]);
      assert(doctor);
      const granted = await client.query(`INSERT INTO operational.clinic_managers(clinic_id,user_id)
        VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING user_id`, [clinic.clinic_id, doctor.user_id]);
      if (granted.rowCount) await client.query(`INSERT INTO operational.audit_log(clinic_id,action,detail)
        VALUES($1,'practice.manager.delegated',$2::jsonb)`, [clinic.clinic_id, JSON.stringify({ userId: doctor.user_id })]);
    }
    assert.equal(await seedFingerprint(client), before);
    await client.query("COMMIT");
    const manifest = JSON.parse(readFileSync(`${root}/docs/SELF_TEST_DATA.json`, "utf8"));
    manifest.clinicAdminAccounts = accounts;
    const trial = clinics.filter(c => c.network_mode === "lite");
    const results = clinics.filter(c => c.network_mode === "full");
    assert(trial.length === 1 && results.length === 2, "Review changed scenario memberships before configuring");
    const scenarioPath = `${root}/artifacts/api-server/src/adoption/scenario.json`;
    const current = JSON.parse(readFileSync(scenarioPath, "utf8"));
    if (current.trialClinicId === null && current.resultClinicIds === null) {
      writeFileSync(scenarioPath, `${JSON.stringify({ trialClinicId: trial[0].clinic_id, resultClinicIds: results.map(c => c.clinic_id) }, null, 2)}\n`);
    }
    manifest.adoption = { managerDoctorSelection: "Principal seeded doctor in each clinic", trialClinicId: trial[0].clinic_id, resultClinicIds: results.map(c => c.clinic_id), membershipsUnchanged: true };
    writeFileSync(`${root}/docs/SELF_TEST_DATA.json`, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log("Clinic-specific administration and voluntary adoption practice prepared. Seeds and clinic memberships unchanged.");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { await client.end(); }
}
main().catch(() => { console.error("Practice context preparation refused or failed; credentials not emitted."); process.exitCode = 1; });
