import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import pg from "pg";
assert(process.env.NODE_ENV !== "production" && process.env.REPLIT_DEPLOYMENT !== "1");
assert(process.env.DATABASE_URL, "Disposable fixture database is required");
assert(/^\/amal_privacy_test_[a-z0-9_]+$/.test(new URL(process.env.DATABASE_URL).pathname),
  "Only the explicitly owned disposable audit database is allowed");
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.AMAL_DEVELOPER_TOOLS = "0";
process.env.AUTH_ALLOWED_ORIGINS = "https://clinical-test.local";
const { default: app } = await import("../src/app");
const { pool } = await import("@workspace/db");
const { digest } = await import("../src/lib/auth");
const { clearOperational } = await import("../../../scripts/src/demo-reset");
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/api`;
type Actor = { id: number; clinic: number; doctor: number | null; session: string; csrf: string; device?: string };
let own: Actor, other: Actor, remote: Actor, desk: Actor, manager: Actor;
let patientId: number, unlinkedId: number, appointmentId: number, foreignAppointmentId: number;
let originalSeeds: unknown;
const name = `Clinical ${randomUUID()}`;
const path = () => `/doctor/patients/${patientId}`;
const input = () => ({ clientOpId: randomUUID(), seenAt: new Date(Date.now() - 60000).toISOString(), note: "Opaque original text; no inferred diagnosis." });
async function snapshot() {
  const result: Record<string, unknown> = {};
  for (const table of ["clinics", "doctors", "patients", "appointments", "patient_visit_history", "calendar_app_export"]) {
    result[table] = (await admin.query(`SELECT count(*)::integer n,
      md5(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text)) hash FROM public.${table} t`)).rows[0];
  }
  return result;
}
async function actor(role: string, clinic: number): Promise<Actor> {
  await admin.query("BEGIN");
  const doctor = role === "doctor" ? (await admin.query(`INSERT INTO operational.doctors
    (doctor_name,clinic_id,specialty,email) VALUES($1,$2,'test',$3) RETURNING doctor_id`,
  [name, clinic, `${randomUUID()}@clinical.test`])).rows[0].doctor_id as number : null;
  const { rows: [user] } = await admin.query(`INSERT INTO operational.users
    (email,password_hash,role,clinic_id,doctor_id) VALUES($1,'unused',$2,$3,$4) RETURNING id`,
  [`${randomUUID()}@clinical.test`, role, clinic, doctor]);
  if (doctor) await admin.query("UPDATE operational.doctors SET user_id=$1 WHERE doctor_id=$2", [user.id, doctor]);
  const result: Actor = { id: user.id as number, clinic, doctor, session: randomUUID(), csrf: randomUUID() };
  let deviceId: number | null = null;
  if (role === "receptionist") {
    deviceId = (await admin.query("INSERT INTO operational.devices(clinic_id,label) VALUES($1,'clinical-test') RETURNING id", [clinic])).rows[0].id;
    result.device = randomUUID();
    await admin.query("INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)", [deviceId, digest(result.device)]);
  }
  await admin.query(`INSERT INTO operational.auth_sessions
    (token_digest,user_id,csrf_token,device_id,absolute_expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+interval '8 hours')`,
  [digest(result.session), result.id, result.csrf, deviceId]);
  await admin.query("COMMIT");
  return result;
}
async function request(a: Actor | null, route: string, method = "GET", body?: unknown, csrf = true) {
  const response = await fetch(base + route, {
    method, headers: { origin: process.env.AUTH_ALLOWED_ORIGINS!, "content-type": "application/json",
      ...(a ? { cookie: `amal_session=${a.session}${a.device ? `; amal_device=${a.device}` : ""}`, ...(csrf ? { "x-csrf-token": a.csrf } : {}) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() as any, cache: response.headers.get("cache-control") };
}
before(async () => {
  await admin.connect();
  const { rows: [target] } = await admin.query(`SELECT current_database() AS name,
    shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()`);
  assert.equal(target.marker, "amal:disposable:privacy-tests:v1");
  assert.match(target.name, /^amal_privacy_test_/);
  originalSeeds = await snapshot();
  const local = (await admin.query(`INSERT INTO operational.clinics
    (clinic_name,city,booking_method,network_mode) VALUES($1,'test','phone','full') RETURNING clinic_id`, [name])).rows[0].clinic_id;
  const foreign = (await admin.query(`INSERT INTO operational.clinics
    (clinic_name,city,booking_method,network_mode) VALUES($1,'test','phone','full') RETURNING clinic_id`, [name])).rows[0].clinic_id;
  own = await actor("doctor", local); other = await actor("doctor", local);
  remote = await actor("doctor", foreign); desk = await actor("receptionist", local); manager = await actor("administrator", local);
  const patients = await admin.query(`INSERT INTO operational.patients
    (patient_name,name_normalized,phone,dob,created_clinic_id) VALUES
    ($1,lower($1),'0590000000','1980-01-01',$2),($1,lower($1),'0590000001','1980-01-01',$2) RETURNING patient_id`, [name, local]);
  [patientId, unlinkedId] = patients.rows.map(row => row.patient_id);
  await admin.query(`INSERT INTO operational.patient_doctor_access(patient_id,clinic_id,doctor_id) VALUES($1,$2,$3)`, [patientId, local, own.doctor]);
  const appointments = await admin.query(`INSERT INTO operational.appointments
    (clinic_id,doctor_id,patient_id,scheduled_at,booking_method,status) VALUES
    ($1,$2,$3,clock_timestamp(),'phone','booked'),($4,$5,$3,clock_timestamp(),'phone','booked') RETURNING appointment_id`,
  [local, own.doctor, patientId, foreign, remote.doctor]);
  [appointmentId, foreignAppointmentId] = appointments.rows.map(row => row.appointment_id);
});
after(async () => {
  assert.deepEqual(await snapshot(), originalSeeds);
  await pool.end();
  await admin.end();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test("fresh trusted ownership only; no new-patient/appointment/consent ownership; roles and CSRF", async () => {
  const access = await request(own, `${path()}/visit-authoring`);
  assert.equal(access.status, 200);
  assert.deepEqual(access.data, { canCreate: true, clinicId: own.clinic, doctorId: own.doctor });
  assert.match(access.cache!, /no-store/);
  for (const a of [other, remote]) {
    const denied = await request(a, `${path()}/visit-authoring`);
    assert.equal(denied.status, 200); assert.equal(denied.data.canCreate, false);
    assert.deepEqual(Object.keys(denied.data).sort(), ["canCreate", "clinicId", "doctorId"]);
    assert.equal((await request(a, `${path()}/visits`, "POST", input())).status, 404);
  }
  assert.equal((await request(own, `/doctor/patients/${unlinkedId}/visit-authoring`)).data.canCreate, false);
  assert.equal((await request(own, `/doctor/patients/${unlinkedId}/visits`, "POST", input())).status, 404);
  for (const a of [desk, manager, null]) {
    assert.ok([401, 403].includes((await request(a, `${path()}/visits`, "POST", input())).status));
    assert.ok([401, 403].includes((await request(a, `${path()}/visit-authoring`)).status));
  }
  assert.equal((await request(own, `${path()}/visits`, "POST", input(), false)).status, 403);
});
test("create exact-once concurrent durable replay, mismatch conflicts, immutable originals and addenda", async () => {
  const body = { ...input(), appointmentId };
  const beforeAppointment = (await admin.query("SELECT * FROM operational.appointments WHERE appointment_id=$1", [appointmentId])).rows[0];
  const replies = await Promise.all(Array.from({ length: 8 }, () => request(own, `${path()}/visits`, "POST", body)));
  assert.ok(replies.every(result => result.status === 201));
  for (const reply of replies) assert.deepEqual(reply.data, replies[0].data);
  const { visitId } = replies[0].data;
  assert.equal((await admin.query("SELECT count(*)::int n FROM operational.patient_visit_history WHERE patient_id=$1 AND diagnosis_notes=$2", [patientId, body.note])).rows[0].n, 1);
  assert.deepEqual((await admin.query("SELECT * FROM operational.appointments WHERE appointment_id=$1", [appointmentId])).rows[0], beforeAppointment);
  assert.equal((await request(own, `${path()}/visits`, "POST", { ...body, note: "different payload" })).status, 409);
  const addition = { clientOpId: randomUUID(), note: "Correction appended; original retained." };
  const route = `${path()}/visits/${visitId}/addenda`;
  const addenda = await Promise.all(Array.from({ length: 8 }, () => request(own, route, "POST", addition)));
  assert.ok(addenda.every(result => result.status === 201));
  for (const reply of addenda) assert.deepEqual(reply.data, addenda[0].data);
  assert.equal((await admin.query("SELECT count(*)::int n FROM operational.visit_addenda WHERE visit_id=$1", [visitId])).rows[0].n, 1);
  assert.equal((await request(own, route, "POST", { ...addition, note: "changed" })).status, 409);
  assert.equal((await request(other, route, "POST", { ...addition, clientOpId: randomUUID() })).status, 404);
  assert.equal((await request(remote, route, "POST", { ...addition, clientOpId: randomUUID() })).status, 404);
  await admin.query("INSERT INTO operational.patient_doctor_access(patient_id,clinic_id,doctor_id) VALUES($1,$2,$3)", [patientId, other.clinic, other.doctor]);
  assert.equal((await request(other, `${path()}/visit-authoring`)).data.canCreate, true);
  assert.equal((await request(other, route, "POST", { clientOpId: randomUUID(), note: "Not the original author" })).status, 404);
  const otherCard = await request(other, path());
  assert.equal(otherCard.data.visits.find((v: any) => v.visitId === visitId).canAddendum, false);
  await admin.query("DELETE FROM operational.patient_doctor_access WHERE patient_id=$1 AND doctor_id=$2", [patientId, other.doctor]);
  assert.equal((await admin.query("SELECT diagnosis_notes FROM operational.patient_visit_history WHERE visit_id=$1", [visitId])).rows[0].diagnosis_notes, body.note);
  await assert.rejects(pool.query("UPDATE operational.patient_visit_history SET diagnosis_notes='changed' WHERE visit_id=$1", [visitId]), (error: any) => error.code === "42501");
  await assert.rejects(pool.query("DELETE FROM operational.visit_addenda WHERE visit_id=$1", [visitId]), (error: any) => error.code === "42501");
  await assert.rejects(pool.query("UPDATE operational.visit_addenda SET note='changed' WHERE visit_id=$1", [visitId]), (error: any) => error.code === "42501");
  const local = (await request(own, path())).data.visits.find((visit: any) => visit.visitId === visitId);
  assert.equal(local.complaint, body.note); assert.equal(local.canAddendum, true);
  assert.equal(local.seenAt, body.seenAt);
  assert.equal(local.addenda[0].note, addition.note);
  assert.equal(local.addenda[0].doctorId, own.doctor);
  assert.equal((await admin.query("SELECT count(*)::int n FROM operational.visit_alerts WHERE visit_id=$1", [visitId])).rows[0].n, 0);
  const audit = (await admin.query("SELECT detail FROM operational.audit_log WHERE action LIKE 'clinical.%' AND patient_id=$1", [patientId])).rows;
  assert.ok(audit.length >= 2);
  assert.ok(!JSON.stringify(audit).includes(body.note)); assert.ok(!JSON.stringify(audit).includes(addition.note));
  // Reauthorization precedes even an otherwise valid durable replay.
  await admin.query("DELETE FROM operational.patient_doctor_access WHERE patient_id=$1", [patientId]);
  assert.equal((await request(own, `${path()}/visits`, "POST", body)).status, 404);
  assert.equal((await request(own, route, "POST", addition)).status, 404);
  await admin.query("INSERT INTO operational.patient_doctor_access(patient_id,clinic_id,doctor_id) VALUES($1,$2,$3)", [patientId, own.clinic, own.doctor]);
});
test("strict inputs, foreign appointment and future/invalid real UTC times", async () => {
  for (const overrides of [
    { note: " \n " }, { note: "x".repeat(10001) }, { seenAt: "2025-02-30T12:00:00Z" },
    { seenAt: "2025-01-01T12:00:00+02:00" }, { seenAt: new Date(Date.now() + 3600000).toISOString() },
    { appointmentId: foreignAppointmentId }, { appointmentId: -1 }, { doctorId: remote.doctor }, { clinicId: remote.clinic },
  ]) assert.equal((await request(own, `${path()}/visits`, "POST", { ...input(), ...overrides })).status, 400);
  const created = await request(own, `${path()}/visits`, "POST", input());
  for (const note of ["", "   ", "x".repeat(10001)]) assert.equal((await request(own,
    `${path()}/visits/${created.data.visitId}/addenda`, "POST", { clientOpId: randomUUID(), note })).status, 400);
});
test("clinical consent shares addenda; basic and withdrawal omit protected fields; no shared write", async () => {
  async function consent(level: string) {
    return (await admin.query(`INSERT INTO operational.patient_consents
      (patient_id,level,given_by,recorded_by_user,recorded_clinic_id,evidence)
      VALUES($1,$2,'patient',$3,$4,'verbal') RETURNING id`, [patientId, level, own.id, own.clinic])).rows[0].id;
  }
  await consent("clinical");
  let result = await request(remote, `/network/lookup?q=${encodeURIComponent(name)}`);
  assert.equal(result.status, 200);
  let visits = result.data.items.find((p: any) => p.id === patientId).visits;
  assert.ok(visits.some((v: any) => v.addenda.length));
  assert.ok(visits.every((v: any) => v.canAddendum === false));
  assert.equal((await request(remote, `${path()}/visit-authoring`)).data.canCreate, false);
  await consent("basic");
  result = await request(remote, `/network/lookup?q=${encodeURIComponent(name)}`);
  visits = result.data.items.find((p: any) => p.id === patientId).visits;
  for (const visit of visits) for (const field of ["visitId", "canAddendum", "addenda", "complaint", "alerts", "keyAlerts"]) assert.equal(Object.hasOwn(visit, field), false);
  const id = await consent("clinical");
  await admin.query("UPDATE operational.patient_consents SET withdrawn_at=clock_timestamp() WHERE id=$1", [id]);
  result = await request(remote, `/network/lookup?q=${encodeURIComponent(name)}`);
  assert.equal(result.data.items.some((p: any) => p.id === patientId), false);
  assert.equal((await request(own, `${path()}/visit-authoring`)).data.canCreate, true);
});
test("expired/revoked sessions cannot author or replay", async () => {
  const body = input();
  assert.equal((await request(own, `${path()}/visits`, "POST", body)).status, 201);
  await admin.query("UPDATE operational.auth_sessions SET last_seen_at=clock_timestamp()-interval '31 minutes' WHERE token_digest=$1", [digest(own.session)]);
  assert.equal((await request(own, `${path()}/visits`, "POST", body)).status, 401);
  assert.equal((await request(own, `${path()}/visit-authoring`)).status, 401);
  await admin.query("UPDATE operational.auth_sessions SET last_seen_at=clock_timestamp(),revoked_at=clock_timestamp() WHERE token_digest=$1", [digest(own.session)]);
  assert.equal((await request(own, `${path()}/visits`, "POST", body)).status, 401);
});
test("a queued authoring request revalidates session after cross-instance clinical locks", async () => {
  await admin.query("UPDATE operational.auth_sessions SET revoked_at=NULL,last_seen_at=clock_timestamp() WHERE token_digest=$1", [digest(own.session)]);
  const blocker = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await blocker.connect();
  await blocker.query("BEGIN");
  await blocker.query("SELECT pg_advisory_xact_lock(160005)");
  const pending = request(own, `${path()}/visits`, "POST", input());
  try {
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      waiting = !!(await admin.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=160005 AND NOT granted")).rowCount;
      if (waiting) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(waiting, true);
    await admin.query("UPDATE operational.auth_sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1", [digest(own.session)]);
    await blocker.query("COMMIT");
    assert.equal((await pending).status, 401);
  } finally { await blocker.query("ROLLBACK"); await blocker.end(); }
});
test("privileged disposable reset orders receipt/addendum/visit/appointment children and never changes seeds", async () => {
  await admin.query("BEGIN");
  try {
    await clearOperational(admin);
    for (const table of ["clinical_write_operations", "visit_addenda", "patient_visit_history", "appointments"])
      assert.equal((await admin.query(`SELECT count(*)::int n FROM operational.${table}`)).rows[0].n, 0);
    assert.deepEqual(await snapshot(), originalSeeds);
  } finally { await admin.query("ROLLBACK"); }
  assert.ok((await admin.query("SELECT count(*)::int n FROM operational.visit_addenda")).rows[0].n > 0);
});
