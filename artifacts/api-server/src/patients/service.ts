import { createHash } from "node:crypto";
import { z } from "zod/v4";
import type { PoolClient } from "pg";
import { pool } from "@workspace/db";
import { canonicalPhone, normalizeName, searchScore } from "@workspace/db/patient-search";
import { CreatePatientBody, ListPatientsQueryParams, UpdatePatientBody } from "@workspace/api-zod";
import { enforceScope, forbidden, type Auth } from "../lib/auth";
import { fail } from "../lib/auth-errors";
import { patientScopeSql } from "../lib/patient-access";
import { hebronDay, isMinor, validBirthDate } from "./demographics";
import { duplicateIdentity, schedulingIdentities, equivalentPatientIds } from "./identity";

const positive = z.coerce.number().int().positive().max(2147483647);
export const patientId = positive;
const name = z.string().trim().min(1).max(200).refine(v => normalizeName(v).length > 0);
const phone = z.string().trim().min(1).max(40).refine(v => canonicalPhone(v) !== null);
const dob = z.string().refine(v => validBirthDate(v));
const demographics = z.object({ name, phone, dateOfBirth: dob }).strict();
function registrationInput(now: Date) {
  const today = hebronDay(now);
  return demographics.extend({
    dateOfBirth: z.string().refine(v => validBirthDate(v, now)),
    clientOpId: z.string().uuid(),
    guardianName: z.string().optional(),
    guardianRelation: z.string().optional(),
  }).strict().superRefine((value, ctx) => {
    if (!validBirthDate(value.dateOfBirth, now) || !isMinor(value.dateOfBirth, today)) return;
    for (const [key, max] of [["guardianName", 200], ["guardianRelation", 100]] as const) {
      if (!value[key]?.trim() || value[key]!.trim().length > max) {
        ctx.addIssue({ code: "custom", path: [key], message: "Required guardian demographic" });
      }
    }
  }).transform(value => {
    const { guardianName, guardianRelation, ...rest } = value;
    return isMinor(value.dateOfBirth, today)
      ? { ...rest, guardianName: guardianName?.trim(), guardianRelation: guardianRelation?.trim() }
      : rest;
  });
}
const update = demographics.partial().refine(v => Object.keys(v).length > 0);
const querySchema = z.object({
  q: z.string().max(200).optional(), cursor: z.string().max(512).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(100)).optional(),
}).strict();
type Patient = { patient_id: number; patient_name: string; phone: string; dob: string; name_normalized: string };
const fields = "p.patient_id,p.patient_name,p.phone,p.dob::text,p.name_normalized";
const scope = patientScopeSql("$1");
function clinic(auth: Auth): number {
  if (!["doctor", "front-desk"].includes(auth.role) || !auth.clinicId) throw forbidden();
  enforceScope(auth, auth.clinicId);
  return auth.clinicId;
}
function projection(row: Patient, clinicId: number) {
  return { id: row.patient_id, name: row.patient_name, phone: row.phone, dateOfBirth: row.dob, clinicId, visibility: "basic" as const };
}
function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Demographic group membership must linearize with every scheduling writer.
    await client.query("SELECT pg_advisory_xact_lock(761910)");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    if (typeof e === "object" && e !== null && "code" in e && ["23514", "23505"].includes(String(e.code))) throw fail(409, "CONFLICT", "conflict");
    throw e;
  } finally { client.release(); }
}
async function record(client: PoolClient, auth: Auth, action: string, id: number) {
  // Do not put demographics in audit detail. These new events survive eligible deletion.
  await client.query(`INSERT INTO operational.audit_log(user_id,clinic_id,action,detail)
    VALUES($1,$2,$3,$4::jsonb)`, [auth.id, clinic(auth), action, JSON.stringify({ patientId: id })]);
}
async function local(client: PoolClient, clinicId: number, id: number) {
  const { rows: [row] } = await client.query<Patient>(`SELECT ${fields} FROM operational.patients p WHERE ${scope} AND p.patient_id=$2 FOR UPDATE OF p`, [clinicId, id]);
  if (!row) throw fail(404, "NOT_FOUND", "notFound");
  return row;
}
export async function listPatients(auth: Auth, raw: unknown) {
  const clinicId = clinic(auth);
  const parsed = querySchema.parse(raw);
  ListPatientsQueryParams.parse(parsed);
  const q = parsed.q ?? "", limit = parsed.limit ?? 25;
  const fingerprint = hash([clinicId, normalizeName(q), canonicalPhone(q)]);
  let offset = 0;
  if (parsed.cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(parsed.cursor, "base64url").toString("utf8"));
      const cursor = z.object({ offset: z.number().int().min(0).max(10000000), fingerprint: z.literal(fingerprint) }).strict().parse(decoded);
      offset = cursor.offset;
    } catch { throw fail(400, "VALIDATION", "validation"); }
  }
  // Scope is applied in SQL BEFORE any fuzzy candidates, ranks or pagination.
  // No LIKE interpolation: %, _ and backslash are ordinary literal characters.
  const { rows } = await pool.query<Patient>(`SELECT ${fields} FROM operational.patients p WHERE ${scope}`, [clinicId]);
  const ranked = rows.map(row => ({ row, score: searchScore(q, row.name_normalized, row.phone) }))
    .filter((r): r is { row: Patient; score: number } => r.score !== null)
    .sort((a, b) => a.score - b.score || a.row.patient_id - b.row.patient_id);
  const end = offset + limit;
  return {
    items: ranked.slice(offset, end).map(r => projection(r.row, clinicId)),
    nextCursor: end < ranked.length ? Buffer.from(JSON.stringify({ offset: end, fingerprint })).toString("base64url") : null,
  };
}
export async function getPatient(auth: Auth, id: number) {
  const clinicId = clinic(auth);
  const { rows: [row] } = await pool.query<Patient>(`SELECT ${fields} FROM operational.patients p WHERE ${scope} AND p.patient_id=$2`, [clinicId, id]);
  if (!row) throw fail(404, "NOT_FOUND", "notFound");
  return projection(row, clinicId);
}
export async function createPatient(auth: Auth, raw: unknown) {
  const clinicId = clinic(auth);
  // Freeze one calendar reference through validation, guardian omission and persistence.
  const now = new Date(), today = hebronDay(now);
  const parsed = registrationInput(now).safeParse(raw);
  if (!parsed.success) {
    // Only a known field identifier crosses this boundary, never the submitted
    // value or Zod's diagnostic text. Reception can associate its translated
    // validation message with the field without leaking demographics to logs.
    const field = parsed.error.issues[0]?.path[0];
    const allowed = ["name", "phone", "dateOfBirth", "guardianName", "guardianRelation"];
    throw fail(400, "VALIDATION", "validation",
      typeof field === "string" && allowed.includes(field) ? { field } : {});
  }
  const data = parsed.data;
  CreatePatientBody.parse(data);
  // Fingerprint the validated request, not today's derived minor/adult
  // projection. An identical lost-response retry across an 18th birthday must
  // replay the same receipt even though hidden guardian fields are now omitted
  // from a new adult record. Raw input's guardian values were type-checked above.
  const guardians = raw as { guardianName?: string; guardianRelation?: string };
  const requestHash = hash({ ...data, guardianName: guardians.guardianName?.trim(),
    guardianRelation: guardians.guardianRelation?.trim() });
  return transaction(async client => {
    // Serialize a clinic's identical operation IDs; shared-device users cannot race a replay.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`patient:${clinicId}:${data.clientOpId}`]);
    const { rows: [receipt] } = await client.query("SELECT * FROM operational.patient_create_receipts WHERE clinic_id=$1 AND client_op_id=$2", [clinicId, data.clientOpId]);
    if (receipt) {
      if (receipt.request_hash !== requestHash) throw fail(409, "CONFLICT", "conflict");
      // Do not recreate a deleted patient or return stale/inaccessible demographics.
      return projection(await local(client, clinicId, receipt.patient_id), clinicId);
    }
    const { rows: [row] } = await client.query<Patient>(`INSERT INTO operational.patients(patient_name,phone,dob,name_normalized,created_clinic_id,minor_as_of,guardian_name,guardian_relation)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING patient_id,patient_name,phone,dob::text,name_normalized`,
    [data.name, data.phone, data.dateOfBirth, normalizeName(data.name), clinicId, today,
      "guardianName" in data ? data.guardianName : null, "guardianRelation" in data ? data.guardianRelation : null]);
    await client.query(`INSERT INTO operational.patient_create_receipts(user_id,client_op_id,clinic_id,request_hash,patient_id)
      VALUES($1,$2,$3,$4,$5)`, [auth.id, data.clientOpId, clinicId, requestHash, row!.patient_id]);
    await record(client, auth, "patient.created", row!.patient_id);
    return projection(row!, clinicId);
  });
}
export async function updatePatient(auth: Auth, id: number, raw: unknown) {
  const clinicId = clinic(auth), data = update.parse(raw);
  UpdatePatientBody.parse(raw);
  return transaction(async client => {
    const old = await local(client, clinicId, id);
    const next = { name: data.name ?? old.patient_name, phone: data.phone ?? old.phone, dateOfBirth: data.dateOfBirth ?? old.dob };
    const before = await schedulingIdentities(client);
    const oldGroup = new Set(equivalentPatientIds(before, id));
    before.set(id, duplicateIdentity({ patient_name: next.name, phone: next.phone, dob: next.dateOfBirth }));
    const newlyEquivalent = equivalentPatientIds(before, id).filter(other => !oldGroup.has(other));
    if (newlyEquivalent.length) {
      const { rowCount } = await client.query(`SELECT 1 FROM operational.appointments a
        JOIN operational.appointments b ON b.patient_id=ANY($2::integer[])
        WHERE a.patient_id=$1 AND a.status IN ('booked','double_booked')
          AND b.status IN ('booked','double_booked')
          AND a.scheduled_at < b.scheduled_at + b.duration_minutes * interval '1 minute'
          AND b.scheduled_at < a.scheduled_at + a.duration_minutes * interval '1 minute' LIMIT 1`, [id, newlyEquivalent]);
      if (rowCount) throw fail(409, "APPOINTMENT_CONFLICT", "conflict");
    }
    const { rows: [row] } = await client.query<Patient>(`UPDATE operational.patients SET patient_name=$2,phone=$3,dob=$4,name_normalized=$5,
      minor_as_of=(now() AT TIME ZONE 'Asia/Hebron')::date WHERE patient_id=$1 RETURNING patient_id,patient_name,phone,dob::text,name_normalized`,
    [id, next.name, next.phone, next.dateOfBirth, normalizeName(next.name)]);
    await record(client, auth, "patient.updated", id);
    return projection(row!, clinicId);
  });
}
export async function deletePatient(auth: Auth, id: number) {
  const clinicId = clinic(auth);
  try {
    await transaction(async client => {
      await local(client, clinicId, id);
      const { rows: [seed] } = await client.query("SELECT 1 FROM public.patients WHERE patient_id=$1", [id]);
      if (seed) throw fail(409, "PATIENT_REFERENCED", "patientReferenced");
      // All patient FKs are restrictive. PostgreSQL rechecks concurrent references
      // under the row lock; there is no TOCTOU reference preflight or cascade.
      await client.query("DELETE FROM operational.patients WHERE patient_id=$1", [id]);
      await record(client, auth, "patient.deleted", id);
    });
  } catch (e) {
    if (typeof e === "object" && e !== null && "code" in e && e.code === "23503") throw fail(409, "PATIENT_REFERENCED", "patientReferenced");
    throw e;
  }
}
