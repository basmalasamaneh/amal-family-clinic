import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod/v4";
import { fromZonedTime } from "date-fns-tz";
import { pool } from "@workspace/db";
import { normalizeName } from "@workspace/db/patient-search";
import { forbidden, type Auth } from "../lib/auth";
import { fail } from "../lib/auth-errors";
import { patientScopeSql } from "../lib/patient-access";
import { hebronDay, isMinor, validBirthDate } from "../patients/demographics";
import { consentEligibility, effectiveLevel, projectConsent, projectVisit, visitVisibility, type Consent, type ConsentRow, type NetworkVisit, type VisitSource } from "./policy";

// Global transaction lock, not a per-instance mutex. Readers share; transitions exclude.
const consentLock = 160005;
export const idSchema = z.coerce.number().int().positive().max(2147483647);
const guardianSchema = z.object({
  name: z.string().trim().min(1).max(200), relationship: z.string().trim().min(1).max(100),
}).strict();
const recordSchema = z.object({
  level: z.enum(["none", "basic", "clinical"]), guardian: guardianSchema.optional(),
  evidence: z.enum(["signed", "verbal"]), clientOpId: z.string().uuid(),
}).strict();
const withdrawSchema = z.object({ clientOpId: z.string().uuid() }).strict();
const lookupSchema = z.object({
  q: z.string().trim().min(2).max(200).transform(normalizeName).refine(q => q.length >= 2),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(100)).optional(),
  cursor: z.string().min(1).max(512).optional(),
}).strict();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function transaction<T>(exclusive: boolean, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(exclusive ? "SELECT pg_advisory_xact_lock($1)" : "SELECT pg_advisory_xact_lock_shared($1)", [consentLock]);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
interface AuditDetail {
  correlationId: string; outcome: "disclosed" | "no-result" | "denied" | "recorded" | "withdrawn" | "read";
  sourceClinicId?: number; sourceVisitId?: number; effectiveLevel?: string; projection?: string; consentId?: number;
}
export async function appendAudit(client: Pick<PoolClient, "query">, auth: Auth | undefined, action: string, patientId: number | null, detail: AuditDetail) {
  await client.query(`INSERT INTO operational.audit_log(user_id,clinic_id,action,patient_id,detail)
    VALUES($1,$2,$3,$4,$5::jsonb)`, [auth?.id ?? null, auth?.clinicId ?? null, action, patientId, JSON.stringify(detail)]);
}
/** Used for authentication, authorization and validation rejections, never search text. */
export async function auditDenied(auth: Auth | undefined, action: string, correlationId: string) {
  await appendAudit(pool, auth, action, null, { correlationId, outcome: "denied" });
}
export async function requireDoctor(client: PoolClient, auth: Auth) {
  if (auth.role !== "doctor" || !auth.clinicId || !auth.doctorId) throw forbidden();
  const { rows: [doctor] } = await client.query(`SELECT c.network_mode FROM operational.doctors d
    JOIN operational.clinics c ON c.clinic_id=d.clinic_id
    WHERE d.doctor_id=$1 AND d.clinic_id=$2 AND d.user_id=$3`, [auth.doctorId, auth.clinicId, auth.id]);
  if (!doctor) throw forbidden();
  return doctor.network_mode as string;
}
async function scopedPatient(client: PoolClient, auth: Auth, patientId: number, mutation: boolean) {
  if (!auth.clinicId || (mutation ? auth.role !== "front-desk" : !["front-desk", "doctor"].includes(auth.role))) throw forbidden();
  if (auth.role === "doctor") await requireDoctor(client, auth);
  const { rows: [patient] } = await client.query<{ patient_id: number; patient_name: string; dob: string | null }>(`SELECT p.patient_id,p.patient_name,p.dob::text
    FROM operational.patients p WHERE p.patient_id=$2 AND ${patientScopeSql("$1")}
    ${auth.role === "doctor" ? `AND EXISTS(SELECT 1 FROM operational.patient_doctor_access da
      WHERE da.patient_id=p.patient_id AND da.clinic_id=$1 AND da.doctor_id=$3)` : ""}
    ${mutation ? "FOR UPDATE OF p" : ""}`,
  auth.role === "doctor" ? [auth.clinicId, patientId, auth.doctorId] : [auth.clinicId, patientId]);
  if (!patient) throw fail(404, "NOT_FOUND", "notFound");
  return patient;
}
async function history(client: PoolClient, patientId: number) {
  const { rows } = await client.query<ConsentRow>("SELECT * FROM operational.patient_consents WHERE patient_id=$1 ORDER BY id DESC", [patientId]);
  return rows;
}
export async function getConsent(auth: Auth, patientId: number) {
  return transaction(false, async client => {
    const patient = await scopedPatient(client, auth, patientId, false);
    const rows = await history(client, patientId);
    const { rows: clinics } = await client.query<{ clinic_id: number; network_mode: string }>(
      "SELECT clinic_id,network_mode FROM operational.clinics");
    const full = new Set(clinics.filter(row => row.network_mode === "full").map(row => row.clinic_id));
    const visible = rows.filter(row => row.recorded_clinic_id === auth.clinicId ||
      (full.has(auth.clinicId!) && row.recorded_clinic_id !== null && full.has(row.recorded_clinic_id)));
    // Do not resurrect an older visible grant when the newest one is hidden.
    const current = rows[0] && visible.includes(rows[0]) ? rows[0] : undefined;
    const { rows: [clock] } = await client.query<{ at: Date }>("SELECT clock_timestamp() AS at");
    return {
      current: current ? projectConsent(current) : null, history: visible.map(projectConsent), effectiveLevel: effectiveLevel(current),
      patient: { id: patient.patient_id, name: patient.patient_name },
      eligibility: consentEligibility(patient.dob, clock!.at),
      canWithdraw: auth.role === "front-desk" && !!current && !current.withdrawn_at && current.recorded_clinic_id === auth.clinicId,
    };
  });
}

const accessHistorySchema = z.object({
  patientRequestConfirmed: z.literal(true),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(512).optional(),
}).strict();
const accessCursorSchema = z.object({
  id: z.number().int().positive().max(2147483647), at: z.string().datetime(),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
function accessSignature(auth: Auth, patientId: number, id: number, at: string) {
  // Existing stable server secret, domain separated from other uses. PIN reauth
  // rotates session/CSRF credentials, not this actor/clinic/patient/device binding.
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for access-history cursor signing");
  return createHmac("sha256", secret)
    .update(JSON.stringify(["amal:patient-access-history:v1", auth.id, auth.clinicId, patientId, auth.device?.id ?? null, id, at])).digest("hex");
}
export async function patientAccessHistory(auth: Auth, patientId: number, body: unknown, correlationId = randomUUID()) {
  const input = accessHistorySchema.parse(body);
  return transaction(false, async client => {
    if (auth.role !== "front-desk" || !auth.clinicId) throw forbidden();
    await scopedPatient(client, auth, patientId, false);
    let cursor: z.infer<typeof accessCursorSchema> | null = null;
    if (input.cursor) {
      try {
        cursor = accessCursorSchema.parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")));
        if (!timingSafeEqual(Buffer.from(cursor.signature, "hex"),
          Buffer.from(accessSignature(auth, patientId, cursor.id, cursor.at), "hex"))) throw new Error("Invalid cursor");
      } catch { throw fail(400, "VALIDATION", "validation"); }
    }
    const limit = input.limit ?? 25;
    const { rows } = await client.query<{ id: number; at: Date; viewer_name: string | null;
      viewer_role: "doctor" | null; viewer_clinic_name: string | null }>(`
      SELECT a.id,a.at,d.doctor_name AS viewer_name,
        CASE WHEN d.doctor_id IS NOT NULL THEN 'doctor' ELSE NULL END AS viewer_role,
        c.clinic_name AS viewer_clinic_name
      FROM operational.audit_log a
      JOIN operational.clinics source ON source.clinic_id::text=a.detail->>'sourceClinicId'
      JOIN operational.clinics viewer ON viewer.clinic_id=a.clinic_id
      JOIN operational.clinics requester ON requester.clinic_id=$5
      LEFT JOIN operational.users u ON u.id=a.user_id AND u.role='doctor' AND u.clinic_id=a.clinic_id
      LEFT JOIN operational.doctors d ON d.doctor_id=u.doctor_id AND d.clinic_id=u.clinic_id AND d.user_id=u.id
      LEFT JOIN operational.clinics c ON c.clinic_id=d.clinic_id
      WHERE a.patient_id=$1 AND a.action='network.lookup' AND a.detail->>'outcome'='disclosed'
        AND requester.network_mode='full' AND source.network_mode='full' AND viewer.network_mode='full'
        AND a.clinic_id IS NOT NULL AND a.clinic_id<>source.clinic_id
        AND ($2::timestamptz IS NULL OR (date_trunc('milliseconds',a.at),a.id)<($2::timestamptz,$3::integer))
      ORDER BY date_trunc('milliseconds',a.at) DESC,a.id DESC LIMIT $4`,
    [patientId, cursor?.at ?? null, cursor?.id ?? null, limit + 1, auth.clinicId]);
    const page = rows.slice(0, limit), last = page.at(-1);
    // Audit only the assisted read, never the returned rows, request body or cursor.
    await appendAudit(client, auth, "patient.access-history.read", patientId, { correlationId, outcome: "read" });
    return {
      items: page.map(row => ({ id: row.id, at: row.at.toISOString(), viewerName: row.viewer_name,
        viewerRole: row.viewer_role, viewerClinicName: row.viewer_clinic_name, action: "patient-view" as const })),
      nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({
        id: last.id, at: last.at.toISOString(), signature: accessSignature(auth, patientId, last.id, last.at.toISOString()),
      })).toString("base64url") : null,
    };
  });
}
async function replay(client: PoolClient, auth: Auth, opId: string, requestHash: string): Promise<Consent | null> {
  const { rows: [receipt] } = await client.query("SELECT * FROM operational.consent_operations WHERE clinic_id=$1 AND client_op_id=$2", [auth.clinicId, opId]);
  if (!receipt) return null;
  if (receipt.actor_id !== auth.id || receipt.request_hash !== requestHash) throw fail(409, "CONFLICT", "conflict");
  return receipt.result as Consent;
}
async function saveReceipt(client: PoolClient, auth: Auth, opId: string, requestHash: string, result: Consent) {
  await client.query(`INSERT INTO operational.consent_operations(clinic_id,client_op_id,actor_id,request_hash,result)
    VALUES($1,$2,$3,$4,$5::jsonb)`, [auth.clinicId, opId, auth.id, requestHash, JSON.stringify(result)]);
}
export async function recordConsent(auth: Auth, patientId: number, body: unknown, correlationId = randomUUID()) {
  const input = recordSchema.parse(body);
  return transaction(true, async client => {
    const patient = await scopedPatient(client, auth, patientId, true);
    const requestHash = hash(["record", patientId, input]);
    const prior = await replay(client, auth, input.clientOpId, requestHash);
    if (prior) return prior; // A receipt never reapplies an old grant.
    const { rows: [clock] } = await client.query<{ at: Date }>("SELECT clock_timestamp() AS at");
    const now = clock!.at;
    // Unknown age never permits a grant, including guardian-attributed grants.
    if (input.level !== "none" && (!patient.dob || !validBirthDate(patient.dob, now))) throw fail(400, "VALIDATION", "validation");
    if (patient.dob && validBirthDate(patient.dob, now) && isMinor(patient.dob, hebronDay(now)) && !input.guardian) throw fail(400, "VALIDATION", "validation");
    const { rows: [row] } = await client.query<ConsentRow>(`INSERT INTO operational.patient_consents
      (patient_id,level,given_by,guardian_name,guardian_relation,given_at,recorded_by_user,recorded_clinic_id,evidence)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [patientId, input.level, input.guardian ? "guardian" : "patient", input.guardian?.name ?? null,
      input.guardian?.relationship ?? null, now, auth.id, auth.clinicId, input.evidence]);
    const result = projectConsent(row!);
    await appendAudit(client, auth, "consent.record", patientId, { correlationId, outcome: "recorded", consentId: row!.id, effectiveLevel: row!.level });
    await saveReceipt(client, auth, input.clientOpId, requestHash, result);
    return result;
  });
}
export async function withdrawConsent(auth: Auth, consentId: number, body: unknown, correlationId = randomUUID()) {
  const input = withdrawSchema.parse(body);
  return transaction(true, async client => {
    if (auth.role !== "front-desk" || !auth.clinicId) throw forbidden();
    const { rows: [target] } = await client.query<ConsentRow>("SELECT * FROM operational.patient_consents WHERE id=$1 AND recorded_clinic_id=$2", [consentId, auth.clinicId]);
    if (!target) throw fail(404, "NOT_FOUND", "notFound");
    await scopedPatient(client, auth, target.patient_id, true);
    const requestHash = hash(["withdraw", consentId, input]);
    const prior = await replay(client, auth, input.clientOpId, requestHash);
    if (prior) return prior;
    const rows = await history(client, target.patient_id);
    if (rows[0]?.id !== consentId) throw fail(409, "CONFLICT", "conflict");
    let withdrawn = target;
    if (!target.withdrawn_at) {
      const { rows: [row] } = await client.query<ConsentRow>("UPDATE operational.patient_consents SET withdrawn_at=GREATEST(clock_timestamp(),given_at) WHERE id=$1 RETURNING *", [consentId]);
      withdrawn = row!;
    }
    const result = projectConsent(withdrawn);
    await appendAudit(client, auth, "consent.withdraw", target.patient_id, { correlationId, outcome: "withdrawn", consentId, effectiveLevel: "none" });
    await saveReceipt(client, auth, input.clientOpId, requestHash, result);
    return result;
  });
}

interface LookupRow extends VisitSource {
  visit_day: string;
  patient_id: number; patient_name: string; visit_id: number; source_mode: string;
  own_patient: boolean; consent_level: "none" | "basic" | "clinical"; consent_withdrawn_at: Date | null;
  consent_visible: boolean;
}
export interface NetworkPatient { id: number; name: string; identityVerified: false; effectiveConsentLevel: "none" | "basic" | "clinical"; visits: NetworkVisit[] }
export async function lookupNetwork(auth: Auth, query: unknown, correlationId = randomUUID()) {
  const input = lookupSchema.parse(query);
  return transaction(false, client => projectNetworkPatients(client, auth, input, correlationId));
}
/** Caller holds the shared consent transaction lock. Exact IDs are internal,
 * doctor-scoped selections, never a name-based patient-card resolution. */
export async function projectNetworkPatients(
  client: PoolClient, auth: Auth,
  input: { q?: string; limit?: number; cursor?: string; patientIds?: number[] },
  correlationId: string,
) {
    const requesterMode = await requireDoctor(client, auth);
    const limit = input.limit ?? 25;
    // Cursor fingerprint binds scope and normalized query, but is never an audit field.
    const fingerprint = hash([auth.id, auth.clinicId, auth.doctorId, input.q]);
    let after = 0;
    if (input.cursor) {
      try {
        const cursor = z.object({ after: z.number().int().nonnegative().max(2147483647), fingerprint: z.literal(fingerprint) }).strict()
          .parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")));
        after = cursor.after;
      } catch { throw fail(400, "VALIDATION", "validation"); }
    }
    const { rows } = await client.query<LookupRow>(`WITH candidates AS (
      SELECT p.patient_id,p.patient_name,
        (${patientScopeSql("$1")} AND EXISTS(SELECT 1 FROM operational.patient_doctor_access da
          WHERE da.patient_id=p.patient_id AND da.clinic_id=$1 AND da.doctor_id=$2)) AS own_patient,
        COALESCE(consent.level,'none') AS consent_level,consent.withdrawn_at AS consent_withdrawn_at,
        COALESCE(consent.recorded_clinic_id=$1 OR ($5='full' AND consent.source_mode='full'),false) AS consent_visible
      FROM operational.patients p
      LEFT JOIN LATERAL (SELECT pc.level,pc.withdrawn_at,pc.recorded_clinic_id,c.network_mode AS source_mode
        FROM operational.patient_consents pc LEFT JOIN operational.clinics c ON c.clinic_id=pc.recorded_clinic_id
        WHERE pc.patient_id=p.patient_id ORDER BY pc.id DESC LIMIT 1) consent ON true
      WHERE p.merged_into_id IS NULL AND p.patient_id>$3
        AND (CASE WHEN $7::integer[] IS NULL THEN strpos(p.name_normalized,$4)>0 ELSE p.patient_id=ANY($7) END)
    ), eligible AS (
      SELECT p.* FROM candidates p
      WHERE ($7::integer[] IS NOT NULL AND p.own_patient) OR ($7::integer[] IS NULL AND EXISTS (
        SELECT 1 FROM operational.patient_visit_history v
        JOIN operational.clinics c ON c.clinic_id=v.clinic_id
        WHERE v.patient_id=p.patient_id AND (
          (v.clinic_id=$1 AND p.own_patient)
          OR (v.clinic_id<>$1 AND c.network_mode='full' AND $5='full'
            AND p.consent_visible AND p.consent_withdrawn_at IS NULL AND p.consent_level IN ('basic','clinical'))
        )
      ))
      ORDER BY p.patient_id LIMIT $6
    )
    SELECT p.patient_id,p.patient_name,
      v.visit_id,v.clinic_id,v.doctor_id,v.diagnosis_notes,
      v.visit_date::text AS visit_day,
      v.clinic_name,v.source_mode,v.doctor_name,
      p.consent_level,p.consent_withdrawn_at,p.consent_visible,p.own_patient,
      COALESCE((SELECT array_agg(a.label ORDER BY a.id) FROM operational.visit_alerts a
        WHERE a.visit_id=v.visit_id AND a.patient_id=p.patient_id),ARRAY[]::text[]) AS key_alerts,
      (v.clinic_id<>$1) AS cross_clinic,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'kind',a.kind,'label',a.label,'source_note_excerpt',a.source_note_excerpt,
        'extractor_rule_id',a.extractor_rule_id,'dictionary_version',a.dictionary_version,
        'label_params',a.label_params,'excerpt_start',a.excerpt_start,'excerpt_end',a.excerpt_end) ORDER BY a.id)
        FROM operational.visit_alerts a WHERE a.visit_id=v.visit_id AND a.patient_id=p.patient_id),'[]'::jsonb) AS alerts
      FROM eligible p
      LEFT JOIN LATERAL (
        SELECT v.*,c.clinic_name,c.network_mode AS source_mode,d.doctor_name
        FROM operational.patient_visit_history v
        JOIN operational.clinics c ON c.clinic_id=v.clinic_id
        JOIN operational.doctors d ON d.doctor_id=v.doctor_id AND d.clinic_id=v.clinic_id
        WHERE v.patient_id=p.patient_id AND (
          (v.clinic_id=$1 AND p.own_patient)
          OR (v.clinic_id<>$1 AND c.network_mode='full' AND $5='full'
            AND p.consent_visible AND p.consent_withdrawn_at IS NULL AND p.consent_level IN ('basic','clinical'))
        )
        ORDER BY v.visit_date DESC,v.visit_id DESC LIMIT 100
      ) v ON true
      ORDER BY p.patient_id,v.visit_date DESC,v.visit_id DESC`,
    [auth.clinicId, auth.doctorId, after, input.q ?? "", requesterMode, limit + 1, input.patientIds ?? null]);
    // Apply visibility before pagination, and never expose totals of hidden matches.
    const patients = new Map<number, { patient: NetworkPatient; disclosures: { row: LookupRow; visibility: "basic" | "clinical" }[] }>();
    for (const row of rows) {
      // The newest row remains authoritative even when its recording clinic is
      // ineligible. Hidden grants must not authorize a different Full clinic's
      // visits; hidden withdrawals/denials must not revive an older grant.
      const consent = !row.consent_visible || row.consent_withdrawn_at ? "none" : row.consent_level;
      const reportedConsent = consent;
      // Exact-ID own patients retain an identity projection even without visits.
      if (input.patientIds && row.own_patient && !patients.has(row.patient_id)) {
        patients.set(row.patient_id, { patient: { id: row.patient_id, name: row.patient_name,
          identityVerified: false, effectiveConsentLevel: reportedConsent, visits: [] }, disclosures: [] });
      }
      if (row.visit_id == null) continue;
      const visibility = visitVisibility({ auth, sourceClinicId: row.clinic_id, sourceMode: row.source_mode, requesterMode, ownPatient: row.own_patient, consent });
      if (!visibility) continue;
      let entry = patients.get(row.patient_id);
      if (!entry) {
        entry = { patient: { id: row.patient_id, name: row.patient_name, identityVerified: false, effectiveConsentLevel: reportedConsent, visits: [] }, disclosures: [] };
        patients.set(row.patient_id, entry);
      }
      // Legacy dates have no recorded time: use documented local start-of-day.
      // Already-UTC scheduling instants are never passed through this conversion.
      entry.patient.visits.push(projectVisit({
        ...row, seen_at: fromZonedTime(`${row.visit_day}T00:00:00`, "Asia/Hebron"),
      }, visibility));
      if (row.clinic_id !== auth.clinicId) entry.disclosures.push({ row, visibility });
    }
    const visible = [...patients.values()];
    const page = visible.slice(0, limit);
    for (const entry of page) for (const { row, visibility } of entry.disclosures) {
      await appendAudit(client, auth, "network.lookup", row.patient_id, {
        correlationId, outcome: "disclosed", sourceClinicId: row.clinic_id, sourceVisitId: row.visit_id,
        effectiveLevel: row.consent_level, projection: visibility,
      });
    }
    if (!page.length) await appendAudit(client, auth, "network.lookup", null, { correlationId, outcome: "no-result" });
    return {
      items: page.map(entry => entry.patient),
      nextCursor: visible.length > limit ? Buffer.from(JSON.stringify({ after: page.at(-1)!.patient.id, fingerprint })).toString("base64url") : null,
    };
}
