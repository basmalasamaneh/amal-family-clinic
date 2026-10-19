import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import bcrypt from "bcryptjs";
import { pool } from "@workspace/db";
import { authenticate, audit, cookies, cookieOptions, createSession, csrf, digest, enforceScope, forbidden, identity, newCredential, requireRoles, throttle, trustedDevice, unauthorized, verifyPin } from "../lib/auth";
import { fail } from "../lib/auth-errors";

const router: IRouter = Router();
const email = z.email().max(254).transform(v => v.toLowerCase());
const pin = z.string().regex(/^[0-9]{4}$/);
const id = z.coerce.number().int().positive();
// Valid bcrypt constant prevents the missing-user fast path from skipping costly verification.
const dummyHash = bcrypt.hashSync("not-a-real-credential", 12);
router.post("/auth/login", async (req, res, next) => {
  const body = z.object({ email, password: z.string().min(1).max(72).refine(v => Buffer.byteLength(v, "utf8") <= 72) }).strict().parse(req.body);
  await throttle(req, body.email);
  const { rows: [user] } = await pool.query("SELECT id,password_hash FROM operational.users WHERE lower(email)=$1 AND role IN ('doctor','administrator')", [body.email]);
  if (!await bcrypt.compare(body.password, user?.password_hash ?? dummyHash) || !user) {
    await audit("auth.password.denied");
    throw unauthorized();
  }
  await createSession(req, res, user.id, null, false);
  next();
}, authenticate, (req, res) => { res.json(identity(req.auth!)); });

router.post("/auth/pin", async (req, res, next) => {
  const body = z.object({ email, pin }).strict().parse(req.body);
  // Even forged-device attempts consume IP/account budget.
  await throttle(req, body.email);
  const device = await trustedDevice(req);
  await throttle(req, body.email, device.id);
  const { rows: [user] } = await pool.query("SELECT id FROM operational.users WHERE lower(email)=$1 AND role='receptionist' AND clinic_id=$2", [body.email, device.clinic_id]);
  if (!user) { await bcrypt.compare(body.pin, dummyHash); throw unauthorized(); }
  await verifyPin(user.id, body.pin);
  await createSession(req, res, user.id, device.id, true);
  next();
}, authenticate, (req, res) => { res.json(identity(req.auth!)); });

router.get("/me", authenticate, (req, res) => { res.json(identity(req.auth!)); });
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
  await verifyPin(a.id, body.pin);
  // Preserve device binding and the original absolute lifetime on rotation.
  const expiry = a.absoluteExpiresAt;
  await createSession(req, res, a.id, device.id, true, expiry);
  await audit("auth.pin.reauthenticated", a.id, a.clinicId);
  next();
}, authenticate, (req, res) => { res.json(identity(req.auth!)); });

router.post("/auth/devices", authenticate, csrf, requireRoles("admin"), async (req, res) => {
  const body = z.object({ clinicId: z.number().int().positive(), label: z.string().regex(/^[a-z][A-Za-z0-9_.-]*$/).max(100) }).strict().parse(req.body);
  enforceScope(req.auth!, body.clinicId);
  const credential = newCredential();
  const client = await pool.connect();
  let deviceId: number;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT clinic_id FROM operational.clinics WHERE clinic_id=$1", [body.clinicId]);
    if (!rows.length) throw fail(404, "NOT_FOUND", "notFound");
    const { rows: [d] } = await client.query("INSERT INTO operational.devices(clinic_id,label) VALUES($1,$2) RETURNING id", [body.clinicId, body.label]);
    deviceId = d.id;
    await client.query("INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)", [deviceId, digest(credential)]);
    await client.query("COMMIT");
  } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  res.cookie(cookies.device, credential, { ...cookieOptions, maxAge: 365*86400000 });
  await audit("auth.device.enrolled", req.auth!.id, body.clinicId);
  res.status(201).json({ id: deviceId, clinicId: body.clinicId, label: body.label });
});
router.delete("/auth/devices/:id", authenticate, csrf, requireRoles("admin"), async (req, res) => {
  const deviceId = id.parse(req.params.id);
  const { rows: [d] } = await pool.query("SELECT clinic_id FROM operational.devices WHERE id=$1", [deviceId]);
  if (!d) throw fail(404, "NOT_FOUND", "notFound");
  enforceScope(req.auth!, d.clinic_id);
  // Authentication always checks revocation, so even concurrent session creation fails closed.
  await pool.query("UPDATE operational.auth_devices SET revoked_at=now() WHERE device_id=$1", [deviceId]);
  await pool.query("UPDATE operational.auth_sessions SET revoked_at=now() WHERE device_id=$1", [deviceId]);
  await audit("auth.device.revoked", req.auth!.id, d.clinic_id);
  res.status(204).end();
});
export default router;
