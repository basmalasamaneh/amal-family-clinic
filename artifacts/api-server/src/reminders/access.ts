import type { PoolClient } from "pg";
import { z } from "zod/v4";
import { type Auth, forbidden } from "../lib/auth";
import { fail } from "../lib/auth-errors";
import { patientScopeSql } from "../lib/patient-access";
import { transaction } from "../appointments/service";
import { setClinicReminderPreference, setPatientReminderOptOut } from "./lifecycle";

export const reminderId = z.coerce.number().int().positive().max(2147483647);
const query = z.object({
  clinicId: reminderId, limit: reminderId.max(100).default(25),
  cursor: reminderId.optional(),
  status: z.enum(["scheduled", "sent", "cancelled"]).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
}).strict().refine(v => !v.from || !v.to || Date.parse(v.from) < Date.parse(v.to));
const clinicInput = z.object({ enabled: z.boolean() }).strict();
const patientInput = z.object({ optedOut: z.boolean() }).strict();

// Network-wide administration is not permission to inspect arbitrary reminder logs.
// This feature deliberately requires the actor's own assigned clinic.
async function ownClinic(client: PoolClient, actor: Auth, clinicId: number) {
  if (actor.clinicId !== clinicId) throw forbidden();
  if (actor.role === "admin") return true;
  if (actor.role === "front-desk") return false;
  if (actor.role === "doctor") {
    const { rows } = await client.query(
      "SELECT 1 FROM operational.clinic_managers WHERE clinic_id=$1 AND user_id=$2", [clinicId, actor.id]);
    if (rows.length) return true;
  }
  throw forbidden();
}
async function localPatient(client: PoolClient, actor: Auth, patientId: number) {
  if (actor.role !== "front-desk" || actor.clinicId === null) throw forbidden();
  const { rows: [patient] } = await client.query(
    `SELECT p.reminder_opt_out FROM operational.patients p
     WHERE p.patient_id=$2 AND ${patientScopeSql("$1")}`, [actor.clinicId, patientId]);
  if (!patient) throw fail(404, "NOT_FOUND", "notFound");
  return patient;
}
async function auditPreference(client: PoolClient, actor: Auth, action: string, patientId?: number) {
  await client.query(`INSERT INTO operational.audit_log(user_id,clinic_id,patient_id,action,detail)
    VALUES($1,$2,$3,$4,'{}')`, [actor.id, actor.clinicId, patientId ?? null, action]);
}
export async function listReminderLog(auth: Auth, input: unknown) {
  const q = query.parse(input);
  return transaction(auth, async (client, actor) => {
    await ownClinic(client, actor, q.clinicId);
    const status = q.status === "scheduled" ? "pending" : q.status === "sent" ? "simulated" : q.status;
    const { rows } = await client.query(
      `SELECT id,status,text_ar,text_en,scheduled_at,sent_at,cancelled_at,cancellation_reason
       FROM operational.notifications WHERE clinic_id=$1 AND
         (schedule_version IS NOT NULL OR ($7::boolean AND waitlist_offer_id IS NOT NULL))
       AND ($2::integer IS NULL OR id<$2)
       AND ($3::text IS NULL OR status::text=$3)
       AND ($4::timestamptz IS NULL OR scheduled_at >= $4)
       AND ($5::timestamptz IS NULL OR scheduled_at < $5)
       ORDER BY id DESC LIMIT $6`,
      [q.clinicId, q.cursor ?? null, status ?? null, q.from ?? null, q.to ?? null, q.limit + 1, actor.role === "front-desk"]);
    const items = rows.slice(0, q.limit).map(r => ({
      id: r.id, status: r.status === "pending" ? "scheduled" : r.status === "simulated" ? "sent" : "cancelled",
      textAr: r.text_ar, textEn: r.text_en, scheduledAt: r.scheduled_at.toISOString(),
      sentAt: r.sent_at?.toISOString() ?? null, cancelledAt: r.cancelled_at?.toISOString() ?? null,
      cancellationReason: r.cancellation_reason,
    }));
    return { items, nextCursor: rows.length > q.limit ? items.at(-1)!.id : null };
  }, { delegation: true });
}
export async function clinicPreference(auth: Auth, clinicId: number, input?: unknown) {
  const change = input === undefined ? undefined : clinicInput.parse(input);
  return transaction(auth, async (client, actor, now) => {
    const canManage = await ownClinic(client, actor, clinicId);
    if (change && !canManage) throw forbidden();
    const { rows: [clinic] } = await client.query(
      "SELECT reminders_enabled FROM operational.clinics WHERE clinic_id=$1", [clinicId]);
    if (!clinic) throw fail(404, "NOT_FOUND", "notFound");
    if (change) {
      await setClinicReminderPreference(client, clinicId, change.enabled, now);
      await auditPreference(client, actor, "reminder.clinic.preference");
    }
    return { enabled: change?.enabled ?? clinic.reminders_enabled, canManage };
  }, { delegation: true });
}
export async function patientPreference(auth: Auth, patientId: number, input?: unknown) {
  const change = input === undefined ? undefined : patientInput.parse(input);
  return transaction(auth, async (client, actor, now) => {
    const patient = await localPatient(client, actor, patientId);
    if (change) {
      await setPatientReminderOptOut(client, patientId, change.optedOut, now);
      await auditPreference(client, actor, "reminder.patient.preference", patientId);
    }
    return { optedOut: change?.optedOut ?? patient.reminder_opt_out };
  });
}
