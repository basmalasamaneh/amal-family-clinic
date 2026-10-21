import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { Auth } from "../src/lib/auth";
import { withIsolatedAuthDatabase } from "./helpers/auth-isolated";

test("real import commits schedule only new eligible appointments, atomically and replay-safely", { timeout: 120000 }, async t => {
  await withIsolatedAuthDatabase(async admin => {
    const { uploadImport, mapImport, commitImport, getImport } = await import("../src/imports/service");
    const { wallToUtc } = await import("../src/imports/validation");
    const { seedFingerprint } = await import("../../../scripts/src/operational-support");
    const beforeSeeds = await seedFingerprint(admin);
    const clinicId = (await admin.query(`INSERT INTO operational.clinics
      (clinic_name,city,booking_method,working_days,open_time,close_time,reminders_enabled)
      VALUES('Reminder import clinic','Test','phone',ARRAY[0,1,2,3,4,5,6],'00:00','23:59',true) RETURNING clinic_id`)).rows[0].clinic_id;
    const doctor = (await admin.query(`INSERT INTO operational.doctors(doctor_name,clinic_id,specialty,email)
      VALUES('Private doctor',$1,'Private specialty',$2) RETURNING doctor_id,email`,
    [clinicId, `${randomUUID()}@reminder-import.test`])).rows[0];
    const patient = (await admin.query(`INSERT INTO operational.patients
      (patient_name,phone,dob,name_normalized,created_clinic_id,reminder_opt_out)
      VALUES('Private patient','0591234567','1980-01-01','private patient',$1,false)
      RETURNING patient_id,patient_name,phone`, [clinicId])).rows[0];
    await admin.query("INSERT INTO operational.patient_clinic_access(patient_id,clinic_id) VALUES($1,$2)", [patient.patient_id, clinicId]);
    const user = (await admin.query(`INSERT INTO operational.users(email,password_hash,role,clinic_id)
      VALUES($1,'unused','receptionist',$2) RETURNING id,email`,
    [`${randomUUID()}@reminder-import.test`, clinicId])).rows[0];
    const deviceId = (await admin.query(`INSERT INTO operational.devices(clinic_id,label)
      VALUES($1,'reminder-import-test') RETURNING id`, [clinicId])).rows[0].id;
    await admin.query("INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)", [deviceId, randomUUID()]);
    const sessionDigest = randomUUID();
    await admin.query(`INSERT INTO operational.auth_sessions(token_digest,user_id,device_id,csrf_token,absolute_expires_at,pin_verified_at)
      VALUES($1,$2,$3,'unused',now()+interval '1 hour',now())`, [sessionDigest, user.id, deviceId]);
    const actor: Auth = { id: user.id, email: user.email, role: "front-desk", clinicId, doctorId: null,
      sessionDigest, csrfToken: "unused", locale: "en", theme: "light", device: { id: deviceId, clinicId },
      expiresAt: new Date(Date.now() + 3600000), absoluteExpiresAt: new Date(Date.now() + 3600000), pinVerifiedAt: new Date() };
    let eventId = 1900000000;
    function source(day: string, status = "confirmed") {
      return { event_id: eventId++, doctor_email: doctor.email, patient_name_typed: patient.patient_name,
        start_time: `${day}T10:00:00`, end_time: `${day}T10:30:00`, event_status: status };
    }
    async function review(row: ReturnType<typeof source>, sourceName = `reminder-import-${randomUUID()}`, associateAppointmentId?: number) {
      const batch: any = await uploadImport(actor, { source: "json", sourceName, clientOpId: randomUUID(), rows: [row] });
      const mapped: any = await mapImport(actor, batch.id, { expectedVersion: batch.version, rows: [{
        rowId: batch.rows[0].id, action: "include", doctorId: doctor.doctor_id,
        identity: { kind: "existing", patientId: patient.patient_id, verification: { method: "phone", value: patient.phone } },
        ...(associateAppointmentId ? { associateAppointmentId } : {}),
      }] });
      return mapped;
    }
    const messages = async (id: number) => (await admin.query(
      "SELECT * FROM operational.notifications WHERE appointment_id=$1 ORDER BY id", [id])).rows;
    const counts = async () => {
      const result: Record<string, number> = {};
      for (const table of ["appointments", "notifications", "import_source_links", "import_operations", "audit_log"]) {
        result[table] = (await admin.query(`SELECT count(*)::integer AS n FROM operational.${table}`)).rows[0].n;
      }
      return result;
    };
    await t.test("future booked import creates two UTC-offset snapshots; operation and source replay create none", async () => {
      const row = source("2082-01-05"), mapped = await review(row), clientOpId = randomUUID();
      assert.equal((await messages(mapped.rows[0].appointmentId ?? -1)).length, 0, "staging does not schedule");
      const committed: any = await commitImport(actor, mapped.id, { expectedVersion: mapped.version, clientOpId });
      assert.equal(committed.rows[0].outcome, "created");
      const id = committed.rows[0].appointmentId;
      const rows = await messages(id);
      assert.equal(rows.length, 2);
      assert(rows.every(n => n.status === "pending" && n.schedule_version === 1 && n.receipt === null));
      const starts = Date.parse(wallToUtc(row.start_time));
      for (const n of rows) {
        assert.equal(n.scheduled_at.getTime(), starts - n.offset_hours * 3600000);
        assert(n.scheduled_at.getTime() > Date.now());
        assert.match(n.text_en, /Reminder import clinic/);
        assert.match(n.text_en, /2082-01-05/);
        assert.match(n.text_en, /10:00/);
        assert(!JSON.stringify([n.text_ar, n.text_en]).includes(patient.patient_name));
      }
      const before = await counts();
      assert.deepEqual(await commitImport(actor, mapped.id, { expectedVersion: mapped.version, clientOpId }), committed);
      assert.deepEqual(await counts(), before);
      const replayBatch = await review(row);
      const replay: any = await commitImport(actor, replayBatch.id, { expectedVersion: replayBatch.version, clientOpId: randomUUID() });
      assert.equal(replay.rows[0].outcome, "source-replay");
      assert.equal(replay.rows[0].appointmentId, id);
      assert.deepEqual(await messages(id), rows);
    });
    await t.test("linking an existing future appointment does not backfill reminders", async () => {
      const row = source("2082-01-06");
      const id = (await admin.query(`INSERT INTO operational.appointments
        (clinic_id,doctor_id,patient_id,scheduled_at,duration_minutes,booking_method,status)
        VALUES($1,$2,$3,$4,30,'phone','booked') RETURNING appointment_id`,
      [clinicId, doctor.doctor_id, patient.patient_id, wallToUtc(row.start_time)])).rows[0].appointment_id;
      const mapped = await review(row, undefined, id), before = await counts();
      const committed: any = await commitImport(actor, mapped.id, { expectedVersion: mapped.version, clientOpId: randomUUID() });
      assert.equal(committed.rows[0].outcome, "linked");
      assert.equal(committed.rows[0].appointmentId, id);
      assert.equal((await messages(id)).length, 0);
      assert.equal((await counts()).appointments, before.appointments);
      assert.equal((await counts()).notifications, before.notifications);
    });
    await t.test("historical booked and future inactive imports create no reminders", async () => {
      for (const [day, status] of [["2000-01-05", "confirmed"], ["2082-01-07", "completed"], ["2082-01-08", "cancelled"]]) {
        const mapped = await review(source(day!, status));
        const committed: any = await commitImport(actor, mapped.id, { expectedVersion: mapped.version, clientOpId: randomUUID() });
        assert.equal(committed.rows[0].outcome, "created");
        assert.equal((await messages(committed.rows[0].appointmentId)).length, 0);
      }
    });
    await t.test("failure after scheduling rolls back appointment, pair, provenance and commit receipt", async () => {
      const mapped = await review(source("2082-01-09"), "reminder-import-rollback"), before = await counts();
      await admin.query(`CREATE FUNCTION operational.reminder_import_fail() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.source_name='reminder-import-rollback' AND NEW.status='committed' THEN
            IF (SELECT count(*) FROM operational.notifications n
              JOIN operational.appointments a ON a.appointment_id=n.appointment_id
              JOIN operational.import_source_links l ON l.appointment_id=a.appointment_id
              WHERE l.batch_id=NEW.id AND n.schedule_version IS NOT NULL AND n.status='pending') <> 2 THEN
              RAISE EXCEPTION 'reminders were not scheduled before final commit';
            END IF;
            RAISE EXCEPTION 'forced final import failure after reminder scheduling';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER reminder_import_fail BEFORE UPDATE ON operational.import_batches
          FOR EACH ROW EXECUTE FUNCTION operational.reminder_import_fail()`);
      const clientOpId = randomUUID();
      try {
        await assert.rejects(commitImport(actor, mapped.id, { expectedVersion: mapped.version, clientOpId }),
          /forced final import failure after reminder scheduling/);
        assert.deepEqual(await counts(), before);
        const unchanged: any = await getImport(actor, mapped.id);
        assert.equal(unchanged.status, "reviewed");
        assert.equal(unchanged.version, mapped.version);
        assert.equal(unchanged.rows[0].appointmentId, null);
      } finally {
        await admin.query(`DROP TRIGGER reminder_import_fail ON operational.import_batches;
          DROP FUNCTION operational.reminder_import_fail()`);
      }
      const retried: any = await commitImport(actor, mapped.id, { expectedVersion: mapped.version, clientOpId });
      assert.equal(retried.rows[0].outcome, "created");
      assert.equal((await messages(retried.rows[0].appointmentId)).length, 2);
    });
    assert.equal(await seedFingerprint(admin), beforeSeeds, "All six seed schemas, contents and protections remain unchanged");
  });
});
