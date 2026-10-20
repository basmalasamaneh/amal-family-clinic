import { createHash, randomBytes } from "node:crypto";
import type { Request, Response, RequestHandler } from "express";
import { pool } from "@workspace/db";
import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import { fail } from "./auth-errors";

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("base64url");
export const cookies = { session: "amal_session", device: "amal_device" };
export const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/" };
export const roles = { administrator: "admin", doctor: "doctor", receptionist: "front-desk" } as const;
export type Role = typeof roles[keyof typeof roles];
export interface Auth {
  id: number; email: string; role: Role; clinicId: number | null; doctorId: number | null;
  locale: "ar" | "en"; theme: "light" | "dark"; sessionDigest: string; csrfToken: string;
  device: { id: number; clinicId: number } | null; expiresAt: Date; absoluteExpiresAt: Date | null; pinVerifiedAt: Date | null;
}
declare global { namespace Express { interface Request { auth?: Auth } } }
export const unauthorized = () => fail(401, "UNAUTHORIZED", "unauthorized");
export const forbidden = () => fail(403, "FORBIDDEN", "forbidden");

export async function trustedDevice(req: Request) {
  const credential = req.cookies?.[cookies.device];
  if (typeof credential !== "string" || credential.length > 100) throw unauthorized();
  const { rows } = await pool.query(`SELECT d.id, d.clinic_id FROM operational.devices d JOIN operational.auth_devices a ON a.device_id=d.id WHERE a.credential_digest=$1 AND a.revoked_at IS NULL`, [digest(credential)]);
  if (!rows[0]) throw unauthorized();
  return rows[0] as { id: number; clinic_id: number };
}
export async function throttle(req: Request, email: string, deviceId?: number) {
  // Each dimension independently persists; changing selectors cannot reset device/IP buckets.
  for (const [key, limit] of (deviceId ? [[`device:${deviceId}`, 30]] : [[`ip:${req.ip}`, 100], [`account:${email}`, 20]]) as [string, number][]) {
    const { rows } = await pool.query(`INSERT INTO operational.auth_throttles(key_digest,attempts) VALUES($1,1)
      ON CONFLICT(key_digest) DO UPDATE SET
      attempts=CASE WHEN operational.auth_throttles.window_started_at <= now()-interval '15 minutes' THEN 1 ELSE operational.auth_throttles.attempts+1 END,
      window_started_at=CASE WHEN operational.auth_throttles.window_started_at <= now()-interval '15 minutes' THEN now() ELSE operational.auth_throttles.window_started_at END RETURNING attempts`, [digest(key)]);
    if (rows[0].attempts > limit) throw fail(429, "RATE_LIMITED", "rateLimited", { retryAfterSeconds: 900 });
  }
}
export async function audit(action: string, userId: number | null = null, clinicId: number | null = null) {
  await pool.query("INSERT INTO operational.audit_log(action,user_id,clinic_id,detail) VALUES($1,$2,$3,'{}')", [action, userId, clinicId]);
}
/** Serialize all administrative user/doctor linkage changes across instances. */
export async function lockAdministration(client: PoolClient, auth: Auth) {
  await client.query("SELECT pg_advisory_xact_lock(31030,1)");
  const { rows: [actor] } = await client.query(`SELECT u.id FROM operational.users u
    JOIN operational.auth_sessions s ON s.user_id=u.id
    WHERE u.id=$1 AND u.role='administrator' AND u.disabled_at IS NULL
      AND u.clinic_id IS NOT DISTINCT FROM $3::integer
      AND s.token_digest=$2 AND s.revoked_at IS NULL
      AND s.last_seen_at>now()-interval '30 minutes' FOR SHARE OF u`,
  [auth.id, auth.sessionDigest, auth.clinicId]);
  if (!actor) throw unauthorized();
}
/** Only identifiers and allowlisted field names, never values or credentials. */
export async function auditAdministration(client: PoolClient, action: string, auth: Auth, clinicId: number | null, targetId: number, fields: string[] = []) {
  await client.query("INSERT INTO operational.audit_log(action,user_id,clinic_id,detail) VALUES($1,$2,$3,$4::jsonb)",
    [action, auth.id, clinicId, JSON.stringify({ targetId, fields })]);
}
export async function verifyPin(userId: number, pin: string) {
  const lockMinutes = Number(process.env.AUTH_PIN_LOCK_MINUTES ?? 15);
  if (!Number.isInteger(lockMinutes) || lockMinutes < 1 || lockMinutes > 1440) throw new Error("Invalid PIN lock duration");
  const client = await pool.connect();
  let error: Error | undefined;
  let version: number | undefined;
  try {
    await client.query("BEGIN");
    const { rows: [user] } = await client.query("SELECT auth_version FROM operational.users WHERE id=$1 AND disabled_at IS NULL FOR SHARE", [userId]);
    if (!user) throw unauthorized();
    version = user.auth_version;
    await client.query("INSERT INTO operational.auth_pin_state(user_id) VALUES($1) ON CONFLICT DO NOTHING", [userId]);
    const { rows: [state] } = await client.query(`SELECT s.*,u.pin_hash,(s.locked_until > now()) AS locked
      FROM operational.auth_pin_state s JOIN operational.users u ON u.id=s.user_id WHERE s.user_id=$1 FOR UPDATE OF s`, [userId]);
    if (state.locked) error = fail(423, "PIN_LOCKED", "pinLocked", { retryAfterSeconds: Math.max(1, Math.ceil((state.locked_until.getTime()-Date.now())/1000)) });
    else {
      const valid = state.pin_hash && await bcrypt.compare(pin, state.pin_hash);
      if (valid) await client.query("UPDATE operational.auth_pin_state SET failures=0,locked_until=NULL WHERE user_id=$1", [userId]);
      else {
        const failures = (state.locked_until ? 0 : state.failures) + 1;
        await client.query("UPDATE operational.auth_pin_state SET failures=$2,locked_until=CASE WHEN $2>=5 THEN now()+($3 * interval '1 minute') ELSE NULL END WHERE user_id=$1", [userId, failures, lockMinutes]);
        error = failures >= 5 ? fail(423, "PIN_LOCKED", "pinLocked", { retryAfterSeconds: lockMinutes * 60 }) : unauthorized();
      }
    }
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
  if (error) { await audit("auth.pin.denied", userId); throw error; }
  return version!;
}
const authentication = (readOnly: boolean): RequestHandler => async (req, _res, next) => {
  try {
    const credential = req.cookies?.[cookies.session];
    if (typeof credential !== "string" || credential.length > 100) throw unauthorized();
    const { rows: [r] } = await pool.query(`${readOnly
      ? "SELECT u.id,u.email,u.role,u.clinic_id,u.doctor_id,u.locale,u.theme,s.* FROM operational.auth_sessions s, operational.users u"
      : "UPDATE operational.auth_sessions s SET last_seen_at=now() FROM operational.users u"}
      WHERE s.token_digest=$1 AND u.id=s.user_id AND u.disabled_at IS NULL AND s.revoked_at IS NULL
      AND ((u.role='receptionist' AND s.device_id IS NOT NULL AND s.absolute_expires_at>now()) OR (u.role IN ('doctor','administrator') AND s.last_seen_at>now()-interval '30 minutes'))
      AND (s.device_id IS NULL OR EXISTS(SELECT 1 FROM operational.auth_devices a JOIN operational.devices d ON d.id=a.device_id WHERE a.device_id=s.device_id AND a.revoked_at IS NULL AND d.clinic_id=u.clinic_id))
      ${readOnly ? "" : "RETURNING u.id,u.email,u.role,u.clinic_id,u.doctor_id,u.locale,u.theme,s.*"}`, [digest(credential)]);
    if (!r || !Object.hasOwn(roles, r.role)) throw unauthorized();
    if (r.device_id) {
      const d = await trustedDevice(req);
      if (d.id !== r.device_id || d.clinic_id !== r.clinic_id) throw unauthorized();
    }
    req.auth = { id: r.user_id, email: r.email, role: roles[r.role as keyof typeof roles], clinicId: r.clinic_id, doctorId: r.doctor_id, locale: r.locale, theme: r.theme,
      sessionDigest: r.token_digest, csrfToken: r.csrf_token, device: r.device_id ? { id: r.device_id, clinicId: r.clinic_id } : null,
      expiresAt: r.absolute_expires_at ?? new Date(r.last_seen_at.getTime()+1800000), absoluteExpiresAt: r.absolute_expires_at, pinVerifiedAt: r.pin_verified_at };
    next();
  } catch (e) { next(e); }
};
export const authenticate = authentication(false);
/** Does not refresh the session or write audit state. */
export const authenticateReadOnly = authentication(true);
export const requireRoles = (...allowed: Role[]): RequestHandler => (req, _res, next) => {
  next(!req.auth ? unauthorized() : !allowed.includes(req.auth.role) ? forbidden() : undefined);
};
export function enforceScope(auth: Auth, clinicId: number, doctorId?: number, clinical = false) {
  if (!["admin", "doctor", "front-desk"].includes(auth.role) || !Number.isInteger(clinicId) || clinicId <= 0) throw forbidden();
  if (clinical && auth.role !== "doctor") throw forbidden();
  if (auth.role !== "admin" || auth.clinicId !== null) if (auth.clinicId !== clinicId) throw forbidden();
  if (auth.role === "doctor" && doctorId !== undefined && auth.doctorId !== doctorId) throw forbidden();
}
export const requireScope = (resolve: (req: Request) => { clinicId: number; doctorId?: number }, clinical = false): RequestHandler => (req, _res, next) => {
  try { if (!req.auth) throw unauthorized(); const scope = resolve(req); enforceScope(req.auth, scope.clinicId, scope.doctorId, clinical); next(); } catch(e) { next(e); }
};
export const requireFreshPin: RequestHandler = (req, _res, next) => {
  const a = req.auth;
  next(!a ? unauthorized() : a.role === "front-desk" && (!a.device || !a.pinVerifiedAt || Date.now()-a.pinVerifiedAt.getTime() >= 300000) ? fail(403, "REAUTH_REQUIRED", "reauthRequired") : undefined);
};
export const csrf: RequestHandler = (req, _res, next) => {
  next(!req.auth ? unauthorized() : req.get("x-csrf-token") !== req.auth.csrfToken ? fail(403, "CSRF", "csrf") : undefined);
};
export function identity(a: Auth) {
  const validUntil = a.pinVerifiedAt ? new Date(a.pinVerifiedAt.getTime()+300000) : null;
  return { id: a.id, email: a.email, role: a.role, clinicId: a.clinicId, doctorId: a.doctorId, locale: a.locale, theme: a.theme,
    session: { expiresAt: a.expiresAt.toISOString(), absoluteExpiresAt: a.absoluteExpiresAt?.toISOString() ?? null, idleTimeoutSeconds: a.role === "front-desk" ? null : 1800 },
    device: a.device, reauth: { required: a.role === "front-desk" && (!validUntil || validUntil.getTime() <= Date.now()), validUntil: validUntil?.toISOString() ?? null }, csrfToken: a.csrfToken };
}
export async function createSession(req: Request, res: Response, userId: number, deviceId: number | null, pinVerified: boolean, originalExpiry?: Date | null, expectedVersion?: number) {
  const credential = token();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [user] } = await client.query("SELECT id,clinic_id,auth_version FROM operational.users WHERE id=$1 AND disabled_at IS NULL FOR UPDATE", [userId]);
    if (!user || (expectedVersion !== undefined && user.auth_version !== expectedVersion)) throw unauthorized();
    if (deviceId !== null) {
      const { rows: [device] } = await client.query(`SELECT d.id FROM operational.devices d JOIN operational.auth_devices a ON a.device_id=d.id
        WHERE d.id=$1 AND d.clinic_id=$2 AND a.revoked_at IS NULL FOR SHARE OF a`, [deviceId, user.clinic_id]);
      if (!device) throw unauthorized();
    }
    if (req.auth) {
      const { rows: [session] } = await client.query("SELECT token_digest FROM operational.auth_sessions WHERE token_digest=$1 AND revoked_at IS NULL", [req.auth.sessionDigest]);
      if (!session) throw unauthorized();
    }
    if (req.cookies?.[cookies.session]) await client.query("UPDATE operational.auth_sessions SET revoked_at=now() WHERE token_digest=$1", [digest(req.cookies[cookies.session])]);
    await client.query(`INSERT INTO operational.auth_sessions(token_digest,user_id,device_id,csrf_token,absolute_expires_at,pin_verified_at)
      SELECT $1,id,$3,$4,CASE WHEN role='receptionist' THEN COALESCE($6::timestamptz,now()+interval '8 hours') ELSE NULL END,CASE WHEN $5 THEN now() ELSE NULL END FROM operational.users WHERE id=$2`,
    [digest(credential), userId, deviceId, token(), pinVerified, originalExpiry ?? null]);
    await client.query("UPDATE operational.users SET last_login=now() WHERE id=$1", [userId]);
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  res.cookie(cookies.session, credential, cookieOptions);
  req.cookies[cookies.session] = credential;
  await audit("auth.login", userId);
}
export const newCredential = token;
