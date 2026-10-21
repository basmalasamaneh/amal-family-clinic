import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { withIsolatedAuthDatabase } from "./helpers/auth-isolated";

test("durable scheduling, rollback, concurrency, preferences and restart recovery", { timeout: 120000 }, async () => {
  await withIsolatedAuthDatabase(async (admin, pool) => {
    await admin.query(readFileSync(new URL("../../../lib/db/migrations/0016_reminders.sql", import.meta.url), "utf8"));
    const { scheduleAppointmentReminders, cancelAppointmentReminders, setClinicReminderPreference, setPatientReminderOptOut } =
      await import("../src/reminders/lifecycle");
    const { dispatchDueReminders } = await import("../src/reminders/dispatcher");
    const seeds = ["clinics", "doctors", "patients", "appointments", "patient_visit_history", "calendar_app_export"];
    async function snapshot() {
      const hashes: string[] = [];
      for (const table of seeds) hashes.push((await admin.query(
        `SELECT md5(string_agg(row_to_json(t)::text,',' ORDER BY row_to_json(t)::text)) AS hash FROM public.${table} t`)).rows[0].hash);
      return hashes;
    }
    const before = await snapshot();
    // All mutations are inside the disposable clone; no workspace fixture changes.
    await admin.query("DELETE FROM operational.notifications");
    const { rows: [reference] } = await admin.query(`SELECT a.clinic_id,a.doctor_id,a.patient_id
      FROM operational.appointments a JOIN operational.patients p ON p.patient_id=a.patient_id
      WHERE p.merged_into_id IS NULL LIMIT 1`);
    assert(reference);
    const now = new Date("2038-01-04T08:00:00Z");
    const starts = new Date("2038-01-06T08:00:00Z");
    async function tx<T>(work: (client: PoolClient) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(761910)");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    }
    await tx(async client => {
      await setClinicReminderPreference(client, reference.clinic_id, true, now);
      await setPatientReminderOptOut(client, reference.patient_id, false, now);
    });
    const { rows: [appointment] } = await admin.query(`INSERT INTO operational.appointments
      (clinic_id,doctor_id,patient_id,scheduled_at,duration_minutes,booking_method,status)
      VALUES($1,$2,$3,$4,30,'phone','booked') RETURNING appointment_id`,
    [reference.clinic_id, reference.doctor_id, reference.patient_id, starts]);
    const id = appointment.appointment_id;
    const messages = async () => (await admin.query(
      "SELECT * FROM operational.notifications WHERE appointment_id=$1 ORDER BY id", [id])).rows;
    await assert.rejects(tx(async client => {
      await scheduleAppointmentReminders(client, id, now);
      throw new Error("forced rollback");
    }));
    assert.equal((await messages()).length, 0);
    await Promise.all(Array.from({ length: 6 }, () => tx(client => scheduleAppointmentReminders(client, id, now))));
    assert.equal((await messages()).length, 2);
    assert((await messages()).every(n => n.status === "pending"));
    const due = new Date(starts.getTime() - 24 * 3600000);
    await admin.query(`CREATE FUNCTION operational.reminder_test_failure() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'forced receipt failure'; END $$;
      CREATE TRIGGER reminder_test_failure BEFORE UPDATE ON operational.notifications
      FOR EACH ROW WHEN (NEW.status='simulated') EXECUTE FUNCTION operational.reminder_test_failure()`);
    await assert.rejects(dispatchDueReminders({ now: due }), /forced receipt failure/);
    assert((await messages()).every(n => n.status === "pending" && n.receipt === null));
    await admin.query(`DROP TRIGGER reminder_test_failure ON operational.notifications;
      DROP FUNCTION operational.reminder_test_failure()`);
    const results = await Promise.all([dispatchDueReminders({ now: due }), dispatchDueReminders({ now: due })]);
    assert.equal(results.reduce((sum, r) => sum + r.sent, 0), 1);
    assert.equal((await messages()).filter(n => n.receipt?.simulated).length, 1);
    // A new invocation reconstructs all progress from DB, not process memory.
    assert.deepEqual(await dispatchDueReminders({ now: due }), { sent: 0, cancelled: 0 });
    await tx(async client => {
      await cancelAppointmentReminders(client, id, now, "appointment_changed");
      await client.query(`UPDATE operational.appointments SET scheduled_at=scheduled_at+interval '1 day',
        reminder_schedule_version=reminder_schedule_version+1 WHERE appointment_id=$1`, [id]);
      await scheduleAppointmentReminders(client, id, now);
    });
    assert.equal((await messages()).length, 4);
    assert.equal((await messages()).filter(n => n.status === "simulated").length, 1);
    const restart = JSON.parse(execFileSync(process.execPath, ["--import", "tsx",
      fileURLToPath(new URL("./reminder-restart-probe.ts", import.meta.url)),
      new Date(due.getTime() + 86400000).toISOString()], { encoding: "utf8" }));
    assert.equal(restart.sent, 1, "fresh OS process recovers persisted pending work");
    const replay = JSON.parse(execFileSync(process.execPath, ["--import", "tsx",
      fileURLToPath(new URL("./reminder-restart-probe.ts", import.meta.url)),
      new Date(due.getTime() + 86400000).toISOString()], { encoding: "utf8" }));
    assert.equal(replay.sent, 0, "restart never repeats durable simulated receipt");
    await tx(client => setPatientReminderOptOut(client, reference.patient_id, true, now));
    assert.equal((await messages()).filter(n => n.status === "pending").length, 0);
    assert.equal((await dispatchDueReminders({ now: new Date("2038-01-10T08:00:00Z") })).sent, 0);
    await tx(async client => {
      await setPatientReminderOptOut(client, reference.patient_id, false, now);
      await setClinicReminderPreference(client, reference.clinic_id, true, now);
    });
    assert.equal((await messages()).length, 4, "reenablement never backfills");
    await tx(async client => {
      await client.query(`UPDATE operational.appointments SET scheduled_at=$2,
        reminder_schedule_version=reminder_schedule_version+1 WHERE appointment_id=$1`,
      [id, new Date(now.getTime() + 3600000)]);
      await scheduleAppointmentReminders(client, id, now);
    });
    assert.equal((await messages()).filter(n => n.cancellation_reason === "missed_window").length, 2);
    assert.deepEqual(await snapshot(), before);
  });
});
