import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import pg from "pg";

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("Adoption tests prohibited in deployment");
}
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.AUTH_ALLOWED_ORIGINS = "http://adoption.test";
const { default: app } = await import("../src/app");
const { pool } = await import("@workspace/db");
const { digest } = await import("../src/lib/auth");
const { lifecycleTransaction } = await import("../src/adoption/service");
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/api`;
type Session = { token: string; csrf: string; device?: string };
type Actor = { id: number; auth: Session; doctorId: number | null };
type Fixture = { clinicId: number; manager: Actor };
const clinics: number[] = [], doctors: number[] = [], users: number[] = [], devices: number[] = [], patients: number[] = [];
let administrator: Session;
let seedBefore: unknown;
let ready = false;

async function seedState() {
  const result: Record<string, unknown> = {};
  for (const table of ["clinics", "doctors", "patients", "appointments", "patient_visit_history", "calendar_app_export"]) {
    result[table] = (await admin.query(`SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY to_jsonb(t)::text`)).rows;
  }
  return result;
}
async function session(userId: number, deviceId: number | null = null): Promise<Session> {
  const auth: Session = { token: randomUUID(), csrf: randomUUID() };
  if (deviceId !== null) {
    auth.device = randomUUID();
    await admin.query("INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)", [deviceId, digest(auth.device)]);
  }
  await admin.query(`INSERT INTO operational.auth_sessions(token_digest,user_id,csrf_token,device_id,absolute_expires_at)
    VALUES($1,$2,$3,$4,CASE WHEN $4::integer IS NULL THEN NULL ELSE now()+interval '1 hour' END)`,
  [digest(auth.token), userId, auth.csrf, deviceId]);
  return auth;
}
async function request(path: string, method = "GET", body?: unknown, auth: Session | null = administrator, csrf = true) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(auth ? { cookie: `amal_session=${auth.token}${auth.device ? `; amal_device=${auth.device}` : ""}` } : {}),
      ...(method !== "GET" ? { origin: "http://adoption.test", "content-type": "application/json",
        ...(csrf && auth ? { "x-csrf-token": auth.csrf } : {}) } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: JSON.parse(text), text };
}
async function actor(clinicId: number, role: "doctor" | "receptionist" | "administrator" = "doctor"): Promise<Actor> {
  await admin.query("BEGIN");
  try {
    let doctorId: number | null = null;
    const email = `${randomUUID()}@adoption.test`;
    if (role === "doctor") {
      const { rows: [row] } = await admin.query(`INSERT INTO operational.doctors(clinic_id,doctor_name,specialty,email)
        VALUES($1,'Adoption doctor','General',$2) RETURNING doctor_id`, [clinicId, email]);
      doctorId = row.doctor_id;
      doctors.push(doctorId!);
    }
    const { rows: [user] } = await admin.query(`INSERT INTO operational.users(email,password_hash,role,clinic_id,doctor_id)
      VALUES($1,'unused-adoption-password',$2,$3,$4) RETURNING id`, [email, role, clinicId, doctorId]);
    users.push(user.id);
    if (doctorId !== null) await admin.query("UPDATE operational.doctors SET user_id=$1 WHERE doctor_id=$2", [user.id, doctorId]);
    let deviceId: number | null = null;
    if (role === "receptionist") {
      const { rows: [device] } = await admin.query("INSERT INTO operational.devices(clinic_id,label) VALUES($1,'adoption-test') RETURNING id", [clinicId]);
      devices.push(device.id);
      deviceId = device.id;
    }
    const auth = await session(user.id, deviceId);
    await admin.query("COMMIT");
    return { id: user.id, doctorId, auth };
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
}
async function fixture(): Promise<Fixture> {
  const created = await request("/clinics", "POST", { name: "عيادة اختبار التبني", city: "Test", bookingMethod: "phone" });
  assert.equal(created.status, 201, created.text);
  const clinicId = created.body.id;
  clinics.push(clinicId);
  const manager = await actor(clinicId);
  const initial = await request(`/clinics/${clinicId}/adoption`, "GET", undefined, manager.auth);
  assert.equal(initial.status, 200, initial.text);
  assert.equal(initial.body.state, "trial");
  assert.equal(initial.body.membershipStatus, "active");
  assert.equal(initial.body.capabilities.networkSharing, false);
  assert.equal(initial.body.capabilities.canManage, false, "creating a clinic/doctor must not auto-delegate management");
  assert.deepEqual(initial.body.allowedTransitions, []);
  await admin.query("INSERT INTO operational.clinic_managers(clinic_id,user_id) VALUES($1,$2)", [clinicId, manager.id]);
  return { clinicId, manager };
}
const path = (f: Fixture, suffix = "adoption") => `/clinics/${f.clinicId}/${suffix}`;
const getState = (f: Fixture) => request(path(f), "GET", undefined, f.manager.auth);
const change = (f: Fixture, state: string) => request(path(f), "POST", { state }, f.manager.auth);
const leave = (f: Fixture) => request(path(f, "leave"), "POST", { confirm: true }, f.manager.auth);
const exportClinic = (f: Fixture) => request(path(f, "export"), "POST", {}, f.manager.auth);
async function events(f: Fixture) {
  return (await admin.query(`SELECT action,detail FROM operational.audit_log WHERE clinic_id=$1
    AND action IN ('clinic.adoption.changed','clinic.left','clinic.export.requested') ORDER BY id`, [f.clinicId])).rows;
}
async function stored(f: Fixture) {
  return (await admin.query("SELECT * FROM operational.clinics WHERE clinic_id=$1", [f.clinicId])).rows[0];
}
async function lifecycleWaits(client: pg.Client, count: number, key = 160005): Promise<number[]> {
  for (let n = 0; n < 200; n++) {
    const { rows } = await client.query(`SELECT pid FROM pg_locks
      WHERE locktype='advisory' AND classid=0 AND objid=$1 AND NOT granted ORDER BY pid`, [key]);
    if (rows.length >= count) return rows.map(row => row.pid);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`expected ${count} observed lifecycle lock waiters`);
}
async function assertReleased(pids: number[]) {
  const { rows: [row] } = await admin.query(`SELECT count(*)::integer AS n FROM pg_locks
    WHERE pid=ANY($1::integer[]) AND locktype='advisory' AND classid=0 AND objid IN (160005,761910)`, [pids]);
  assert.equal(row.n, 0, "pooled export connection must not retain lifecycle session locks");
}
async function auditFailure(f: Fixture, actions: string[], work: () => Promise<void>) {
  // Scope a temporary failure trigger to this fixture only; immutable rows are never modified.
  const name = `adoption_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE FUNCTION operational.${name}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.clinic_id=${f.clinicId} AND NEW.action=ANY(ARRAY[${actions.map(a => `'${a}'`).join(",")}])
      THEN RAISE EXCEPTION 'adoption test audit unavailable'; END IF; RETURN NEW; END $$`);
  try {
    await admin.query(`CREATE TRIGGER ${name} BEFORE INSERT ON operational.audit_log
      FOR EACH ROW EXECUTE FUNCTION operational.${name}()`);
    await work();
  } finally {
    await admin.query(`DROP TRIGGER IF EXISTS ${name} ON operational.audit_log`);
    await admin.query(`DROP FUNCTION IF EXISTS operational.${name}()`);
  }
}

before(async () => {
  await admin.connect();
  const { rows: [migration] } = await admin.query("SELECT to_regclass('operational.clinic_managers') IS NOT NULL AS ready");
  assert(migration.ready, "apply migration 0014_adoption.sql before adoption API tests");
  seedBefore = await seedState();
  const { rows: [user] } = await admin.query(`INSERT INTO operational.users(email,password_hash,role)
    VALUES($1,'unused-adoption-password','administrator') RETURNING id`, [`${randomUUID()}@adoption.test`]);
  users.push(user.id);
  administrator = await session(user.id);
  ready = true;
});
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  try {
    await admin.query("ROLLBACK");
    if (ready) {
      assert.deepEqual(await seedState(), seedBefore, "all six immutable source tables remain unchanged");
      await admin.query("BEGIN");
      await admin.query("SET LOCAL ROLE amal_demo_reset");
      await admin.query("DELETE FROM operational.audit_log WHERE user_id=ANY($1::int[]) OR clinic_id=ANY($2::int[])", [users, clinics]);
      await admin.query("RESET ROLE");
      await admin.query("DELETE FROM operational.auth_sessions WHERE user_id=ANY($1::int[])", [users]);
      await admin.query("DELETE FROM operational.auth_devices WHERE device_id=ANY($1::int[])", [devices]);
      await admin.query("DELETE FROM operational.devices WHERE id=ANY($1::int[])", [devices]);
      await admin.query("DELETE FROM operational.appointments WHERE clinic_id=ANY($1::int[])", [clinics]);
      await admin.query("DELETE FROM operational.patient_visit_history WHERE clinic_id=ANY($1::int[])", [clinics]);
      await admin.query("DELETE FROM operational.patient_doctor_access WHERE patient_id=ANY($1::int[])", [patients]);
      await admin.query("DELETE FROM operational.patient_clinic_access WHERE patient_id=ANY($1::int[])", [patients]);
      await admin.query("DELETE FROM operational.patients WHERE patient_id=ANY($1::int[])", [patients]);
      await admin.query("DELETE FROM operational.clinic_managers WHERE clinic_id=ANY($1::int[])", [clinics]);
      // Fixture-only cleanup releases the non-deferrable left_by reference.
      await admin.query(`UPDATE operational.clinics SET membership_status='active',left_at=NULL,left_by=NULL
        WHERE clinic_id=ANY($1::int[])`, [clinics]);
      await admin.query("SET CONSTRAINTS ALL DEFERRED");
      await admin.query("DELETE FROM operational.users WHERE id=ANY($1::int[])", [users]);
      await admin.query("DELETE FROM operational.doctors WHERE doctor_id=ANY($1::int[])", [doctors]);
      await admin.query("DELETE FROM operational.clinics WHERE clinic_id=ANY($1::int[])", [clinics]);
      await admin.query("COMMIT");
    }
  } finally { await admin.end(); await pool.end(); }
});

test("Trial is explicit, management is doctor-only delegated authority, and status reads do not grant it", async () => {
  const f = await fixture();
  const doctor = await actor(f.clinicId);
  const reception = await actor(f.clinicId, "receptionist");
  const limitedAdmin = await actor(f.clinicId, "administrator");
  const managed = await getState(f);
  assert(managed.body.trialStartedAt);
  assert.equal(managed.body.fullStartedAt, null);
  assert.equal(managed.body.liteStartedAt, null);
  assert.deepEqual(managed.body.allowedTransitions, ["lite", "full"]);
  assert.deepEqual(managed.body.capabilities, {
    canManage: true, canExport: true, canLeave: true, localBooking: true, networkSharing: false,
  });
  // Even an explicitly inserted non-doctor delegation is insufficient.
  for (const user of [reception, limitedAdmin]) {
    await admin.query("INSERT INTO operational.clinic_managers(clinic_id,user_id) VALUES($1,$2)", [f.clinicId, user.id]);
  }
  for (const auth of [doctor.auth, reception.auth, limitedAdmin.auth, administrator]) {
    for (const [suffix, body] of [["adoption", { state: "full" }], ["leave", { confirm: true }], ["export", {}]] as const) {
      assert.equal((await request(path(f, suffix), "POST", body, auth)).status, 403);
    }
  }
  for (const auth of [doctor.auth, reception.auth]) {
    const read = await request(path(f), "GET", undefined, auth);
    assert.equal(read.status, 200);
    assert.equal(read.body.capabilities.canManage, false);
    assert.equal(read.body.capabilities.canExport, false);
  }
  assert.deepEqual(await events(f), []);
});

test("authentication, cross-clinic IDOR, CSRF, revoked sessions and forged lifecycle fields fail closed", async () => {
  const f = await fixture(), foreign = await fixture();
  const before = await stored(f);
  for (const [suffix, body] of [["adoption", { state: "full" }], ["leave", { confirm: true }], ["export", {}]] as const) {
    assert.equal((await request(path(f, suffix), "POST", body, null)).status, 401);
    assert.equal((await request(path(f, suffix), "POST", body, foreign.manager.auth)).status, 403);
    const missingCsrf = await request(path(f, suffix), "POST", body, f.manager.auth, false);
    assert.equal(missingCsrf.status, 403);
    assert.equal(missingCsrf.body.code, "CSRF");
    assert.equal((await request(path(f, suffix), "POST", body, { ...f.manager.auth, csrf: "forged" })).status, 403);
  }
  assert.equal((await request(path(f), "GET", undefined, null)).status, 401);
  assert.equal((await request(path(f), "GET", undefined, foreign.manager.auth)).status, 403);
  for (const body of [{}, { state: "trial" }, { state: "left" }, { state: "full", clinicId: foreign.clinicId },
    { state: "full", userId: f.manager.id }, { state: "full", membershipStatus: "active" },
    { state: "full", canManage: true }, { state: "full", changedAt: "2026-01-01" }]) {
    assert.equal((await request(path(f), "POST", body, f.manager.auth)).status, 400, JSON.stringify(body));
  }
  for (const body of [{}, { confirm: false }, { confirm: "true" }, { confirm: true, leftBy: f.manager.id }]) {
    assert.equal((await request(path(f, "leave"), "POST", body, f.manager.auth)).status, 400);
  }
  assert.equal((await request(path(f, "export"), "POST", { clinicId: foreign.clinicId }, f.manager.auth)).status, 400);
  for (const invalid of ["0", "-1", "2147483648", "1.2", "NaN"]) {
    assert.equal((await request(`/clinics/${invalid}/adoption`, "GET", undefined, f.manager.auth)).status, 400);
  }
  await admin.query("UPDATE operational.auth_sessions SET revoked_at=now() WHERE token_digest=$1", [digest(f.manager.auth.token)]);
  assert.equal((await getState(f)).status, 401);
  assert.equal((await change(f, "full")).status, 401);
  assert.deepEqual(await stored(f), before);
  assert.deepEqual(await events(f), []);
});

test("Trial to Lite to Full and back preserves timestamp history; retries create no audit/timestamp changes", async () => {
  const f = await fixture();
  const trial = (await getState(f)).body;
  for (const target of ["lite", "full", "lite", "full"]) {
    const changed = await change(f, target);
    assert.equal(changed.status, 200, changed.text);
    assert.equal(changed.body.state, target);
    assert.equal(changed.body.membershipStatus, "active");
    assert.equal(changed.body.capabilities.networkSharing, target === "full");
    assert.equal(changed.body.trialStartedAt, trial.trialStartedAt);
    assert(changed.body[target === "lite" ? "liteStartedAt" : "fullStartedAt"]);
    assert.deepEqual(changed.body.allowedTransitions, [target === "lite" ? "full" : "lite"]);
    const count = (await events(f)).length;
    const retry = await change(f, target);
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.body, changed.body);
    assert.equal((await events(f)).length, count);
  }
  const audit = await events(f);
  assert.deepEqual(audit.map(event => event.detail), [
    { from: "trial", to: "lite", membershipStatus: "active" },
    { from: "lite", to: "full", membershipStatus: "active" },
    { from: "full", to: "lite", membershipStatus: "active" },
    { from: "lite", to: "full", membershipStatus: "active" },
  ]);
});

test("concurrent identical transitions and leave retries serialize to one event each", async () => {
  const f = await fixture();
  const results = await Promise.all([change(f, "full"), change(f, "full"), change(f, "full")]);
  assert.deepEqual(results.map(result => result.status), [200, 200, 200]);
  assert.deepEqual(results[0].body, results[1].body);
  assert.deepEqual(results[1].body, results[2].body);
  assert.equal((await events(f)).length, 1);
  const leaving = await Promise.all([leave(f), leave(f), leave(f)]);
  assert.deepEqual(leaving.map(result => result.status), [200, 200, 200]);
  assert.deepEqual(leaving[0].body, leaving[1].body);
  assert.deepEqual(leaving[1].body, leaving[2].body);
  assert.deepEqual((await events(f)).map(event => event.action), ["clinic.adoption.changed", "clinic.left"]);
});

test("racing leave and Full can never rejoin or leave network sharing enabled", async () => {
  const f = await fixture();
  const [left, full] = await Promise.all([leave(f), change(f, "full")]);
  assert.equal(left.status, 200);
  assert([200, 409].includes(full.status), full.text);
  const final = (await getState(f)).body;
  assert.equal(final.membershipStatus, "left");
  assert.equal(final.state, "lite");
  assert.equal(final.capabilities.networkSharing, false);
  assert.equal((await events(f)).filter(event => event.action === "clinic.left").length, 1);
  assert.equal((await change(f, "full")).body.code, "CLINIC_LEFT");
});

test("management delegation revoked while a mutation waits is rechecked before committing", async () => {
  const f = await fixture();
  const blocker = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await blocker.connect();
  let pending: ReturnType<typeof change> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock(160005)");
    pending = change(f, "full");
    let waiting = false;
    for (let n = 0; n < 200; n++) {
      const { rows: [row] } = await blocker.query(`SELECT EXISTS(SELECT 1 FROM pg_locks
        WHERE locktype='advisory' AND classid=0 AND objid=160005 AND NOT granted) AS waiting`);
      if (row.waiting) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert(waiting, "lifecycle write must wait on the shared privacy lock");
    await blocker.query("DELETE FROM operational.clinic_managers WHERE clinic_id=$1 AND user_id=$2", [f.clinicId, f.manager.id]);
    await blocker.query("COMMIT");
    assert.equal((await pending).status, 403);
    assert.equal((await stored(f)).adoption_state, "trial");
    assert.deepEqual(await events(f), []);
  } finally {
    await blocker.query("ROLLBACK");
    await blocker.end();
    if (pending) await pending;
  }
});

test("waiting export establishes its snapshot after delegation revocation commits, then releases its session locks", async () => {
  const f = await fixture();
  const blocker = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await blocker.connect();
  let pending: ReturnType<typeof exportClinic> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock(160005)");
    pending = exportClinic(f);
    const pids = await lifecycleWaits(blocker, 1);
    // The trusted delegation trigger takes the same locks reentrantly here.
    await blocker.query("DELETE FROM operational.clinic_managers WHERE clinic_id=$1 AND user_id=$2",
      [f.clinicId, f.manager.id]);
    await blocker.query("COMMIT");
    const denied = await pending;
    assert.equal(denied.status, 403, denied.text);
    assert.equal(denied.headers.get("content-disposition"), null);
    assert(!denied.text.includes("datasets"));
    assert.deepEqual(await events(f), []);
    await assertReleased(pids);
  } finally {
    await blocker.query("ROLLBACK");
    await blocker.end();
    if (pending) await pending;
  }
});

test("export queued behind a leave takes a post-leave snapshot, not the state from before its lock wait", async () => {
  const f = await fixture();
  assert.equal((await change(f, "full")).status, 200);
  const blocker = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await blocker.connect();
  let leaving: ReturnType<typeof leave> | undefined;
  let exporting: ReturnType<typeof exportClinic> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock(160005)");
    leaving = leave(f);
    await lifecycleWaits(blocker, 1);
    exporting = exportClinic(f);
    const pids = await lifecycleWaits(blocker, 2);
    await blocker.query("COMMIT");
    const left = await leaving;
    assert.equal(left.status, 200, left.text);
    const exported = await exporting;
    assert.equal(exported.status, 200, exported.text);
    assert.equal(exported.body.datasets.clinicSettings[0].network_mode, "lite");
    assert.equal((await getState(f)).body.membershipStatus, "left");
    assert.deepEqual((await events(f)).map(event => event.action), [
      "clinic.adoption.changed", "clinic.left", "clinic.export.requested",
    ]);
    await assertReleased(pids);
  } finally {
    await blocker.query("ROLLBACK");
    await blocker.end();
    if (leaving) await leaving;
    if (exporting) await exporting;
  }
});

test("snapshot transactions release both session locks after callback errors and commits", async () => {
  for (const shouldFail of [true, false]) {
    let pid = 0;
    const work = lifecycleTransaction(async client => {
      pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const { rows: [settings] } = await client.query("SELECT current_setting('transaction_isolation') AS isolation");
      assert.equal(settings.isolation, "repeatable read");
      if (shouldFail) throw new Error("snapshot callback failure");
      return "committed";
    }, true);
    if (shouldFail) await assert.rejects(work, /snapshot callback failure/);
    else assert.equal(await work, "committed");
    assert(pid > 0);
    await assertReleased([pid]);
  }
});

test("cancellation during second snapshot lock acquisition releases the first lock and rolls back safely", async () => {
  const blocker = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await blocker.connect();
  let pending: Promise<unknown> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock(761910)");
    pending = lifecycleTransaction(async () => assert.fail("cancelled export must not run its callback"), true);
    // Attach rejection handling before cancelling the backend query.
    const rejected = assert.rejects(pending, (error: unknown) =>
      typeof error === "object" && error !== null && "code" in error && error.code === "LIFECYCLE_RETRY");
    const pids = await lifecycleWaits(blocker, 1, 761910);
    assert.equal(pids.length, 1);
    // Cancel as the runtime login that owns the pending query, not as the
    // restricted fixture login (which must not receive pg_signal_backend).
    await pool.query("SELECT pg_cancel_backend($1)", [pids[0]]);
    await rejected;
    await assertReleased(pids);
  } finally {
    await blocker.query("ROLLBACK");
    await blocker.end();
    if (pending) await pending.catch(() => undefined);
  }
  assert.equal(await lifecycleTransaction(async () => "pool remains usable", true), "pool remains usable");
});

test("audit failure atomically rolls back both adoption and leave without exposing internal errors", async () => {
  const f = await fixture();
  const before = await stored(f);
  await auditFailure(f, ["clinic.adoption.changed", "clinic.left"], async () => {
    for (const response of [await change(f, "full"), await leave(f)]) {
      assert.equal(response.status, 500);
      assert.equal(response.body.code, "INTERNAL");
      assert(!response.text.includes("adoption test audit unavailable"));
      assert.deepEqual(await stored(f), before);
      assert.deepEqual(await events(f), []);
    }
  });
  assert.equal((await change(f, "full")).status, 200, "retry succeeds after audit recovers");
});

test("download delivers scoped UTF-8 clinical records before and after leave, with no deletion or rejoin", async () => {
  const f = await fixture(), foreign = await fixture();
  const { rows: [patient] } = await admin.query(`INSERT INTO operational.patients(patient_name,phone,dob,name_normalized,created_clinic_id)
    VALUES('مريض محلي','0599000000','1990-01-02','مريض محلي',$1) RETURNING patient_id`, [f.clinicId]);
  patients.push(patient.patient_id);
  await admin.query("INSERT INTO operational.patient_clinic_access(patient_id,clinic_id) VALUES($1,$2)", [patient.patient_id, f.clinicId]);
  await admin.query(`INSERT INTO operational.appointments(clinic_id,doctor_id,patient_id,scheduled_at,booking_method,status)
    VALUES($1,$2,$3,'2036-06-10T09:00:00Z','phone','booked')`, [f.clinicId, f.manager.doctorId, patient.patient_id]);
  for (const [clinicId, doctorId, note] of [
    [f.clinicId, f.manager.doctorId, "ملاحظة محلية"],
    [foreign.clinicId, foreign.manager.doctorId, "FOREIGN_PRIVATE_NOTE"],
  ]) {
    await admin.query(`INSERT INTO operational.patient_visit_history(clinic_id,doctor_id,patient_id,visit_date,diagnosis_notes)
      VALUES($1,$2,$3,'2026-06-10',$4)`, [clinicId, doctorId, patient.patient_id, note]);
  }
  assert.equal((await change(f, "full")).status, 200);
  const exported = await exportClinic(f);
  assert.equal(exported.status, 200, exported.text);
  assert.match(exported.headers.get("content-type")!, /application\/json; charset=utf-8/i);
  assert.equal(exported.headers.get("cache-control"), "private, no-store");
  assert.equal(exported.headers.get("content-disposition"), `attachment; filename="clinic-${f.clinicId}-export.json"`);
  assert.equal(exported.body.manifest.format, "amal-clinic-export");
  assert.equal(exported.body.manifest.schemaVersion, 1);
  assert.equal(exported.body.manifest.clinicId, f.clinicId);
  assert.equal(exported.body.manifest.encoding, "UTF-8");
  assert.equal(exported.body.manifest.empty, false);
  assert.equal(exported.body.datasets.patients[0].patient_name, "مريض محلي");
  assert.equal(exported.body.datasets.visits[0].diagnosis_notes, "ملاحظة محلية");
  assert.equal(exported.body.datasets.appointments.length, 1);
  assert(!exported.text.includes("FOREIGN_PRIVATE_NOTE"));
  for (const description of exported.body.manifest.includedDatasets) {
    assert.equal(description.count, exported.body.datasets[description.dataset].length);
  }
  const localBefore = {
    appointments: (await admin.query("SELECT * FROM operational.appointments WHERE clinic_id=$1", [f.clinicId])).rows,
    visits: (await admin.query("SELECT * FROM operational.patient_visit_history WHERE clinic_id=$1", [f.clinicId])).rows,
    patients: (await admin.query("SELECT * FROM operational.patients WHERE patient_id=$1", [patient.patient_id])).rows,
  };
  const left = await leave(f);
  assert.equal(left.status, 200, left.text);
  assert.equal(left.body.state, "lite");
  assert.equal(left.body.membershipStatus, "left");
  assert(left.body.leftAt);
  assert.equal(left.body.leftBy, f.manager.id);
  assert.deepEqual(left.body.allowedTransitions, []);
  assert.deepEqual(left.body.capabilities, {
    canManage: true, canExport: true, canLeave: false, localBooking: true, networkSharing: false,
  });
  assert.deepEqual((await leave(f)).body, left.body);
  for (const state of ["full", "lite"]) {
    const rejoin = await change(f, state);
    assert.equal(rejoin.status, 409);
    assert.equal(rejoin.body.code, "CLINIC_LEFT");
  }
  const after = await exportClinic(f);
  assert.equal(after.status, 200, after.text);
  for (const dataset of ["patients", "doctors", "appointments", "visits", "consents", "importBatches", "importProvenance"]) {
    assert.deepEqual(after.body.datasets[dataset], exported.body.datasets[dataset], dataset);
  }
  assert.equal(after.body.datasets.clinicSettings[0].network_mode, "lite");
  assert.deepEqual({
    appointments: (await admin.query("SELECT * FROM operational.appointments WHERE clinic_id=$1", [f.clinicId])).rows,
    visits: (await admin.query("SELECT * FROM operational.patient_visit_history WHERE clinic_id=$1", [f.clinicId])).rows,
    patients: (await admin.query("SELECT * FROM operational.patients WHERE patient_id=$1", [patient.patient_id])).rows,
  }, localBefore);
  const audit = await events(f);
  assert.deepEqual(audit.map(event => event.action), [
    "clinic.adoption.changed", "clinic.export.requested", "clinic.left", "clinic.export.requested",
  ]);
  assert.deepEqual(audit[1].detail, { format: "amal-clinic-export", schemaVersion: 1 });
  assert(!JSON.stringify(audit).includes("مريض"));
});

test("no-clinical-data export has explicit empty datasets and does not change adoption or membership", async () => {
  const f = await fixture();
  const before = await stored(f);
  const exported = await exportClinic(f);
  assert.equal(exported.status, 200, exported.text);
  for (const dataset of ["patients", "appointments", "visits", "consents", "importBatches", "importProvenance"]) {
    assert.deepEqual(exported.body.datasets[dataset], []);
  }
  // A delegated doctor necessarily has a directory row. Settings-only is the
  // documented manifest.empty definition; absence of clinical data is explicit.
  assert.equal(exported.body.manifest.empty, false);
  assert.equal(exported.body.manifest.rowCount, 2);
  assert.deepEqual(await stored(f), before);
  assert.deepEqual(await events(f), [{
    action: "clinic.export.requested", detail: { format: "amal-clinic-export", schemaVersion: 1 },
  }]);
});

test("failed export audit delivers no attachment or clinical payload and never prevents an independent leave", async () => {
  const f = await fixture();
  const before = await stored(f);
  await auditFailure(f, ["clinic.export.requested"], async () => {
    const failed = await exportClinic(f);
    assert.equal(failed.status, 500);
    assert.equal(failed.body.code, "INTERNAL");
    assert.equal(failed.headers.get("content-disposition"), null);
    assert(!failed.text.includes("datasets"));
    assert(!failed.text.includes("adoption test audit unavailable"));
    assert.deepEqual(await stored(f), before);
    assert.deepEqual(await events(f), []);
    const left = await leave(f);
    assert.equal(left.status, 200);
    assert.equal(left.body.membershipStatus, "left");
    assert.equal((await exportClinic(f)).status, 500);
    assert.equal((await getState(f)).body.membershipStatus, "left");
    assert.deepEqual((await events(f)).map(event => event.action), ["clinic.left"]);
  });
  const recovered = await exportClinic(f);
  assert.equal(recovered.status, 200, recovered.text);
  assert.equal((await getState(f)).body.membershipStatus, "left");
});
