import type { PoolClient } from "pg";
import { renderReminder } from "./templates";

export type CancellationReason = "missed_window" | "appointment_changed" | "appointment_inactive" | "clinic_disabled" | "patient_opt_out" | "stale_schedule";
/** All helpers require an active transaction holding scheduling lock 761910. */
export async function cancelAppointmentReminders(client: PoolClient, appointmentId: number, now: Date, reason: CancellationReason) {
  await client.query(`UPDATE operational.notifications SET status='cancelled',cancelled_at=$2,cancellation_reason=$3
    WHERE appointment_id=$1 AND schedule_version IS NOT NULL AND status='pending'`, [appointmentId, now, reason]);
}
export async function setClinicReminderPreference(client: PoolClient, clinicId: number, enabled: boolean, now: Date) {
  await client.query("UPDATE operational.clinics SET reminders_enabled=$2 WHERE clinic_id=$1", [clinicId, enabled]);
  if (!enabled) await client.query(`UPDATE operational.notifications SET status='cancelled',cancelled_at=$2,cancellation_reason='clinic_disabled'
    WHERE clinic_id=$1 AND schedule_version IS NOT NULL AND status='pending'`, [clinicId, now]);
}
export async function setPatientReminderOptOut(client: PoolClient, patientId: number, optedOut: boolean, now: Date) {
  await client.query("UPDATE operational.patients SET reminder_opt_out=$2 WHERE patient_id=$1", [patientId, optedOut]);
  if (optedOut) await client.query(`UPDATE operational.notifications SET status='cancelled',cancelled_at=$2,cancellation_reason='patient_opt_out'
    WHERE patient_id=$1 AND schedule_version IS NOT NULL AND status='pending'`, [patientId, now]);
}
export async function scheduleAppointmentReminders(client: PoolClient, appointmentId: number, now: Date) {
  const { rows: [a] } = await client.query(`SELECT a.appointment_id,a.clinic_id,a.patient_id,a.scheduled_at,
    a.reminder_schedule_version,c.clinic_name FROM operational.appointments a
    JOIN operational.clinics c ON c.clinic_id=a.clinic_id JOIN operational.patients p ON p.patient_id=a.patient_id
    WHERE a.appointment_id=$1 AND a.status IN ('booked','double_booked') AND a.scheduled_at>$2
      AND c.reminders_enabled AND NOT p.reminder_opt_out AND p.merged_into_id IS NULL`, [appointmentId, now]);
  if (!a) return;
  const text = renderReminder({ clinicDisplayName: a.clinic_name, startsAt: a.scheduled_at });
  for (const offset of [24, 2]) {
    const due = new Date(a.scheduled_at.getTime() - offset * 3600000);
    const missed = due.getTime() <= now.getTime();
    await client.query(`INSERT INTO operational.notifications
      (clinic_id,patient_id,appointment_id,message_key,status,scheduled_at,schedule_version,offset_hours,text_ar,text_en,cancelled_at,cancellation_reason)
      VALUES($1,$2,$3,'reminder.appointment',$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
    [a.clinic_id, a.patient_id, a.appointment_id, missed ? "cancelled" : "pending", due,
      a.reminder_schedule_version, offset, text.ar, text.en, missed ? now : null, missed ? "missed_window" : null]);
  }
}
