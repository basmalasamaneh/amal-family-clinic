import type { PoolClient } from "pg";
import { pool } from "@workspace/db";
import { evaluate } from "../appointments/engine";
import { simulator } from "../reminders/simulator";
import { renderReminder } from "../reminders/templates";
import { logger } from "../lib/logger";
import { patientScopeSql } from "../lib/patient-access";
import { matchesWindow } from "./matching";

export async function history(client: PoolClient, clinicId: number, event: string, ids: {
  entryId?: number; opportunityId?: number; offerId?: number; actorId?: number; reason?: string;
}, now: Date) {
  await client.query(`INSERT INTO operational.waitlist_transitions
    (clinic_id,actor_id,entry_id,opportunity_id,offer_id,event,reason,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
  [clinicId, ids.actorId ?? null, ids.entryId ?? null, ids.opportunityId ?? null, ids.offerId ?? null, event, ids.reason ?? null, now]);
  await client.query(`INSERT INTO operational.audit_log(user_id,clinic_id,action,detail)
    VALUES($1,$2,$3,$4)`, [ids.actorId ?? null, clinicId, `waitlist.${event}`, JSON.stringify(ids)]);
}

/** Slot-wide validity has no candidate patient exemptions, hold ownership, or
 * patient identity disclosure. Holds block offers just as normal booking. */
export async function slotAvailable(client: PoolClient, opportunity: any, now: Date) {
  if (opportunity.starts_at.getTime() <= now.getTime()) return false;
  const { rows: [c] } = await client.query("SELECT * FROM operational.clinics WHERE clinic_id=$1", [opportunity.clinic_id]);
  const { rows: booked } = await client.query(`SELECT appointment_id FROM operational.appointments
    WHERE doctor_id=$1 AND status IN ('booked','double_booked') AND scheduled_at<$3
      AND scheduled_at+duration_minutes*interval '1 minute'>$2`, [opportunity.doctor_id, opportunity.starts_at, opportunity.ends_at]);
  const { rows: held } = await client.query(`SELECT token FROM operational.appointment_holds
    WHERE doctor_id=$1 AND expires_at>$4 AND starts_at<$3
      AND starts_at+duration_minutes*interval '1 minute'>$2`, [opportunity.doctor_id, opportunity.starts_at, opportunity.ends_at, now]);
  if (!c || booked.length || held.length) return false;
  try {
    return evaluate({
      appointment: { id: 0, clinicId: opportunity.clinic_id, doctorId: opportunity.doctor_id, patientId: 0,
        startAt: opportunity.starts_at.toISOString(), durationMinutes: (opportunity.ends_at - opportunity.starts_at) / 60000, status: "booked" },
      appointments: [], holds: [], settings: { workingDays: c.working_days, openTime: c.open_time,
        closeTime: c.close_time, slotMinutes: c.slot_minutes, timezone: c.timezone },
      now, ownerId: -1, canOverride: false, visible: () => false,
    }).ok;
  } catch { return false; } // Invalid clinic settings cannot manufacture a usable slot.
}

export async function closeOffer(client: PoolClient, offer: any, status: string, now: Date, actorId?: number, appointmentId?: number) {
  await client.query("UPDATE operational.waitlist_offers SET status=$2,appointment_id=$3 WHERE id=$1 AND status='active'",
    [offer.id, status, appointmentId ?? null]);
  await client.query(`UPDATE operational.notifications SET status='cancelled',cancelled_at=$2,cancellation_reason='offer_'||$3
    WHERE waitlist_offer_id=$1 AND status='pending'`, [offer.id, now, status]);
  await history(client, offer.clinic_id, status, { offerId: offer.id, opportunityId: offer.opportunity_id,
    entryId: offer.entry_id, actorId }, now);
}

async function notify(client: PoolClient, offer: any, opportunity: any, now: Date) {
  const { rows: [c] } = await client.query(`SELECT c.clinic_name,c.reminders_enabled,p.reminder_opt_out,p.merged_into_id
    FROM operational.clinics c CROSS JOIN operational.patients p WHERE c.clinic_id=$1 AND p.patient_id=$2`,
  [offer.clinic_id, offer.patient_id]);
  const rendered = renderReminder({ clinicDisplayName: c.clinic_name, startsAt: opportunity.starts_at });
  const message = { ar: `عرض قائمة الانتظار — غير محجوز\n${rendered.ar}`, en: `Waitlist offer — not reserved\n${rendered.en}` };
  const reason = !c.reminders_enabled ? "clinic_disabled" : c.reminder_opt_out || c.merged_into_id ? "patient_opt_out" : null;
  await client.query(`INSERT INTO operational.notifications
    (clinic_id,patient_id,waitlist_offer_id,message_key,status,scheduled_at,text_ar,text_en,cancelled_at,cancellation_reason)
    VALUES($1,$2,$3,'waitlist.offer',$4,$5,$6,$7,$8,$9)`,
  [offer.clinic_id, offer.patient_id, offer.id, reason ? "cancelled" : "pending", now, message.ar, message.en, reason ? now : null, reason]);
  if (!reason) {
    const receipt = await simulator.deliver({ idempotencyKey: `waitlist:${offer.id}`, message });
    await client.query("UPDATE operational.notifications SET status='simulated',sent_at=$2,receipt=$3 WHERE waitlist_offer_id=$1 AND status='pending'",
      [offer.id, now, JSON.stringify(receipt)]);
  }
  await history(client, offer.clinic_id, reason ? "notification_suppressed" : "notification_simulated",
    { offerId: offer.id, entryId: offer.entry_id, opportunityId: opportunity.id, reason: reason ?? undefined }, now);
}

/** Requires reset-admission then scheduling locks. Only operational opportunities
 * are scanned; never scan historical cancelled appointments. */
export async function reconcileWaitlist(client: PoolClient, now: Date, clinicId?: number, controlledClock = false) {
  const { rows } = await client.query(`SELECT * FROM operational.waitlist_opportunities
    WHERE status='open' AND ($1::integer IS NULL OR clinic_id=$1) ORDER BY created_at,id`, [clinicId ?? null]);
  for (const opportunity of rows) {
    // Recovery is not a replay of historical deadlines. Production time advances
    // per opportunity; test callers alone can supply a controlled authoritative clock.
    if (!controlledClock) now = (await client.query("SELECT clock_timestamp() AS now")).rows[0].now;
    const { rows: [active] } = await client.query("SELECT * FROM operational.waitlist_offers WHERE opportunity_id=$1 AND status='active'", [opportunity.id]);
    const available = await slotAvailable(client, opportunity, now);
    if (!available) {
      if (active) await closeOffer(client, active, "unavailable", now);
      await client.query("UPDATE operational.waitlist_opportunities SET status='unavailable' WHERE id=$1", [opportunity.id]);
      await history(client, opportunity.clinic_id, "opportunity_unavailable", { opportunityId: opportunity.id, reason: "slot_unavailable" }, now);
      continue;
    }
    if (active && active.expires_at.getTime() > now.getTime()) continue;
    if (active) await closeOffer(client, active, "expired", now);
    const { rows: candidates } = await client.query(`SELECT e.* FROM operational.waitlist_entries e
      JOIN operational.patients p ON p.patient_id=e.patient_id
      WHERE e.clinic_id=$1 AND e.doctor_id=$2 AND e.status='active' AND ${patientScopeSql("$1")}
        AND NOT EXISTS(SELECT 1 FROM operational.waitlist_offers f WHERE f.entry_id=e.id AND (f.opportunity_id=$3 OR f.status='active'))
      ORDER BY e.requested_at,e.id`, [opportunity.clinic_id, opportunity.doctor_id, opportunity.id]);
    const candidate = candidates.find(e => matchesWindow(e, opportunity.starts_at, opportunity.ends_at));
    if (!candidate) {
      // An entry currently offered elsewhere may become eligible later. Keep the
      // opportunity open in that case, but never re-offer a previously tried entry.
      const { rows: busy } = await client.query(`SELECT e.* FROM operational.waitlist_entries e
        JOIN operational.patients p ON p.patient_id=e.patient_id
        WHERE e.clinic_id=$1 AND e.doctor_id=$2 AND e.status='active' AND ${patientScopeSql("$1")}
          AND NOT EXISTS(SELECT 1 FROM operational.waitlist_offers f WHERE f.entry_id=e.id AND f.opportunity_id=$3)`,
      [opportunity.clinic_id, opportunity.doctor_id, opportunity.id]);
      if (busy.some(e => matchesWindow(e, opportunity.starts_at, opportunity.ends_at))) continue;
      await client.query("UPDATE operational.waitlist_opportunities SET status='exhausted' WHERE id=$1", [opportunity.id]);
      await history(client, opportunity.clinic_id, "opportunity_exhausted", { opportunityId: opportunity.id, reason: "no_matching_entry" }, now);
      continue;
    }
    if (!controlledClock) now = (await client.query("SELECT clock_timestamp() AS now")).rows[0].now;
    if (opportunity.starts_at <= now) {
      await client.query("UPDATE operational.waitlist_opportunities SET status='unavailable' WHERE id=$1", [opportunity.id]);
      await history(client, opportunity.clinic_id, "opportunity_unavailable", { opportunityId: opportunity.id, reason: "slot_started" }, now);
      continue;
    }
    const { rows: [offer] } = await client.query(`INSERT INTO operational.waitlist_offers
      (clinic_id,doctor_id,patient_id,entry_id,opportunity_id,created_at,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$6::timestamptz+interval '15 minutes') RETURNING *`,
    [opportunity.clinic_id, opportunity.doctor_id, candidate.patient_id, candidate.id, opportunity.id, now]);
    await history(client, opportunity.clinic_id, "offer_created", { entryId: candidate.id, opportunityId: opportunity.id, offerId: offer.id }, now);
    await notify(client, offer, opportunity, now);
  }
}

/** Called exclusively inside updateAppointment's committed mutation transaction.
 * Capture the ORIGINAL interval even if cancel+move were submitted together. */
export async function cancelledAppointment(client: PoolClient, original: {
  appointment_id: number; clinic_id: number; doctor_id: number; scheduled_at: Date; duration_minutes: number; version: number;
}, cancellationVersion: number, clientOpId: string, actorId: number, now: Date) {
  const { rows: [opportunity] } = await client.query(`INSERT INTO operational.waitlist_opportunities
    (clinic_id,doctor_id,source_appointment_id,cancellation_version,cancellation_op_id,starts_at,ends_at,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id`,
  [original.clinic_id, original.doctor_id, original.appointment_id, cancellationVersion, clientOpId,
    original.scheduled_at, new Date(original.scheduled_at.getTime() + original.duration_minutes * 60000), now]);
  if (!opportunity) return;
  await history(client, original.clinic_id, "opportunity_created", { opportunityId: opportunity.id, actorId }, now);
  await reconcileWaitlist(client, now, original.clinic_id);
}

export async function processWaitlist(options: { now?: Date } = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock_shared(761930)");
    await client.query("SELECT pg_advisory_xact_lock(761910)");
    const { rows: [clock] } = await client.query("SELECT clock_timestamp() AS now");
    await reconcileWaitlist(client, options.now ?? clock.now, undefined, options.now !== undefined);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export function startWaitlistWorker(intervalMs = 15000) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    try { await processWaitlist(); }
    catch { logger.warn({ code: "WAITLIST_PROCESSING_UNAVAILABLE" }, "Waitlist processing unavailable"); }
    if (!stopped) { timer = setTimeout(() => void tick(), intervalMs); timer.unref(); }
  };
  timer = setTimeout(() => void tick(), 0);
  timer.unref();
  return () => { stopped = true; clearTimeout(timer); };
}
