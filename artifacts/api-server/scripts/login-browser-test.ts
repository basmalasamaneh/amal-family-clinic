/**
 * Isolated real-API browser acceptance. No seed writes, credential files, or auth mocks.
 * Test users remain disabled because the audit log is append-only.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import bcrypt from "bcryptjs";
import { pool } from "@workspace/db";
import { digest } from "../src/lib/auth";

if (process.env.NODE_ENV === "production") throw new Error("Browser acceptance is development-only");
const base = process.env.AMAL_E2E_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
if (!process.env.AMAL_E2E_BASE_URL && !process.env.REPLIT_DEV_DOMAIN) throw new Error("Development preview URL required");
const suffix = randomUUID();
const password = `Synthetic-${randomUUID()}!`;
const pin = "0123";
const users: { id: number; email: string }[] = [];
let deviceId: number | undefined;
let revokedDeviceId: number | undefined;
let doctorId: number | undefined;
let cookie = "";
let csrf = "";

async function api(path: string, body?: unknown, method = body ? "POST" : "GET") {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: { Origin: base, "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const c of response.headers.getSetCookie()) {
    const pair = c.split(";")[0];
    cookie = [...cookie.split("; ").filter(v => v && !v.startsWith(pair.split("=")[0] + "=")), pair].join("; ");
  }
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`Fixture API ${path}: ${response.status} ${data?.code ?? "failed"}`);
  if (data?.csrfToken) csrf = data.csrfToken;
  return data;
}

try {
  const clinics = (await pool.query("SELECT clinic_id FROM operational.clinics ORDER BY clinic_id LIMIT 2")).rows;
  if (clinics.length < 2) throw new Error("Requires existing operational clinics");
  const hash = await bcrypt.hash(password, 4);
  const pinHash = await bcrypt.hash(pin, 4);
  const client = await pool.connect();
  try {
  await client.query("BEGIN");
  doctorId = (await client.query(
    "INSERT INTO operational.doctors(doctor_name,clinic_id,specialty,email) VALUES($1,$2,$3,$4) RETURNING doctor_id",
    ["Synthetic browser-test doctor", clinics[0].clinic_id, "Test", `doctor.${suffix}@browser-test.example`],
  )).rows[0].doctor_id;
  for (const [label, role, clinic, doctor] of [
    ["admin", "administrator", null, null],
    ["doctor", "doctor", clinics[0].clinic_id, doctorId],
    ["desk", "receptionist", clinics[0].clinic_id, null],
    ["desk2", "receptionist", clinics[0].clinic_id, null],
    ["lock", "receptionist", clinics[0].clinic_id, null],
    ["wrongclinic", "receptionist", clinics[1].clinic_id, null],
    ["ratelimit", "administrator", null, null],
  ] as const) {
    const u = (await client.query(
      "INSERT INTO operational.users(email,password_hash,role,clinic_id,doctor_id,pin_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,email",
      [`${label}.${suffix}@browser-test.example`, hash, role, clinic, doctor, role === "receptionist" ? pinHash : null],
    )).rows[0];
    users.push(u);
    if (role === "doctor") await client.query("UPDATE operational.doctors SET user_id=$1 WHERE doctor_id=$2", [u.id, doctorId]);
  }
  await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  await api("/auth/login", { email: users[0].email, password });
  const revokedDevice = await api("/auth/devices", { clinicId: clinics[0].clinic_id, label: "test.revoked" });
  revokedDeviceId = revokedDevice.id;
  const revokedCookie = cookie.split("; ").find(c => c.startsWith("amal_device="))!;
  await api(`/auth/devices/${revokedDeviceId}`, undefined, "DELETE");
  const device = await api("/auth/devices", { clinicId: clinics[0].clinic_id, label: "test.browser" });
  deviceId = device.id;
  const deviceCookie = cookie.split("; ").find(c => c.startsWith("amal_device="))!;
  if (!deviceCookie) throw new Error("Enrollment did not return a device cookie");
  await api("/auth/logout", {});
  await pool.query("INSERT INTO operational.auth_throttles(key_digest,attempts) VALUES($1,20)", [digest(`account:${users[6].email}`)]);
  const child = spawn("pnpm", ["--filter", "@workspace/amal-network", "exec", "playwright", "test", "auth.spec.ts", "--workers=1", ...process.argv.slice(2)], {
    cwd: new URL("../../../", import.meta.url),
    stdio: "inherit",
    env: {
      ...process.env, AMAL_E2E_BASE_URL: base,
      AMAL_E2E_ADMIN_EMAIL: users[0].email, AMAL_E2E_ADMIN_PASSWORD: password,
      AMAL_E2E_DOCTOR_EMAIL: users[1].email, AMAL_E2E_DOCTOR_PASSWORD: password,
      AMAL_E2E_DESK_EMAIL: users[2].email, AMAL_E2E_DESK_PIN: pin,
      AMAL_E2E_DESK2_EMAIL: users[3].email, AMAL_E2E_DESK2_PIN: pin,
      AMAL_E2E_LOCK_EMAIL: users[4].email, AMAL_E2E_WRONG_CLINIC_EMAIL: users[5].email,
      AMAL_E2E_DEVICE_COOKIE: deviceCookie,
      AMAL_E2E_REVOKED_DEVICE_COOKIE: revokedCookie,
      AMAL_E2E_RATE_EMAIL: users[6].email,
    },
  });
  const [code] = await once(child, "exit");
  process.exitCode = typeof code === "number" ? code : 1;
} finally {
  // Never delete audit rows or test actors referenced by them; disable credentials instead.
  const ids = users.map(u => u.id);
  if (ids.length) {
    await pool.query("DELETE FROM operational.auth_sessions WHERE user_id=ANY($1::int[])", [ids]);
    await pool.query("DELETE FROM operational.auth_pin_state WHERE user_id=ANY($1::int[])", [ids]);
    await pool.query("UPDATE operational.users SET password_hash=$2,pin_hash=NULL WHERE id=ANY($1::int[])", [ids, await bcrypt.hash(randomUUID(), 4)]);
    await pool.query("DELETE FROM operational.auth_throttles WHERE key_digest=ANY($1::text[])", [
      [...users.map(u => digest(`account:${u.email}`)), ...(deviceId ? [digest(`device:${deviceId}`)] : [])],
    ]);
  }
  if (deviceId) await pool.query("UPDATE operational.auth_devices SET revoked_at=now() WHERE device_id=$1", [deviceId]);
  if (revokedDeviceId) await pool.query("UPDATE operational.auth_devices SET revoked_at=now() WHERE device_id=$1", [revokedDeviceId]);
  await pool.end();
}
