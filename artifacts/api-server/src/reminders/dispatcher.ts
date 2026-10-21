import { pool } from "@workspace/db";
import { simulator } from "./simulator";
import { logger } from "../lib/logger";

/** Reset admission -> scheduling -> rows. All effects and receipt commit together.
 * Cancellation/opt-out committed first wins; earlier sends remain history.
 * No startup/backfill scan of appointments, only versioned notification records. */
export async function dispatchDueReminders(options: { now?: Date; limit?: number } = {}) {
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Invalid reminder batch limit");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock_shared(761930)");
    await client.query("SELECT pg_advisory_xact_lock(761910)");
    const { rows: [clock] } = await client.query("SELECT clock_timestamp() AS now");
    const now = options.now ?? clock.now;
    const { rows } = await client.query(`SELECT n.id,n.appointment_id,n.schedule_version,n.offset_hours,n.text_ar,n.text_en,
      a.status AS appointment_status,a.scheduled_at AS appointment_start,a.reminder_schedule_version,
      c.reminders_enabled,p.reminder_opt_out,p.merged_into_id
      FROM operational.notifications n JOIN operational.appointments a ON a.appointment_id=n.appointment_id
      JOIN operational.clinics c ON c.clinic_id=a.clinic_id JOIN operational.patients p ON p.patient_id=a.patient_id
      WHERE n.schedule_version IS NOT NULL AND n.status='pending' AND n.scheduled_at<=$1
      ORDER BY n.scheduled_at,n.id LIMIT $2 FOR UPDATE OF n`, [now, limit]);
    let sent = 0, cancelled = 0;
    for (const n of rows) {
      const sendTime = options.now ?? (await client.query("SELECT clock_timestamp() AS now")).rows[0].now;
      const reason = !n.reminders_enabled ? "clinic_disabled" : n.reminder_opt_out || n.merged_into_id ? "patient_opt_out"
        : !["booked", "double_booked"].includes(n.appointment_status) ? "appointment_inactive"
        : n.schedule_version !== n.reminder_schedule_version ? "stale_schedule"
        : n.appointment_start.getTime() <= sendTime.getTime()
          || (n.offset_hours === 24 && sendTime.getTime() >= n.appointment_start.getTime() - 7200000)
          ? "missed_window" : null;
      if (reason) {
        await client.query(`UPDATE operational.notifications SET status='cancelled',cancelled_at=$2,cancellation_reason=$3 WHERE id=$1`, [n.id, sendTime, reason]);
        cancelled++;
      } else {
        const receipt = await simulator.deliver({
          idempotencyKey: `reminder:${n.id}:${n.appointment_id}:${n.schedule_version}`,
          message: { ar: n.text_ar, en: n.text_en },
        });
        await client.query(`UPDATE operational.notifications SET status='simulated',sent_at=$2,receipt=$3 WHERE id=$1`,
          [n.id, sendTime, JSON.stringify(receipt)]);
        sent++;
      }
    }
    await client.query("COMMIT");
    return { sent, cancelled };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Sequential ticks avoid overlapping local batches. Fail closed on absent schema;
 * retry permits an operator to migrate without a restart. Never run migrations. */
export function startReminderWorker(intervalMs = 15000) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function tick() {
    try { await dispatchDueReminders(); }
    catch { logger.warn({ code: "REMINDER_DISPATCH_UNAVAILABLE" }, "Simulated reminder dispatcher unavailable"); }
    if (!stopped) { timer = setTimeout(() => void tick(), intervalMs); timer.unref(); }
  }
  timer = setTimeout(() => void tick(), intervalMs);
  timer.unref();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
