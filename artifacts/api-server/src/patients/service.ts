import { createHash } from "node:crypto";
import { z } from "zod/v4";
import type { PoolClient } from "pg";
import { pool } from "@workspace/db";
import { canonicalPhone, normalizeName, searchScore } from "@workspace/db/patient-search";
import { CreatePatientBody, ListPatientsQueryParams, UpdatePatientBody } from "@workspace/api-zod";
import { enforceScope, forbidden, type Auth } from "../lib/auth";
import { fail } from "../lib/auth-errors";
import { patientScopeSql } from "../lib/patient-access";

const positive = z.coerce.number().int().positive().max(2147483647);
export const patientId = positive;
const name = z.string().min(1).max(200).refine(v => normalizeName(v).length > 0);
const phone = z.string().min(1).max(40).refine(v => canonicalPhone(v) !== null);
const dob = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v &&
    v >= "0001-01-01" && v <= new Date().toISOString().slice(0, 10);
});
const demographics = z.object({ name, phone, dateOfBirth: dob }).strict();
const input = demographics.extend({ clientOpId: z.string().uuid() }).strict();
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
  const data = input.parse(raw);
  CreatePatientBody.parse(raw);
  const requestHash = hash(data);
  return transaction(async client => {
    // Serialize a clinic's identical operation IDs; shared-device users cannot race a replay.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`patient:${clinicId}:${data.clientOpId}`]);
    const { rows: [receipt] } = await client.query("SELECT * FROM operational.patient_create_receipts WHERE clinic_id=$1 AND client_op_id=$2", [clinicId, data.clientOpId]);
    if (receipt) {
      if (receipt.request_hash !== requestHash) throw fail(409, "CONFLICT", "conflict");
      // Do not recreate a deleted patient or return stale/inaccessible demographics.
      return projection(await local(client, clinicId, receipt.patient_id), clinicId);
    }
    const { rows: [row] } = await client.query<Patient>(`INSERT INTO operational.patients(patient_name,phone,dob,name_normalized,created_clinic_id,minor_as_of)
      VALUES($1,$2,$3,$4,$5,(now() AT TIME ZONE 'UTC')::date)
      RETURNING patient_id,patient_name,phone,dob::text,name_normalized`,
    [data.name, data.phone, data.dateOfBirth, normalizeName(data.name), clinicId]);
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
    const { rows: [row] } = await client.query<Patient>(`UPDATE operational.patients SET patient_name=$2,phone=$3,dob=$4,name_normalized=$5,
      minor_as_of=(now() AT TIME ZONE 'UTC')::date WHERE patient_id=$1 RETURNING patient_id,patient_name,phone,dob::text,name_normalized`,
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
