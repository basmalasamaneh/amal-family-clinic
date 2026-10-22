import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import type { ClinicalVisitInput, ClinicalVisitReceipt, VisitAddendumInput, VisitAuthoringAccess } from "@workspace/api-zod";
import { forbidden, unauthorized, type Auth } from "../lib/auth";
import { fail } from "../lib/auth-errors";
import { patientScopeSql } from "../lib/patient-access";
import { appendAudit } from "../consent/service";

type VisitInput = Omit<ClinicalVisitInput, "seenAt"> & { seenAt: string };
type Receipt = Omit<ClinicalVisitReceipt, "createdAt"> & { createdAt: string };
const note = z.string().min(1).max(10000).refine(value => /\S/u.test(value));
const clientOpId = z.string().min(1).max(200).refine(value => value.trim().length > 0);
const instant = z.iso.datetime({ offset: false }).refine(value =>
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19));
const createInput = z.object({
  clientOpId, note, seenAt: instant, appointmentId: z.number().int().positive().max(2147483647).optional(),
}).strict();
const addendumInput = z.object({ clientOpId, note }).strict();

async function transaction<T>(auth: Auth, work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Generation -> consent -> scheduling/lifecycle -> relationship -> actor ->
    // patient. Keep the cross-instance fences until the receipt/audit commits.
    await client.query("SELECT pg_advisory_xact_lock_shared(761930)");
    await client.query("SELECT pg_advisory_xact_lock_shared(160005)");
    await client.query("SELECT pg_advisory_xact_lock(761910)");
    await client.query("SELECT operational.lock_patient_merge_access()");
    if (auth.role !== "doctor" || !auth.clinicId || !auth.doctorId) throw forbidden();
    // Lock first, then evaluate wall-clock expiry in a separate statement.
    await client.query(`SELECT u.id FROM operational.users u
      JOIN operational.auth_sessions s ON s.user_id=u.id
      WHERE u.id=$1 AND s.token_digest=$2 FOR SHARE OF u,s`, [auth.id, auth.sessionDigest]);
    const { rows: [actor] } = await client.query(`SELECT d.doctor_id FROM operational.users u
      JOIN operational.auth_sessions s ON s.user_id=u.id
      JOIN operational.doctors d ON d.doctor_id=u.doctor_id AND d.clinic_id=u.clinic_id AND d.user_id=u.id
      WHERE u.id=$1 AND s.token_digest=$2 AND u.disabled_at IS NULL AND u.role='doctor'
      AND u.clinic_id=$3 AND u.doctor_id=$4 AND s.revoked_at IS NULL
      AND s.last_seen_at>clock_timestamp()-interval '30 minutes'
      AND (s.device_id IS NULL OR EXISTS(SELECT 1 FROM operational.auth_devices a
        JOIN operational.devices dv ON dv.id=a.device_id WHERE a.device_id=s.device_id
        AND a.revoked_at IS NULL AND dv.clinic_id=u.clinic_id))`,
    [auth.id, auth.sessionDigest, auth.clinicId, auth.doctorId]);
    if (!actor) throw unauthorized();
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
async function ownPatient(client: PoolClient, auth: Auth, patientId: number) {
  return !!(await client.query(`SELECT p.patient_id FROM operational.patients p
    JOIN operational.patient_doctor_access da ON da.patient_id=p.patient_id
      AND da.clinic_id=$1 AND da.doctor_id=$3
    WHERE p.patient_id=$2 AND ${patientScopeSql("$1")} FOR UPDATE OF p`,
  [auth.clinicId, patientId, auth.doctorId])).rowCount;
}
export async function visitAuthoringAccess(auth: Auth, patientId: number): Promise<VisitAuthoringAccess> {
  return transaction(auth, async client => ({
    canCreate: await ownPatient(client, auth, patientId), clinicId: auth.clinicId!, doctorId: auth.doctorId!,
  }));
}
async function write(auth: Auth, patientId: number, input: VisitInput | VisitAddendumInput, visitId?: number): Promise<Receipt> {
  return transaction(auth, async client => {
    if (!await ownPatient(client, auth, patientId)) throw fail(404, "NOT_FOUND", "notFound");
    if (visitId !== undefined) {
      const { rowCount } = await client.query(`SELECT visit_id FROM operational.patient_visit_history
        WHERE visit_id=$1 AND patient_id=$2 AND clinic_id=$3 AND doctor_id=$4`,
      [visitId, patientId, auth.clinicId, auth.doctorId]);
      if (!rowCount) throw fail(404, "NOT_FOUND", "notFound");
    }
    const requestHash = createHash("sha256").update(JSON.stringify([
      visitId === undefined ? "visit" : "addendum", patientId, visitId ?? null,
      input.note, "seenAt" in input ? input.seenAt : null,
      "appointmentId" in input ? input.appointmentId ?? null : null,
    ])).digest("hex");
    const { rows: [prior] } = await client.query(`SELECT actor_id,request_hash,result
      FROM operational.clinical_write_operations WHERE clinic_id=$1 AND client_op_id=$2`,
    [auth.clinicId, input.clientOpId]);
    if (prior) {
      if (prior.actor_id !== auth.id || prior.request_hash !== requestHash) throw fail(409, "CONFLICT", "conflict");
      return prior.result as Receipt;
    }
    let result: Receipt;
    if ("seenAt" in input) {
      const { rows: [clock] } = await client.query<{ at: Date }>("SELECT clock_timestamp() AS at");
      if (Date.parse(input.seenAt) > clock!.at.getTime() + 300000) throw fail(400, "VALIDATION", "validation");
      if (input.appointmentId !== undefined) {
        const { rowCount } = await client.query(`SELECT appointment_id FROM operational.appointments
          WHERE appointment_id=$1 AND patient_id=$2 AND clinic_id=$3 AND doctor_id=$4 FOR SHARE`,
        [input.appointmentId, patientId, auth.clinicId, auth.doctorId]);
        if (!rowCount) throw fail(400, "VALIDATION", "validation");
      }
      const { rows: [row] } = await client.query<{ visit_id: number; created_at: Date }>(`
        INSERT INTO operational.patient_visit_history
          (patient_id,clinic_id,doctor_id,visit_date,diagnosis_notes,seen_at,created_at,appointment_id)
        VALUES($1,$2,$3,($4::timestamptz AT TIME ZONE 'Asia/Hebron')::date,$5,$4,clock_timestamp(),$6)
        RETURNING visit_id,created_at`,
      [patientId, auth.clinicId, auth.doctorId, input.seenAt, input.note, input.appointmentId ?? null]);
      result = { visitId: row!.visit_id, createdAt: row!.created_at.toISOString() };
    } else {
      const { rows: [row] } = await client.query<{ created_at: Date }>(`INSERT INTO operational.visit_addenda
        (visit_id,doctor_id,clinic_id,note) VALUES($1,$2,$3,$4) RETURNING created_at`,
      [visitId, auth.doctorId, auth.clinicId, input.note]);
      result = { visitId: visitId!, createdAt: row!.created_at.toISOString() };
    }
    await client.query(`INSERT INTO operational.clinical_write_operations
      (clinic_id,client_op_id,actor_id,patient_id,request_hash,result) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
    [auth.clinicId, input.clientOpId, auth.id, patientId, requestHash, JSON.stringify(result)]);
    await appendAudit(client, auth, visitId === undefined ? "clinical.visit.create" : "clinical.addendum.create",
      patientId, { correlationId: randomUUID(), outcome: "recorded", sourceVisitId: result.visitId, sourceClinicId: auth.clinicId! });
    return result;
  });
}
export function createDoctorVisit(auth: Auth, patientId: number, body: unknown) {
  return write(auth, patientId, createInput.parse(body));
}
export function createVisitAddendum(auth: Auth, patientId: number, visitId: number, body: unknown) {
  return write(auth, patientId, addendumInput.parse(body), visitId);
}
