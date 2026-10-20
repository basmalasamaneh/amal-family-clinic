import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import pg from "pg";

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Administration tests prohibited in deployment");
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.AUTH_ALLOWED_ORIGINS = "http://admin-directory.test";
const { default: app } = await import("../src/app");
const { pool } = await import("@workspace/db");
const { digest } = await import("../src/lib/auth");
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/api`;
const clinics: number[] = [], doctors: number[] = [], users: number[] = [];
type Session = { token: string; csrf: string };
let adminSession: Session, doctorSession: Session, secondAdmin: Session, clinicAdmin: Session;
let linkedDoctor: number, doctorUser: number, originalClinic: number, secondClinic: number;
let seedBefore: unknown;

async function seedState() {
  const result: Record<string, unknown> = {};
  for (const table of ["clinics", "doctors", "patients", "appointments", "patient_visit_history", "calendar_app_export"]) {
    result[table] = (await admin.query(`SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY to_jsonb(t)::text`)).rows;
  }
  return result;
}
async function session(userId: number): Promise<Session> {
  const result = { token: randomUUID(), csrf: randomUUID() };
  await admin.query(`INSERT INTO operational.auth_sessions(token_digest,user_id,csrf_token)
    VALUES($1,$2,$3)`, [digest(result.token), userId, result.csrf]);
  return result;
}
async function request(path: string, method = "GET", body?: unknown, auth: Session | null = adminSession, csrf = true) {
  const res = await fetch(`${base}${path}`, {
    method, headers: {
      ...(auth ? { cookie: `amal_session=${auth.token}` } : {}),
      ...(method !== "GET" ? { origin: "http://admin-directory.test", "content-type": "application/json",
        ...(csrf && auth ? { "x-csrf-token": auth.csrf } : {}) } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
}
async function createClinic(name = "Administration test") {
  const response = await request("/clinics", "POST", { name, city: "Test city", bookingMethod: "phone" });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  clinics.push(response.body.id);
  return response.body;
}
async function createDoctor(clinicId: number, email = `${randomUUID()}@directory.test`) {
  const response = await request("/doctors", "POST", { name: "Test doctor", clinicId, specialty: "General", email });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  doctors.push(response.body.id);
  return response.body;
}

before(async () => {
  await admin.connect();
  const { rows: [ready] } = await admin.query(`SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='operational' AND table_name='users' AND column_name='disabled_at') AS ready`);
  assert(ready.ready, "apply development admin migration 0011 before tests");
  seedBefore = await seedState();
  await admin.query("BEGIN");
  for (let n = 0; n < 2; n++) {
    const { rows: [row] } = await admin.query(`INSERT INTO operational.clinics(clinic_name,city,booking_method)
      VALUES('Admin directory fixture','Test','phone') RETURNING clinic_id`);
    clinics.push(row.clinic_id);
  }
  [originalClinic, secondClinic] = clinics;
  const { rows: [doc] } = await admin.query(`INSERT INTO operational.doctors(doctor_name,clinic_id,specialty,email)
    VALUES('Linked directory doctor',$1,'General',$2) RETURNING doctor_id`, [originalClinic, `${randomUUID()}@directory.test`]);
  linkedDoctor = doc.doctor_id;
  doctors.push(linkedDoctor);
  for (const role of ["administrator", "administrator", "doctor"]) {
    const { rows: [user] } = await admin.query(`INSERT INTO operational.users(email,password_hash,role,clinic_id,doctor_id)
      VALUES($1,'not-a-login-password',$2,$3,$4) RETURNING id`, [
      `${randomUUID()}@directory.test`, role, role === "doctor" ? originalClinic : null, role === "doctor" ? linkedDoctor : null]);
    users.push(user.id);
    if (role === "doctor") {
      doctorUser = user.id;
      await admin.query("UPDATE operational.doctors SET user_id=$1 WHERE doctor_id=$2", [user.id, linkedDoctor]);
      doctorSession = await session(user.id);
    } else if (!adminSession) adminSession = await session(user.id);
    else secondAdmin = await session(user.id);
  }
  const { rows: [limited] } = await admin.query(`INSERT INTO operational.users(email,password_hash,role,clinic_id)
    VALUES($1,'not-a-login-password','administrator',$2) RETURNING id`, [`${randomUUID()}@directory.test`, originalClinic]);
  users.push(limited.id);
  clinicAdmin = await session(limited.id);
  await admin.query("COMMIT");
});
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  try {
    await admin.query("ROLLBACK");
    assert.deepEqual(await seedState(), seedBefore, "all six immutable source tables are unchanged");
    await admin.query("BEGIN");
    await admin.query("SET LOCAL ROLE amal_demo_reset");
    await admin.query("DELETE FROM operational.audit_log WHERE user_id=ANY($1::int[])", [users]);
    await admin.query("RESET ROLE");
    await admin.query("DELETE FROM operational.auth_sessions WHERE user_id=ANY($1::int[])", [users]);
    await admin.query("DELETE FROM operational.users WHERE id=ANY($1::int[])", [users]);
    await admin.query("DELETE FROM operational.doctors WHERE doctor_id=ANY($1::int[])", [doctors]);
    await admin.query("DELETE FROM operational.clinics WHERE clinic_id=ANY($1::int[])", [clinics]);
    await admin.query("COMMIT");
  } finally { await admin.end(); await pool.end(); }
});

test("administration auth, CSRF, and existing directory scope remain separate", async () => {
  for (const path of ["/admin/clinics", "/admin/doctors", `/admin/clinics/${originalClinic}`, `/admin/doctors/${linkedDoctor}`]) {
    assert.equal((await request(path, "GET", undefined, null)).status, 401);
    assert.equal((await request(path, "GET", undefined, doctorSession)).status, 403);
  }
  assert.equal((await request("/clinics", "POST", {}, doctorSession)).status, 403);
  assert.equal((await request("/doctors", "POST", {}, adminSession, false)).status, 403);
  assert.equal((await request("/clinics", "GET", undefined, adminSession)).status, 403);
  const scoped = await request(`/clinics/${originalClinic}`, "GET", undefined, doctorSession);
  assert.equal(scoped.status, 200);
  assert.deepEqual(Object.keys(scoped.body).sort(), ["adoption", "id", "mode", "name", "timezone"]);
  assert.equal(scoped.body.adoption.capabilities.canManage, false);
  assert.equal((await request(`/clinics/${secondClinic}`, "GET", undefined, doctorSession)).status, 403);
  assert.equal((await request("/doctors?clinicId=" + secondClinic, "GET", undefined, doctorSession)).status, 403);
});

test("admin audit denies other roles, scopes events and excludes sensitive payloads with keyset pagination", async () => {
  assert.equal((await request("/admin/audit", "GET", undefined, null)).status, 401);
  assert.equal((await request("/admin/audit", "GET", undefined, doctorSession)).status, 403);
  assert.equal((await request("/audit", "GET", undefined, adminSession)).status, 403);
  const actor = users[0]!;
  const marker = "PRIVATE-query-clinical-password-token";
  const ids: number[] = [];
  for (const [action, clinicId, targetId] of [
    ["admin.user.updated", originalClinic, actor],
    ["auth.password.denied", originalClinic, actor],
    ["admin.user.updated", secondClinic, actor],
    ["admin.user.updated", originalClinic, marker],
    ["network.lookup", originalClinic, actor],
    [`unknown.${marker}`, originalClinic, actor],
    ["auth.login", null, actor],
  ] as const) {
    const { rows: [row] } = await admin.query(`INSERT INTO operational.audit_log(user_id,clinic_id,action,detail,at)
      VALUES($1,$2,$3,$4::jsonb,'2020-01-01T12:00:00Z') RETURNING id`,
    [actor, clinicId, action, JSON.stringify({ targetId, query: marker, diagnosis: marker, token: marker, password: marker, outcome: marker })]);
    ids.push(row.id);
  }
  const patient = (await admin.query("SELECT patient_id FROM operational.patients LIMIT 1")).rows[0].patient_id;
  await admin.query(`INSERT INTO operational.audit_log(user_id,clinic_id,action,patient_id,detail,at)
    VALUES($1,$2,'admin.user.updated',$3,'{}','2020-01-01T12:00:00Z')`, [actor, originalClinic, patient]);
  const filter = `actorId=${actor}&from=2020-01-01T00:00:00Z&to=2020-01-02T00:00:00Z`;
  const result = await request(`/admin/audit?${filter}`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.items.map((r: any) => r.id), [ids[6], ids[3], ids[2], ids[1], ids[0]]);
  assert(!JSON.stringify(result.body).includes(marker));
  for (const row of result.body.items) {
    assert.deepEqual(Object.keys(row).sort(), ["action", "actorId", "clinicId", "eventTime", "id", "outcome", "targetId", "targetType"]);
  }
  assert.equal(result.body.items.find((r: any) => r.id === ids[3]).targetId, null);
  assert.equal(result.body.items.find((r: any) => r.id === ids[1]).outcome, "denied");
  const first = await request(`/admin/audit?${filter}&limit=2`);
  assert.equal(first.body.nextBeforeId, ids[3]);
  // A newer event must not shift or duplicate the next page.
  await admin.query(`INSERT INTO operational.audit_log(user_id,clinic_id,action,at)
    VALUES($1,$2,'auth.login','2020-01-01T13:00:00Z')`, [actor, originalClinic]);
  const next = await request(`/admin/audit?${filter}&limit=2&beforeId=${first.body.nextBeforeId}`);
  assert.deepEqual(next.body.items.map((r: any) => r.id), [ids[2], ids[1]]);
  const last = await request(`/admin/audit?${filter}&limit=2&beforeId=${next.body.nextBeforeId}`);
  assert.deepEqual(last.body.items.map((r: any) => r.id), [ids[0]]);
  assert.equal(last.body.nextBeforeId, null);
  const scoped = await request(`/admin/audit?${filter}`, "GET", undefined, clinicAdmin);
  assert(scoped.body.items.every((r: any) => r.clinicId === originalClinic));
  assert(!scoped.body.items.some((r: any) => [ids[2], ids[6]].includes(r.id)));
  assert.equal((await request(`/admin/audit?clinicId=${secondClinic}`, "GET", undefined, clinicAdmin)).status, 403);
  const denied = await request(`/admin/audit?${filter}&outcome=denied&clinicId=${originalClinic}&action=auth.password.denied`);
  assert.deepEqual(denied.body.items.map((r: any) => r.id), [ids[1]]);
  assert.deepEqual((await request("/admin/audit?actorId=2147483647")).body, { items: [], nextBeforeId: null });
  for (const bad of ["limit=101", "beforeId=-1", "patientId=1", "action=network.lookup", "query=secret",
    "actorId=1&actorId=2", "from=bad", "from=2020-01-02T00:00:00Z&to=2020-01-01T00:00:00Z"]) {
    assert.equal((await request(`/admin/audit?${bad}`)).status, 400, bad);
  }
  // Valid front-desk session must still be rejected by the admin-only route.
  const { rows: [reception] } = await admin.query(`INSERT INTO operational.users(email,password_hash,role,clinic_id)
    VALUES($1,'unused','receptionist',$2) RETURNING id`, [`${randomUUID()}@audit.test`, originalClinic]);
  users.push(reception.id);
  const { rows: [device] } = await admin.query("INSERT INTO operational.devices(clinic_id,label) VALUES($1,'audit-test') RETURNING id", [originalClinic]);
  const deviceToken = randomUUID(), token = randomUUID();
  try {
    await admin.query("INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)", [device.id, digest(deviceToken)]);
    await admin.query(`INSERT INTO operational.auth_sessions(token_digest,user_id,device_id,csrf_token,absolute_expires_at)
      VALUES($1,$2,$3,'unused',now()+interval '1 hour')`, [digest(token), reception.id, device.id]);
    const response = await fetch(`${base}/admin/audit`, { headers: { cookie: `amal_session=${token}; amal_device=${deviceToken}` } });
    assert.equal(response.status, 403);
  } finally {
    await admin.query("DELETE FROM operational.auth_sessions WHERE user_id=$1", [reception.id]);
    await admin.query("DELETE FROM operational.auth_devices WHERE device_id=$1", [device.id]);
    await admin.query("DELETE FROM operational.devices WHERE id=$1", [device.id]);
  }
  await admin.query("UPDATE operational.auth_sessions SET revoked_at=now() WHERE token_digest=$1", [digest(secondAdmin.token)]);
  assert.equal((await request("/admin/audit", "GET", undefined, secondAdmin)).status, 401);
  await admin.query("UPDATE operational.auth_sessions SET revoked_at=NULL WHERE token_digest=$1", [digest(secondAdmin.token)]);
});

test("Trial clinic settings roundtrip preserves lifecycle; mode bypass, IANA zone, partial and overnight validation", async () => {
  const clinic = await createClinic();
  assert.equal(clinic.mode, "lite");
  assert.equal(clinic.adoption.state, "trial");
  assert.equal(clinic.slotMinutes, 30);
  assert.equal(clinic.timezone, "Asia/Hebron");
  const settings = { timezone: "America/New_York", openTime: "09:15", closeTime: "18:45",
    slotMinutes: 15, workingDays: [0, 2, 4], name: "Updated clinic", city: "Other city", bookingMethod: "online" };
  const updated = await request(`/clinics/${clinic.id}`, "PATCH", settings);
  assert.equal(updated.status, 200);
  for (const [key, value] of Object.entries(settings)) assert.deepEqual(updated.body[key], value);
  assert.deepEqual(updated.body.adoption, clinic.adoption, "settings cannot mutate lifecycle state or timestamps");
  assert.deepEqual((await request(`/admin/clinics/${clinic.id}`)).body, updated.body);
  for (const patch of [{}, { slotMinutes: 0 }, { slotMinutes: 1441 }, { slotMinutes: 2.5 },
    { workingDays: [] }, { workingDays: [1, 1] }, { workingDays: [7] }, { workingDays: [null] },
    { timezone: "+03:00" }, { timezone: "Not/AZone" }, { mode: "network" }, { mode: "full" }, { mode: "lite" },
    { adoption: { state: "full" } }, { adoptionState: "full" }, { membershipStatus: "active" }, { openTime: "24:00" },
    { closeTime: "08:00" }, { openTime: "19:00" }, { openTime: "18:45" }, { name: " " },
    { joinedAt: "2026-01-01" }, { userId: users[0] }]) {
    assert.equal((await request(`/clinics/${clinic.id}`, "PATCH", patch)).status, 400, JSON.stringify(patch));
  }
  const partial = await request(`/clinics/${clinic.id}`, "PATCH", { slotMinutes: 1440 });
  assert.equal(partial.status, 200);
  assert.equal(partial.body.openTime, settings.openTime, "generated PATCH defaults must not overwrite omitted hours");
  assert.equal(partial.body.closeTime, settings.closeTime);
  const nameOnly = await request(`/clinics/${clinic.id}`, "PATCH", { name: "Name only" });
  assert.equal(nameOnly.status, 200);
  assert.equal(nameOnly.body.slotMinutes, 1440, "generated PATCH defaults must not overwrite omitted slot duration");
  assert.equal(nameOnly.body.openTime, settings.openTime);
  assert.equal((await request("/clinics", "POST", { name: "Overnight", city: "Test", bookingMethod: "phone",
    openTime: "20:00", closeTime: "06:00" })).status, 400);
  assert.equal((await request("/clinics/2147483647", "PATCH", { name: "Missing" })).status, 404);
});

test("clinic-limited administrators cannot widen read or write scope", async () => {
  const listed = await request("/admin/clinics", "GET", undefined, clinicAdmin);
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.items.map((item: { id: number }) => item.id), [originalClinic]);
  assert.equal((await request(`/admin/clinics/${secondClinic}`, "GET", undefined, clinicAdmin)).status, 403);
  assert.equal((await request(`/admin/doctors?clinicId=${secondClinic}`, "GET", undefined, clinicAdmin)).status, 403);
  assert.equal((await request(`/clinics/${secondClinic}`, "PATCH", { name: "Wrong scope" }, clinicAdmin)).status, 403);
  assert.equal((await request("/clinics", "POST", { name: "Wrong scope", city: "Test", bookingMethod: "phone" }, clinicAdmin)).status, 403);
  assert.equal((await request(`/doctors/${linkedDoctor}`, "PATCH", { clinicId: secondClinic }, clinicAdmin)).status, 403);
  assert.equal((await request("/doctors", "POST", { name: "Wrong scope", clinicId: secondClinic,
    specialty: "General", email: `${randomUUID()}@directory.test` }, clinicAdmin)).status, 403);
});

test("stable bounded pagination rejects malformed, actor-crossed and resource/filter-crossed cursors", async () => {
  const first = await request("/admin/clinics?limit=1");
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, 1);
  assert.equal(typeof first.body.nextCursor, "string");
  const second = await request(`/admin/clinics?limit=1&cursor=${first.body.nextCursor}`);
  assert(second.body.items[0].id > first.body.items[0].id);
  assert.equal((await request(`/admin/clinics?cursor=${first.body.nextCursor}`, "GET", undefined, secondAdmin)).status, 400);
  assert.equal((await request(`/admin/doctors?cursor=${first.body.nextCursor}`)).status, 400);
  await createDoctor(originalClinic);
  const docs = await request(`/admin/doctors?clinicId=${originalClinic}&limit=1`);
  assert(docs.body.nextCursor);
  assert.equal((await request(`/admin/doctors?clinicId=${secondClinic}&cursor=${docs.body.nextCursor}`)).status, 400);
  for (const query of ["limit=0", "limit=101", "limit=1.2", "limit=1&limit=2", "cursor=garbage",
    "cursor=", "sort=name", "limit=Infinity", "cursor=" + "x".repeat(513)]) {
    assert.equal((await request(`/admin/clinics?${query}`)).status, 400, query);
  }
  for (const invalid of ["0", "-1", "2147483648", "1.2", "NaN"]) {
    assert.equal((await request(`/admin/clinics/${invalid}`)).status, 400);
    assert.equal((await request(`/admin/doctors/${invalid}`)).status, 400);
  }
});

test("doctor directory writes validate linkage and email without provisioning login", async () => {
  const countBefore = (await admin.query("SELECT count(*)::int AS n FROM operational.users")).rows[0].n;
  const created = await createDoctor(originalClinic);
  assert.equal(created.userId, null);
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM operational.users")).rows[0].n, countBefore);
  assert.deepEqual((await request(`/admin/doctors/${created.id}`)).body, created);
  const moved = await request(`/doctors/${created.id}`, "PATCH", { clinicId: secondClinic, specialty: "Cardiology" });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.clinicId, secondClinic);
  for (const patch of [{}, { email: "bad" }, { name: "" }, { clinicId: 2147483647 }, { clinicId: "1" },
    { userId: doctorUser }, { password: "unintended-login" }, { specialty: " " }]) {
    assert.equal((await request(`/doctors/${created.id}`, "PATCH", patch)).status, 400, JSON.stringify(patch));
  }
  const duplicate = await request("/doctors", "POST", { name: "Other", clinicId: originalClinic,
    specialty: "General", email: created.email.toUpperCase() });
  assert.equal(duplicate.status, 409);
  const collision = (await admin.query("SELECT email FROM operational.users WHERE id=$1", [users[0]])).rows[0].email;
  assert.equal((await request(`/doctors/${created.id}`, "PATCH", { email: collision })).status, 409);
  assert.equal((await request(`/doctors/${linkedDoctor}`, "PATCH", { clinicId: secondClinic })).status, 409);
  assert.equal((await request("/doctors/2147483647", "PATCH", { name: "Missing" })).status, 404);
});

test("linked email synchronization revokes sessions without changing account authority or credentials", async () => {
  const before = (await admin.query("SELECT * FROM operational.users WHERE id=$1", [doctorUser])).rows[0];
  const email = `${randomUUID()}@directory.test`;
  const updated = await request(`/doctors/${linkedDoctor}`, "PATCH", { email });
  assert.equal(updated.status, 200);
  const after = (await admin.query("SELECT * FROM operational.users WHERE id=$1", [doctorUser])).rows[0];
  assert.equal(after.email, email);
  for (const key of ["role", "clinic_id", "doctor_id", "password_hash", "pin_hash", "disabled_at"]) {
    assert.deepEqual(after[key], before[key], key);
  }
  assert.equal(after.auth_version, before.auth_version + 1);
  assert.equal((await request(`/clinics/${originalClinic}`, "GET", undefined, doctorSession)).status, 401);
});

test("concurrent case-insensitive doctor duplicates serialize to one commit and one safe audit event", async () => {
  const email = `${randomUUID()}@directory.test`;
  const payload = { name: "Race doctor", clinicId: originalClinic, specialty: "General", email };
  const results = await Promise.all([request("/doctors", "POST", payload),
    request("/doctors", "POST", { ...payload, email: email.toUpperCase() })]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  const created = results.find(result => result.status === 201)!.body;
  doctors.push(created.id);
  const { rows } = await admin.query(`SELECT action,detail FROM operational.audit_log
    WHERE user_id=$1 AND action='admin.doctor.created' AND detail->>'targetId'=$2`, [users[0], String(created.id)]);
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0].detail).sort(), ["fields", "targetId"]);
  assert(!JSON.stringify(rows).includes(email));
  assert(!JSON.stringify(rows).includes(payload.name));
});

test("mutation authority is rechecked after common advisory lock waits", async () => {
  const blocker = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await blocker.connect();
  let pending: Promise<Awaited<ReturnType<typeof request>>> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock(31030,1)");
    pending = request(`/clinics/${originalClinic}`, "PATCH", { name: "Must not commit" }, secondAdmin);
    // Observe the database lock wait rather than depending only on a sleep.
    let waiting = false;
    for (let n = 0; n < 100; n++) {
      const { rows: [row] } = await blocker.query(`SELECT EXISTS(SELECT 1 FROM pg_locks
        WHERE locktype='advisory' AND classid=31030 AND objid=1 AND NOT granted) AS waiting`);
      if (row.waiting) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert(waiting, "directory mutation must acquire shared administration lock");
    await blocker.query("UPDATE operational.users SET disabled_at=now() WHERE id=$1", [users[1]]);
    await blocker.query("COMMIT");
    assert.equal((await pending).status, 401);
    assert.notEqual((await request(`/admin/clinics/${originalClinic}`)).body.name, "Must not commit");
  } finally {
    await blocker.query("ROLLBACK");
    await blocker.query("UPDATE operational.users SET disabled_at=NULL WHERE id=$1", [users[1]]);
    await blocker.end();
    if (pending) await pending;
  }
});

test("audit insertion failure rolls back clinic mutation", async () => {
  const blocker = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await blocker.connect();
  try {
    const before = (await request(`/admin/clinics/${originalClinic}`)).body;
    // A test-only trigger targets this test's actor; never change immutable audit rows.
    await blocker.query(`CREATE FUNCTION operational.admin_directory_test_audit_failure() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.user_id=${users[0]} AND NEW.action IN ('admin.clinic.updated','admin.doctor.updated') THEN
          RAISE EXCEPTION 'test audit unavailable';
        END IF;
        RETURN NEW;
      END $$`);
    await blocker.query(`CREATE TRIGGER admin_directory_test_audit_failure BEFORE INSERT ON operational.audit_log
      FOR EACH ROW EXECUTE FUNCTION operational.admin_directory_test_audit_failure()`);
    const response = await request(`/clinics/${originalClinic}`, "PATCH", { name: "Rolled back" });
    assert.equal(response.status, 500);
    assert.deepEqual((await request(`/admin/clinics/${originalClinic}`)).body, before);
    assert.equal(response.body.code, "INTERNAL");
    assert(!JSON.stringify(response.body).includes("test audit unavailable"));
    const linkedBefore = (await admin.query("SELECT * FROM operational.users WHERE id=$1", [doctorUser])).rows[0];
    const doctorBefore = (await request(`/admin/doctors/${linkedDoctor}`)).body;
    const activeSession = await session(doctorUser);
    const changed = await request(`/doctors/${linkedDoctor}`, "PATCH", { email: `${randomUUID()}@directory.test` });
    assert.equal(changed.status, 500);
    assert.deepEqual((await admin.query("SELECT * FROM operational.users WHERE id=$1", [doctorUser])).rows[0], linkedBefore);
    assert.deepEqual((await request(`/admin/doctors/${linkedDoctor}`)).body, doctorBefore);
    assert.equal((await admin.query("SELECT revoked_at FROM operational.auth_sessions WHERE token_digest=$1",
      [digest(activeSession.token)])).rows[0].revoked_at, null);
  } finally {
    await blocker.query("DROP TRIGGER IF EXISTS admin_directory_test_audit_failure ON operational.audit_log");
    await blocker.query("DROP FUNCTION IF EXISTS operational.admin_directory_test_audit_failure()");
    await blocker.end();
  }
});
