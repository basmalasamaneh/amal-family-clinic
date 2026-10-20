import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import bcrypt from "bcryptjs";
import { pool } from "@workspace/db";
import {
  EnrollDeviceBody, EnrollDeviceResponse, ListAdminDevicesQueryParams, ListAdminDevicesResponse,
  RevokeDeviceParams, RevokeDeviceResponse,
} from "@workspace/api-zod";
import { authenticate, audit, auditAdministration, lockAdministration, cookies, cookieOptions, createSession, csrf, digest, enforceScope, forbidden, identity, newCredential, requireRoles, throttle, trustedDevice, unauthorized, verifyPin } from "../lib/auth";
import { ApiError, fail } from "../lib/auth-errors";
import { issueOfflinePermit } from "../lib/offline-permit";

const router: IRouter = Router();
type Contract<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };
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
const email = z.email().max(254).transform(v => v.toLowerCase());
const pin = z.string().regex(/^[0-9]{4}$/);
const id = z.coerce.number().int().min(1).max(2147483647);
// Valid bcrypt constant prevents the missing-user fast path from skipping costly verification.
const dummyHash = bcrypt.hashSync("not-a-real-credential", 12);
// A device-bound context, not a public clinic directory or an enrollment path.
router.get("/auth/device-context", async (req, res) => {
  let device;
  try { device = await trustedDevice(req); }
  catch (error) {
    if (error instanceof ApiError && error.status === 401) throw fail(403, "DEVICE_UNTRUSTED", "deviceUntrusted");
    throw error;
  }
  const { rows: [clinic] } = await pool.query(
    "SELECT clinic_id AS id, clinic_name AS name FROM operational.clinics WHERE clinic_id=$1", [device.clinic_id],
  );
  if (!clinic) throw fail(403, "DEVICE_UNTRUSTED", "deviceUntrusted");
  res.json({ clinic });
});
router.post("/auth/login", async (req, res, next) => {
  const body = z.object({ email, password: z.string().min(1).max(72).refine(v => Buffer.byteLength(v, "utf8") <= 72) }).strict().parse(req.body);
  await throttle(req, body.email);
  const { rows: [user] } = await pool.query("SELECT id,password_hash,auth_version FROM operational.users WHERE lower(email)=$1 AND disabled_at IS NULL AND role IN ('doctor','administrator')", [body.email]);
  if (!await bcrypt.compare(body.password, user?.password_hash ?? dummyHash) || !user) {
    await audit("auth.password.denied");
    throw unauthorized();
  }
  await createSession(req, res, user.id, null, false, null, user.auth_version);
  next();
}, authenticate, (req, res) => { res.json(identity(req.auth!)); });

router.post("/auth/pin", async (req, res, next) => {
  const body = z.object({ email, pin }).strict().parse(req.body);
  // Even forged-device attempts consume IP/account budget.
  await throttle(req, body.email);
  const device = await trustedDevice(req);
  await throttle(req, body.email, device.id);
  const { rows: [user] } = await pool.query("SELECT id FROM operational.users WHERE lower(email)=$1 AND disabled_at IS NULL AND role='receptionist' AND clinic_id=$2", [body.email, device.clinic_id]);
  if (!user) { await bcrypt.compare(body.pin, dummyHash); throw unauthorized(); }
  const version = await verifyPin(user.id, body.pin);
  await createSession(req, res, user.id, device.id, true, null, version);
  next();
}, authenticate, (req, res) => { res.json(identity(req.auth!)); });

router.get("/me", authenticate, (req, res) => { res.json(identity(req.auth!)); });
// This permit is local continuation authority only; no server route accepts it as login.
router.get("/auth/offline-permit", authenticate, requireRoles("doctor", "front-desk"), async (req, res) => {
  const nonce = z.string().regex(/^[a-f0-9]{64}$/).parse(req.query.nonce);
  const a = req.auth!;
  const { rows: [clinic] } = await pool.query(
    "SELECT clinic_id AS id, clinic_name AS name FROM operational.clinics WHERE clinic_id=$1", [a.clinicId],
  );
  if (!clinic) throw forbidden();
  res.setHeader("Cache-Control", "no-store");
  res.json(issueOfflinePermit(a, clinic, nonce));
});
router.post("/auth/logout", authenticate, csrf, async (req, res) => {
  await pool.query("UPDATE operational.auth_sessions SET revoked_at=now() WHERE token_digest=$1", [req.auth!.sessionDigest]);
  await audit("auth.logout", req.auth!.id, req.auth!.clinicId);
  res.clearCookie(cookies.session, cookieOptions).status(204).end();
});
router.post("/auth/reauth", authenticate, csrf, requireRoles("front-desk"), async (req, res, next) => {
  const body = z.object({ pin }).strict().parse(req.body);
  const a = req.auth!;
  await throttle(req, a.email);
  const device = await trustedDevice(req);
  if (device.clinic_id !== a.clinicId || (a.device && a.device.id !== device.id)) throw forbidden();
  await throttle(req, a.email, device.id);
  const version = await verifyPin(a.id, body.pin);
  // Preserve device binding and the original absolute lifetime on rotation.
  const expiry = a.absoluteExpiresAt;
  await createSession(req, res, a.id, device.id, true, expiry, version);
  await audit("auth.pin.reauthenticated", a.id, a.clinicId);
  next();
}, authenticate, (req, res) => { res.json(identity(req.auth!)); });

router.get("/auth/devices", authenticate, requireRoles("admin"), async (req, res) => {
  const query = requestContract(ListAdminDevicesQueryParams, z.object({
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    clinicId: id.optional(),
    revoked: z.enum(["true", "false"]).optional(),
  }).strict().parse(req.query));
  if (query.clinicId !== undefined) enforceScope(req.auth!, query.clinicId);
  const clinicId = req.auth!.clinicId ?? query.clinicId ?? null;
  const values = [clinicId, query.revoked === undefined ? null : query.revoked === "true"];
  const from = `FROM operational.devices d JOIN operational.auth_devices a ON a.device_id=d.id
    WHERE ($1::integer IS NULL OR d.clinic_id=$1)
      AND ($2::boolean IS NULL OR (a.revoked_at IS NOT NULL)=$2)`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { rows: [count] } = await client.query(`SELECT count(*)::integer AS total ${from}`, values);
    const { rows } = await client.query(`SELECT d.id,d.clinic_id AS "clinicId",d.label,
      d.registered_at AS "registeredAt",a.revoked_at AS "revokedAt" ${from}
      ORDER BY d.id LIMIT $3 OFFSET $4`, [...values, query.pageSize, (query.page - 1) * query.pageSize]);
    await client.query("COMMIT");
    res.json(responseContract(ListAdminDevicesResponse, { items: rows, total: count.total, page: query.page, pageSize: query.pageSize }));
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
});
router.post("/auth/devices", authenticate, csrf, requireRoles("admin"), async (req, res) => {
  const body = z.object({ clinicId: z.number().int().min(1).max(2147483647), label: z.string().regex(/^[a-z][A-Za-z0-9_.-]*$/).max(100) })
    .strict().parse(requestContract(EnrollDeviceBody, req.body));
  enforceScope(req.auth!, body.clinicId);
  const credential = newCredential();
  const client = await pool.connect();
  let deviceId: number;
  try {
    await client.query("BEGIN");
    await lockAdministration(client, req.auth!);
    const { rows } = await client.query("SELECT clinic_id FROM operational.clinics WHERE clinic_id=$1", [body.clinicId]);
    if (!rows.length) throw fail(404, "NOT_FOUND", "notFound");
    const { rows: [d] } = await client.query("INSERT INTO operational.devices(clinic_id,label) VALUES($1,$2) RETURNING id", [body.clinicId, body.label]);
    deviceId = d.id;
    await client.query("INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)", [deviceId, digest(credential)]);
    await auditAdministration(client, "auth.device.enrolled", req.auth!, body.clinicId, deviceId, ["clinicId", "label"]);
    responseContract(EnrollDeviceResponse, { id: deviceId, clinicId: body.clinicId, label: body.label });
    await client.query("COMMIT");
  } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  res.cookie(cookies.device, credential, { ...cookieOptions, maxAge: 365*86400000 });
  res.status(201).json(responseContract(EnrollDeviceResponse, { id: deviceId, clinicId: body.clinicId, label: body.label }));
});
router.delete("/auth/devices/:id", authenticate, csrf, requireRoles("admin"), async (req, res) => {
  const deviceId = id.parse(requestContract(RevokeDeviceParams, req.params).id);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockAdministration(client, req.auth!);
    const { rows: [d] } = await client.query(`SELECT d.clinic_id,a.revoked_at FROM operational.devices d
      JOIN operational.auth_devices a ON a.device_id=d.id WHERE d.id=$1 FOR UPDATE OF a`, [deviceId]);
    if (!d) throw fail(404, "NOT_FOUND", "notFound");
    enforceScope(req.auth!, d.clinic_id);
    await client.query("UPDATE operational.auth_devices SET revoked_at=COALESCE(revoked_at,now()) WHERE device_id=$1", [deviceId]);
    await client.query("UPDATE operational.auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE device_id=$1", [deviceId]);
    if (!d.revoked_at) await auditAdministration(client, "auth.device.revoked", req.auth!, d.clinic_id, deviceId);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  responseContract(RevokeDeviceResponse, undefined);
  res.status(204).end();
});
export default router;
