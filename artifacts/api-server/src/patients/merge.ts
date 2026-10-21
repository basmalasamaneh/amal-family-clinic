import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { canonicalPhone, normalizeName } from "@workspace/db/patient-search";
import { forbidden, type Auth } from "../lib/auth";
import { fail } from "../lib/auth-errors";
import { patientScopeSql } from "../lib/patient-access";
import { validBirthDate } from "./demographics";
import { setPatientReminderOptOut } from "../reminders/lifecycle";

const positive = z.number().int().positive().max(2147483647);
export const mergeInput = z.object({
  sourceId: positive, targetId: positive, sourceVersion: positive, targetVersion: positive,
  confirmed: z.literal(true), reason: z.string().trim().min(1).max(1000), clientOpId: z.string().uuid(),
}).strict();
const queryInput = z.object({
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(positive.max(100)).optional(),
  cursor: z.string().min(1).max(512).optional(),
}).strict();
type Identity = { patient_name: string | null; phone: string | null; dob: string | null };
type Patient = Identity & { patient_id: number; version: number; merged_into_id: number | null;
  created_clinic_id: number | null; guardian_name: string | null; guardian_relation: string | null };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const unsafe = (code = "MERGE_UNSAFE") => fail(409, code, "conflict");
const fields = "p.patient_id,p.patient_name,p.phone,p.dob::text,p.version,p.merged_into_id,p.created_clinic_id,p.guardian_name,p.guardian_relation";

/** Exact identity key, never fuzzy and never a missing-value equivalence. */
export function duplicateIdentity(row: Identity): string | null {
  if (!row.patient_name || !row.phone || !row.dob || !validBirthDate(row.dob)) return null;
  const name = normalizeName(row.patient_name), phone = canonicalPhone(row.phone);
  return name && phone ? JSON.stringify([name, row.dob, phone]) : null;
}
async function currentActor(client: PoolClient, auth: Auth, readOnly = false) {
  if (!["doctor", "front-desk"].includes(auth.role) || !auth.clinicId) throw forbidden();
  // Reauthorize after waiting for locks, including lost-response replays. Hold
  // actor/session/device locks until commit so revocations linearize with merge.
  const { rows: [row] } = await client.query(`SELECT u.id FROM operational.users u
    JOIN operational.auth_sessions s ON s.user_id=u.id
    WHERE u.id=$1 AND u.clinic_id=$2 AND u.role=$3 AND u.doctor_id IS NOT DISTINCT FROM $4
      AND s.token_digest=$5 AND s.revoked_at IS NULL
      AND ((u.role='receptionist' AND s.device_id IS NOT NULL AND s.absolute_expires_at>clock_timestamp())
        OR (u.role='doctor' AND s.last_seen_at>clock_timestamp()-interval '30 minutes'))
      AND s.device_id IS NOT DISTINCT FROM $6
    ${readOnly ? "" : "FOR SHARE OF u,s"}`,
  [auth.id, auth.clinicId, auth.role === "front-desk" ? "receptionist" : "doctor", auth.doctorId, auth.sessionDigest, auth.device?.id ?? null]);
  if (!row) throw forbidden();
  if (auth.device) {
    const { rowCount } = await client.query(`SELECT d.id FROM operational.devices d
      JOIN operational.auth_devices a ON a.device_id=d.id
      WHERE d.id=$1 AND d.clinic_id=$2 AND a.revoked_at IS NULL ${readOnly ? "" : "FOR SHARE OF d,a"}`, [auth.device.id, auth.clinicId]);
    if (!rowCount) throw forbidden();
  }
  if (auth.role === "doctor") {
    const { rowCount } = await client.query(`SELECT doctor_id FROM operational.doctors
      WHERE doctor_id=$1 AND clinic_id=$2 AND user_id=$3 ${readOnly ? "" : "FOR SHARE"}`, [auth.doctorId, auth.clinicId, auth.id]);
    if (!rowCount) throw forbidden();
  }
}
function scope(auth: Auth, includeAlias = false) {
  const local = includeAlias
    ? `(p.created_clinic_id=$1 OR EXISTS(SELECT 1 FROM operational.patient_clinic_access a WHERE a.patient_id=p.patient_id AND a.clinic_id=$1))`
    : patientScopeSql("$1");
  return `${local} AND ($2::integer IS NULL OR EXISTS(SELECT 1 FROM operational.patient_doctor_access a
    WHERE a.patient_id=p.patient_id AND a.clinic_id=$1 AND a.doctor_id=$2))`;
}
function scopeArgs(auth: Auth) { return [auth.clinicId, auth.role === "doctor" ? auth.doctorId : null]; }
async function transaction<T>(auth: Auth, mutate: boolean, work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(mutate ? "SELECT pg_advisory_xact_lock(160005)" : "SELECT pg_advisory_xact_lock_shared(160005)");
    // Sync conflict creation/resolution and appointment writes take this same
    // scheduling lock before reading references. Retain it through blocker
    // checks and commit: an open modern conflict cannot race a patient merge.
    if (mutate) await client.query("SELECT pg_advisory_xact_lock(761910)");
    await client.query("SELECT operational.lock_patient_merge_access()");
    await currentActor(client, auth);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    if (error && typeof error === "object" && "code" in error &&
      ["23503", "23505", "23514", "40001", "40P01"].includes(String(error.code))) throw unsafe();
    throw error;
  } finally { client.release(); }
}
export async function listPatientDuplicates(auth: Auth, raw: unknown) {
  const input = queryInput.parse(raw);
  return transaction(auth, false, async client => {
    const fingerprint = hash([auth.id, auth.clinicId, auth.role, auth.doctorId]);
    let after = [0, 0];
    if (input.cursor) {
      try {
        const cursor = z.object({ pair: z.tuple([positive, positive]), fingerprint: z.literal(fingerprint) }).strict()
          .parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")));
        after = cursor.pair;
      } catch { throw fail(400, "VALIDATION", "validation"); }
    }
    // SQL scope precedes both grouping and comparison. No phone/DOB is exposed.
    const { rows } = await client.query<Patient>(`SELECT ${fields} FROM operational.patients p
      WHERE ${scope(auth)} ORDER BY p.patient_id`, scopeArgs(auth));
    const groups = new Map<string, Patient[]>();
    for (const row of rows) {
      const key = duplicateIdentity(row);
      if (key) groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const pairs: [Patient, Patient][] = [];
    const limit = input.limit ?? 25;
    // Retain only the bounded page; duplicate groups can contain many records.
    for (const a of rows) {
      const key = duplicateIdentity(a);
      if (!key) continue;
      for (const b of groups.get(key) ?? []) {
        if (a.patient_id >= b.patient_id || a.patient_id < after[0]! ||
          (a.patient_id === after[0] && b.patient_id <= after[1]!)) continue;
        pairs.push([a, b]);
        if (pairs.length > limit) break;
      }
      if (pairs.length > limit) break;
    }
    const page = pairs.slice(0, limit), last = page.at(-1);
    const project = (p: Patient) => ({ id: p.patient_id, name: p.patient_name!, version: p.version });
    return { items: page.map(([a, b]) => ({ source: project(a), target: project(b) })),
      nextCursor: pairs.length > limit && last
        ? Buffer.from(JSON.stringify({ pair: last.map(p => p.patient_id), fingerprint })).toString("base64url") : null };
  });
}

async function visibility(client: PoolClient, p: Patient) {
  const { rows: clinics } = await client.query(`SELECT clinic_id FROM operational.patient_clinic_access WHERE patient_id=$1 ORDER BY clinic_id`, [p.patient_id]);
  const { rows: doctors } = await client.query(`SELECT clinic_id,doctor_id FROM operational.patient_doctor_access WHERE patient_id=$1 ORDER BY clinic_id,doctor_id`, [p.patient_id]);
  return JSON.stringify([p.created_clinic_id, clinics, doctors]);
}
// Every direct FK is classified here. Schema evolution fails closed instead of
// accidentally leaving a new mutable reference on an invisible tombstone.
const knownReferences = new Set([
  "patients.merged_into_id", "appointments.patient_id", "patient_visit_history.patient_id",
  "patient_consents.patient_id", "visit_alerts.patient_id", "audit_log.patient_id",
  "import_rows.suggested_patient_id", "import_rows.confirmed_patient_id",
  "patient_merge_candidates.patient_a", "patient_merge_candidates.patient_b",
  "notifications.patient_id", "appointment_holds.patient_id", "patient_clinic_access.patient_id",
  "patient_doctor_access.patient_id", "patient_merge_operations.source_id", "patient_merge_operations.target_id",
  "patient_merge_moves.source_id", "patient_merge_moves.target_id",
  // Waitlist identity/history must not be transferred to another patient.
  "waitlist_entries.patient_id", "waitlist_offers.patient_id",
]);
async function referenceBlockers(client: PoolClient, ids: number[]) {
  const blockers: string[] = [];
  const { rows: refs } = await client.query(`SELECT n.nspname,t.relname,a.attname FROM pg_constraint c
    JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=ANY(c.conkey)
    WHERE c.contype='f' AND c.confrelid='operational.patients'::regclass`);
  if (refs.some(r => r.nspname !== "operational" || !knownReferences.has(`${r.relname}.${r.attname}`))) blockers.push("MERGE_UNKNOWN_REFERENCE");
  // Protect JSON reviews and historical mappings as well as direct FK columns.
  // No consent grant, denial, withdrawal or guardian evidence is reattributed.
  const { rows: [blocked] } = await client.query(`SELECT
    EXISTS(SELECT 1 FROM operational.patient_consents WHERE patient_id=ANY($1)) AS consent,
    (EXISTS(SELECT 1 FROM operational.import_rows WHERE suggested_patient_id=ANY($1) OR confirmed_patient_id=ANY($1))
      OR EXISTS(SELECT 1 FROM operational.import_rows r,unnest($1::integer[]) AS selected(patient_id)
        WHERE jsonb_path_exists(r.staging,'$.**.patientId ? (@ == $id)',jsonb_build_object('id',selected.patient_id)))) AS imported,
    (EXISTS(SELECT 1 FROM operational.sync_operations s,unnest($1::integer[]) AS selected(patient_id)
      WHERE s.status::text IN ('pending','conflict') AND (
        jsonb_path_exists(s.payload,'$.**.patientId ? (@ == $id)',jsonb_build_object('id',selected.patient_id))
        OR jsonb_path_exists(s.payload,'$.**.patient_id ? (@ == $id)',jsonb_build_object('id',selected.patient_id))))
      OR EXISTS(SELECT 1 FROM operational.sync_conflicts c WHERE c.status='open' AND (
        EXISTS(SELECT 1 FROM unnest($1::integer[]) AS selected(patient_id) WHERE
          jsonb_path_exists(c.operation,'$.**.patientId ? (@ == $id)',jsonb_build_object('id',selected.patient_id))
          OR jsonb_path_exists(c.operation,'$.**.patient_id ? (@ == $id)',jsonb_build_object('id',selected.patient_id)))
        OR EXISTS(SELECT 1 FROM operational.appointments a WHERE a.patient_id=ANY($1) AND (
          a.appointment_id=c.target_id
          OR jsonb_path_exists(c.reasons,'$.**.appointmentId ? (@ == $id)',jsonb_build_object('id',a.appointment_id))))))) AS synced,
    EXISTS(SELECT 1 FROM operational.appointment_holds WHERE patient_id=ANY($1) AND expires_at>clock_timestamp()) AS held,
    EXISTS(SELECT 1 FROM operational.patients WHERE merged_into_id=ANY($1)) AS alias`, [ids]);
  if (blocked.consent) blockers.push("MERGE_CONSENT");
  if (blocked.imported || blocked.synced || blocked.held || blocked.alias) blockers.push("MERGE_UNSAFE");
  const { rows: [waitlist] } = await client.query("SELECT to_regclass('operational.waitlist_entries') IS NOT NULL AS ready");
  if (waitlist.ready) {
    const { rowCount } = await client.query("SELECT 1 FROM operational.waitlist_entries WHERE patient_id=ANY($1::integer[]) LIMIT 1", [ids]);
    if (rowCount) blockers.push("MERGE_UNSAFE");
  }
  return blockers;
}
async function mergeBlockers(client: PoolClient, source: Patient, target: Patient) {
  const blockers: string[] = [];
  if (source.patient_id === target.patient_id || source.merged_into_id || target.merged_into_id) blockers.push("MERGE_UNSAFE");
  const key = duplicateIdentity(source);
  if (!key || key !== duplicateIdentity(target) || source.guardian_name !== target.guardian_name ||
    source.guardian_relation !== target.guardian_relation) blockers.push("MERGE_IDENTITY");
  if (await visibility(client, source) !== await visibility(client, target)) blockers.push("MERGE_VISIBILITY");
  blockers.push(...await referenceBlockers(client, [source.patient_id, target.patient_id]));
  const { rowCount } = await client.query(`SELECT 1 FROM operational.appointments a
    JOIN operational.appointments b ON b.patient_id=$2 AND b.status IN ('booked','double_booked')
      AND a.scheduled_at < b.scheduled_at+b.duration_minutes*interval '1 minute'
      AND b.scheduled_at < a.scheduled_at+a.duration_minutes*interval '1 minute'
    WHERE a.patient_id=$1 AND a.status IN ('booked','double_booked') LIMIT 1`, [source.patient_id, target.patient_id]);
  if (rowCount) blockers.push("MERGE_PATIENT_OVERLAP");
  return blockers;
}

export const mergePreviewInput = z.object({ sourceId: positive, targetId: positive }).strict();
export async function previewPatientMerge(auth: Auth, raw: unknown) {
  const input = mergePreviewInput.parse(raw);
  const client = await pool.connect();
  try {
    // Consistent advisory snapshot, never a reservation or permission to merge.
    // PostgreSQL itself prohibits writes, including accidental future writes.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await currentActor(client, auth, true);
    const { rows } = await client.query<Patient>(`SELECT ${fields} FROM operational.patients p
      WHERE ${scope(auth, true)} AND p.patient_id=ANY($3::integer[]) ORDER BY p.patient_id`,
    [...scopeArgs(auth), [input.sourceId, input.targetId]]);
    const source = rows.find(p => p.patient_id === input.sourceId), target = rows.find(p => p.patient_id === input.targetId);
    if (!source || !target) throw fail(404, "NOT_FOUND", "notFound");
    const internal = await mergeBlockers(client, source, target);
    // Do not reveal the existence/type of hidden clinical evidence or overlaps.
    const blockers = [...new Set(internal.map(code =>
      code === "MERGE_IDENTITY" ? "MERGE_IDENTITY" as const : "MERGE_RESTRICTED" as const))];
    const { rows: [counts] } = await client.query<{source: number; target: number}>(`SELECT
      count(*) FILTER (WHERE patient_id=$1)::integer AS source,
      count(*) FILTER (WHERE patient_id=$2)::integer AS target
      FROM operational.appointments WHERE patient_id=ANY($3::integer[]) AND clinic_id=$4
      AND ($5::integer IS NULL OR doctor_id=$5)`,
    [source.patient_id, target.patient_id, [source.patient_id, target.patient_id], ...scopeArgs(auth)]);
    const result = {
      sourceId: source.patient_id, targetId: target.patient_id,
      sourceVersion: source.version, targetVersion: target.version,
      canMerge: blockers.length === 0, blockers,
      references: { appointments: { sourceCount: counts!.source, targetCount: counts!.target, scope: "current-actor" as const },
        clinicalReferences: "withheld" as const, auditHistory: "retained-on-source" as const },
      requiresTransactionalRevalidation: true as const,
    };
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export async function mergePatients(auth: Auth, raw: unknown) {
  const input = mergeInput.parse(raw);
  if (input.sourceId === input.targetId) throw unsafe();
  const requestHash = hash(input);
  return transaction(auth, true, async client => {
    // Existing rows in these non-booking workflows may change without taking a
    // patient lock. Stabilize their reference checks before selecting patients.
    await client.query("LOCK TABLE operational.import_rows,operational.sync_operations IN SHARE ROW EXCLUSIVE MODE");
    const { rows } = await client.query<Patient>(`SELECT ${fields} FROM operational.patients p
      WHERE ${scope(auth, true)} AND p.patient_id=ANY($3::integer[]) ORDER BY p.patient_id FOR UPDATE OF p`,
    [...scopeArgs(auth), [input.sourceId, input.targetId]]);
    if (rows.length !== 2) throw fail(404, "NOT_FOUND", "notFound");
    const source = rows.find(p => p.patient_id === input.sourceId)!, target = rows.find(p => p.patient_id === input.targetId)!;
    const { rows: [receipt] } = await client.query("SELECT * FROM operational.patient_merge_operations WHERE client_op_id=$1", [input.clientOpId]);
    if (receipt) {
      if (receipt.actor_id !== auth.id || receipt.clinic_id !== auth.clinicId || receipt.request_hash !== requestHash) throw unsafe("IDEMPOTENCY_CONFLICT");
      if (source.merged_into_id !== target.patient_id || target.merged_into_id) throw unsafe();
      return receipt.result;
    }
    if (source.merged_into_id || target.merged_into_id) throw unsafe();
    if (source.version !== input.sourceVersion || target.version !== input.targetVersion) throw unsafe("MERGE_STALE");
    const blockers = await mergeBlockers(client, source, target);
    if (blockers.length) throw unsafe(blockers[0]);
    await client.query("SET CONSTRAINTS operational.alerts_visit_patient_fk,operational.notifications_appointment_patient_clinic_fk DEFERRED");
    for (const [table, pk] of [
      ["appointments", "appointment_id"], ["patient_visit_history", "visit_id"],
      ["visit_alerts", "id"], ["notifications", "id"],
    ] as const) {
      await client.query(`SELECT ${pk} FROM operational.${table} WHERE patient_id=$1 ORDER BY ${pk} FOR UPDATE`, [source.patient_id]);
      await client.query(`INSERT INTO operational.patient_merge_moves(client_op_id,relation_name,record_id,source_id,target_id)
        SELECT $1,$2,${pk},$3,$4 FROM operational.${table} WHERE patient_id=$3`,
      [input.clientOpId, table, source.patient_id, target.patient_id]);
      await client.query(`UPDATE operational.${table} SET patient_id=$2
        ${table === "appointments" ? ",version=version+1,updated_at=clock_timestamp()" : ""}
        WHERE patient_id=$1`, [source.patient_id, target.patient_id]);
    }
    // Expired holds, candidates, receipts, source payloads and audit subject IDs
    // remain attached to the source as evidence, never interpreted as grants.
    const { rows: [s] } = await client.query("UPDATE operational.patients SET merged_into_id=$2 WHERE patient_id=$1 RETURNING version", [source.patient_id, target.patient_id]);
    const { rows: [t] } = await client.query("UPDATE operational.patients SET version=version WHERE patient_id=$1 RETURNING version", [target.patient_id]);
    const { rows: [clock] } = await client.query("SELECT clock_timestamp() AS at");
    // Opt-out is patient-wide: consolidating identity must never silently opt in.
    const { rows: [preferences] } = await client.query(`SELECT bool_or(reminder_opt_out) AS opted_out
      FROM operational.patients WHERE patient_id=ANY($1::integer[])`, [[source.patient_id, target.patient_id]]);
    if (preferences.opted_out) await setPatientReminderOptOut(client, target.patient_id, true, clock.at);
    const result = { sourceId: source.patient_id, targetId: target.patient_id, sourceVersion: s.version, targetVersion: t.version, mergedAt: clock.at.toISOString() };
    await client.query(`INSERT INTO operational.patient_merge_operations(client_op_id,actor_id,clinic_id,source_id,target_id,request_hash,reason,result)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [input.clientOpId, auth.id, auth.clinicId, source.patient_id, target.patient_id, requestHash, input.reason, JSON.stringify(result)]);
    await client.query(`INSERT INTO operational.audit_log(user_id,clinic_id,action,patient_id,detail)
      VALUES($1,$2,'patient.merged',$3,$4::jsonb)`, [auth.id, auth.clinicId, source.patient_id,
      JSON.stringify({ sourceId: source.patient_id, targetId: target.patient_id, reason: input.reason, clientOpId: input.clientOpId })]);
    return result;
  });
}
