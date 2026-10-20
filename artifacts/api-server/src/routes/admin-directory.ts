import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import type { PoolClient, QueryResultRow } from "pg";
import { pool } from "@workspace/db";
import {
  CreateClinicBody, CreateClinicResponse, UpdateClinicBody, UpdateClinicResponse, UpdateClinicParams,
  CreateDoctorBody, CreateDoctorResponse, UpdateDoctorBody, UpdateDoctorResponse, UpdateDoctorParams,
  GetClinicParams, GetClinicResponse, GetAdminClinicParams, GetAdminClinicResponse,
  GetAdminDoctorParams, GetAdminDoctorResponse, ListAdminClinicsQueryParams, ListAdminClinicsResponse,
  ListAdminDoctorsQueryParams, ListAdminDoctorsResponse,
} from "@workspace/api-zod";
import { authenticate, auditAdministration, csrf, enforceScope, forbidden, lockAdministration, requireRoles, type Auth } from "../lib/auth";
import { fail } from "../lib/auth-errors";

const router: IRouter = Router();
const id = z.coerce.number().int().min(1).max(2147483647);
const text = z.string().trim().min(1).max(200);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const timezone = z.string().min(1).max(100).refine(value => {
  // Reject numeric offsets: the schedule must follow an IANA zone's DST rules.
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(value)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
});
const clinicFields = z.object({
  name: text, city: text, bookingMethod: text,
  slotMinutes: z.number().int().min(1).max(1440),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7)
    .refine(value => new Set(value).size === value.length),
  openTime: time, closeTime: time, mode: z.enum(["full", "lite"]), timezone,
}).strict();
const clinicCreate = clinicFields.extend({
  slotMinutes: clinicFields.shape.slotMinutes.default(30),
  workingDays: clinicFields.shape.workingDays.default([0, 1, 2, 3, 4, 5, 6]),
  openTime: time.default("08:00"), closeTime: time.default("17:00"),
  mode: clinicFields.shape.mode.default("full"), timezone: timezone.default("Asia/Hebron"),
});
const clinicPatch = clinicFields.partial().refine(value => Object.keys(value).length > 0);
const doctorFields = z.object({
  name: text, clinicId: z.number().int().min(1).max(2147483647), specialty: text,
  email: z.email().max(254).transform(value => value.toLowerCase()),
}).strict();
const doctorPatch = doctorFields.partial().refine(value => Object.keys(value).length > 0);
const page = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(512).optional(),
}).strict();
const doctorPage = page.extend({ clinicId: id.optional() });
const invalid = () => fail(400, "VALIDATION", "validation");
const conflict = () => fail(409, "CONFLICT", "conflict");
const missing = () => fail(404, "NOT_FOUND", "notFound");

// Generated schemas use Zod 3 while the application error handler knows Zod 4.
// Never let a generated-schema error escape as an unrecognized exception.
// Retain locally refined values: generated PATCH defaults must not replace
// omitted fields, and generated date coercion must not alter response shapes.
function contract<T>(schema: { safeParse(value: unknown): { success: boolean } }, value: T, response = false): T {
  if (!schema.safeParse(value).success) {
    if (response) throw fail(500, "INTERNAL", "internal");
    throw invalid();
  }
  return value;
}

function clinic(row: QueryResultRow) {
  return { id: row.clinic_id, name: row.clinic_name, city: row.city, bookingMethod: row.booking_method,
    slotMinutes: row.slot_minutes, workingDays: row.working_days,
    openTime: row.open_time.slice(0, 5), closeTime: row.close_time.slice(0, 5),
    mode: row.network_mode, timezone: row.timezone, joinedAt: row.joined_at.toISOString() };
}
function doctor(row: QueryResultRow) {
  return { id: row.doctor_id, name: row.doctor_name, clinicId: row.clinic_id,
    specialty: row.specialty, email: row.email, userId: row.user_id };
}
function after(cursor: string | undefined, scope: string) {
  if (cursor === undefined) return 0;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalid();
    return z.object({ scope: z.literal(scope), after: z.number().int().min(1).max(2147483647) }).strict()
      .parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))).after;
  } catch { throw invalid(); }
}
function next(scope: string, value: number) {
  return Buffer.from(JSON.stringify({ scope, after: value })).toString("base64url");
}

// Recheck authority after the common administration lock, not only in middleware:
// another administrator may have disabled/demoted the caller while this write waited.
async function mutate<T>(auth: Auth, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockAdministration(client, auth);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    const code = (error as { code?: string }).code;
    if (code === "23505" || code === "23503") throw conflict();
    if (code === "23514" || code === "22003") throw invalid();
    throw error;
  } finally { client.release(); }
}
async function audit(client: PoolClient, auth: Auth, action: string, clinicId: number, entityId: number, fields: string[]) {
  // No names, emails, settings values, credentials, or raw request bodies in audit.
  await auditAdministration(client, action, auth, clinicId, entityId, fields.sort());
}

router.get("/clinics/:id", authenticate, requireRoles("doctor", "front-desk"), async (req, res) => {
  const clinicId = contract(GetClinicParams, { id: id.parse(req.params.id) }).id;
  enforceScope(req.auth!, clinicId);
  const { rows: [row] } = await pool.query(
    "SELECT clinic_id,clinic_name,network_mode,timezone FROM operational.clinics WHERE clinic_id=$1", [clinicId]);
  if (!row) throw missing();
  res.json(contract(GetClinicResponse, { id: row.clinic_id, name: row.clinic_name,
    mode: row.network_mode === "full" ? "network" : "lite", timezone: row.timezone }, true));
});

router.get("/admin/clinics", authenticate, requireRoles("admin"), async (req, res) => {
  const query = contract(ListAdminClinicsQueryParams, page.parse(req.query));
  const scope = `admin-clinics:${req.auth!.id}:${req.auth!.clinicId ?? "all"}`;
  const { rows } = await pool.query(`SELECT * FROM operational.clinics
    WHERE clinic_id>$1 AND ($3::integer IS NULL OR clinic_id=$3) ORDER BY clinic_id LIMIT $2`,
  [after(query.cursor, scope), query.limit + 1, req.auth!.clinicId]);
  const items = rows.slice(0, query.limit).map(clinic);
  res.json(contract(ListAdminClinicsResponse, { items,
    nextCursor: rows.length > query.limit ? next(scope, items.at(-1)!.id) : null }, true));
});
router.get("/admin/clinics/:id", authenticate, requireRoles("admin"), async (req, res) => {
  const clinicId = contract(GetAdminClinicParams, { id: id.parse(req.params.id) }).id;
  enforceScope(req.auth!, clinicId);
  const { rows: [row] } = await pool.query("SELECT * FROM operational.clinics WHERE clinic_id=$1", [clinicId]);
  if (!row) throw missing();
  res.json(contract(GetAdminClinicResponse, clinic(row), true));
});
router.get("/admin/doctors", authenticate, requireRoles("admin"), async (req, res) => {
  const query = contract(ListAdminDoctorsQueryParams, doctorPage.parse(req.query));
  if (query.clinicId !== undefined) enforceScope(req.auth!, query.clinicId);
  const clinicId = req.auth!.clinicId ?? query.clinicId;
  const scope = `admin-doctors:${req.auth!.id}:${clinicId ?? "all"}`;
  const { rows } = await pool.query(`SELECT * FROM operational.doctors
    WHERE doctor_id>$1 AND ($2::integer IS NULL OR clinic_id=$2) ORDER BY doctor_id LIMIT $3`,
  [after(query.cursor, scope), clinicId ?? null, query.limit + 1]);
  const items = rows.slice(0, query.limit).map(doctor);
  res.json(contract(ListAdminDoctorsResponse, { items,
    nextCursor: rows.length > query.limit ? next(scope, items.at(-1)!.id) : null }, true));
});
router.get("/admin/doctors/:id", authenticate, requireRoles("admin"), async (req, res) => {
  const doctorId = contract(GetAdminDoctorParams, { id: id.parse(req.params.id) }).id;
  const { rows: [row] } = await pool.query("SELECT * FROM operational.doctors WHERE doctor_id=$1", [doctorId]);
  if (!row) throw missing();
  enforceScope(req.auth!, row.clinic_id);
  res.json(contract(GetAdminDoctorResponse, doctor(row), true));
});

router.post("/clinics", authenticate, requireRoles("admin"), csrf, async (req, res) => {
  if (req.auth!.clinicId !== null) throw forbidden();
  const input = contract(CreateClinicBody, clinicCreate.parse(req.body));
  if (input.openTime >= input.closeTime) throw invalid();
  res.status(201).json(await mutate(req.auth!, async client => {
    const { rows: [row] } = await client.query(`INSERT INTO operational.clinics
      (clinic_name,city,booking_method,slot_minutes,working_days,open_time,close_time,network_mode,timezone)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [input.name, input.city, input.bookingMethod, input.slotMinutes, input.workingDays,
      input.openTime, input.closeTime, input.mode, input.timezone]);
    await audit(client, req.auth!, "admin.clinic.created", row.clinic_id, row.clinic_id, Object.keys(input));
    return contract(CreateClinicResponse, clinic(row), true);
  }));
});
router.patch("/clinics/:id", authenticate, requireRoles("admin"), csrf, async (req, res) => {
  const clinicId = contract(UpdateClinicParams, { id: id.parse(req.params.id) }).id;
  const input = contract(UpdateClinicBody, clinicPatch.parse(req.body));
  enforceScope(req.auth!, clinicId);
  res.json(await mutate(req.auth!, async client => {
    const { rows: [existing] } = await client.query("SELECT * FROM operational.clinics WHERE clinic_id=$1 FOR UPDATE", [clinicId]);
    if (!existing) throw missing();
    const { id: _id, joinedAt: _joinedAt, ...settings } = clinic(existing);
    const merged = clinicFields.parse({ ...settings, ...input });
    if (merged.openTime >= merged.closeTime) throw invalid();
    const { rows: [row] } = await client.query(`UPDATE operational.clinics SET clinic_name=$2,city=$3,
      booking_method=$4,slot_minutes=$5,working_days=$6,open_time=$7,close_time=$8,network_mode=$9,timezone=$10
      WHERE clinic_id=$1 RETURNING *`, [clinicId, merged.name, merged.city, merged.bookingMethod,
      merged.slotMinutes, merged.workingDays, merged.openTime, merged.closeTime, merged.mode, merged.timezone]);
    await audit(client, req.auth!, "admin.clinic.updated", clinicId, clinicId, Object.keys(input));
    return contract(UpdateClinicResponse, clinic(row), true);
  }));
});

async function checkDoctorEmail(client: PoolClient, email: string, doctorId: number | null, userId: number | null) {
  const { rows } = await client.query(`SELECT 1 FROM operational.doctors WHERE lower(email)=lower($1)
    AND ($2::integer IS NULL OR doctor_id<>$2)
    UNION ALL SELECT 1 FROM operational.users WHERE lower(email)=lower($1)
    AND ($3::integer IS NULL OR id<>$3) LIMIT 1`, [email, doctorId, userId]);
  if (rows.length) throw conflict();
}
router.post("/doctors", authenticate, requireRoles("admin"), csrf, async (req, res) => {
  const input = contract(CreateDoctorBody, doctorFields.parse(req.body));
  enforceScope(req.auth!, input.clinicId);
  res.status(201).json(await mutate(req.auth!, async client => {
    const { rows } = await client.query("SELECT clinic_id FROM operational.clinics WHERE clinic_id=$1", [input.clinicId]);
    if (!rows.length) throw invalid();
    await checkDoctorEmail(client, input.email, null, null);
    // Directory creation is deliberately not account provisioning.
    const { rows: [row] } = await client.query(`INSERT INTO operational.doctors(doctor_name,clinic_id,specialty,email)
      VALUES($1,$2,$3,$4) RETURNING *`, [input.name, input.clinicId, input.specialty, input.email]);
    await audit(client, req.auth!, "admin.doctor.created", row.clinic_id, row.doctor_id, Object.keys(input));
    return contract(CreateDoctorResponse, doctor(row), true);
  }));
});
router.patch("/doctors/:id", authenticate, requireRoles("admin"), csrf, async (req, res) => {
  const doctorId = contract(UpdateDoctorParams, { id: id.parse(req.params.id) }).id;
  const input = contract(UpdateDoctorBody, doctorPatch.parse(req.body));
  res.json(await mutate(req.auth!, async client => {
    const { rows: [existing] } = await client.query("SELECT * FROM operational.doctors WHERE doctor_id=$1 FOR UPDATE", [doctorId]);
    if (!existing) throw missing();
    enforceScope(req.auth!, existing.clinic_id);
    const { rows: users } = await client.query("SELECT id,email,role,doctor_id,clinic_id FROM operational.users WHERE doctor_id=$1 OR id=$2 FOR UPDATE",
      [doctorId, existing.user_id]);
    const linked = users[0];
    if (users.length > 1 || linked && (linked.id !== existing.user_id || linked.role !== "doctor"
      || linked.doctor_id !== doctorId || linked.clinic_id !== existing.clinic_id) || existing.user_id && !linked) throw conflict();
    const merged = { ...doctor(existing), ...input };
    enforceScope(req.auth!, merged.clinicId);
    if (merged.clinicId !== existing.clinic_id) {
      // Do not re-scope an existing account or historical appointments/clinical records.
      const { rows } = await client.query(`SELECT 1 FROM operational.appointments WHERE doctor_id=$1
        UNION ALL SELECT 1 FROM operational.patient_visit_history WHERE doctor_id=$1 LIMIT 1`, [doctorId]);
      if (linked || rows.length) throw conflict();
    }
    const { rows: clinics } = await client.query("SELECT clinic_id FROM operational.clinics WHERE clinic_id=$1", [merged.clinicId]);
    if (!clinics.length) throw invalid();
    await checkDoctorEmail(client, merged.email, doctorId, linked?.id ?? null);
    if (linked && input.email !== undefined && linked.email !== merged.email) {
      await client.query("UPDATE operational.users SET email=$2 WHERE id=$1", [linked.id, merged.email]);
      await client.query("UPDATE operational.auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [linked.id]);
    }
    const { rows: [row] } = await client.query(`UPDATE operational.doctors SET doctor_name=$2,clinic_id=$3,specialty=$4,email=$5
      WHERE doctor_id=$1 RETURNING *`, [doctorId, merged.name, merged.clinicId, merged.specialty, merged.email]);
    await audit(client, req.auth!, "admin.doctor.updated", row.clinic_id, doctorId, Object.keys(input));
    return contract(UpdateDoctorResponse, doctor(row), true);
  }));
});

export default router;
