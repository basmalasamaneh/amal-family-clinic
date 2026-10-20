import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import pg from "pg";
import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import { ZodError } from "zod/v4";
import { pool } from "@workspace/db";
import {
  CreateAdminUserResponse, EnrollDeviceResponse, GetAdminUserResponse,
  ListAdminDevicesResponse, ListAdminUsersResponse, UpdateAdminUserResponse,
} from "@workspace/api-zod";
import authRouter from "../src/routes/auth";
import usersRouter from "../src/routes/admin-users";
import { ApiError } from "../src/lib/auth-errors";
import { createSession, verifyPin } from "../src/lib/auth";

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Admin tests prohibited in deployment");
process.env.NODE_ENV = "test";
// All SQL is real PostgreSQL, redirected into a disposable operational schema.
// This permits testing the actual final-network-admin race without disabling
// any prerequisite/demo accounts or deleting production append-only audit.
const schema = `admin_users_test_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
// LIKE deliberately shares the existing immutable enum types, not the tables.
const rewrite = (text: string) => text.replaceAll("operational.", `${schema}.`)
  .replaceAll(`${schema}.user_role`, "operational.user_role");
const query = pool.query.bind(pool);
const connect = pool.connect.bind(pool);
const tables = ["clinics", "doctors", "users", "devices", "auth_devices", "auth_sessions", "auth_pin_state", "auth_throttles", "audit_log"];
const password = "Administrative-Test-Password!";
let server: ReturnType<express.Express["listen"]>;
let base: string, clinic: number, otherClinic: number, doctorId: number;
let manager: Browser, second: Browser, scoped: Browser;
let managerId: number, secondId: number, receptionId: number;
let originalSeeds: unknown;
async function seeds() {
  const rows = [];
  for (const table of ["clinics", "doctors", "patients", "appointments", "patient_visit_history", "calendar_app_export"]) {
    rows.push((await admin.query(`SELECT count(*)::integer n,md5(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text)) h FROM public.${table} t`)).rows[0]);
  }
  return rows;
}
class Browser {
  jar = new Map<string, string>();
  csrf = "";
  async call(path: string, method = "GET", body?: unknown, csrf = this.csrf) {
    const headers: Record<string, string> = { origin: "http://admin-test.local" };
    if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (csrf) headers["x-csrf-token"] = csrf;
    if (body !== undefined) headers["content-type"] = "application/json";
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const cookie of r.headers.getSetCookie()) { const [key, value] = cookie.split(";")[0].split("="); this.jar.set(key, value); }
    const text = await r.text();
    const data = text ? JSON.parse(text) : null;
    if (data?.csrfToken) this.csrf = data.csrfToken;
    return { status: r.status, data, text };
  }
}
async function login(email: string) {
  const browser = new Browser();
  assert.equal((await browser.call("/auth/login", "POST", { email, password })).status, 200);
  return browser;
}
async function create(body: Record<string, unknown>, browser = manager) {
  return browser.call("/admin/users", "POST", { email: `${randomUUID()}@admin.test`, role: "admin", password, ...body });
}
before(async () => {
  await admin.connect();
  originalSeeds = await seeds();
  await admin.query(`CREATE SCHEMA ${schema}`);
  for (const table of tables) await admin.query(`CREATE TABLE ${schema}.${table} (LIKE operational.${table} INCLUDING ALL)`);
  // LIKE copies checks and unique indexes, not foreign keys or deferred triggers.
  await admin.query(`ALTER TABLE ${schema}.users ADD FOREIGN KEY(clinic_id) REFERENCES ${schema}.clinics(clinic_id);
    ALTER TABLE ${schema}.users ADD FOREIGN KEY(doctor_id) REFERENCES ${schema}.doctors(doctor_id) DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE ${schema}.doctors ADD FOREIGN KEY(user_id) REFERENCES ${schema}.users(id) DEFERRABLE INITIALLY DEFERRED`);
  const functionDefinition = (await admin.query("SELECT pg_get_functiondef('operational.check_doctor_user_links()'::regprocedure) AS definition")).rows[0].definition;
  await admin.query(rewrite(functionDefinition));
  for (const table of ["users", "doctors"]) await admin.query(`CREATE CONSTRAINT TRIGGER ${table}_links
    AFTER INSERT OR UPDATE OR DELETE ON ${schema}.${table} DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION ${schema}.check_doctor_user_links()`);
  await admin.query(`CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON ${schema}.audit_log
    FOR EACH ROW EXECUTE FUNCTION operational.guard_audit_log()`);
  const migration = await readFile(new URL("../../../lib/db/migrations/0011_admin.sql", import.meta.url), "utf8");
  await admin.query(rewrite(migration));
  await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO amal_app;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO amal_app;
    GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO amal_app;
    REVOKE UPDATE,DELETE,TRUNCATE ON ${schema}.audit_log FROM amal_app`);
  (pool as any).query = async (text: string, values?: unknown[]) => {
    const client = await connect();
    try { return await client.query(rewrite(text), values); } finally { client.release(); }
  };
  (pool as any).connect = async () => {
    const client = await connect();
    const original = client.query.bind(client);
    (client as any).query = (text: string, ...args: unknown[]) => (original as any)(rewrite(text), ...args);
    const release = client.release.bind(client);
    client.release = (...args) => { client.query = original; client.release = release; release(...args); };
    return client;
  };
  clinic = (await pool.query("INSERT INTO operational.clinics(clinic_name,city,booking_method,adoption_state) VALUES('Test A','Test','phone','full') RETURNING clinic_id")).rows[0].clinic_id;
  otherClinic = (await pool.query("INSERT INTO operational.clinics(clinic_name,city,booking_method,adoption_state) VALUES('Test B','Test','phone','full') RETURNING clinic_id")).rows[0].clinic_id;
  doctorId = (await pool.query(`INSERT INTO operational.doctors(doctor_name,clinic_id,specialty,email)
    VALUES('Test doctor',$1,'general','doctor@admin.test') RETURNING doctor_id`, [clinic])).rows[0].doctor_id;
  const hash = await bcrypt.hash(password, 4);
  for (const [email, clinicId] of [["manager@admin.test", null], ["second@admin.test", null], ["scoped@admin.test", clinic]] as const) {
    const user = (await pool.query("INSERT INTO operational.users(email,password_hash,role,clinic_id) VALUES($1,$2,'administrator',$3) RETURNING id", [email, hash, clinicId])).rows[0];
    if (email.startsWith("manager")) managerId = user.id;
    if (email.startsWith("second")) secondId = user.id;
  }
  const app = express();
  app.use(express.json(), cookieParser());
  app.use(authRouter, usersRouter);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const safe = error instanceof ApiError ? error : error instanceof ZodError ? new ApiError(400, "VALIDATION", "validation") : new ApiError(500, "INTERNAL", "internal");
    res.status(safe.status).json({ code: safe.code, messageKey: `error.${safe.key}`, params: safe.params });
  });
  server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  manager = await login("manager@admin.test"); second = await login("second@admin.test"); scoped = await login("scoped@admin.test");
});
after(async () => {
  try {
    if (server) { server.close(); await once(server, "close"); }
    assert.deepEqual(await seeds(), originalSeeds, "All six source seed tables unchanged");
  } finally {
    (pool as any).query = query; (pool as any).connect = connect;
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});

test("user and registered-device administration", async t => {
  await t.test("deny anonymous/non-admin/CSRF and reject unsafe fields, role aliases and pagination", async () => {
    assert.equal((await new Browser().call("/admin/users")).status, 401);
    assert.equal((await manager.call("/admin/users", "POST", { email: "a@b.test", role: "administrator", password })).status, 400);
    assert.equal((await create({ password_hash: "unsafe" })).status, 400);
    assert.equal((await manager.call("/admin/users", "POST", {}, "wrong")).status, 403);
    for (const q of ["page=0", "pageSize=101", "clinicId=0", "role=receptionist", "unknown=1"]) {
      assert.equal((await manager.call(`/admin/users?${q}`)).status, 400);
    }
    assert.equal((await create({ role: "front-desk", clinicId: clinic })).status, 400);
    assert.equal((await create({ role: "doctor", clinicId: clinic, doctorId: null })).status, 400);
  });
  await t.test("bounded stable listing/detail expose canonical safe DTOs only and enforce clinic authority", async () => {
    const first = await manager.call("/admin/users?pageSize=2");
    const next = await manager.call("/admin/users?pageSize=2&page=2");
    ListAdminUsersResponse.parse(first.data); ListAdminUsersResponse.parse(next.data);
    assert.equal(first.status, 200); assert.equal(first.data.items.length, 2);
    assert(first.data.items[1].id < next.data.items[0].id);
    assert.equal(first.data.total, 3);
    const detail = await manager.call(`/admin/users/${managerId}`);
    GetAdminUserResponse.parse(detail.data);
    assert.equal(detail.data.role, "admin");
    assert.deepEqual(Object.keys(detail.data).sort(), ["active", "clinicId", "disabledAt", "doctorId", "email", "id", "lastLogin", "locale", "role", "theme"]);
    assert(!/hash|csrf|digest|credential|fixture_key/.test(detail.text));
    assert.equal((await scoped.call(`/admin/users/${managerId}`)).status, 403);
    assert.equal((await scoped.call(`/admin/users?clinicId=${otherClinic}`)).status, 403);
    assert.equal((await create({ clinicId: otherClinic }, scoped)).status, 403);
    assert.equal((await create({}, scoped)).status, 403);
    assert.equal((await scoped.call("/admin/users")).data.total, 1);
  });
  await t.test("create/link doctor atomically, enforce case-insensitive uniqueness and reciprocal assignments", async () => {
    const result = await create({ role: "doctor", email: "LINKED@admin.test", clinicId: clinic, doctorId });
    CreateAdminUserResponse.parse(result.data);
    assert.equal(result.status, 201); assert.equal(result.data.email, "linked@admin.test");
    assert.equal((await pool.query("SELECT user_id FROM operational.doctors WHERE doctor_id=$1", [doctorId])).rows[0].user_id, result.data.id);
    assert.equal((await create({ email: "Linked@admin.test" })).status, 409);
    assert.equal((await create({ role: "doctor", clinicId: clinic, doctorId })).status, 409);
    assert.equal((await create({ role: "doctor", clinicId: otherClinic, doctorId })).status, 400);
    const doctor = await login(result.data.email);
    assert.equal((await doctor.call("/admin/users")).status, 403);
    assert.equal((await doctor.call("/auth/devices")).status, 403);
    const changed = await manager.call(`/admin/users/${result.data.id}`, "PATCH", { role: "admin", doctorId: null, clinicId: null });
    assert.equal(changed.status, 200); UpdateAdminUserResponse.parse(changed.data);
    assert.equal((await doctor.call("/me")).status, 401);
    assert.equal((await pool.query("SELECT user_id FROM operational.doctors WHERE doctor_id=$1", [doctorId])).rows[0].user_id, null);
    // Do not leave an extra network administrator for the final-admin race.
    assert.equal((await manager.call(`/admin/users/${result.data.id}`, "DELETE")).status, 204);
  });
  await t.test("enroll/list devices, PIN reset unlocks and invalidates every session, deactivation blocks login", async () => {
    const created = await create({ role: "front-desk", clinicId: clinic, pin: "0123" });
    assert.equal(created.status, 201); receptionId = created.data.id;
    const device = await manager.call("/auth/devices", "POST", { clinicId: clinic, label: "test.reception" });
    EnrollDeviceResponse.parse(device.data);
    assert.equal(device.status, 201);
    const list = await manager.call("/auth/devices?pageSize=1");
    ListAdminDevicesResponse.parse(list.data);
    assert.equal(list.data.items[0].id, device.data.id);
    assert(!/credential|digest/.test(list.text));
    const desk = new Browser(); desk.jar.set("amal_device", manager.jar.get("amal_device")!);
    const credentials = { email: created.data.email, pin: "0123" };
    assert.equal((await desk.call("/auth/pin", "POST", credentials)).status, 200);
    const replay = new Browser(); replay.jar = new Map(desk.jar);
    await pool.query("UPDATE operational.auth_pin_state SET failures=5,locked_until=now()+interval '1 hour' WHERE user_id=$1", [receptionId]);
    assert.equal((await desk.call("/auth/pin", "POST", credentials)).status, 423);
    assert.equal((await manager.call(`/admin/users/${receptionId}/reset-pin`, "POST", { pin: "5678" })).status, 204);
    assert.equal((await replay.call("/me")).status, 401);
    assert.equal((await pool.query("SELECT failures,locked_until FROM operational.auth_pin_state WHERE user_id=$1", [receptionId])).rows[0].failures, 0);
    assert.equal((await desk.call("/auth/pin", "POST", { ...credentials, pin: "5678" })).status, 200);
    assert.equal((await manager.call(`/admin/users/${receptionId}`, "DELETE")).status, 204);
    assert.equal((await desk.call("/me")).status, 401);
    assert.equal((await desk.call("/auth/pin", "POST", { ...credentials, pin: "5678" })).status, 401);
    assert.equal((await manager.call(`/admin/users/${receptionId}`, "PATCH", { active: true })).status, 200);
    assert.equal((await desk.call("/auth/pin", "POST", { ...credentials, pin: "5678" })).status, 200);
    assert.equal((await manager.call(`/auth/devices/${device.data.id}`, "DELETE")).status, 204);
    assert.equal((await desk.call("/me")).status, 401);
    assert.equal((await desk.call("/auth/pin", "POST", { ...credentials, pin: "5678" })).status, 401);
    assert.equal((await manager.call("/auth/devices?revoked=true")).data.total, 1);
    const auditCount = (await pool.query("SELECT count(*)::integer n FROM operational.audit_log WHERE action='auth.device.revoked'")).rows[0].n;
    assert.equal((await manager.call(`/auth/devices/${device.data.id}`, "DELETE")).status, 204);
    assert.equal((await pool.query("SELECT count(*)::integer n FROM operational.audit_log WHERE action='auth.device.revoked'")).rows[0].n, auditCount);
  });
  await t.test("credential-generation check rejects a login verified before reset/deactivation", async () => {
    const version = await verifyPin(receptionId, "5678");
    assert.equal((await manager.call(`/admin/users/${receptionId}/reset-pin`, "POST", { pin: "4321" })).status, 204);
    await assert.rejects(createSession({ cookies: {} } as any, { cookie() { throw new Error("Must not issue cookie"); } } as any,
      receptionId, null, true, null, version), (e: any) => e.code === "UNAUTHORIZED");
    await pool.query("UPDATE operational.users SET disabled_at=now() WHERE id=$1", [receptionId]);
    await assert.rejects(verifyPin(receptionId, "4321"), (e: any) => e.code === "UNAUTHORIZED");
  });
  await t.test("audit failure rolls back user creation and device revocation with sessions intact", async () => {
    assert.equal((await manager.call(`/admin/users/${receptionId}`, "PATCH", { active: true })).status, 200);
    const reception = (await manager.call(`/admin/users/${receptionId}`)).data;
    const device = await manager.call("/auth/devices", "POST", { clinicId: clinic, label: "test.auditRollback" });
    assert.equal(device.status, 201);
    const desk = new Browser(); desk.jar.set("amal_device", manager.jar.get("amal_device")!);
    assert.equal((await desk.call("/auth/pin", "POST", { email: reception.email, pin: "4321" })).status, 200);
    await admin.query(`CREATE FUNCTION ${schema}.reject_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected audit failure'; END $$;
      CREATE TRIGGER reject_test_audit BEFORE INSERT ON ${schema}.audit_log FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_test_audit()`);
    try {
      const email = `${randomUUID()}@admin.test`;
      assert.equal((await create({ email })).status, 500);
      assert.equal((await pool.query("SELECT count(*)::integer n FROM operational.users WHERE email=$1", [email])).rows[0].n, 0);
      assert.equal((await manager.call("/auth/devices", "POST", { clinicId: clinic, label: "test.rollback" })).status, 500);
      assert.equal((await pool.query("SELECT count(*)::integer n FROM operational.devices WHERE label='test.rollback'")).rows[0].n, 0);
      assert.equal((await manager.call(`/admin/users/${secondId}`, "DELETE")).status, 500);
      assert.equal((await second.call("/me")).status, 200);
      assert.equal((await manager.call(`/auth/devices/${device.data.id}`, "DELETE")).status, 500);
      assert.equal((await desk.call("/me")).status, 200);
      assert.equal((await desk.call("/auth/device-context")).status, 200);
      assert.equal((await manager.call(`/admin/users/${receptionId}/reset-pin`, "POST", { pin: "9999" })).status, 500);
      assert.equal((await desk.call("/me")).status, 200);
    } finally { await admin.query(`DROP TRIGGER reject_test_audit ON ${schema}.audit_log`); }
    // Login itself appends auth.login, so verify the preserved PIN only after
    // removing the deliberately failing audit trigger.
    assert.equal((await desk.call("/auth/pin", "POST", { email: reception.email, pin: "4321" })).status, 200);
    const rows = (await pool.query("SELECT action,detail FROM operational.audit_log WHERE action LIKE 'admin.%' OR action LIKE 'auth.device.%'")).rows;
    assert(rows.length > 0);
    for (const row of rows) {
      assert.deepEqual(Object.keys(row.detail).sort(), ["fields", "targetId"]);
      assert(!/@|5678|4321|0123|\$2[aby]\$|password|pin_hash|credential_digest/.test(JSON.stringify(row.detail)));
    }
    await assert.rejects(pool.query("UPDATE operational.audit_log SET action='tampered'"));
    await assert.rejects(pool.query("DELETE FROM operational.audit_log"));
  });
  await t.test("concurrent removal cannot remove the final active network administrator", async () => {
    const results = await Promise.all([
      manager.call(`/admin/users/${managerId}`, "PATCH", { active: false }),
      second.call(`/admin/users/${secondId}`, "PATCH", { active: false }),
    ]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    assert.equal(results.find(r => r.status === 409)!.data.code, "LAST_ADMIN");
    assert.equal((await pool.query("SELECT count(*)::integer n FROM operational.users WHERE role='administrator' AND clinic_id IS NULL AND disabled_at IS NULL")).rows[0].n, 1);
    const survivor = results[0].status === 409 ? manager : second;
    const survivorId = results[0].status === 409 ? managerId : secondId;
    assert.equal((await survivor.call(`/admin/users/${survivorId}`, "DELETE")).data.code, "LAST_ADMIN");
    assert.equal((await survivor.call(`/admin/users/${survivorId}`, "PATCH", { clinicId: clinic })).data.code, "LAST_ADMIN");
    assert.equal((await survivor.call(`/admin/users/${survivorId}`, "PATCH", { role: "front-desk", clinicId: clinic, pin: "1111" })).data.code, "LAST_ADMIN");
    const disabledEmail = results[0].status === 200 ? "manager@admin.test" : "second@admin.test";
    assert.equal((await new Browser().call("/auth/login", "POST", { email: disabledEmail, password })).status, 401);
  });
});
