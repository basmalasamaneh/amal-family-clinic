import { patientScopeSql } from "../lib/patient-access";
import { cancelAppointmentReminders, scheduleAppointmentReminders } from "../reminders/lifecycle";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { enforceScope, forbidden, roles, type Auth } from "../lib/auth";
import { ApiError, fail } from "../lib/auth-errors";
import { evaluate, nearestAvailability, type Appointment, type ConflictResult } from "./engine";

const positive = z.number().int().positive();
const instant = z.iso.datetime({ offset: false }).refine(value => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19);
}).transform(value => new Date(value).toISOString());
const operationId = z.uuid();
const reason = z.string().trim().min(1).max(2000);
const intervalFields = { clinicId: positive, doctorId: positive, patientId: positive, startsAt: instant, endsAt: instant };
const options = { overrideReason: reason.optional(), holdToken: z.uuid().optional() };
export const createInput = z.object({
  ...intervalFields, clientOpId: operationId, source: z.enum(["phone", "walk-in", "online", "import"]), ...options,
}).strict();
export const checkInput = createInput.extend({ clientOpId: operationId.optional(), appointmentId: positive.optional(), expectedVersion: positive.optional() });
export const holdInput = z.object({ ...intervalFields, clientOpId: operationId, appointmentId: positive.optional(), overrideReason: reason.optional() }).strict();
export const updateInput = z.object({
  clientOpId: operationId, expectedVersion: positive, startsAt: instant.optional(), endsAt: instant.optional(),
  status: z.enum(["booked", "double_booked", "completed", "no_show", "cancelled"]).optional(), cancelReason: reason.optional(), ...options,
}).strict().refine(value => value.startsAt !== undefined || value.endsAt !== undefined || value.status !== undefined);
export const releaseInput = z.object({ clientOpId: operationId }).strict();
export const listInput = z.object({
  clinicId: z.coerce.number().int().positive(), doctorId: z.coerce.number().int().positive().optional(),
  patientId: z.coerce.number().int().positive().optional(), status: z.enum(["booked", "double_booked", "completed", "no_show", "cancelled"]).optional(),
  upcoming: z.enum(["true", "false"]).transform(v => v === "true").optional(),
  from: instant.optional(), to: instant.optional(), cursor: z.string().max(512).optional(), limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict().refine(v => v.upcoming ? v.patientId !== undefined &&
  (v.status === undefined || ["booked", "double_booked"].includes(v.status)) : v.from !== undefined && v.to !== undefined)
  .refine(v => !v.from || !v.to || Date.parse(v.to) > Date.parse(v.from));
export const availabilityInput = z.object({
  clinicId: z.coerce.number().int().positive(), patientId: z.coerce.number().int().positive(),
}).strict();
type Booking = z.infer<typeof createInput>;
type IntervalInput = z.infer<typeof holdInput>;
type Row = {
  appointment_id: number; clinic_id: number; doctor_id: number; patient_id: number; scheduled_at: Date;
  duration_minutes: number; status: string; booking_method: string; client_op_id: string | null; version: number;
};
type HoldRow = {
  token: string; owner_id: number; clinic_id: number; doctor_id: number; patient_id: number;
  appointment_id: number | null; starts_at: Date; duration_minutes: number; expires_at: Date;
};
const conflict = (code = "APPOINTMENT_CONFLICT", params: Record<string, number> = {}) => fail(409, code, "conflict", params);
const missing = () => fail(404, "NOT_FOUND", "notFound");
function duration(input: { startsAt: string; endsAt: string }) {
  const minutes = (Date.parse(input.endsAt) - Date.parse(input.startsAt)) / 60000;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw fail(400, "VALIDATION", "validation");
  return minutes;
}
function engineRow(row: Row): Appointment {
  return { id: row.appointment_id, clinicId: row.clinic_id, doctorId: row.doctor_id, patientId: row.patient_id, startAt: row.scheduled_at.toISOString(), durationMinutes: row.duration_minutes, status: row.status };
}
export function project(row: Row) {
  return {
    id: row.appointment_id, clinicId: row.clinic_id, doctorId: row.doctor_id, patientId: row.patient_id,
    startsAt: row.scheduled_at.toISOString(), endsAt: new Date(row.scheduled_at.getTime() + row.duration_minutes * 60000).toISOString(),
    source: row.booking_method,
    clientOpId: row.client_op_id, status: row.status, version: row.version,
  };
}
export function bookingScope(auth: Auth, clinicId: number, doctorId: number) {
  if (auth.role !== "doctor" && auth.role !== "front-desk") throw forbidden();
  enforceScope(auth, clinicId, doctorId);
}
export async function currentAuth(client: Pick<PoolClient, "query">, auth: Auth): Promise<Auth> {
  const { rows: [user] } = await client.query(`SELECT u.role,u.clinic_id,u.doctor_id,s.device_id
    FROM operational.users u JOIN operational.auth_sessions s ON s.user_id=u.id
    WHERE u.id=$1 AND s.token_digest=$2 AND s.revoked_at IS NULL AND u.disabled_at IS NULL
      AND ((u.role='receptionist' AND s.device_id IS NOT NULL AND s.absolute_expires_at>clock_timestamp())
        OR (u.role IN ('doctor','administrator') AND s.last_seen_at>clock_timestamp()-interval '30 minutes'))
      AND (s.device_id IS NULL OR EXISTS(SELECT 1 FROM operational.auth_devices a
        JOIN operational.devices d ON d.id=a.device_id WHERE a.device_id=s.device_id
          AND a.revoked_at IS NULL AND d.clinic_id=u.clinic_id))`, [auth.id, auth.sessionDigest]);
  if (!user || !Object.hasOwn(roles, user.role)) throw forbidden();
  if ((user.device_id ?? null) !== (auth.device?.id ?? null) ||
    (auth.device && auth.device.clinicId !== user.clinic_id)) throw forbidden();
  return { ...auth, role: roles[user.role as keyof typeof roles], clinicId: user.clinic_id, doctorId: user.doctor_id };
}
export async function transaction<T>(auth: Auth, work: (client: PoolClient, actor: Auth, now: Date) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // All previews and appointment/hold mutations share this lock, including cross-clinic patient checks.
    await client.query("SELECT pg_advisory_xact_lock(761910)");
    const actor = await currentAuth(client, auth);
    const { rows: [clock] } = await client.query("SELECT clock_timestamp() AS now");
    const result = await work(client, actor, clock.now);
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
/** Receipts preserve outcomes, not the authority to redisclose old counts.
 * Historical evidence has no reliable source-clinic provenance after redaction.
 * Apply at every receipt/history delivery, including sync error envelopes. */
export function projectStoredOperationResult<T extends Record<string, any>>(result: T): T {
  if (result.code === "APPOINTMENT_CONFLICT" && result.params) {
    const { conflictCount: _count, ...params } = result.params;
    return { ...result, params };
  }
  if (result.error) return { ...result, error: projectStoredOperationResult(result.error) };
  return result;
}
export async function replay(client: PoolClient, actor: Auth, clientOpId: string, target: string, payload: unknown) {
  const hash = createHash("sha256").update(canonical({ target, payload })).digest("hex");
  const { rows: [op] } = await client.query("SELECT * FROM operational.appointment_operations WHERE client_op_id=$1", [clientOpId]);
  if (op) {
    // Reauthorization precedes returning a stored response, never trust recorded scope alone.
    bookingScope(actor, op.clinic_id, op.doctor_id);
    if (op.actor_id !== actor.id || op.payload_hash !== hash) throw conflict("IDEMPOTENCY_CONFLICT");
    if (op.device_id !== null && op.device_id !== actor.device?.id) throw conflict("IDEMPOTENCY_CONFLICT");
    op.result = projectStoredOperationResult(op.result);
    if (op.status === "conflict" || op.status === "rejected") throw fail(op.result.httpStatus ?? 409, op.result.code, "conflict", op.result.params);
  }
  return { hash, op };
}
export async function record(client: PoolClient, actor: Auth, clientOpId: string, clinicId: number, doctorId: number, hash: string, result: unknown) {
  await client.query(`INSERT INTO operational.appointment_operations(client_op_id,actor_id,clinic_id,doctor_id,payload_hash,result) VALUES($1,$2,$3,$4,$5,$6)`,
    [clientOpId, actor.id, clinicId, doctorId, hash, JSON.stringify(result)]);
}
export async function existing(client: PoolClient, actor: Auth, id: number): Promise<Row> {
  const { rows: [row] } = await client.query<Row>("SELECT * FROM operational.appointments WHERE appointment_id=$1", [id]);
  if (!row) throw missing();
  bookingScope(actor, row.clinic_id, row.doctor_id);
  return row;
}
async function relationships(client: PoolClient, input: Pick<IntervalInput, "clinicId" | "doctorId" | "patientId">) {
  const { rows: [valid] } = await client.query(`SELECT
    EXISTS(SELECT 1 FROM operational.doctors WHERE doctor_id=$1 AND clinic_id=$2) AS doctor,
    EXISTS(SELECT 1 FROM operational.patients p WHERE p.patient_id=$3 AND ${patientScopeSql("$2")}) AS patient`, [input.doctorId, input.clinicId, input.patientId]);
  if (!valid.doctor || !valid.patient) throw fail(422, "INVALID_BOOKING_REFERENCE", "validation");
}
async function authorizedPatient(client: Pick<PoolClient, "query">, clinicId: number, patientId: number) {
  const { rows: [row] } = await client.query(
    `SELECT p.patient_id FROM operational.patients p WHERE p.patient_id=$2 AND ${patientScopeSql("$1")}`, [clinicId, patientId]);
  if (!row) throw missing();
}

export async function getAppointmentAvailability(auth: Auth, raw: unknown) {
  const input = availabilityInput.parse(raw);
  return transaction(auth, async (client, actor, now) => {
    if (!["doctor", "front-desk"].includes(actor.role)) throw forbidden();
    enforceScope(actor, input.clinicId);
    await authorizedPatient(client, input.clinicId, input.patientId);
    const { rows: [clinic] } = await client.query("SELECT slot_minutes,working_days,open_time,close_time,timezone FROM operational.clinics WHERE clinic_id=$1", [input.clinicId]);
    if (!clinic) throw missing();
    const { rows: doctors } = await client.query<{ doctor_id: number }>(
      "SELECT doctor_id FROM operational.doctors WHERE clinic_id=$1 AND ($2::integer IS NULL OR doctor_id=$2) ORDER BY doctor_id",
      [input.clinicId, actor.role === "doctor" ? actor.doctorId : null]);
    // Patient collisions may be cross-clinic; only proposed local slots leave the service.
    const { rows: appointments } = await client.query<Row>(
      `SELECT a.* FROM operational.appointments a
        JOIN operational.clinics source ON source.clinic_id=a.clinic_id
        JOIN operational.clinics requester ON requester.clinic_id=$1
        WHERE (a.clinic_id=$1 OR (a.patient_id=$2 AND source.network_mode='full' AND requester.network_mode='full'))
          AND a.status IN ('booked','double_booked')`,
      [input.clinicId, input.patientId]);
    const { rows: holds } = await client.query<HoldRow>(
      "SELECT * FROM operational.appointment_holds WHERE clinic_id=$1 AND expires_at>$2", [input.clinicId, now]);
    const items = doctors.flatMap(doctor => {
      bookingScope(actor, input.clinicId, doctor.doctor_id);
      const slot = nearestAvailability({
        appointment: { id: 0, clinicId: input.clinicId, doctorId: doctor.doctor_id, patientId: input.patientId,
          startAt: now.toISOString(), durationMinutes: clinic.slot_minutes, status: "booked" },
        appointments: appointments.map(engineRow),
        holds: holds.map(h => ({ clinicId: h.clinic_id, doctorId: h.doctor_id, startAt: h.starts_at.toISOString(),
          durationMinutes: h.duration_minutes, ownerId: h.owner_id, expiresAt: h.expires_at.toISOString() })),
        settings: { workingDays: clinic.working_days, openTime: clinic.open_time, closeTime: clinic.close_time,
          slotMinutes: clinic.slot_minutes, timezone: clinic.timezone },
        now, ownerId: actor.id, canOverride: false, visible: () => false,
      });
      return slot ? [{ doctorId: doctor.doctor_id, ...slot }] : [];
    });
    return { items, durationMinutes: clinic.slot_minutes, checkedAt: now.toISOString() };
  });
}
function exactHold(h: HoldRow, actor: Auth, input: { clinicId: number; doctorId: number; patientId: number; startsAt: string }, minutes: number, appointmentId?: number) {
  return h.owner_id === actor.id && h.clinic_id === input.clinicId && h.doctor_id === input.doctorId &&
    h.patient_id === input.patientId && h.starts_at.toISOString() === input.startsAt && h.duration_minutes === minutes &&
    h.appointment_id === (appointmentId ?? null);
}
async function preview(client: PoolClient, actor: Auth, now: Date, input: z.infer<typeof checkInput>, status = "booked") {
  bookingScope(actor, input.clinicId, input.doctorId);
  const minutes = duration(input);
  await relationships(client, input);
  if (input.appointmentId) {
    const row = await existing(client, actor, input.appointmentId);
    if (row.clinic_id !== input.clinicId || row.doctor_id !== input.doctorId || row.patient_id !== input.patientId) throw forbidden();
    if (input.expectedVersion !== undefined && row.version !== input.expectedVersion) throw conflict("VERSION_CONFLICT", { currentVersion: row.version });
  }
  const { rows: [clinic] } = await client.query("SELECT * FROM operational.clinics WHERE clinic_id=$1", [input.clinicId]);
  if (!clinic) throw fail(422, "INVALID_BOOKING_REFERENCE", "validation");
  // The scheduling lock orders this authoritative mode read against lifecycle
  // transitions. Filtering before evaluation also protects counts, suggestions,
  // overrides and eligibility (redacting only `with` would still leak existence).
  const { rows: appointments } = await client.query<Row>(`SELECT a.* FROM operational.appointments a
    JOIN operational.clinics source ON source.clinic_id=a.clinic_id
    WHERE (a.doctor_id=$1 OR a.patient_id=$2) AND a.status IN ('booked','double_booked')
      AND (a.clinic_id=$3 OR (source.network_mode='full' AND $4='full'))`,
  [input.doctorId, input.patientId, input.clinicId, clinic.network_mode]);
  const { rows: holds } = await client.query<HoldRow>("SELECT * FROM operational.appointment_holds WHERE doctor_id=$1 AND expires_at>$2", [input.doctorId, now]);
  if (input.holdToken && !holds.some(h => h.token === input.holdToken && exactHold(h, actor, input, minutes, input.appointmentId))) throw conflict("HOLD_EXPIRED");
  const result = evaluate({
    appointment: { id: input.appointmentId ?? 0, clinicId: input.clinicId, doctorId: input.doctorId, patientId: input.patientId, startAt: input.startsAt, durationMinutes: minutes, status },
    appointments: appointments.map(engineRow),
    holds: holds.filter(h => !exactHold(h, actor, input, minutes, input.appointmentId)).map(h => ({
      clinicId: h.clinic_id, doctorId: h.doctor_id, startAt: h.starts_at.toISOString(), durationMinutes: h.duration_minutes,
      // Only an exact owner+interval+patient+target hold is exempt; other own holds still block.
      ownerId: h.owner_id === actor.id ? -1 : h.owner_id, expiresAt: h.expires_at.toISOString(),
    })),
    settings: { workingDays: clinic.working_days, openTime: clinic.open_time, closeTime: clinic.close_time, slotMinutes: clinic.slot_minutes, timezone: clinic.timezone },
    now, ownerId: actor.id, overrideReason: input.overrideReason, canOverride: true,
    visible: a => a.clinicId === actor.clinicId && (actor.role !== "doctor" || a.doctorId === actor.doctorId),
  });
  const affectedAppointments = appointments.filter(a => a.appointment_id !== (input.appointmentId ?? 0) && a.patient_id === input.patientId &&
    a.scheduled_at.getTime() < Date.parse(input.endsAt) && Date.parse(input.startsAt) < a.scheduled_at.getTime() + a.duration_minutes * 60000)
    .map(a => ({ appointmentId: a.appointment_id, clinicId: a.clinic_id, doctorId: a.doctor_id }));
  return { result, minutes, holds, affectedAppointments };
}
function requireEligible(result: ConflictResult) {
  // ApiFailure params are scalars; the exact structured preview is obtained from /check.
  if (!result.ok) throw Object.assign(conflict("APPOINTMENT_CONFLICT"), { evidence: result.conflicts });
}
async function auditOverride(client: PoolClient, actor: Auth, input: { clinicId: number; patientId: number; overrideReason?: string }, appointmentId: number, clientOpId: string, result: ConflictResult, operation: "create" | "update", affectedAppointments: { appointmentId: number; clinicId: number; doctorId: number }[]) {
  if (!result.conflicts.some(c => c.type === "patient-overlap")) return;
  await client.query(`INSERT INTO operational.audit_log(user_id,clinic_id,patient_id,action,detail) VALUES($1,$2,$3,'appointment.patient_overlap_override',$4)`,
    [actor.id, input.clinicId, input.patientId, JSON.stringify({ operation, target: { appointmentId, clinicId: input.clinicId }, appointmentId, clientOpId, reason: input.overrideReason, affectedAppointments, conflictTypes: result.conflicts.map(c => c.type) })]);
}
async function consume(client: PoolClient, actor: Auth, input: z.infer<typeof checkInput>, holds: HoldRow[], minutes: number) {
  const tokens = holds.filter(h => exactHold(h, actor, input, minutes, input.appointmentId)).map(h => h.token);
  if (tokens.length) await client.query("DELETE FROM operational.appointment_holds WHERE token=ANY($1::uuid[])", [tokens]);
}
export async function checkAppointment(auth: Auth, raw: unknown) {
  const input = checkInput.parse(raw);
  return transaction(auth, async (client, actor, now) => (await preview(client, actor, now, input)).result);
}
export type AppointmentContext = { client: PoolClient; actor: Auth; now: Date };
/** Re-evaluate a durable proposal for delivery, never its historical evidence.
 * The caller must hold the scheduling transaction lock and refresh actor authority.
 * Like explicit resolution, this ignores offline holds and evaluates updates
 * against the current authorized target, without accepting its stale revision. */
export async function previewAppointmentOperation(context: AppointmentContext, target: string, raw: unknown) {
  const { client, actor, now } = context;
  if (target === "create") {
    const { holdToken: _hold, ...input } = createInput.parse(raw);
    return (await preview(client, actor, now, input)).result;
  }
  if (!/^update:[1-9][0-9]*$/.test(target)) throw fail(400, "VALIDATION", "validation");
  const id = Number(target.slice("update:".length));
  const row = await existing(client, actor, id);
  const { holdToken: _hold, expectedVersion: _version, ...input } = updateInput.parse(raw);
  const candidate = {
    ...project(row), ...input, appointmentId: id,
    source: row.booking_method as Booking["source"],
  };
  const nextStatus = input.status ?? row.status;
  const status = (input.startsAt !== undefined || input.endsAt !== undefined) && nextStatus !== "cancelled" ? "booked" : nextStatus;
  return (await preview(client, actor, now, candidate, status)).result;
}
// A savepoint separates rollback of business work from durable conflict evidence.
async function mutation<T>(auth: Auth, target: string, input: Booking | z.infer<typeof updateInput>,
  context: AppointmentContext | undefined, work: (client: PoolClient, actor: Auth, now: Date) => Promise<T>): Promise<T> {
  const run = async (client: PoolClient, actor: Auth, now: Date) => {
    const row = target === "create" ? null : await existing(client, actor, Number(target.split(":")[1]));
    const scope = row ? { clinicId: row.clinic_id, doctorId: row.doctor_id } : input as Booking;
    bookingScope(actor, scope.clinicId, scope.doctorId);
    const hash = createHash("sha256").update(canonical({ target, payload: input })).digest("hex");
    const { rows: [prior] } = await client.query("SELECT * FROM operational.appointment_operations WHERE client_op_id=$1", [input.clientOpId]);
    if (prior) {
      bookingScope(actor, prior.clinic_id, prior.doctor_id);
      if (prior.actor_id !== actor.id || prior.payload_hash !== hash) throw conflict("IDEMPOTENCY_CONFLICT");
      if (prior.device_id !== null && prior.device_id !== actor.device?.id) throw conflict("IDEMPOTENCY_CONFLICT");
      prior.result = projectStoredOperationResult(prior.result);
      if (prior.status === "conflict" || prior.status === "rejected") return {
        error: Object.assign(fail(prior.result.httpStatus ?? 409, prior.result.code,
          String(prior.result.messageKey).replace(/^error\./, ""), prior.result.params),
        { operationId: input.clientOpId, operationHash: hash }),
      };
      return { value: prior.result as T };
    }
    await client.query("SAVEPOINT appointment_mutation");
    try {
      const value = await work(client, actor, now);
      await client.query("UPDATE operational.appointment_operations SET request=$2,device_id=$3 WHERE client_op_id=$1",
        [input.clientOpId, JSON.stringify({ target, payload: input }), actor.device?.id ?? null]);
      await client.query("RELEASE SAVEPOINT appointment_mutation");
      return { value };
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT appointment_mutation");
      if (!(error instanceof ApiError) || ![400, 409, 422].includes(error.status) || error.code === "IDEMPOTENCY_CONFLICT") throw error;
      // Invalid intervals/references are validation failures, not accepted operations.
      if (error.key === "validation") throw error;
      // Auth/not-found failures are not accepted; authorized business failures retain their identity.
      const status = error.status === 409 ? "conflict" : "rejected";
      const id = randomUUID();
      const result = { code: error.code, messageKey: `error.${error.key}`, params: error.params,
        httpStatus: error.status, ...(status === "conflict" ? { conflictId: id } : {}) };
      await client.query(`INSERT INTO operational.appointment_operations
        (client_op_id,actor_id,clinic_id,doctor_id,payload_hash,result,request,device_id,status,conflict_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$10,$9)`,
      [input.clientOpId, actor.id, scope.clinicId, scope.doctorId, hash, JSON.stringify(result),
        JSON.stringify({ target, payload: input }), actor.device?.id ?? null, status === "conflict" ? id : null, status]);
      if (status === "conflict") await client.query(`INSERT INTO operational.sync_conflicts
        (id,client_op_id,actor_id,device_id,clinic_id,doctor_id,operation,target_id,base_version,server_state,reasons)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, input.clientOpId, actor.id, actor.device?.id ?? null, scope.clinicId, scope.doctorId,
        JSON.stringify({ target, payload: input }), row?.appointment_id ?? null,
        "expectedVersion" in input ? input.expectedVersion : null, JSON.stringify(row ? project(row) : null),
        JSON.stringify("evidence" in error ? error.evidence : [result])]);
      return { error: Object.assign(error, { operationId: input.clientOpId, operationHash: hash }) };
    }
  };
  const result = context ? await run(context.client, context.actor, context.now) : await transaction(auth, run);
  if ("error" in result) throw result.error;
  return result.value;
}
export async function createAppointment(auth: Auth, raw: unknown, context?: AppointmentContext) {
  const input = createInput.parse(raw);
  return mutation(auth, "create", input, context, async (client, actor, now) => {
    bookingScope(actor, input.clinicId, input.doctorId);
    const { hash, op } = await replay(client, actor, input.clientOpId, "create", input);
    if (op) return op.result;
    const { result, minutes, holds, affectedAppointments } = await preview(client, actor, now, input);
    requireEligible(result);
    const { rows: [row] } = await client.query<Row>(`INSERT INTO operational.appointments(clinic_id,doctor_id,patient_id,scheduled_at,duration_minutes,booking_method,status,client_op_id,created_by)
      VALUES($1,$2,$3,$4,$5,$6,'booked',$7,$8) RETURNING *`, [input.clinicId, input.doctorId, input.patientId, input.startsAt, minutes, input.source, input.clientOpId, actor.id]);
    await auditOverride(client, actor, input, row!.appointment_id, input.clientOpId, result, "create", affectedAppointments);
    await consume(client, actor, input, holds, minutes);
    await scheduleAppointmentReminders(client, row!.appointment_id, now);
    const response = project(row!);
    await record(client, actor, input.clientOpId, input.clinicId, input.doctorId, hash, response);
    return response;
  });
}
export async function updateAppointment(auth: Auth, id: number, raw: unknown, context?: AppointmentContext) {
  const input = updateInput.parse(raw);
  return mutation(auth, `update:${id}`, input, context, async (client, actor, now) => {
    const row = await existing(client, actor, id);
    const { hash, op } = await replay(client, actor, input.clientOpId, `update:${id}`, input);
    if (op) return op.result;
    if (row.version !== input.expectedVersion) throw conflict("VERSION_CONFLICT", { currentVersion: row.version });
    const candidate = {
      ...project(row), ...input, clinicId: row.clinic_id, doctorId: row.doctor_id, patientId: row.patient_id,
      source: row.booking_method as Booking["source"], appointmentId: id,
    };
    const nextStatus = input.status ?? row.status;
    const evaluationStatus = (input.startsAt !== undefined || input.endsAt !== undefined) && nextStatus !== "cancelled" ? "booked" : nextStatus;
    const { result, minutes, holds, affectedAppointments } = await preview(client, actor, now, candidate, evaluationStatus);
    requireEligible(result);
    const moved = candidate.startsAt !== row.scheduled_at.toISOString() || minutes !== row.duration_minutes;
    const { rows: [updated] } = await client.query<Row>(`UPDATE operational.appointments SET
      reminder_schedule_version=reminder_schedule_version+CASE WHEN scheduled_at<>$2::timestamptz OR duration_minutes<>$3 THEN 1 ELSE 0 END,
      scheduled_at=$2,duration_minutes=$3,status=$4,version=version+1,updated_at=clock_timestamp(),cancel_reason=COALESCE($5,cancel_reason)
      WHERE appointment_id=$1 RETURNING *`, [id, candidate.startsAt, minutes, input.status ?? row.status, input.cancelReason ?? null]);
    await auditOverride(client, actor, candidate, id, input.clientOpId, result, "update", affectedAppointments);
    await consume(client, actor, candidate, holds, minutes);
    if (moved || !["booked", "double_booked"].includes(updated!.status)) {
      await cancelAppointmentReminders(client, id, now, moved ? "appointment_changed" : "appointment_inactive");
    }
    if (moved) await scheduleAppointmentReminders(client, id, now);
    const response = project(updated!);
    await record(client, actor, input.clientOpId, row.clinic_id, row.doctor_id, hash, response);
    return response;
  });
}
export async function createHold(auth: Auth, raw: unknown) {
  const input = holdInput.parse(raw);
  return transaction(auth, async (client, actor, now) => {
    bookingScope(actor, input.clinicId, input.doctorId);
    const { hash, op } = await replay(client, actor, input.clientOpId, "hold", input);
    if (op) return op.result; // Expired replays return the original expiry; never renew.
    const { result, minutes, holds } = await preview(client, actor, now, { ...input, source: "online" });
    requireEligible(result);
    const same = holds.find(h => exactHold(h, actor, input, minutes, input.appointmentId));
    let response: { token: string; expiresAt: string };
    if (same) response = { token: same.token, expiresAt: same.expires_at.toISOString() };
    else {
      const { rows: [created] } = await client.query<HoldRow>(`INSERT INTO operational.appointment_holds(token,owner_id,clinic_id,doctor_id,patient_id,appointment_id,starts_at,duration_minutes,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()+interval '30 seconds') RETURNING *`,
      [randomUUID(), actor.id, input.clinicId, input.doctorId, input.patientId, input.appointmentId ?? null, input.startsAt, minutes]);
      response = { token: created!.token, expiresAt: created!.expires_at.toISOString() };
    }
    await record(client, actor, input.clientOpId, input.clinicId, input.doctorId, hash, response);
    return response;
  });
}
export async function releaseHold(auth: Auth, token: string, raw: unknown) {
  z.uuid().parse(token);
  const input = releaseInput.parse(raw);
  return transaction(auth, async (client, actor) => {
    const { hash, op } = await replay(client, actor, input.clientOpId, `release:${token}`, input);
    if (op) return;
    const { rows: [hold] } = await client.query<HoldRow>("SELECT * FROM operational.appointment_holds WHERE token=$1", [token]);
    if (!hold) throw missing();
    bookingScope(actor, hold.clinic_id, hold.doctor_id);
    if (hold.owner_id !== actor.id) throw forbidden();
    await client.query("DELETE FROM operational.appointment_holds WHERE token=$1", [token]);
    await record(client, actor, input.clientOpId, hold.clinic_id, hold.doctor_id, hash, {});
  });
}
export async function listAppointments(auth: Auth, raw: unknown) {
  const input = listInput.parse(raw);
  const actor = await currentAuth(pool, auth);
  if (actor.role !== "doctor" && actor.role !== "front-desk") throw forbidden();
  enforceScope(actor, input.clinicId, input.doctorId);
  if (input.upcoming) {
    await authorizedPatient(pool, input.clinicId, input.patientId!);
    return listUpcoming(actor, input);
  }
  const doctorId = actor.role === "doctor" ? actor.doctorId : input.doctorId;
  const filterHash = createHash("sha256").update(canonical({
    clinicId: input.clinicId, doctorId, patientId: input.patientId, status: input.status, from: input.from, to: input.to,
  })).digest("hex");
  let after = 0;
  if (input.cursor !== undefined) {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(input.cursor)) throw new Error();
      const cursor = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8"));
      if (cursor.v !== 1 || cursor.filterHash !== filterHash || !Number.isSafeInteger(cursor.after) || cursor.after < 1 ||
        Object.keys(cursor).sort().join(",") !== "after,filterHash,v") throw new Error();
      after = cursor.after;
    } catch { throw fail(400, "VALIDATION", "validation"); }
  }
  const { rows } = await pool.query<Row>(`SELECT * FROM operational.appointments WHERE clinic_id=$1 AND scheduled_at >= $2 AND scheduled_at < $3
    AND ($4::integer IS NULL OR doctor_id=$4) AND ($5::integer IS NULL OR patient_id=$5) AND ($6::text IS NULL OR status=$6)
    AND appointment_id>$7 ORDER BY appointment_id LIMIT $8`, [input.clinicId, input.from, input.to, doctorId ?? null, input.patientId ?? null, input.status ?? null, after, input.limit + 1]);
  const items = rows.slice(0, input.limit);
  return { items: items.map(project), nextCursor: rows.length > input.limit ? Buffer.from(JSON.stringify({ v: 1, after: items.at(-1)!.appointment_id, filterHash })).toString("base64url") : null };
}

async function listUpcoming(actor: Auth, input: z.infer<typeof listInput>) {
  const doctorId = actor.role === "doctor" ? actor.doctorId : input.doctorId;
  const filterHash = createHash("sha256").update(canonical({
    actorId: actor.id, clinicId: input.clinicId, doctorId, patientId: input.patientId, status: input.status,
    from: input.from, to: input.to, upcoming: true,
  })).digest("hex");
  let afterId = 0, afterTime: string | null = null;
  if (input.cursor !== undefined) {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(input.cursor)) throw new Error();
      const cursor = z.object({
        v: z.literal(2), filterHash: z.literal(filterHash), afterId: positive, afterTime: instant,
      }).strict().parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")));
      afterId = cursor.afterId; afterTime = cursor.afterTime;
    } catch { throw fail(400, "VALIDATION", "validation"); }
  }
  const { rows } = await pool.query<Row>(`SELECT * FROM operational.appointments
    WHERE clinic_id=$1 AND patient_id=$2 AND status IN ('booked','double_booked') AND scheduled_at>=clock_timestamp()
      AND ($3::integer IS NULL OR doctor_id=$3) AND ($4::text IS NULL OR status=$4)
      AND ($5::timestamptz IS NULL OR scheduled_at>=$5) AND ($6::timestamptz IS NULL OR scheduled_at<$6)
      AND ($7::timestamptz IS NULL OR (scheduled_at,appointment_id)>($7::timestamptz,$8::integer))
    ORDER BY scheduled_at,appointment_id LIMIT $9`, [
    input.clinicId, input.patientId, doctorId ?? null, input.status ?? null, input.from ?? null, input.to ?? null,
    afterTime, afterId, input.limit + 1,
  ]);
  const items = rows.slice(0, input.limit), last = items.at(-1);
  return { items: items.map(project), nextCursor: rows.length > input.limit && last ?
    Buffer.from(JSON.stringify({ v: 2, filterHash, afterId: last.appointment_id, afterTime: last.scheduled_at.toISOString() })).toString("base64url") : null };
}
