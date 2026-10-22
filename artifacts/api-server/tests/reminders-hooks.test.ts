import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Auth } from "../src/lib/auth";
import { withIsolatedAuthDatabase } from "./helpers/auth-isolated";

test("real booking hooks, move replay/back, failures and explicitly ordered mutation/dispatch races", { timeout: 120000 }, async t => {
  await withIsolatedAuthDatabase(async (admin) => {
    await admin.query(readFileSync(new URL("../../../lib/db/migrations/0016_reminders.sql", import.meta.url), "utf8"));
    // This is the private disposable clone. Source reminder backlog must not
    // consume a bounded dispatcher batch ahead of these synthetic fixtures.
    await admin.query("DELETE FROM operational.notifications WHERE schedule_version IS NOT NULL");
    const { createAppointment, updateAppointment, transaction } = await import("../src/appointments/service");
    const { setClinicReminderPreference, setPatientReminderOptOut } = await import("../src/reminders/lifecycle");
    const { dispatchDueReminders } = await import("../src/reminders/dispatcher");
    const { seedFingerprint } = await import("../../../scripts/src/operational-support");
    const before = await seedFingerprint(admin);
    const clinicId = (await admin.query(`INSERT INTO operational.clinics
      (clinic_name,city,booking_method,working_days,open_time,close_time,reminders_enabled)
      VALUES('Reminder hook clinic','Test','phone',ARRAY[0,1,2,3,4,5,6],'00:00','23:59',true) RETURNING clinic_id`)).rows[0].clinic_id;
    const doctorId = (await admin.query(`INSERT INTO operational.doctors(doctor_name,clinic_id,specialty,email)
      VALUES('Private doctor',$1,'Private specialty',$2) RETURNING doctor_id`,
    [clinicId, `${randomUUID()}@reminder.test`])).rows[0].doctor_id;
    const patientId = (await admin.query(`INSERT INTO operational.patients(patient_name,phone,dob,name_normalized,created_clinic_id)
      VALUES('Private patient','private-phone','1980-01-01','private patient',$1) RETURNING patient_id`, [clinicId])).rows[0].patient_id;
    await admin.query("INSERT INTO operational.patient_clinic_access(patient_id,clinic_id) VALUES($1,$2)", [patientId, clinicId]);
    const email = `${randomUUID()}@reminder.test`;
    await admin.query("BEGIN");
    const userId = (await admin.query(`INSERT INTO operational.users(email,password_hash,role,clinic_id,doctor_id)
      VALUES($1,'unused','doctor',$2,$3) RETURNING id`, [email, clinicId, doctorId])).rows[0].id;
    await admin.query("UPDATE operational.doctors SET user_id=$1 WHERE doctor_id=$2", [userId, doctorId]);
    await admin.query("COMMIT");
    const sessionDigest = randomUUID(), csrfToken = randomUUID();
    await admin.query(`INSERT INTO operational.auth_sessions(token_digest,user_id,csrf_token,absolute_expires_at)
      VALUES($1,$2,$3,now()+interval '8 hours')`, [sessionDigest, userId, csrfToken]);
    const actor: Auth = { id: userId, email, role: "doctor", clinicId, doctorId, locale: "en", theme: "light",
      sessionDigest, csrfToken, device: null, expiresAt: new Date(Date.now() + 1800000), absoluteExpiresAt: null, pinVerifiedAt: null };
    let day = 1;
    const interval = () => {
      const date = new Date(Date.UTC(2080, 0, day++, 10));
      return { startsAt: date.toISOString(), endsAt: new Date(date.getTime() + 1800000).toISOString() };
    };
    const input = () => ({ clinicId, doctorId, patientId, ...interval(), source: "phone", clientOpId: randomUUID() });
    const messages = async (id: number) => (await admin.query(
      "SELECT * FROM operational.notifications WHERE appointment_id=$1 ORDER BY id", [id])).rows;
    const due = (a: { startsAt: string }) => new Date(Date.parse(a.startsAt) - 86400000);
    async function preferences(enabled = true, optedOut = false) {
      await transaction(actor, async (client, _actor, now) => {
        await setClinicReminderPreference(client, clinicId, enabled, now);
        await setPatientReminderOptOut(client, patientId, optedOut, now);
      });
    }
    function barrier() {
      let release!: () => void;
      const promise = new Promise<void>(resolve => { release = resolve; });
      return { promise, release };
    }
    await t.test("create retries, rejected booking and transaction failure leave exactly the expected pair", async () => {
      const payload = input();
      const [a, b] = await Promise.all([createAppointment(actor, payload), createAppointment(actor, payload)]);
      assert.equal(a.id, b.id);
      assert.equal((await messages(a.id)).length, 2);
      assert((await messages(a.id)).every(n => n.status === "pending" && n.schedule_version === 1));
      assert.deepEqual((await messages(a.id)).map(n => n.scheduled_at.toISOString()).sort(),
        [new Date(Date.parse(a.startsAt) - 86400000).toISOString(), new Date(Date.parse(a.startsAt) - 7200000).toISOString()].sort());
      const count = (await admin.query("SELECT count(*)::integer AS n FROM operational.notifications")).rows[0].n;
      await assert.rejects(createAppointment(actor, { ...payload, clientOpId: randomUUID() }),
        (e: any) => e.code === "APPOINTMENT_CONFLICT");
      assert.equal((await admin.query("SELECT count(*)::integer AS n FROM operational.notifications")).rows[0].n, count);
      const rolledBack = input();
      await assert.rejects(transaction(actor, async (client, current, now) => {
        await createAppointment(actor, rolledBack, { client, actor: current, now });
        throw new Error("rollback actual booking");
      }), /rollback actual booking/);
      assert.equal((await admin.query("SELECT 1 FROM operational.appointments WHERE client_op_id=$1", [rolledBack.clientOpId])).rowCount, 0);
      assert.equal((await admin.query("SELECT count(*)::integer AS n FROM operational.notifications")).rows[0].n, count);
      await updateAppointment(actor, a.id, { expectedVersion: a.version, status: "cancelled", clientOpId: randomUUID() });
      assert((await messages(a.id)).every(n => n.status === "cancelled"));
    });
    await t.test("real move replay and moving back create separate schedule versions", async () => {
      const a = await createAppointment(actor, input());
      const move = { ...interval(), expectedVersion: a.version, clientOpId: randomUUID() };
      const b = await updateAppointment(actor, a.id, move);
      assert.deepEqual(await updateAppointment(actor, a.id, move), b);
      assert.equal((await messages(a.id)).length, 4);
      const c = await updateAppointment(actor, a.id, { startsAt: a.startsAt, endsAt: a.endsAt,
        expectedVersion: b.version, clientOpId: randomUUID() });
      const rows = await messages(a.id);
      assert.deepEqual(rows.map(n => n.schedule_version), [1, 1, 2, 2, 3, 3]);
      assert.equal(rows.filter(n => n.status === "pending").length, 2);
      await updateAppointment(actor, a.id, { expectedVersion: c.version, status: "cancelled", clientOpId: randomUUID() });
      assert((await messages(a.id)).every(n => n.status === "cancelled"));
    });
    for (const kind of ["optout", "disable"] as const) {
      await t.test(`${kind} commits first while dispatch competes; committed earlier sends remain history`, async () => {
        await preferences();
        const a = await createAppointment(actor, input());
        const changed = barrier(), commit = barrier();
        const first = transaction(actor, async (client, _actor, now) => {
          if (kind === "optout") await setPatientReminderOptOut(client, patientId, true, now);
          else await setClinicReminderPreference(client, clinicId, false, now);
          changed.release();
          await commit.promise;
        });
        await changed.promise;
        const worker = dispatchDueReminders({ now: due(a) });
        commit.release();
        await Promise.all([first, worker]);
        assert((await messages(a.id)).every(n => n.status === "cancelled" && n.receipt === null));
        const suppressed = await createAppointment(actor, input());
        assert.equal((await messages(suppressed.id)).length, 0, "authoritative preference suppresses real booking hook");
        await preferences();
        assert.equal((await messages(suppressed.id)).length, 0, "reenablement never backfills suppressed bookings");
        const b = await createAppointment(actor, input());
        await dispatchDueReminders({ now: due(b) });
        await preferences(kind !== "disable", kind === "optout");
        const rows = await messages(b.id);
        assert.equal(rows.filter(n => n.status === "simulated" && n.receipt?.simulated).length, 1);
        assert.equal(rows.filter(n => n.status === "cancelled").length, 1);
      });
    }
    for (const winner of ["cancel", "move"] as const) {
      await t.test(`${winner} wins overlapping cancel/move request and dispatch`, async () => {
        await preferences();
        const a = await createAppointment(actor, input());
        const move = { ...interval(), expectedVersion: a.version, clientOpId: randomUUID() };
        const cancel = { status: "cancelled", expectedVersion: a.version, clientOpId: randomUUID() };
        const changed = barrier(), commit = barrier();
        const first = transaction(actor, async (client, current, now) => {
          const result = await updateAppointment(actor, a.id, winner === "cancel" ? cancel : move, { client, actor: current, now });
          changed.release();
          await commit.promise;
          return result;
        });
        await changed.promise;
        const second = assert.rejects(updateAppointment(actor, a.id, winner === "cancel" ? move : cancel),
          (e: any) => e.code === "VERSION_CONFLICT");
        const worker = dispatchDueReminders({ now: due(a) });
        commit.release();
        const [result] = await Promise.all([first, second, worker]);
        const rows = await messages(a.id);
        assert.equal(rows.filter(n => n.receipt !== null).length, 0);
        assert.equal(rows.filter(n => n.status === "pending").length, winner === "move" ? 2 : 0);
        assert.equal(rows.filter(n => n.schedule_version === 1 && n.status === "cancelled").length, 2);
        if (winner === "move") await updateAppointment(actor, a.id, {
          expectedVersion: result.version, status: "cancelled", clientOpId: randomUUID(),
        });
      });
    }
    await t.test("late restart never bursts both windows, including across one-row batches", async () => {
      await preferences();
      const a = await createAppointment(actor, input());
      const late = new Date(Date.parse(a.startsAt) - 3600000).toISOString();
      // Isolate this scenario from copied historical test data, not source data.
      await admin.query("DELETE FROM operational.notifications WHERE appointment_id<>$1", [a.id]);
      const probe = () => JSON.parse(execFileSync(process.execPath, ["--import", "tsx",
        fileURLToPath(new URL("./reminder-restart-probe.ts", import.meta.url)), late, "1"], { encoding: "utf8" }));
      assert.deepEqual(probe(), { sent: 0, cancelled: 1 });
      assert.deepEqual(probe(), { sent: 1, cancelled: 0 });
      assert.deepEqual(probe(), { sent: 0, cancelled: 0 });
      const rows = await messages(a.id);
      assert.equal(rows.find(n => n.offset_hours === 24)?.cancellation_reason, "missed_window");
      assert.equal(rows.find(n => n.offset_hours === 2)?.status, "simulated");
    });
    assert.equal(await seedFingerprint(admin), before);
  });
});
