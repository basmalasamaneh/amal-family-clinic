import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Auth } from "../src/lib/auth";
import { withIsolatedAuthDatabase } from "./helpers/auth-isolated";

test("global exact-identity scheduling and import safety", { timeout: 180000 }, async t => {
  await withIsolatedAuthDatabase(async admin => {
    const { createAppointment, updateAppointment, checkAppointment, createHold } = await import("../src/appointments/service");
    const { updatePatient } = await import("../src/patients/service");
    const { uploadImport, mapImport, commitImport } = await import("../src/imports/service");
    const { wallToUtc } = await import("../src/imports/validation");
    const { seedFingerprint } = await import("../../../scripts/src/operational-support");
    const seeds = await seedFingerprint(admin);
    async function fixture() {
      const clinicId = (await admin.query(`INSERT INTO operational.clinics
        (clinic_name,city,booking_method,working_days,open_time,close_time)
        VALUES('Collision test','Test','phone',ARRAY[0,1,2,3,4,5,6],'00:00','23:59') RETURNING clinic_id`)).rows[0].clinic_id;
      const doctor = (await admin.query(`INSERT INTO operational.doctors(doctor_name,clinic_id,specialty,email)
        VALUES('Test',$1,'Test',$2) RETURNING doctor_id,email`, [clinicId, `${randomUUID()}@collision.test`])).rows[0];
      const user = (await admin.query(`INSERT INTO operational.users(email,password_hash,role,clinic_id)
        VALUES($1,'unused','receptionist',$2) RETURNING id,email`, [`${randomUUID()}@collision.test`, clinicId])).rows[0];
      const deviceId = (await admin.query("INSERT INTO operational.devices(clinic_id,label) VALUES($1,'test') RETURNING id", [clinicId])).rows[0].id;
      await admin.query("INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)", [deviceId, randomUUID()]);
      const sessionDigest = randomUUID();
      await admin.query(`INSERT INTO operational.auth_sessions(token_digest,user_id,device_id,csrf_token,absolute_expires_at,pin_verified_at)
        VALUES($1,$2,$3,'unused',now()+interval '1 hour',now())`, [sessionDigest, user.id, deviceId]);
      const actor: Auth = { id: user.id, email: user.email, role: "front-desk", clinicId, doctorId: null,
        sessionDigest, csrfToken: "unused", locale: "en", theme: "light", device: { id: deviceId, clinicId },
        expiresAt: new Date(Date.now() + 3600000), absoluteExpiresAt: new Date(Date.now() + 3600000), pinVerifiedAt: new Date() };
      return { actor, clinicId, doctor };
    }
    const a = await fixture(), b = await fixture();
    async function patient(clinicId: number, name: string, phone = "0591234567", dob = "1980-01-01") {
      return (await admin.query(`INSERT INTO operational.patients(patient_name,phone,dob,name_normalized,created_clinic_id)
        VALUES($1,$2,$3,lower($1),$4) RETURNING patient_id`, [name, phone, dob, clinicId])).rows[0].patient_id as number;
    }
    function booking(f: typeof a, patientId: number, day: number, hour = 10) {
      const startsAt = `2085-01-${String(day).padStart(2, "0")}T${hour}:00:00.000Z`;
      return { clinicId: f.clinicId, doctorId: f.doctor.doctor_id, patientId, startsAt,
        endsAt: new Date(Date.parse(startsAt) + 1800000).toISOString(), source: "phone", clientOpId: randomUUID() };
    }
    const blocked = (e: unknown) => (e as { code: string }).code === "APPOINTMENT_CONFLICT";
    const p = await patient(a.clinicId, "Exact Patient"), q = await patient(b.clinicId, " Exact  Patient ");
    await t.test("distinct equivalent IDs serialize concurrent commits across clinics; all modes retain hidden blockers", async () => {
      const attempts = await Promise.allSettled([createAppointment(a.actor, booking(a, p, 1)), createAppointment(b.actor, booking(b, q, 1))]);
      assert.equal(attempts.filter(x => x.status === "fulfilled").length, 1);
      assert.equal(attempts.filter(x => x.status === "rejected" && blocked(x.reason)).length, 1);
      const loser = attempts[0]!.status === "rejected" ? a : b, id = loser === a ? p : q;
      for (const mode of ["full", "lite", "none"]) {
        // No-network membership uses the persisted lite enum plus left state.
        await admin.query(`UPDATE operational.clinics SET network_mode=$2,
          adoption_state=$3,membership_status=$4,
          left_at=CASE WHEN $4='left' THEN now() ELSE NULL END,
          left_by=CASE WHEN $4='left' THEN $5::integer ELSE NULL END
          WHERE clinic_id=ANY($1::integer[])`, [[a.clinicId, b.clinicId], mode === "full" ? "full" : "lite",
          mode === "full" ? "full" : "lite", mode === "none" ? "left" : "active", a.actor.id]);
        const input = { ...booking(loser, id, 1), overrideReason: "Authorized handoff" };
        const preview = await checkAppointment(loser.actor, input);
        assert.equal(preview.ok, false);
        assert.equal(preview.conflicts.length, 1);
        assert.equal(preview.conflicts[0]!.with, null);
        await assert.rejects(createAppointment(loser.actor, input), blocked);
        const { source: _source, ...hold } = { ...input, clientOpId: randomUUID() };
        await assert.rejects(createHold(loser.actor, hold), blocked);
      }
    });
    await t.test("same patient ID cannot collide across both disabled clinics, and rejected edit preserves original", async () => {
      await admin.query("INSERT INTO operational.patient_clinic_access(patient_id,clinic_id) VALUES($1,$2)", [p, b.clinicId]);
      await createAppointment(a.actor, booking(a, p, 2));
      for (const left of [false, true]) {
        await admin.query(`UPDATE operational.clinics SET network_mode='lite',adoption_state='lite',
          membership_status=CASE WHEN $2 THEN 'left' ELSE 'active' END,
          left_at=CASE WHEN $2 THEN now() ELSE NULL END,
          left_by=CASE WHEN $2 THEN $3::integer ELSE NULL END
          WHERE clinic_id=ANY($1::integer[])`, [[a.clinicId, b.clinicId], left, a.actor.id]);
        await assert.rejects(createAppointment(b.actor, { ...booking(b, p, 2), overrideReason: "Approved" }), blocked);
      }
      const original: any = await createAppointment(b.actor, booking(b, p, 2, 12));
      await assert.rejects(updateAppointment(b.actor, original.id, {
        clientOpId: randomUUID(), expectedVersion: 1, startsAt: booking(b, p, 2).startsAt,
        endsAt: booking(b, p, 2).endsAt, overrideReason: "Approved",
      }), blocked);
      const stored = (await admin.query("SELECT scheduled_at,version FROM operational.appointments WHERE appointment_id=$1", [original.id])).rows[0];
      assert.equal(stored.scheduled_at.toISOString(), original.startsAt);
      assert.equal(stored.version, 1);
      await createAppointment(b.actor, { ...booking(b, p, 2), startsAt: "2085-01-02T10:30:00.000Z", endsAt: "2085-01-02T11:00:00.000Z" });
    });
    await t.test("demographic updates reject new colliding group membership but retain historical unchanged collisions", async () => {
      const r = await patient(b.clinicId, "Different Patient");
      await createAppointment(a.actor, booking(a, p, 3));
      await createAppointment(b.actor, booking(b, r, 3));
      await assert.rejects(updatePatient(b.actor, r, { name: "Exact Patient" }), blocked);
      assert.equal((await admin.query("SELECT patient_name FROM operational.patients WHERE patient_id=$1", [r])).rows[0].patient_name, "Different Patient");
      // Simulate a pre-existing historical collision only in this disposable fixture.
      await admin.query("UPDATE operational.patients SET patient_name='Exact Patient' WHERE patient_id=$1", [r]);
      await updatePatient(b.actor, r, { name: " Exact   Patient " });
    });
    await t.test("multiple mismatched fields and single-field mismatches do not establish equivalence", async () => {
      for (const [index, fields] of [
        ["Different Patient", "0591234567", "1980-01-01"],
        ["Exact Patient", "0591234568", "1980-01-01"],
        ["Exact Patient", "0591234567", "1980-01-02"],
        ["Different Patient", "0591234568", "1980-01-02"],
      ].entries()) {
        const r = await patient(b.clinicId, fields[0]!, fields[1]!, fields[2]!);
        await createAppointment(a.actor, booking(a, p, 10 + index));
        await createAppointment(b.actor, booking(b, r, 10 + index));
      }
    });
    await t.test("demographic membership edits serialize with booking creation", async () => {
      const r = await patient(b.clinicId, "Race Different");
      await createAppointment(a.actor, booking(a, p, 20));
      const outcomes = await Promise.allSettled([
        updatePatient(b.actor, r, { name: "Exact Patient" }),
        createAppointment(b.actor, booking(b, r, 20)),
      ]);
      assert.equal(outcomes.filter(x => x.status === "fulfilled").length, 1);
      assert.equal(outcomes.filter(x => x.status === "rejected" && blocked(x.reason)).length, 1);
    });
    let eventId = 1800000000;
    async function staged(day: string, two: boolean) {
      const rows = [a.doctor, ...(two ? [b.doctor] : [])].map(d => ({
        event_id: eventId++, doctor_email: d.email, patient_name_typed: "Staged Exact",
        start_time: `${day}T10:00:00`, end_time: `${day}T10:30:00`, event_status: "confirmed",
      }));
      // Both staged doctors must be authorized locally.
      if (two) rows[1]!.doctor_email = (await admin.query(`INSERT INTO operational.doctors(doctor_name,clinic_id,specialty,email)
        VALUES('Other',$1,'Test',$2) RETURNING email`, [a.clinicId, `${randomUUID()}@collision.test`])).rows[0].email;
      const uploaded: any = await uploadImport(a.actor, { source: "json", sourceName: "collision-test", clientOpId: randomUUID(), rows });
      const mapped: any = await mapImport(a.actor, uploaded.id, { expectedVersion: uploaded.version, rows: await Promise.all(uploaded.rows.map(async (row: any, i: number) => ({
        rowId: row.id, action: "include", doctorId: (await admin.query("SELECT doctor_id FROM operational.doctors WHERE email=$1", [rows[i]!.doctor_email])).rows[0].doctor_id,
        identity: { kind: "new", patient: { name: "Staged Exact", phone: "0598888888", dateOfBirth: "1980-01-01" } },
        overrideReason: "Reviewed",
      }))) });
      return mapped;
    }
    await t.test("new staged exact duplicates collide with each other at preview and atomic commit", async () => {
      const batch = await staged("2085-02-01", true);
      assert(batch.conflicts.some((c: any) => c.code === "patient-overlap" && c.severity === "blocking"));
      const before = (await admin.query("SELECT count(*) n FROM operational.patients")).rows[0].n;
      await assert.rejects(commitImport(a.actor, batch.id, { expectedVersion: batch.version, clientOpId: randomUUID() }), (e: any) => e.code === "IMPORT_CONFLICT");
      assert.equal((await admin.query("SELECT count(*) n FROM operational.patients")).rows[0].n, before);
    });
    await t.test("staged new patient collides with global database equivalent at preview and commit revalidation", async () => {
      const r = await patient(b.clinicId, "Staged Exact", "0598888888");
      const batch = await staged("2085-02-02", false);
      assert(!batch.conflicts.some((c: any) => c.code === "patient-overlap"));
      await createAppointment(b.actor, { ...booking(b, r, 1), startsAt: wallToUtc("2085-02-02T10:00:00"), endsAt: wallToUtc("2085-02-02T10:30:00") });
      await assert.rejects(commitImport(a.actor, batch.id, { expectedVersion: batch.version, clientOpId: randomUUID() }), (e: any) => e.code === "IMPORT_CONFLICT");
      const { getImport } = await import("../src/imports/service");
      const refreshed: any = await getImport(a.actor, batch.id);
      assert(refreshed.conflicts.some((c: any) => c.code === "patient-overlap" && c.severity === "blocking" && !c.appointmentId));
    });
    assert.equal(await seedFingerprint(admin), seeds);
  });
});
