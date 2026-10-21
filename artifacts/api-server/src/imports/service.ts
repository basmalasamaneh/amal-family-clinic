import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "@workspace/db";
import { canonicalPhone, normalizeName } from "@workspace/db/patient-search";
import { enforceScope, forbidden, roles, type Auth } from "../lib/auth";
import { fail } from "../lib/auth-errors";
import { patientScopeSql } from "../lib/patient-access";
import { scheduleAppointmentReminders } from "../reminders/lifecycle";
import { evaluate, type Appointment } from "../appointments/engine";
import { hebronDay, isMinor } from "../patients/demographics";
import { importMessages } from "./messages";
import { uploadInput, mapInput, commitInput, newPatientInput, sourceRow, interval, statuses, issue, localTime, wallToUtc, zone,
  type SourceRow, type Mapping, type Issue } from "./validation";

type Patient = { patient_id: number; patient_name: string; phone: string; dob: string; guardian_name: string | null; guardian_relation: string | null };
type Review = {
  action: "include" | "skip"; reviewerId: number; reviewedAt: string; reason?: string;
  method?: "phone" | "dob" | "new"; identityHash?: string; patientId?: number;
  newPatient?: ReturnType<typeof newPatientInput.parse>; associateAppointmentId?: number; overrideReason?: string;
};
type Stage = { errors: Issue[]; suggestedPatientIds: number[]; mapping: Mapping | null; review: Review | null; outcome?: string };
type ImportRow = {
  id: number; batch_id: number; source_event_id: number; source_payload: SourceRow;
  staging: Stage; confirmed_patient_id: number | null; appointment_id: number | null;
};
type Batch = {
  id: number; clinic_id: number; source_name: string; status: string; owner_id: number;
  owner_doctor_id: number | null; version: number; created_at: Date; committed_at: Date | null; report: unknown;
};
type Conflict = { kind: string; rowIds: number[]; code: string; messageKey: string; severity: string; appointmentId?: number };
type ReviewHistory = {
  rowId: number; version: number; reviewerId: number; reviewedAt: string; action: string;
  verificationMethod: string | null; patientId: number | null; reason: string | null;
  overrideReason: string | null; associateAppointmentId: number | null;
  mapping: (Mapping & { startLocal: string; endLocal: string; timezone: string }) | null; priorConflicts: Conflict[];
};
async function history(c: PoolClient, id: number): Promise<ReviewHistory[]> {
  const { rows: events } = await c.query("SELECT row_id,version,reviewer_id,reviewed_at,action,verification_method,detail FROM operational.import_reviews WHERE batch_id=$1 ORDER BY id", [id]);
  return events.map(e => ({ rowId: e.row_id, version: e.version, reviewerId: e.reviewer_id,
    reviewedAt: e.reviewed_at.toISOString(), action: e.action, verificationMethod: e.verification_method,
    patientId: e.detail.patientId ?? null, reason: e.detail.reason ?? null, overrideReason: e.detail.overrideReason ?? null,
    associateAppointmentId: e.detail.associateAppointmentId ?? null,
    mapping: e.detail.mapping ? { ...e.detail.mapping, startLocal: localTime(e.detail.mapping.startsAt),
      endLocal: localTime(e.detail.mapping.endsAt), timezone: zone } : null,
    priorConflicts: e.detail.priorConflicts ?? [],
  }));
}
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`;
  return JSON.stringify(v);
}
const hash = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex");
// Fingerprint is internal only and is never exposed in projections or audit detail.
const identityHash = (p: Patient, batch: Batch) => hash([batch.id, batch.created_at.toISOString(), p]);
const sourceNamespace = "calendar_app_export";
function sourceHash(r: ImportRow, b: Batch) {
  const source = sourceRow.parse(r.source_payload);
  // Provenance fingerprints the immutable input, not the corrected booking.
  // Canonicalize each valid timestamp independently: invalid/reversed intervals
  // remain fingerprintable, while equivalent seed UTC / JSON wall times agree.
  const originalTime = (value: string) => {
    try { return b.source_name === sourceNamespace ? new Date(value).toISOString() : wallToUtc(value); }
    catch { return { invalidOriginalTime: value }; }
  };
  return hash({ ...source, start_time: originalTime(source.start_time), end_time: originalTime(source.end_time) });
}
const conflict = (code: string) => fail(409, code, "conflict");
const missing = () => fail(404, "NOT_FOUND", "notFound");
async function transaction<T>(auth: Auth, work: (c: PoolClient, a: Auth) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    // Same order as safe-merge, then the exact appointment/hold coordination lock.
    await c.query("SELECT pg_advisory_xact_lock(160005)");
    await c.query("SELECT pg_advisory_xact_lock(761910)");
    const { rows: [u] } = await c.query("SELECT role,clinic_id,doctor_id FROM operational.users WHERE id=$1 FOR SHARE", [auth.id]);
    if (!u || !Object.hasOwn(roles, u.role)) throw forbidden();
    const a = { ...auth, role: roles[u.role as keyof typeof roles], clinicId: u.clinic_id, doctorId: u.doctor_id };
    if (!["doctor", "front-desk"].includes(a.role) || !a.clinicId) throw forbidden();
    const result = await work(c, a);
    await c.query("COMMIT");
    return result;
  } catch (e) { await c.query("ROLLBACK"); throw e; }
  finally { c.release(); }
}
function authorize(a: Auth, b: Batch) {
  enforceScope(a, b.clinic_id);
  // Batch artifacts can contain typed names from the uploader's document. Ownership
  // is stricter than clinic-wide chart access; no ambient manager/admin privilege.
  if (b.owner_id !== a.id || (a.role === "doctor" && b.owner_doctor_id !== a.doctorId)) throw forbidden();
}
async function batch(c: PoolClient, a: Auth, id: number) {
  const { rows: [b] } = await c.query<Batch>("SELECT * FROM operational.import_batches WHERE id=$1 FOR UPDATE", [id]);
  if (!b) throw missing();
  authorize(a, b);
  return b;
}
async function rows(c: PoolClient, id: number) {
  return (await c.query<ImportRow>("SELECT * FROM operational.import_rows WHERE batch_id=$1 ORDER BY id FOR UPDATE", [id])).rows;
}
async function patient(c: PoolClient, a: Auth, id: number): Promise<Patient> {
  const { rows: [p] } = await c.query<Patient>(`SELECT p.patient_id,p.patient_name,p.phone,p.dob::text,p.guardian_name,p.guardian_relation
    FROM operational.patients p WHERE ${patientScopeSql("$1")} AND p.patient_id=$2 FOR UPDATE OF p`, [a.clinicId, id]);
  if (!p) throw missing();
  return p;
}
async function doctor(c: PoolClient, a: Auth, id: number) {
  const { rows: [d] } = await c.query("SELECT doctor_id,clinic_id FROM operational.doctors WHERE doctor_id=$1 FOR SHARE", [id]);
  if (!d) throw missing();
  enforceScope(a, d.clinic_id, d.doctor_id);
  return d;
}
function checkVersion(b: Batch, version: number) {
  if (b.status === "committed") throw conflict("IMPORT_ALREADY_COMMITTED");
  if (b.version !== version) throw conflict("VERSION_CONFLICT");
}
async function receipt(c: PoolClient, a: Auth, key: string, fingerprint: string, operation: string) {
  const { rows: [r] } = await c.query("SELECT * FROM operational.import_operations WHERE user_id=$1 AND client_op_id=$2", [a.id, key]);
  if (r && (r.request_hash !== fingerprint || r.operation !== operation)) throw conflict("IDEMPOTENCY_CONFLICT");
  return r;
}
async function record(c: PoolClient, a: Auth, key: string, fingerprint: string, b: Batch, operation: string) {
  await c.query("INSERT INTO operational.import_operations(user_id,client_op_id,request_hash,batch_id,operation) VALUES($1,$2,$3,$4,$5)",
    [a.id, key, fingerprint, b.id, operation]);
}
async function audit(c: PoolClient, a: Auth, b: Batch, action: string, detail: unknown) {
  await c.query("INSERT INTO operational.audit_log(user_id,clinic_id,action,detail) VALUES($1,$2,$3,$4)", [a.id, b.clinic_id, action, JSON.stringify(detail)]);
}
function engineRow(r: ImportRow): Appointment {
  const m = r.staging.mapping!;
  return { id: -r.id, clinicId: m.clinicId, doctorId: m.doctorId, patientId: r.staging.review?.patientId ?? -r.id,
    startAt: m.startsAt, durationMinutes: m.durationMinutes, status: m.status };
}
function appointmentRow(r: any): Appointment {
  return { id: r.appointment_id, clinicId: r.clinic_id, doctorId: r.doctor_id, patientId: r.patient_id,
    startAt: r.scheduled_at.toISOString(), durationMinutes: r.duration_minutes, status: r.status };
}
async function association(c: PoolClient, a: Auth, r: ImportRow, appointmentId: number) {
  const { rows: [p] } = await c.query("SELECT * FROM operational.appointments WHERE appointment_id=$1 FOR UPDATE", [appointmentId]);
  const m = r.staging.mapping!, identity = r.staging.review?.patientId;
  if (!p || !identity || p.patient_id !== identity || p.clinic_id !== m.clinicId || p.doctor_id !== m.doctorId ||
    p.scheduled_at.toISOString() !== m.startsAt || p.duration_minutes !== m.durationMinutes || p.status !== m.status) {
    throw conflict("IMPORT_ASSOCIATION_MISMATCH");
  }
  enforceScope(a, p.clinic_id, p.doctor_id);
  return p;
}
async function conflicts(c: PoolClient, a: Auth, rs: ImportRow[]): Promise<Conflict[]> {
  const candidates = rs.filter(r => r.staging.mapping && r.staging.review?.action !== "skip" && !r.staging.errors.length);
  const results: Conflict[] = [], seen = new Map<string, Conflict>();
  for (const r of candidates) {
    const m = r.staging.mapping!, review = r.staging.review;
    const { rows: [clinic] } = await c.query("SELECT * FROM operational.clinics WHERE clinic_id=$1", [m.clinicId]);
    const { rows: existing } = await c.query("SELECT * FROM operational.appointments WHERE doctor_id=$1 OR patient_id=$2", [m.doctorId, review?.patientId ?? 0]);
    // Coincident doctor/time is visible evidence, not a booking conflict or identity
    // match. The real export has five such rows, including inactive statuses.
    for (const p of existing) {
      if (p.doctor_id === m.doctorId && p.scheduled_at.toISOString() === m.startsAt &&
        p.clinic_id === a.clinicId && (a.role !== "doctor" || p.doctor_id === a.doctorId)) {
        results.push({ kind: "source-coincidence", rowIds: [r.id], code: "doctor-time-coincidence",
          messageKey: "import.doctor-time-coincidence", severity: "info", appointmentId: p.appointment_id });
      }
    }
    const { rows: holds } = await c.query("SELECT * FROM operational.appointment_holds WHERE doctor_id=$1 AND expires_at>clock_timestamp()", [m.doctorId]);
    const associated = review?.associateAppointmentId;
    const other = candidates.filter(x => x.id !== r.id && (!associated || x.staging.review?.associateAppointmentId !== associated));
    const result = evaluate({
      appointment: { ...engineRow(r), id: associated ?? -r.id },
      appointments: [...existing.map(appointmentRow), ...other.map(engineRow)],
      holds: holds.map(h => ({ clinicId: h.clinic_id, doctorId: h.doctor_id, startAt: h.starts_at.toISOString(),
        durationMinutes: h.duration_minutes, ownerId: -1, expiresAt: h.expires_at.toISOString() })),
      settings: { workingDays: clinic.working_days, openTime: clinic.open_time, closeTime: clinic.close_time, slotMinutes: clinic.slot_minutes, timezone: clinic.timezone },
      now: new Date(), ownerId: a.id, canOverride: true, overrideReason: review?.overrideReason,
      visible: p => p.id < 0 || (p.clinicId === a.clinicId && (a.role !== "doctor" || p.doctorId === a.doctorId)),
    });
    for (const f of result.conflicts) {
      const staged = f.with && f.with.appointmentId < 0;
      const ids = staged ? [r.id, -f.with!.appointmentId].sort((x, y) => x - y) : [r.id];
      const key = `${f.type}:${ids.join(",")}:${staged ? "" : f.with?.appointmentId ?? ""}`;
      const severity = f.severity === "warning" && review?.overrideReason ? "acknowledged" : f.severity;
      const prior = seen.get(key);
      if (prior) {
        // A single display pair still represents two row-level decisions.
        // Any unacknowledged participant keeps the pair unresolved, independent
        // of row order; one row's reason never acknowledges the other row.
        if (severity === "warning") prior.severity = "warning";
        continue;
      }
      const entry: Conflict = { kind: staged ? "intra-export" : f.with || ["doctor-overlap", "patient-overlap", "same-day-other-clinic"].includes(f.type) ? "existing-appointment" : "policy",
        rowIds: ids, code: f.type, messageKey: `import.${f.type}`,
        severity,
        ...(f.with && !staged ? { appointmentId: f.with.appointmentId } : {}),
      };
      seen.set(key, entry);
      results.push(entry);
    }
  }
  return results;
}
function projection(b: Batch, rs: ImportRow[], cs: Conflict[], reviews: ReviewHistory[]) {
  const projected = rs.map(r => {
    const s = r.staging, review = s.review;
    return { id: r.id, source: r.source_payload, suggestedPatientIds: s.suggestedPatientIds,
      confirmedPatientId: r.confirmed_patient_id ?? review?.patientId ?? null, errors: s.errors,
      review: review ? { action: review.action, reviewerId: review.reviewerId, reviewedAt: review.reviewedAt,
        ...(review.method ? { verificationMethod: review.method } : {}),
        ...(review.reason ? { reason: review.reason } : {}),
        ...(review.overrideReason ? { overrideReason: review.overrideReason } : {}),
        ...(review.associateAppointmentId ? { associateAppointmentId: review.associateAppointmentId } : {}),
        identityAction: review.method === "new" ? "create" : review.patientId ? "existing" : null } : null,
      mapping: s.mapping ? { ...s.mapping, startLocal: localTime(s.mapping.startsAt), endLocal: localTime(s.mapping.endsAt), timezone: zone } : null,
      outcome: s.outcome ?? (review?.action === "skip" ? "skipped" : review ? "reviewed" : "review-required"),
      appointmentId: r.appointment_id, availableActions: ["include-existing", "create-patient", "skip"],
      reviewHistory: reviews.filter(e => e.rowId === r.id),
    };
  });
  return { id: b.id, version: b.version, status: b.status, sourceName: b.source_name, adapter: sourceNamespace,
    createdAt: b.created_at.toISOString(), committedAt: b.committed_at?.toISOString() ?? null,
    rows: projected, conflicts: cs, totals: {
      sourceRows: rs.length, autoLinked: 0, reviewRequired: rs.filter(r => !r.staging.review).length,
      suggestedRows: rs.filter(r => r.staging.suggestedPatientIds.length > 0).length,
      skipped: rs.filter(r => r.staging.review?.action === "skip").length,
      created: rs.filter(r => r.staging.outcome === "created").length,
      linked: rs.filter(r => r.staging.outcome === "linked" || r.staging.outcome === "source-replay").length,
      intraExportPairs: new Set(cs.filter(x => x.kind === "intra-export" && x.code === "doctor-overlap").map(x => x.rowIds.join(","))).size,
      existingOverlaps: cs.filter(x => x.kind === "existing-appointment" && x.code === "doctor-overlap").length,
      existingCoincidences: cs.filter(x => x.kind === "source-coincidence").length,
    },
  };
}
async function read(c: PoolClient, a: Auth, b: Batch) {
  if (b.status === "committed") return b.report;
  const rs = await rows(c, b.id);
  return projection(b, rs, await conflicts(c, a, rs), await history(c, b.id));
}
export async function uploadImport(auth: Auth, raw: unknown) {
  if (Buffer.byteLength(JSON.stringify(raw) ?? "") > 131072) throw fail(413, "IMPORT_TOO_LARGE", "validation");
  const input = uploadInput.parse(raw);
  return transaction(auth, async (c, a) => {
    const fingerprint = hash(input), prior = await receipt(c, a, input.clientOpId, fingerprint, "upload");
    if (prior) return read(c, a, await batch(c, a, prior.batch_id));
    let source: Record<string, unknown>[];
    if (input.source === "seed") {
      // Source timestamps were converted once at workbook ingestion. Never re-zone.
      source = (await c.query("SELECT event_id,doctor_email,patient_name_typed,start_time,end_time,event_status FROM public.calendar_app_export ORDER BY event_id")).rows.map(r => ({
        ...r, start_time: r.start_time.toISOString(), end_time: r.end_time.toISOString(),
      }));
    } else source = input.rows!;
    if (!source.length || source.length > 100) throw fail(400, "IMPORT_ROW_LIMIT", "validation");
    const { rows: [b] } = await c.query<Batch>(`INSERT INTO operational.import_batches(clinic_id,source_name,source_checksum,owner_id,owner_doctor_id)
      VALUES($1,$2,$3,$4,$5) RETURNING *`, [a.clinicId, input.source === "seed" ? "calendar_app_export" : input.sourceName, hash(source), a.id, a.role === "doctor" ? a.doctorId : null]);
    const { rows: roster } = await c.query<{ patient_id: number; patient_name: string }>(`SELECT p.patient_id,p.patient_name FROM operational.patients p WHERE ${patientScopeSql("$1")}`, [a.clinicId]);
    const eventIds = new Set<number>();
    for (let i = 0; i < source.length; i++) {
      const rawRow = source[i]!, parsed = sourceRow.safeParse(rawRow);
      const errors: Issue[] = [], s: Stage = { errors, suggestedPatientIds: [], mapping: null, review: null };
      if (!parsed.success) errors.push(issue("INVALID_COLUMNS", { row: i + 1 }));
      const eventId = parsed.success ? parsed.data.event_id : -(i + 1);
      if (eventIds.has(eventId)) throw fail(400, "IMPORT_DUPLICATE_EVENT_ID", "validation", { row: i + 1 });
      eventIds.add(eventId);
      if (parsed.success) {
        const r = parsed.data;
        s.suggestedPatientIds = roster.filter(p => normalizeName(p.patient_name) === normalizeName(r.patient_name_typed)).map(p => p.patient_id);
        const { rows: ds } = await c.query("SELECT doctor_id,clinic_id FROM operational.doctors WHERE lower(email)=lower($1)", [r.doctor_email]);
        const d = ds.length === 1 ? ds[0] : null;
        const inScope = d && d.clinic_id === a.clinicId && (a.role !== "doctor" || d.doctor_id === a.doctorId);
        if (!inScope) errors.push(issue(ds.length > 1 ? "AMBIGUOUS_DOCTOR" : d ? "DOCTOR_OUT_OF_SCOPE" : "MISSING_DOCTOR"));
        if (!Object.hasOwn(statuses, r.event_status)) errors.push(issue("UNSUPPORTED_STATUS"));
        try {
          const times = interval(r.start_time, r.end_time, input.source === "seed");
          if (inScope && Object.hasOwn(statuses, r.event_status)) s.mapping = { ...times, doctorId: d.doctor_id, clinicId: d.clinic_id, status: statuses[r.event_status]! };
        } catch (e) { errors.push(issue(e instanceof Error ? e.message : "INVALID_LOCAL_TIME")); }
      }
      await c.query("INSERT INTO operational.import_rows(batch_id,source_event_id,source_payload,staging,suggested_patient_id,suggested_doctor_id) VALUES($1,$2,$3,$4,$5,$6)",
        [b!.id, eventId, JSON.stringify(rawRow), JSON.stringify(s), s.suggestedPatientIds[0] ?? null, s.mapping?.doctorId ?? null]);
    }
    await record(c, a, input.clientOpId, fingerprint, b!, "upload");
    await audit(c, a, b!, "import.uploaded", { batchId: b!.id, rows: source.length });
    return read(c, a, b!);
  });
}
export async function getImport(auth: Auth, id: number) {
  return transaction(auth, async (c, a) => read(c, a, await batch(c, a, id)));
}
export async function mapImport(auth: Auth, id: number, raw: unknown) {
  const input = mapInput.parse(raw);
  return transaction(auth, async (c, a) => {
    const b = await batch(c, a, id); checkVersion(b, input.expectedVersion);
    const rs = await rows(c, id), at = new Date().toISOString();
    const priorConflicts = await conflicts(c, a, rs);
    for (const choice of input.rows) {
      const r = rs.find(r => r.id === choice.rowId);
      if (!r) throw missing();
      let review: Review;
      if (choice.action === "skip") review = { action: "skip", reason: choice.reason, reviewerId: a.id, reviewedAt: at };
      else {
        const source = sourceRow.safeParse(r.source_payload);
        if (!source.success || !Object.hasOwn(statuses, source.data.event_status)) throw fail(422, "IMPORT_INVALID_SOURCE_ROW", "validation");
        const d = await doctor(c, a, choice.doctorId);
        let times;
        try { times = choice.startLocal ? interval(choice.startLocal, choice.endLocal!, false) :
          interval(source.data.start_time, source.data.end_time, b.source_name === "calendar_app_export"); }
        catch { throw fail(422, "IMPORT_INVALID_LOCAL_TIME", "validation"); }
        r.staging.mapping = { ...times, doctorId: d.doctor_id, clinicId: d.clinic_id, status: statuses[source.data.event_status]! };
        r.staging.errors = [];
        review = { action: "include", reviewerId: a.id, reviewedAt: at, overrideReason: choice.overrideReason,
          associateAppointmentId: choice.associateAppointmentId };
        if (choice.identity.kind === "existing") {
          const p = await patient(c, a, choice.identity.patientId), v = choice.identity.verification;
          const valid = v.method === "phone" ? canonicalPhone(v.value) !== null && canonicalPhone(v.value) === canonicalPhone(p.phone) : v.value === p.dob;
          if (!valid) throw fail(422, "IMPORT_IDENTITY_VERIFICATION_FAILED", "validation");
          review.patientId = p.patient_id; review.method = v.method; review.identityHash = identityHash(p, b);
        } else {
          if (choice.associateAppointmentId) throw fail(422, "IMPORT_NEW_PATIENT_ASSOCIATION", "validation");
          review.newPatient = choice.identity.patient; review.method = "new";
        }
      }
      r.staging.review = review;
      if (review.associateAppointmentId) await association(c, a, r, review.associateAppointmentId);
      await c.query(`UPDATE operational.import_rows SET staging=$2,review_state=$3,chosen_action=$4,confirmed_patient_id=$5,confirmed_doctor_id=$6,appointment_id=NULL WHERE id=$1`,
        [r.id, JSON.stringify(r.staging), review.action === "skip" ? "rejected" : "confirmed",
          review.action === "skip" ? "skip" : review.patientId ? "link" : "create", review.patientId ?? null,
          review.action === "include" ? r.staging.mapping!.doctorId : null]);
      await c.query(`INSERT INTO operational.import_reviews(batch_id,row_id,version,reviewer_id,action,verification_method,detail)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [id, r.id, b.version + 1, a.id, review.action, review.method ?? null,
          JSON.stringify({ patientId: review.patientId, identityAction: review.newPatient ? "create" : "existing", reason: review.reason,
            overrideReason: review.overrideReason, mapping: r.staging.mapping, associateAppointmentId: review.associateAppointmentId,
            priorConflicts: priorConflicts.filter(f => f.rowIds.includes(r.id)) })]);
    }
    const { rows: [updated] } = await c.query<Batch>("UPDATE operational.import_batches SET version=version+1,status=$2 WHERE id=$1 RETURNING *", [id, rs.every(r => r.staging.review) ? "reviewed" : "review_required"]);
    await audit(c, a, b, "import.reviewed", { batchId: id, version: updated!.version, rowIds: input.rows.map(r => r.rowId) });
    return read(c, a, updated!);
  });
}
export async function commitImport(auth: Auth, id: number, raw: unknown) {
  const input = commitInput.parse(raw);
  return transaction(auth, async (c, a) => {
    const fingerprint = hash({ id, ...input }), prior = await receipt(c, a, input.clientOpId, fingerprint, "commit");
    const b = await batch(c, a, id);
    if (prior) return read(c, a, b);
    checkVersion(b, input.expectedVersion);
    const rs = await rows(c, id);
    if (!rs.length || rs.some(r => !r.staging.review)) throw conflict("IMPORT_REVIEW_REQUIRED");
    for (const r of rs) {
      const review = r.staging.review!;
      if (review.action === "skip") continue;
      if (r.staging.errors.length || !r.staging.mapping) throw conflict("IMPORT_INVALID_ROW");
      await doctor(c, a, r.staging.mapping.doctorId);
      if (review.patientId) {
        if (identityHash(await patient(c, a, review.patientId), b) !== review.identityHash) throw conflict("IMPORT_STALE_IDENTITY");
      } else if (review.newPatient) newPatientInput.parse(review.newPatient);
      else throw conflict("IMPORT_REVIEW_REQUIRED");
      const { rows: [link] } = await c.query("SELECT * FROM operational.import_source_links WHERE source_name=$1 AND source_event_id=$2",
        [sourceNamespace, r.source_event_id]);
      if (link) {
        if (link.source_hash !== sourceHash(r, b)) throw conflict("IMPORT_SOURCE_CHANGED");
        // Provenance replay is not clinical verification: manual review still precedes
        // this exact-field check, and cannot create a second patient or appointment.
        await association(c, a, r, link.appointment_id);
        review.associateAppointmentId = link.appointment_id; r.staging.outcome = "source-replay";
      } else if (review.associateAppointmentId) await association(c, a, r, review.associateAppointmentId);
    }
    const cs = await conflicts(c, a, rs);
    if (cs.some(x => x.severity === "blocking" || x.severity === "warning")) throw conflict("IMPORT_CONFLICT");
    for (const r of rs) {
      const review = r.staging.review!;
      if (review.action === "skip") {
        r.staging.outcome = "skipped";
        await c.query("UPDATE operational.import_rows SET staging=$2 WHERE id=$1", [r.id, JSON.stringify(r.staging)]);
        continue;
      }
      const m = r.staging.mapping!;
      if (review.newPatient) {
        const p = newPatientInput.parse(review.newPatient), minor = isMinor(p.dateOfBirth);
        const { rows: [created] } = await c.query(`INSERT INTO operational.patients(patient_name,phone,dob,name_normalized,created_clinic_id,minor_as_of,guardian_name,guardian_relation)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING patient_id`,
        [p.name, p.phone, p.dateOfBirth, normalizeName(p.name), a.clinicId, hebronDay(), minor ? p.guardianName : null, minor ? p.guardianRelation : null]);
        review.patientId = created.patient_id;
        await audit(c, a, b, "patient.created", { patientId: review.patientId, batchId: id, rowId: r.id });
      }
      r.confirmed_patient_id = review.patientId!;
      if (review.associateAppointmentId) { r.appointment_id = review.associateAppointmentId; r.staging.outcome ??= "linked"; }
      else {
        const { rows: [created] } = await c.query(`INSERT INTO operational.appointments(clinic_id,doctor_id,patient_id,scheduled_at,duration_minutes,booking_method,status,created_by)
          VALUES($1,$2,$3,$4,$5,'import',$6,$7) RETURNING appointment_id`,
        [m.clinicId, m.doctorId, review.patientId, m.startsAt, m.durationMinutes, m.status, a.id]);
        r.appointment_id = created.appointment_id; r.staging.outcome = "created";
        // The import transaction already owns the scheduling lock. Only newly
        // created, eligible future bookings schedule; associations/replays never
        // backfill reminders on pre-existing or historical appointments.
        const { rows: [clock] } = await c.query("SELECT clock_timestamp() AS now");
        await scheduleAppointmentReminders(c, created.appointment_id, clock.now);
      }
      if (r.staging.outcome !== "source-replay") await c.query(`INSERT INTO operational.import_source_links(source_name,source_event_id,source_hash,appointment_id,batch_id,row_id)
        VALUES($1,$2,$3,$4,$5,$6)`, [sourceNamespace, r.source_event_id, sourceHash(r, b), r.appointment_id, id, r.id]);
      // Retain only review evidence, not staged demographics or verification digests.
      delete review.newPatient; delete review.identityHash;
      await c.query("UPDATE operational.import_rows SET staging=$2,confirmed_patient_id=$3,appointment_id=$4 WHERE id=$1",
        [r.id, JSON.stringify(r.staging), review.patientId, r.appointment_id]);
      await audit(c, a, b, "import.row_committed", { batchId: id, rowId: r.id, appointmentId: r.appointment_id,
        patientId: review.patientId, outcome: r.staging.outcome, overrideReason: review.overrideReason, conflicts: cs.filter(x => x.rowIds.includes(r.id)) });
    }
    b.status = "committed"; b.version++; b.committed_at = new Date();
    const report = projection(b, rs, cs, await history(c, id));
    await c.query("UPDATE operational.import_batches SET status='committed',version=$2,committed_at=$3,report=$4 WHERE id=$1", [id, b.version, b.committed_at, JSON.stringify(report)]);
    await record(c, a, input.clientOpId, fingerprint, b, "commit");
    await audit(c, a, b, "import.committed", { batchId: id, version: b.version, totals: report.totals });
    return report;
  });
}
export async function importReport(auth: Auth, id: number, locale: "ar" | "en") {
  const result = await getImport(auth, id);
  return { locale, labels: { ...reportLabels[locale], ...importMessages[locale] }, batch: result };
}
export const reportLabels = {
  en: { source: "Original source", suggested: "Suggested identity — not verified", confirmed: "Confirmed identity",
    skipped: "Skipped", created: "Appointment created", linked: "Existing appointment linked", reviewer: "Reviewer",
    timezone: "Asia/Hebron local time", reviewRequired: "Manual review required", conflicts: "Scheduling conflicts" },
  ar: { source: "المصدر الأصلي", suggested: "هوية مقترحة — غير مؤكدة", confirmed: "الهوية المؤكدة",
    skipped: "تم التخطي", created: "تم إنشاء الموعد", linked: "تم ربط موعد موجود", reviewer: "المراجع",
    timezone: "التوقيت المحلي Asia/Hebron", reviewRequired: "مراجعة يدوية مطلوبة", conflicts: "تعارضات المواعيد" },
};
