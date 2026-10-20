import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { enforceScope, forbidden, roles, type Auth } from "../lib/auth";
import { fail } from "../lib/auth-errors";
import { evaluate, type Appointment, type ConflictResult } from "./engine";

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
  from: instant, to: instant, cursor: z.string().max(512).optional(), limit: z.coerce.number().int().min(1).max(100).default(25),
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
function bookingScope(auth: Auth, clinicId: number, doctorId: number) {
  if (auth.role !== "doctor" && auth.role !== "front-desk") throw forbidden();
  enforceScope(auth, clinicId, doctorId);
}
async function currentAuth(client: Pick<PoolClient, "query">, auth: Auth): Promise<Auth> {
  const { rows: [user] } = await client.query("SELECT role,clinic_id,doctor_id FROM operational.users WHERE id=$1", [auth.id]);
  if (!user || !Object.hasOwn(roles, user.role)) throw forbidden();
  return { ...auth, role: roles[user.role as keyof typeof roles], clinicId: user.clinic_id, doctorId: user.doctor_id };
}
async function transaction<T>(auth: Auth, work: (client: PoolClient, actor: Auth, now: Date) => Promise<T>): Promise<T> {
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
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
async function replay(client: PoolClient, actor: Auth, clientOpId: string, target: string, payload: unknown) {
  const hash = createHash("sha256").update(canonical({ target, payload })).digest("hex");
  const { rows: [op] } = await client.query("SELECT * FROM operational.appointment_operations WHERE client_op_id=$1", [clientOpId]);
  if (op) {
    // Reauthorization precedes returning a stored response, never trust recorded scope alone.
    bookingScope(actor, op.clinic_id, op.doctor_id);
    if (op.actor_id !== actor.id || op.payload_hash !== hash) throw conflict("IDEMPOTENCY_CONFLICT");
  }
  return { hash, op };
}
async function record(client: PoolClient, actor: Auth, clientOpId: string, clinicId: number, doctorId: number, hash: string, result: unknown) {
  await client.query(`INSERT INTO operational.appointment_operations(client_op_id,actor_id,clinic_id,doctor_id,payload_hash,result) VALUES($1,$2,$3,$4,$5,$6)`,
    [clientOpId, actor.id, clinicId, doctorId, hash, JSON.stringify(result)]);
}
async function existing(client: PoolClient, actor: Auth, id: number): Promise<Row> {
  const { rows: [row] } = await client.query<Row>("SELECT * FROM operational.appointments WHERE appointment_id=$1", [id]);
  if (!row) throw missing();
  bookingScope(actor, row.clinic_id, row.doctor_id);
  return row;
}
async function relationships(client: PoolClient, input: Pick<IntervalInput, "clinicId" | "doctorId" | "patientId">) {
  const { rows: [valid] } = await client.query(`SELECT
    EXISTS(SELECT 1 FROM operational.doctors WHERE doctor_id=$1 AND clinic_id=$2) AS doctor,
    EXISTS(SELECT 1 FROM operational.patients WHERE patient_id=$3 AND merged_into_id IS NULL) AS patient`, [input.doctorId, input.clinicId, input.patientId]);
  if (!valid.doctor || !valid.patient) throw fail(422, "INVALID_BOOKING_REFERENCE", "validation");
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
  const { rows: appointments } = await client.query<Row>("SELECT * FROM operational.appointments WHERE (doctor_id=$1 OR patient_id=$2) AND status IN ('booked','double_booked')", [input.doctorId, input.patientId]);
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
  if (!result.ok) throw conflict("APPOINTMENT_CONFLICT", { conflictCount: result.conflicts.length });
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
export async function createAppointment(auth: Auth, raw: unknown) {
  const input = createInput.parse(raw);
  return transaction(auth, async (client, actor, now) => {
    bookingScope(actor, input.clinicId, input.doctorId);
    const { hash, op } = await replay(client, actor, input.clientOpId, "create", input);
    if (op) return op.result;
    const { result, minutes, holds, affectedAppointments } = await preview(client, actor, now, input);
    requireEligible(result);
    const { rows: [row] } = await client.query<Row>(`INSERT INTO operational.appointments(clinic_id,doctor_id,patient_id,scheduled_at,duration_minutes,booking_method,status,client_op_id,created_by)
      VALUES($1,$2,$3,$4,$5,$6,'booked',$7,$8) RETURNING *`, [input.clinicId, input.doctorId, input.patientId, input.startsAt, minutes, input.source, input.clientOpId, actor.id]);
    await auditOverride(client, actor, input, row!.appointment_id, input.clientOpId, result, "create", affectedAppointments);
    await consume(client, actor, input, holds, minutes);
    const response = project(row!);
    await record(client, actor, input.clientOpId, input.clinicId, input.doctorId, hash, response);
    return response;
  });
}
export async function updateAppointment(auth: Auth, id: number, raw: unknown) {
  const input = updateInput.parse(raw);
  return transaction(auth, async (client, actor, now) => {
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
    const { rows: [updated] } = await client.query<Row>(`UPDATE operational.appointments SET scheduled_at=$2,duration_minutes=$3,status=$4,version=version+1,updated_at=clock_timestamp(),cancel_reason=COALESCE($5,cancel_reason)
      WHERE appointment_id=$1 RETURNING *`, [id, candidate.startsAt, minutes, input.status ?? row.status, input.cancelReason ?? null]);
    await auditOverride(client, actor, candidate, id, input.clientOpId, result, "update", affectedAppointments);
    await consume(client, actor, candidate, holds, minutes);
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
  if (Date.parse(input.to) <= Date.parse(input.from)) throw fail(400, "VALIDATION", "validation");
  const actor = await currentAuth(pool, auth);
  if (actor.role !== "doctor" && actor.role !== "front-desk") throw forbidden();
  enforceScope(actor, input.clinicId, input.doctorId);
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
