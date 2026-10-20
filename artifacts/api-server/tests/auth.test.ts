import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

if (process.env.NODE_ENV === "production") throw new Error("Auth integration tests are prohibited in production");
process.env.AUTH_ALLOWED_ORIGINS = "http://auth-test.local";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
const { default: app } = await import("../src/app");
const { pool } = await import("@workspace/db");
const { digest, enforceScope, requireFreshPin, requireRoles } = await import("../src/lib/auth");
const { translations } = await import("../src/lib/auth-errors");
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const suffix = randomUUID();
const password = "Test-Only-Password!";
let admin: any, reception: any, other: any, doctor: any, deviceId: number;
const createdIds: number[] = [];
const devices: number[] = [];
async function restartProbe(input: unknown) {
  const child = spawn(process.execPath, ["--import","tsx",new URL("./restart-probe.ts",import.meta.url).pathname], { stdio:["pipe","pipe","pipe"] });
  let output = ""; let error = "";
  child.stdout.on("data",chunk=>{output+=chunk;});
  child.stderr.on("data",chunk=>{error+=chunk;});
  child.stdin.end(JSON.stringify(input));
  const [code] = await once(child,"close");
  assert.equal(code,0,error);
  return JSON.parse(output);
}
class Browser {
  jar = new Map<string, string>();
  csrf = "";
  async call(path: string, method = "GET", body?: unknown, options: { origin?: string | null; csrf?: string; raw?: string } = {}) {
    const headers: Record<string,string> = {};
    if (options.origin !== null) headers.origin = options.origin ?? "http://auth-test.local";
    if (this.jar.size) headers.cookie = [...this.jar].map(([k,v])=>`${k}=${v}`).join("; ");
    if (this.csrf || options.csrf) headers["x-csrf-token"] = options.csrf ?? this.csrf;
    if (body !== undefined || options.raw !== undefined) headers["content-type"] = "application/json";
    const r = await fetch(base+path, { method, headers, body: options.raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    for (const c of r.headers.getSetCookie()) { const [k,v] = c.split(";")[0].split("="); this.jar.set(k,v); }
    const text = await r.text();
    const data = text ? JSON.parse(text) : null;
    if (data?.csrfToken) this.csrf = data.csrfToken;
    return { status: r.status, data, headers: r.headers, text };
  }
}
const manager = new Browser();
const desk = new Browser();
before(async () => {
  const role = await pool.query("SELECT current_user AS name");
  assert.equal(role.rows[0].name, "amal_app");
  const clinics = (await pool.query("SELECT clinic_id FROM operational.clinics ORDER BY clinic_id LIMIT 2")).rows;
  assert.equal(clinics.length, 2, "Requires existing prerequisite clinics");
  const hash = await bcrypt.hash(password, 4);
  const pinHash = await bcrypt.hash("0123", 4);
  for (const [role, clinic] of [["administrator", null], ["receptionist", clinics[0].clinic_id], ["receptionist", clinics[1].clinic_id]] as const) {
    const { rows: [u] } = await pool.query("INSERT INTO operational.users(email,password_hash,role,clinic_id,pin_hash) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [`${role}.${createdIds.length}.${suffix}@auth-test.example`,hash,role,clinic,role==="receptionist"?pinHash:null]);
    createdIds.push(u.id);
    if (role==="administrator") admin=u; else if (!reception) reception=u; else other=u;
  }
  doctor = (await pool.query("SELECT * FROM operational.users WHERE role='doctor' ORDER BY id LIMIT 1")).rows[0];
  assert(doctor, "Requires prerequisite doctor fixture");
});
after(async () => {
  // Audit is append-only: test identities remain as explicitly test-tagged synthetic users.
  // Clean ephemeral credentials/session state without deleting or changing demo fixtures.
  await pool.query("DELETE FROM operational.auth_sessions WHERE user_id=ANY($1::int[]) OR token_digest=ANY($2::text[])", [createdIds, []]);
  await pool.query("DELETE FROM operational.auth_pin_state WHERE user_id=ANY($1::int[])", [createdIds]);
  if (devices.length) {
    await pool.query("UPDATE operational.auth_devices SET revoked_at=now() WHERE device_id=ANY($1::int[])", [devices]);
  }
  await pool.query("UPDATE operational.users SET password_hash=$2,pin_hash=NULL WHERE id=ANY($1::int[])", [createdIds, await bcrypt.hash(randomUUID(),4)]);
  await pool.query("DELETE FROM operational.auth_throttles WHERE key_digest=ANY($1::text[])", [[digest("ip:127.0.0.1"), ...[admin,reception,other,doctor].filter(Boolean).map(u=>digest(`account:${u.email}`)), ...devices.map(d=>digest(`device:${d}`))]]);
  server.close(); await once(server,"close"); await pool.end();
});
test("real auth security integration", async t => {
  await t.test("uniform input/CSRF errors, safe anonymous identity and explicit origins", async () => {
    assert.equal((await desk.call("/api/me")).status,401);
    assert.equal((await desk.call("/api/auth/login","POST",{}, {origin:null})).status,403);
    assert.equal((await desk.call("/api/auth/login","POST",{}, {origin:"https://evil.example"})).status,403);
    const bad = await desk.call("/api/auth/login","POST",undefined,{raw:"{"});
    assert.equal(bad.status,400);
    assert.deepEqual(Object.keys(bad.data).sort(),["code","messageKey","params"]);
    assert.equal((await desk.call("/api/auth/login","POST",{email:admin.email,password,role:"admin"})).status,400);
    assert.equal((await desk.call("/api/auth/login","POST",{email:admin.email,password:"wrong"})).status,401);
  });
  await t.test("admin login, safe identity/cookies, server-side digests and provisioning CSRF", async () => {
    const r = await manager.call("/api/auth/login","POST",{email:admin.email,password});
    assert.equal(r.status,200); assert.equal(r.data.role,"admin");
    assert.equal(r.data.session.idleTimeoutSeconds,1800);
    assert(!/password|pin_hash|token_digest|amal_session/.test(r.text));
    const c = r.headers.getSetCookie().join(";");
    assert.match(c,/HttpOnly/); assert.match(c,/SameSite=Strict/);
    const stored = (await pool.query("SELECT token_digest FROM operational.auth_sessions WHERE user_id=$1",[admin.id])).rows[0];
    assert.equal(stored.token_digest,digest(manager.jar.get("amal_session")!));
    assert.equal((await manager.call("/api/auth/devices","POST",{clinicId:reception.clinic_id,label:"test.reception"},{csrf:"wrong"})).status,403);
    const d = await manager.call("/api/auth/devices","POST",{clinicId:reception.clinic_id,label:"test.reception"});
    assert.equal(d.status,201); deviceId=d.data.id; devices.push(deviceId);
    assert.deepEqual(Object.keys(d.data).sort(),["clinicId","id","label"]);
  });
  await t.test("device IDs cannot establish trust; strict PIN and clinic checks", async () => {
    const anonymousContext = await desk.call("/api/auth/device-context");
    assert.equal(anonymousContext.status,403);
    assert.equal(anonymousContext.data.messageKey,"error.deviceUntrusted");
    assert.equal((await desk.call("/api/auth/login","POST",{email:reception.email,password})).status,401);
    assert.equal((await desk.call("/api/auth/pin","POST",{email:reception.email,pin:"0123"})).status,401);
    assert.equal((await desk.call("/api/auth/pin","POST",{email:reception.email,pin:"0123",deviceId})).status,400);
    desk.jar.set("amal_device","forged");
    assert.deepEqual((await desk.call("/api/auth/device-context")).data,anonymousContext.data);
    assert.equal((await desk.call("/api/auth/pin","POST",{email:reception.email,pin:"0123"})).status,401);
    desk.jar.set("amal_device",manager.jar.get("amal_device")!);
    const context = await desk.call("/api/auth/device-context");
    assert.equal(context.status,200);
    assert.deepEqual(Object.keys(context.data),["clinic"]);
    assert.deepEqual(Object.keys(context.data.clinic).sort(),["id","name"]);
    assert.equal(context.data.clinic.id,reception.clinic_id);
    assert.equal(typeof context.data.clinic.name,"string");
    assert.equal(context.headers.get("cache-control"),"no-store");
    assert.equal((await desk.call(`/api/auth/device-context?clinicId=${other.clinic_id}`)).data.clinic.id,reception.clinic_id);
    assert.equal((await desk.call("/api/me")).status,401, "Device context must not create a session");
    assert.equal((await desk.call("/api/auth/login","POST",{email:reception.email,password})).status,401);
    assert.equal((await desk.call("/api/auth/pin","POST",{email:other.email,pin:"0123"})).status,401);
    for (const pin of [123,"123","１２３４","12345"]) assert.equal((await desk.call("/api/auth/pin","POST",{email:reception.email,pin})).status,400);
    const r = await desk.call("/api/auth/pin","POST",{email:reception.email,pin:"0123"});
    assert.equal(r.status,200); assert.equal(r.data.role,"front-desk");
    assert.equal(r.data.device.id,deviceId); assert.equal(r.data.reauth.required,false);
    assert.equal(r.data.session.idleTimeoutSeconds,null);
    assert.deepEqual(await restartProbe({kind:"session",session:desk.jar.get("amal_session"),device:desk.jar.get("amal_device")}),{id:reception.id});
    assert.equal((await desk.call("/api/auth/devices","POST",{clinicId:reception.clinic_id,label:"test.denied"})).status,403);
  });
  await t.test("concurrent fifth failure locks durably, including correct PIN; expiry recovery resets", async () => {
    await pool.query("DELETE FROM operational.auth_throttles WHERE key_digest=ANY($1::text[])", [[digest("ip:127.0.0.1"),digest(`account:${reception.email}`),digest(`device:${deviceId}`)]]);
    const failures = await Promise.all(Array.from({length:5},()=>desk.call("/api/auth/pin","POST",{email:reception.email,pin:"9999"})));
    assert.equal(failures.filter(r=>r.status===401).length,4);
    assert.equal(failures.filter(r=>r.status===423).length,1);
    assert.equal((await desk.call("/api/auth/pin","POST",{email:reception.email,pin:"0123"})).status,423);
    const state = (await pool.query("SELECT failures,locked_until FROM operational.auth_pin_state WHERE user_id=$1",[reception.id])).rows[0];
    assert.equal(state.failures,5); assert(state.locked_until > new Date());
    assert.equal((await restartProbe({kind:"pin",userId:reception.id,pin:"0123"})).status,423);
    await pool.query("UPDATE operational.auth_pin_state SET locked_until=now()-interval '1 second' WHERE user_id=$1",[reception.id]);
    assert.equal((await desk.call("/api/auth/pin","POST",{email:reception.email,pin:"0123"})).status,200);
    assert.equal((await pool.query("SELECT failures FROM operational.auth_pin_state WHERE user_id=$1",[reception.id])).rows[0].failures,0);
  });
  await t.test("rotation, reauth preserves lifetime, logout immediate and revocation", async () => {
    const old = desk.jar.get("amal_session")!;
    const before = (await desk.call("/api/me")).data.session.absoluteExpiresAt;
    assert.equal((await desk.call("/api/auth/reauth","POST",{pin:"0123"})).status,200);
    assert.notEqual(desk.jar.get("amal_session"),old);
    assert.equal((await desk.call("/api/me")).data.session.absoluteExpiresAt,before);
    const replay = new Browser(); replay.jar.set("amal_session",old); replay.jar.set("amal_device",desk.jar.get("amal_device")!);
    assert.equal((await replay.call("/api/me")).status,401);
    assert.equal((await desk.call("/api/auth/logout","POST")).status,204);
    assert.equal((await desk.call("/api/me")).status,401);
    await desk.call("/api/auth/pin","POST",{email:reception.email,pin:"0123"});
    assert.equal((await manager.call(`/api/auth/devices/${deviceId}`,"DELETE")).status,204);
    const revokedContext = await desk.call("/api/auth/device-context");
    assert.equal(revokedContext.status,403);
    assert.equal(revokedContext.data.messageKey,"error.deviceUntrusted");
    assert.equal((await desk.call("/api/me")).status,401);
    assert.equal((await desk.call("/api/auth/pin","POST",{email:reception.email,pin:"0123"})).status,401);
  });
  await t.test("doctor idle expiry and reception absolute expiry persisted in DB", async () => {
    const dr = new Browser();
    const r = await dr.call("/api/auth/login","POST",{email:doctor.email,password:"Amal-Demo-Only-2026!"});
    assert.equal(r.status,200); assert.equal(r.data.role,"doctor"); assert.equal(r.data.doctorId,doctor.doctor_id);
    await pool.query("UPDATE operational.auth_sessions SET last_seen_at=now()-interval '30 minutes' WHERE token_digest=$1",[digest(dr.jar.get("amal_session")!)]);
    assert.equal((await dr.call("/api/me")).status,401);
    // Even a valid preexisting server row cannot bypass the receptionist device requirement.
    const forged = new Browser();
    const credential = randomUUID();
    await pool.query("INSERT INTO operational.auth_sessions(token_digest,user_id,csrf_token,absolute_expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",[digest(credential),reception.id,randomUUID()]);
    forged.jar.set("amal_session",credential);
    assert.equal((await forged.call("/api/me")).status,401);
    forged.jar.set("amal_device",desk.jar.get("amal_device")!);
    assert.equal((await forged.call("/api/me")).status,401);
    // Restore test-only device trust to exercise absolute expiry on a legitimate PIN session.
    await pool.query("UPDATE operational.auth_devices SET revoked_at=NULL WHERE device_id=$1",[deviceId]);
    assert.equal((await desk.call("/api/auth/pin","POST",{email:reception.email,pin:"0123"})).status,200);
    await pool.query("UPDATE operational.auth_sessions SET absolute_expires_at=now() WHERE token_digest=$1",[digest(desk.jar.get("amal_session")!)]);
    assert.equal((await desk.call("/api/me")).status,401);
    await pool.query("UPDATE operational.auth_sessions SET last_seen_at=now()-interval '30 minutes' WHERE token_digest=$1",[digest(manager.jar.get("amal_session")!)]);
    assert.equal((await manager.call("/api/me")).status,401);
  });
  await t.test("durable IP throttle survives changing account selectors", async () => {
    await pool.query("INSERT INTO operational.auth_throttles(key_digest,attempts) VALUES($1,100) ON CONFLICT(key_digest) DO UPDATE SET attempts=100,window_started_at=now()",[digest("ip:127.0.0.1")]);
    const r = await desk.call("/api/auth/login","POST",{email:`unknown.${suffix}@example.com`,password});
    assert.equal(r.status,429); assert.equal(r.data.code,"RATE_LIMITED");
  });
  await t.test("account and device throttle dimensions cannot be bypassed with a new IP/account", async () => {
    await pool.query("DELETE FROM operational.auth_throttles WHERE key_digest=$1",[digest("ip:127.0.0.1")]);
    await pool.query("INSERT INTO operational.auth_throttles(key_digest,attempts) VALUES($1,20) ON CONFLICT(key_digest) DO UPDATE SET attempts=20,window_started_at=now()",[digest(`account:${admin.email}`)]);
    assert.equal((await manager.call("/api/auth/login","POST",{email:admin.email,password})).status,429);
    const { throttle } = await import("../src/lib/auth");
    await pool.query("INSERT INTO operational.auth_throttles(key_digest,attempts) VALUES($1,30) ON CONFLICT(key_digest) DO UPDATE SET attempts=30,window_started_at=now()",[digest(`device:${deviceId}`)]);
    await assert.rejects(throttle({ip:"different-ip"} as any,"different@example.com",deviceId),(e:any)=>e.code==="RATE_LIMITED");
  });
});
test("role/scope guards are default-deny, no admin clinical bypass, localized key coverage", () => {
  const baseAuth = { clinicId:1,doctorId:2 } as any;
  for (const role of ["admin","doctor","front-desk"] as const) {
    const auth = {...baseAuth,role};
    assert.doesNotThrow(()=>enforceScope(auth,1,2));
    assert.throws(()=>enforceScope(auth,99,2));
    if (role!=="doctor") assert.throws(()=>enforceScope(auth,1,2,true));
    let result: any;
    requireRoles(role)({auth} as any,{} as any,(e:any)=>{result=e;}); assert.equal(result,undefined);
    requireRoles(role)({auth:{...auth,role:"unknown"}} as any,{} as any,(e:any)=>{result=e;}); assert.equal(result.status,403);
  }
  assert.throws(()=>enforceScope({...baseAuth,role:"doctor"},1,99));
  let error:any;
  requireRoles("admin")({} as any,{} as any,(e:any)=>{error=e;}); assert.equal(error.status,401);
  requireFreshPin({auth:{role:"front-desk",pinVerifiedAt:new Date(0),device:{id:1}}} as any,{} as any,(e:any)=>{error=e;}); assert.equal(error.code,"REAUTH_REQUIRED");
  assert.deepEqual(Object.keys(translations.en),Object.keys(translations.ar));
});
