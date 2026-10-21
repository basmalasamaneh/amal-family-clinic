import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod/v4";
import { type Auth, forbidden } from "../lib/auth";
import { ApiError, fail } from "../lib/auth-errors";
import { patientScopeSql } from "../lib/patient-access";
import { canonical, checkAppointmentInContext, createAppointment, transaction } from "../appointments/service";
import { closeOffer, history, reconcileWaitlist } from "./lifecycle";

const id = z.number().int().positive().max(2147483647);
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const entryInput = z.object({
  clientOpId: z.uuid(), patientId: id, doctorId: id,
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(v => new Set(v).size === v.length),
  windowStart: clock, windowEnd: clock,
}).strict().refine(v => v.windowStart < v.windowEnd);
export const decisionInput = z.object({
  clientOpId: z.uuid(), decision: z.enum(["accept", "decline"]),
  overrideReason: z.string().trim().min(1).max(2000).optional(),
}).strict();
function reception(actor: Auth): number {
  if (actor.role !== "front-desk" || actor.clinicId === null) throw forbidden();
  return actor.clinicId;
}
function projectEntry(e: any) {
  return { id: e.id, patientId: e.patient_id, patientName: e.patient_name, doctorId: e.doctor_id, doctorName: e.doctor_name,
    weekdays: e.weekdays, windowStart: e.window_start, windowEnd: e.window_end, requestedAt: e.requested_at.toISOString(), status: e.status };
}
function projectOffer(f: any) {
  return { id: f.id, entryId: f.entry_id, opportunityId: f.opportunity_id, patientId: f.patient_id, patientName: f.patient_name,
    doctorId: f.doctor_id, doctorName: f.doctor_name, startsAt: f.starts_at.toISOString(), endsAt: f.ends_at.toISOString(),
    createdAt: f.created_at.toISOString(), expiresAt: f.expires_at.toISOString(), status: f.status,
    notificationStatus: f.notification_status === "cancelled" && ["clinic_disabled", "patient_opt_out"].includes(f.notification_reason)
      ? "suppressed" : f.notification_status, notificationReason: f.notification_reason, appointmentId: f.appointment_id };
}
const entrySelect = `SELECT e.*,p.patient_name,d.doctor_name FROM operational.waitlist_entries e
  JOIN operational.patients p ON p.patient_id=e.patient_id JOIN operational.doctors d ON d.doctor_id=e.doctor_id`;
const offerSelect = `SELECT f.*,o.starts_at,o.ends_at,p.patient_name,d.doctor_name,
  n.status AS notification_status,n.cancellation_reason AS notification_reason
  FROM operational.waitlist_offers f JOIN operational.waitlist_opportunities o ON o.id=f.opportunity_id
  JOIN operational.patients p ON p.patient_id=f.patient_id JOIN operational.doctors d ON d.doctor_id=f.doctor_id
  JOIN operational.notifications n ON n.waitlist_offer_id=f.id`;
async function offer(client: PoolClient, clinicId: number, offerId: number) {
  const { rows: [f] } = await client.query(`${offerSelect} WHERE f.clinic_id=$1 AND f.id=$2`, [clinicId, offerId]);
  if (!f) throw fail(404, "NOT_FOUND", "notFound");
  return f;
}
function booking(f: any, clientOpId?: string, overrideReason?: string) {
  return { clinicId: f.clinic_id, doctorId: f.doctor_id, patientId: f.patient_id,
    startsAt: f.starts_at.toISOString(), endsAt: f.ends_at.toISOString(), source: "phone", clientOpId, overrideReason };
}
async function receipt(client: PoolClient, actor: Auth, clientOpId: string, target: string, payload: unknown) {
  const hash = createHash("sha256").update(canonical({ target, payload })).digest("hex");
  const { rows: [prior] } = await client.query("SELECT * FROM operational.waitlist_operations WHERE client_op_id=$1", [clientOpId]);
  if (prior && (prior.clinic_id !== actor.clinicId || prior.actor_id !== actor.id ||
    prior.device_id !== (actor.device?.id ?? null) || prior.payload_hash !== hash)) throw fail(409, "IDEMPOTENCY_CONFLICT", "conflict");
  return { hash, prior };
}
async function record(client: PoolClient, actor: Auth, clientOpId: string, hash: string, result: unknown) {
  await client.query(`INSERT INTO operational.waitlist_operations(client_op_id,actor_id,clinic_id,device_id,payload_hash,result)
    VALUES($1,$2,$3,$4,$5,$6)`, [clientOpId, actor.id, actor.clinicId, actor.device?.id ?? null, hash, JSON.stringify(result)]);
}
export async function listWaitlist(auth: Auth) {
  return transaction(auth, async (client, actor, now) => {
    const clinicId = reception(actor);
    await reconcileWaitlist(client, now, clinicId);
    const { rows: entries } = await client.query(`${entrySelect} WHERE e.clinic_id=$1 ORDER BY e.requested_at,e.id`, [clinicId]);
    const { rows: offers } = await client.query(`${offerSelect} WHERE f.clinic_id=$1 ORDER BY f.created_at,f.id`, [clinicId]);
    const { rows: opportunities } = await client.query("SELECT * FROM operational.waitlist_opportunities WHERE clinic_id=$1 ORDER BY created_at,id", [clinicId]);
    const { rows: [clock] } = await client.query("SELECT clock_timestamp() AS now");
    return { entries: entries.map(projectEntry), offers: offers.map(projectOffer),
      opportunities: opportunities.map(o => ({ id: o.id, doctorId: o.doctor_id, startsAt: o.starts_at.toISOString(),
        endsAt: o.ends_at.toISOString(), status: o.status })), serverNow: clock.now.toISOString() };
  });
}
export async function createWaitlistEntry(auth: Auth, raw: unknown) {
  const input = entryInput.parse(raw);
  return transaction(auth, async (client, actor, now) => {
    const clinicId = reception(actor);
    const { hash, prior } = await receipt(client, actor, input.clientOpId, "entry", input);
    if (prior) return prior.result;
    const { rows: [valid] } = await client.query(`SELECT
      EXISTS(SELECT 1 FROM operational.patients p WHERE p.patient_id=$2 AND ${patientScopeSql("$1")}) AS patient,
      EXISTS(SELECT 1 FROM operational.doctors WHERE clinic_id=$1 AND doctor_id=$3) AS doctor`,
    [clinicId, input.patientId, input.doctorId]);
    if (!valid.patient || !valid.doctor) throw fail(422, "INVALID_BOOKING_REFERENCE", "validation");
    const { rows: [e] } = await client.query(`INSERT INTO operational.waitlist_entries
      (clinic_id,patient_id,doctor_id,weekdays,window_start,window_end,requested_at,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [clinicId, input.patientId, input.doctorId, input.weekdays, input.windowStart, input.windowEnd, now, actor.id]);
    await history(client, clinicId, "entry_created", { entryId: e.id, actorId: actor.id }, now);
    const { rows: [entry] } = await client.query(`${entrySelect} WHERE e.id=$1`, [e.id]);
    const result = projectEntry(entry);
    await record(client, actor, input.clientOpId, hash, result);
    return result;
  });
}
export async function checkWaitlistOffer(auth: Auth, offerId: number, raw: unknown) {
  z.object({}).strict().parse(raw);
  // Business errors are returned, then thrown after commit so expiry/recovery is durable.
  const outcome = await transaction(auth, async (client, actor, now) => {
    const clinicId = reception(actor);
    await offer(client, clinicId, offerId);
    await reconcileWaitlist(client, now, clinicId);
    const f = await offer(client, clinicId, offerId);
    if (f.status !== "active") return { error: fail(409, "WAITLIST_OFFER_INACTIVE", "waitlistOfferInactive") };
    return { value: await checkAppointmentInContext({ client, actor, now }, booking(f)) };
  });
  if (outcome.error) throw outcome.error;
  return outcome.value;
}
export async function decideWaitlistOffer(auth: Auth, offerId: number, raw: unknown) {
  const input = decisionInput.parse(raw);
  const outcome = await transaction(auth, async (client, actor, now) => {
    const clinicId = reception(actor);
    await offer(client, clinicId, offerId);
    const { hash, prior } = await receipt(client, actor, input.clientOpId, `decision:${offerId}`, input);
    if (prior) {
      if (prior.result.error) {
        const e = prior.result.error;
        return { error: fail(e.status, e.code, e.key, e.params) };
      }
      return { value: prior.result };
    }
    await reconcileWaitlist(client, now, clinicId);
    const f = await offer(client, clinicId, offerId);
    if (f.status === "active") {
      const { rows: [clock] } = await client.query("SELECT clock_timestamp() AS now");
      if (clock.now >= f.expires_at || clock.now >= f.starts_at) {
        await reconcileWaitlist(client, clock.now, clinicId);
      } else if (input.decision === "decline") {
        await closeOffer(client, f, "declined", clock.now, actor.id);
      } else {
        // Use authoritative server time after lock acquisition and immediately before
        // booking. An offer is NOT a hold and confers no conflict exemptions.
        let appointment;
        try {
          appointment = await createAppointment(actor, booking(f, input.clientOpId, input.overrideReason),
            { client, actor, now: clock.now });
        } catch (error) {
          // createAppointment has already rolled back its business savepoint and
          // written protected conflict evidence. Preserve it, never book a bypass.
          if (!(error instanceof ApiError) || error.status !== 409) throw error;
          if (error.code !== "IDEMPOTENCY_CONFLICT") await record(client, actor, input.clientOpId, hash,
            { error: { status: error.status, code: error.code, key: error.key, params: error.params } });
          return { error };
        }
        await closeOffer(client, f, "accepted", clock.now, actor.id, appointment.id);
        await client.query("UPDATE operational.waitlist_entries SET status='fulfilled' WHERE id=$1", [f.entry_id]);
        await client.query("UPDATE operational.waitlist_opportunities SET status='fulfilled' WHERE id=$1", [f.opportunity_id]);
        await history(client, clinicId, "fulfilled", { entryId: f.entry_id, offerId: f.id,
          opportunityId: f.opportunity_id, actorId: actor.id }, clock.now);
      }
      await reconcileWaitlist(client, now, clinicId);
    }
    const result = projectOffer(await offer(client, clinicId, offerId));
    await record(client, actor, input.clientOpId, hash, result);
    return { value: result };
  });
  if (outcome.error) throw outcome.error;
  return outcome.value;
}
