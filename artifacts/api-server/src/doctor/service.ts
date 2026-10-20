import { createHash, randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { fromZonedTime } from "date-fns-tz";
import type { Auth } from "../lib/auth";
import { fail } from "../lib/auth-errors";
import { patientScopeSql } from "../lib/patient-access";
import { hebronDay } from "../patients/demographics";
import { idSchema, projectNetworkPatients, requireDoctor, transaction } from "../consent/service";
import { adoption } from "../adoption/service";

const limitSchema = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(100));
const pageSchema = z.object({ limit: limitSchema.optional(), cursor: z.string().min(1).max(512).optional() }).strict();
const auditSchema = pageSchema.extend({ patientId: z.string().regex(/^[1-9]\d*$/).transform(Number)
  .pipe(z.number().int().positive().max(2147483647)).optional() }).strict();
const emptySchema = z.object({}).strict();
const cursorSchema = z.object({
  id: idSchema, at: z.string().datetime(), fingerprint: z.string(),
}).strict();
const invalid = () => fail(400, "VALIDATION", "validation");
const fingerprint = (auth: Auth, scope: unknown) =>
  createHash("sha256").update(JSON.stringify([auth.id, auth.clinicId, auth.doctorId, scope])).digest("hex");
function decode(value: string | undefined, binding: string) {
  if (!value) return null;
  try {
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (cursor.fingerprint !== binding) throw invalid();
    return cursor;
  } catch { throw invalid(); }
}
function encode(id: number, at: Date, binding: string) {
  return Buffer.from(JSON.stringify({ id, at: at.toISOString(), fingerprint: binding })).toString("base64url");
}
/** Convert both calendar midnights independently: adding 24h is wrong on DST days. */
export function dayInterval(now = new Date()) {
  const day = hebronDay(now);
  const next = new Date(`${day}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { day, start: fromZonedTime(`${day}T00:00:00`, "Asia/Hebron"),
    end: fromZonedTime(`${next.toISOString().slice(0, 10)}T00:00:00`, "Asia/Hebron") };
}
const ownPatient = `EXISTS(SELECT 1 FROM operational.patient_doctor_access da
  WHERE da.patient_id=p.patient_id AND da.clinic_id=$1 AND da.doctor_id=$2)`;

export async function doctorDay(auth: Auth, query: unknown) {
  const input = pageSchema.parse(query);
  return transaction(false, async client => {
    await requireDoctor(client, auth);
    const interval = dayInterval();
    const binding = fingerprint(auth, ["day", interval.day]);
    const cursor = decode(input.cursor, binding);
    const limit = input.limit ?? 25;
    const { rows } = await client.query<{ appointment_id: number; patient_id: number; scheduled_at: Date; status: string }>(`
      SELECT a.appointment_id,a.patient_id,a.scheduled_at,a.status FROM operational.appointments a
      JOIN operational.patients p ON p.patient_id=a.patient_id
      WHERE a.clinic_id=$1 AND a.doctor_id=$2 AND ${patientScopeSql("$1")} AND ${ownPatient}
        AND a.scheduled_at >= $3 AND a.scheduled_at < $4
        AND ($5::timestamptz IS NULL OR (date_trunc('milliseconds',a.scheduled_at),a.appointment_id)>($5::timestamptz,$6::integer))
      ORDER BY date_trunc('milliseconds',a.scheduled_at),a.appointment_id LIMIT $7`,
    [auth.clinicId, auth.doctorId, interval.start, interval.end, cursor?.at ?? null, cursor?.id ?? null, limit + 1]);
    const page = rows.slice(0, limit);
    const ids = [...new Set(page.map(row => row.patient_id))];
    const patients = ids.length ? (await projectNetworkPatients(client, auth, { patientIds: ids, limit: 100 }, randomUUID())).items : [];
    const byId = new Map(patients.map(patient => [patient.id, patient]));
    const last = page.at(-1);
    return { day: interval.day, items: page.map(row => {
      const patient = byId.get(row.patient_id);
      if (!patient) throw fail(409, "CONFLICT", "conflict");
      return { id: row.appointment_id, startsAt: row.scheduled_at.toISOString(), status: row.status, patient };
    }), nextCursor: rows.length > limit && last ? encode(last.appointment_id, last.scheduled_at, binding) : null };
  });
}
export async function doctorPatient(auth: Auth, patientId: number, query: unknown) {
  emptySchema.parse(query);
  return transaction(false, async client => {
    const result = await projectNetworkPatients(client, auth, { patientIds: [patientId], limit: 1 }, randomUUID());
    if (!result.items[0]) throw fail(404, "NOT_FOUND", "notFound");
    return result.items[0];
  });
}
export async function doctorPrivacy(auth: Auth, query: unknown) {
  emptySchema.parse(query);
  return transaction(false, async client => {
    const networkMode = await requireDoctor(client, auth);
    const { rows: [row] } = await client.query(
      `SELECT c.*, EXISTS(SELECT 1 FROM operational.clinic_managers m
        WHERE m.clinic_id=c.clinic_id AND m.user_id=$2) AS can_manage
       FROM operational.clinics c WHERE c.clinic_id=$1`, [auth.clinicId, auth.id]);
    if (!row) throw fail(403, "FORBIDDEN", "forbidden");
    const mode = ["trial", "lite", "full"].includes(row.adoption_state) ? row.adoption_state : "unknown";
    return { clinic: { id: row.clinic_id, name: row.clinic_name }, mode,
      effectiveSharing: mode === "full" && networkMode === "full" ? "consent" : "local-only",
      trialStateAvailable: true, adoption: adoption(row, row.can_manage) };
  });
}
export async function doctorAudit(auth: Auth, query: unknown) {
  const input = auditSchema.parse(query);
  return transaction(false, async client => {
    await requireDoctor(client, auth);
    const binding = fingerprint(auth, ["audit", input.patientId ?? null]);
    const cursor = decode(input.cursor, binding);
    const limit = input.limit ?? 25;
    const { rows } = await client.query<{ id: number; at: Date; patient_id: number; patient_name: string;
      viewer_name: string | null; viewer_clinic_name: string | null }>(`
      SELECT a.id,a.at,p.patient_id,p.patient_name,
        CASE WHEN a.clinic_id=$1 AND u.clinic_id=$1 THEN d.doctor_name ELSE NULL END AS viewer_name,
        CASE WHEN a.clinic_id=$1 AND u.clinic_id=$1 THEN c.clinic_name ELSE NULL END AS viewer_clinic_name
      FROM operational.audit_log a JOIN operational.patients p ON p.patient_id=a.patient_id
      JOIN operational.clinics source ON source.clinic_id=$1
      LEFT JOIN operational.clinics viewer ON viewer.clinic_id=a.clinic_id
      LEFT JOIN operational.users u ON u.id=a.user_id AND u.role='doctor'
      LEFT JOIN operational.doctors d ON d.doctor_id=u.doctor_id AND d.clinic_id=u.clinic_id AND d.user_id=u.id
      LEFT JOIN operational.clinics c ON c.clinic_id=u.clinic_id AND d.doctor_id IS NOT NULL
      WHERE ${patientScopeSql("$1")} AND ${ownPatient}
        AND a.action='network.lookup' AND a.detail->>'outcome'='disclosed'
        AND a.detail->>'sourceClinicId'=$1::text
        AND (a.clinic_id=$1 OR (source.network_mode='full' AND (viewer.network_mode='full' OR a.clinic_id IS NULL)))
        AND ($3::integer IS NULL OR p.patient_id=$3)
        AND ($4::timestamptz IS NULL OR (date_trunc('milliseconds',a.at),a.id)<($4::timestamptz,$5::integer))
      ORDER BY date_trunc('milliseconds',a.at) DESC,a.id DESC LIMIT $6`,
    [auth.clinicId, auth.doctorId, input.patientId ?? null, cursor?.at ?? null, cursor?.id ?? null, limit + 1]);
    const page = rows.slice(0, limit), last = page.at(-1);
    return { items: page.map(row => ({ id: row.id, at: row.at.toISOString(),
      patient: { id: row.patient_id, name: row.patient_name }, viewerName: row.viewer_name,
      viewerClinicName: row.viewer_clinic_name, action: "patient-view" as const })),
    nextCursor: rows.length > limit && last ? encode(last.id, last.at, binding) : null };
  });
}
