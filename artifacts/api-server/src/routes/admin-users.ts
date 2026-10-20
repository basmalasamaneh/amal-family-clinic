import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import { pool } from "@workspace/db";
import {
  CreateAdminUserBody, CreateAdminUserResponse, DeactivateAdminUserParams, DeactivateAdminUserResponse,
  GetAdminUserParams, GetAdminUserResponse, ListAdminUsersQueryParams, ListAdminUsersResponse,
  ResetAdminUserPinBody, ResetAdminUserPinParams, ResetAdminUserPinResponse,
  UpdateAdminUserBody, UpdateAdminUserParams, UpdateAdminUserResponse,
} from "@workspace/api-zod";
import {
  authenticate, auditAdministration, csrf, enforceScope, forbidden,
  lockAdministration, newCredential, requireRoles, roles, type Auth,
} from "../lib/auth";
import { fail } from "../lib/auth-errors";

const router: IRouter = Router();
type Contract<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };
// Generated contracts use Zod 3; never leak their errors to the Zod 4-only app handler.
function requestContract<T>(schema: Contract<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw fail(400, "VALIDATION", "validation");
  return result.data;
}
function responseContract<T>(schema: Contract<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw fail(500, "INTERNAL", "internal");
  return result.data;
}
const id = z.coerce.number().int().min(1).max(2147483647);
const role = z.enum(["admin", "doctor", "front-desk"]);
const storedRoles = { admin: "administrator", doctor: "doctor", "front-desk": "receptionist" } as const;
const email = z.email().max(254).transform(v => v.toLowerCase());
const password = z.string().min(12).max(72).refine(v => Buffer.byteLength(v, "utf8") <= 72);
const pin = z.string().regex(/^[0-9]{4}$/);
const fields = {
  email, role, clinicId: z.number().int().min(1).max(2147483647).nullable(),
  doctorId: z.number().int().min(1).max(2147483647).nullable(),
  locale: z.enum(["ar", "en"]), theme: z.enum(["light", "dark"]),
  active: z.boolean(), password,
};
const create = z.object({
  ...fields, clinicId: fields.clinicId.default(null), doctorId: fields.doctorId.default(null),
  locale: fields.locale.default("ar"), theme: fields.theme.default("light"),
  active: fields.active.default(true), password: password.optional(), pin: pin.optional(),
}).strict();
const update = z.object({ ...fields, pin }).partial().strict().refine(v => Object.keys(v).length > 0);
const projection = `id,email,role,clinic_id,doctor_id,locale,theme,last_login,disabled_at`;
function safeUser(row: Record<string, any>) {
  return {
    id: row.id, email: row.email, role: roles[row.role as keyof typeof roles],
    clinicId: row.clinic_id, doctorId: row.doctor_id, locale: row.locale, theme: row.theme,
    lastLogin: row.last_login, active: row.disabled_at === null, disabledAt: row.disabled_at,
  };
}
function scope(auth: Auth, clinicId: number | null) {
  if (clinicId === null) { if (auth.clinicId !== null) throw forbidden(); }
  else enforceScope(auth, clinicId);
}
type Assignment = { role: z.infer<typeof role>; clinicId: number | null; doctorId: number | null };
async function assignment(client: PoolClient, value: Assignment, userId?: number) {
  if (value.role === "doctor" ? value.clinicId === null || value.doctorId === null
    : value.doctorId !== null || (value.role === "front-desk" && value.clinicId === null)) {
    throw fail(400, "INVALID_ASSIGNMENT", "validation");
  }
  if (value.clinicId !== null) {
    const { rows: [clinic] } = await client.query("SELECT clinic_id FROM operational.clinics WHERE clinic_id=$1 FOR SHARE", [value.clinicId]);
    if (!clinic) throw fail(404, "NOT_FOUND", "notFound");
  }
  if (value.doctorId !== null) {
    const { rows: [doctor] } = await client.query("SELECT clinic_id,user_id FROM operational.doctors WHERE doctor_id=$1 FOR UPDATE", [value.doctorId]);
    if (!doctor) throw fail(404, "NOT_FOUND", "notFound");
    if (doctor.clinic_id !== value.clinicId) throw fail(400, "INVALID_ASSIGNMENT", "validation");
    if (doctor.user_id !== null && doctor.user_id !== userId) throw fail(409, "DOCTOR_ALREADY_LINKED", "conflict");
  }
}
async function transaction<T>(auth: Auth, work: (client: PoolClient) => Promise<T>) {
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
    if (code === "23505") throw fail(409, "ALREADY_EXISTS", "conflict");
    if (code === "23503" || code === "23514") throw fail(409, "INVALID_RELATIONSHIP", "conflict");
    throw error;
  } finally { client.release(); }
}
async function lastAdmin(client: PoolClient, old: Record<string, any>, next: Assignment & { active: boolean }) {
  // A clinic-limited administrator cannot replace the final network administrator.
  if (old.role === "administrator" && old.clinic_id === null && old.disabled_at === null
    && (next.role !== "admin" || next.clinicId !== null || !next.active)) {
    const { rows: [count] } = await client.query(`SELECT count(*)::integer AS n FROM operational.users
      WHERE role='administrator' AND clinic_id IS NULL AND disabled_at IS NULL AND id<>$1`, [old.id]);
    if (!count.n) throw fail(409, "LAST_ADMIN", "conflict");
  }
}
router.use("/admin/users", authenticate, requireRoles("admin"));
router.get("/admin/users", async (req, res) => {
  const query = requestContract(ListAdminUsersQueryParams, z.object({
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    role: role.optional(), clinicId: id.optional(),
    active: z.enum(["true", "false"]).optional(), q: z.string().trim().min(1).max(254).optional(),
  }).strict().parse(req.query));
  if (query.clinicId !== undefined) scope(req.auth!, query.clinicId);
  const values = [req.auth!.clinicId ?? query.clinicId ?? null, query.role ? storedRoles[query.role] : null,
    query.active === undefined ? null : query.active === "true", query.q?.toLowerCase() ?? null];
  // strpos is literal matching: wildcard input cannot turn into an unrestricted LIKE.
  const from = `FROM operational.users WHERE ($1::integer IS NULL OR clinic_id=$1)
    AND ($2::text IS NULL OR role::text=$2)
    AND ($3::boolean IS NULL OR (disabled_at IS NULL)=$3)
    AND ($4::text IS NULL OR strpos(lower(email),$4)>0)`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { rows: [count] } = await client.query(`SELECT count(*)::integer AS total ${from}`, values);
    const { rows } = await client.query(`SELECT ${projection} ${from} ORDER BY id LIMIT $5 OFFSET $6`,
      [...values, query.pageSize, (query.page - 1) * query.pageSize]);
    await client.query("COMMIT");
    res.json(responseContract(ListAdminUsersResponse, { items: rows.map(safeUser), total: count.total, page: query.page, pageSize: query.pageSize }));
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
});
router.get("/admin/users/:id", async (req, res) => {
  const params = requestContract(GetAdminUserParams, req.params);
  const { rows: [user] } = await pool.query(`SELECT ${projection} FROM operational.users WHERE id=$1`, [params.id]);
  if (!user) throw fail(404, "NOT_FOUND", "notFound");
  scope(req.auth!, user.clinic_id);
  res.json(responseContract(GetAdminUserResponse, safeUser(user)));
});
router.post("/admin/users", csrf, async (req, res) => {
  const body = create.parse(requestContract(CreateAdminUserBody, req.body));
  scope(req.auth!, body.clinicId);
  if ((body.role === "front-desk" && !body.pin) || (body.role !== "front-desk" && !body.password)
    || (body.role !== "front-desk" && body.pin !== undefined)) throw fail(400, "INVALID_CREDENTIALS", "validation");
  const hash = await bcrypt.hash(body.password ?? newCredential(), 12);
  const pinHash = body.pin ? await bcrypt.hash(body.pin, 12) : null;
  const result = await transaction(req.auth!, async client => {
    await assignment(client, body);
    const { rows: [user] } = await client.query(`INSERT INTO operational.users
      (email,password_hash,role,clinic_id,doctor_id,pin_hash,locale,theme,disabled_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $9 THEN NULL ELSE now() END) RETURNING ${projection}`,
    [body.email, hash, storedRoles[body.role], body.clinicId, body.doctorId, pinHash, body.locale, body.theme, body.active]);
    if (body.doctorId !== null) await client.query("UPDATE operational.doctors SET user_id=$1 WHERE doctor_id=$2", [user.id, body.doctorId]);
    await auditAdministration(client, "admin.user.created", req.auth!, body.clinicId, user.id,
      ["email", "role", "clinicId", "doctorId", "locale", "theme", "active"]);
    return responseContract(CreateAdminUserResponse, safeUser(user));
  });
  res.status(201).json(result);
});
router.patch("/admin/users/:id", csrf, async (req, res) => {
  const userId = requestContract(UpdateAdminUserParams, req.params).id;
  const body = update.parse(requestContract(UpdateAdminUserBody, req.body));
  const hash = body.password ? await bcrypt.hash(body.password, 12) : undefined;
  const pinHash = body.pin ? await bcrypt.hash(body.pin, 12) : undefined;
  const result = await transaction(req.auth!, async client => {
    const { rows: [old] } = await client.query(`SELECT ${projection} FROM operational.users WHERE id=$1 FOR UPDATE`, [userId]);
    if (!old) throw fail(404, "NOT_FOUND", "notFound");
    scope(req.auth!, old.clinic_id);
    const next = {
      role: body.role ?? roles[old.role as keyof typeof roles], clinicId: body.clinicId === undefined ? old.clinic_id : body.clinicId,
      doctorId: body.doctorId === undefined ? old.doctor_id : body.doctorId, active: body.active ?? old.disabled_at === null,
    };
    scope(req.auth!, next.clinicId);
    if (old.role === "receptionist" && next.role !== "front-desk" && !hash) throw fail(400, "PASSWORD_REQUIRED", "validation");
    if (old.role !== "receptionist" && next.role === "front-desk" && !pinHash) throw fail(400, "PIN_REQUIRED", "validation");
    if (next.role !== "front-desk" && pinHash) throw fail(400, "PIN_ROLE_REQUIRED", "validation");
    await assignment(client, next, userId);
    await lastAdmin(client, old, next);
    if (old.doctor_id !== next.doctorId && old.doctor_id !== null) {
      await client.query("UPDATE operational.doctors SET user_id=NULL WHERE doctor_id=$1 AND user_id=$2", [old.doctor_id, userId]);
    }
    const { rows: [user] } = await client.query(`UPDATE operational.users SET email=$2,role=$3::text::operational.user_role,clinic_id=$4,doctor_id=$5,
      locale=$6,theme=$7,disabled_at=CASE WHEN $8 THEN NULL ELSE COALESCE(disabled_at,now()) END,
      password_hash=COALESCE($9,password_hash),pin_hash=CASE WHEN $3::text='receptionist' THEN COALESCE($10,pin_hash) ELSE NULL END
      WHERE id=$1 RETURNING ${projection}`,
    [userId, body.email ?? old.email, storedRoles[next.role], next.clinicId, next.doctorId,
      body.locale ?? old.locale, body.theme ?? old.theme, next.active, hash ?? null, pinHash ?? null]);
    if (next.doctorId !== null) await client.query("UPDATE operational.doctors SET user_id=$1 WHERE doctor_id=$2", [userId, next.doctorId]);
    // Even preference-only admin edits invalidate existing authority immediately.
    await client.query("UPDATE operational.auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1", [userId]);
    if (pinHash) await client.query(`INSERT INTO operational.auth_pin_state(user_id,failures,locked_until) VALUES($1,0,NULL)
      ON CONFLICT(user_id) DO UPDATE SET failures=0,locked_until=NULL`, [userId]);
    await auditAdministration(client, "admin.user.updated", req.auth!, user.clinic_id, userId,
      [...new Set(Object.keys(body).map(k => k === "password" || k === "pin" ? "credential" : k))].sort());
    return responseContract(UpdateAdminUserResponse, safeUser(user));
  });
  res.json(result);
});
router.delete("/admin/users/:id", csrf, async (req, res) => {
  const userId = requestContract(DeactivateAdminUserParams, req.params).id;
  await transaction(req.auth!, async client => {
    const { rows: [old] } = await client.query(`SELECT ${projection} FROM operational.users WHERE id=$1 FOR UPDATE`, [userId]);
    if (!old) throw fail(404, "NOT_FOUND", "notFound");
    scope(req.auth!, old.clinic_id);
    await lastAdmin(client, old, { role: roles[old.role as keyof typeof roles], clinicId: old.clinic_id, doctorId: old.doctor_id, active: false });
    await client.query("UPDATE operational.users SET disabled_at=COALESCE(disabled_at,now()) WHERE id=$1", [userId]);
    await client.query("UPDATE operational.auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1", [userId]);
    if (old.disabled_at === null) await auditAdministration(client, "admin.user.deactivated", req.auth!, old.clinic_id, userId, ["active"]);
  });
  responseContract(DeactivateAdminUserResponse, undefined);
  res.status(204).end();
});
router.post("/admin/users/:id/reset-pin", csrf, async (req, res) => {
  const userId = requestContract(ResetAdminUserPinParams, req.params).id;
  const body = z.object({ pin }).strict().parse(requestContract(ResetAdminUserPinBody, req.body));
  const hash = await bcrypt.hash(body.pin, 12);
  await transaction(req.auth!, async client => {
    const { rows: [user] } = await client.query(`SELECT ${projection} FROM operational.users WHERE id=$1 FOR UPDATE`, [userId]);
    if (!user) throw fail(404, "NOT_FOUND", "notFound");
    scope(req.auth!, user.clinic_id);
    if (user.role !== "receptionist") throw fail(400, "PIN_ROLE_REQUIRED", "validation");
    await client.query("UPDATE operational.users SET pin_hash=$2 WHERE id=$1", [userId, hash]);
    await client.query(`INSERT INTO operational.auth_pin_state(user_id,failures,locked_until) VALUES($1,0,NULL)
      ON CONFLICT(user_id) DO UPDATE SET failures=0,locked_until=NULL`, [userId]);
    await auditAdministration(client, "admin.user.pin_reset", req.auth!, user.clinic_id, userId, ["credential"]);
  });
  responseContract(ResetAdminUserPinResponse, undefined);
  res.status(204).end();
});
export default router;
