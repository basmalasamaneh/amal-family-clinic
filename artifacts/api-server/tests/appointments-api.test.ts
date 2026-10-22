import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import pg from "pg";

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Appointment tests prohibited in deployment");
process.env.AUTH_ALLOWED_ORIGINS = "http://appointments-test.local";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
const { default: app } = await import("../src/app");
const { pool } = await import("@workspace/db");
const { digest } = await import("../src/lib/auth");
const { createAppointment } = await import("../src/appointments/service");
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/api`;
const marker = randomUUID();
let seedBefore: unknown;
async function seedSnapshot() {
  const hashes: Record<string, unknown> = {};
  for (const table of ["clinics", "doctors", "patients", "appointments", "patient_visit_history", "calendar_app_export"]) {
    hashes[table] = (await admin.query(`SELECT count(*)::integer AS count,
      md5(string_agg(row_to_json(t)::text, E'\\n' ORDER BY row_to_json(t)::text)) AS hash FROM public.${table} t`)).rows[0];
  }
  return hashes;
}
const clinicIds: number[] = [], doctorIds: number[] = [], patientIds: number[] = [], userIds: number[] = [], deviceIds: number[] = [];
type Actor = { id: number; clinicId: number; doctorId: number | null; session: string; csrf: string; device?: string };
let doctor: Actor, otherDoctor: Actor, remoteDoctor: Actor, desk: Actor, desk2: Actor, manager: Actor;
const farDay = "2091-06-04";
const interval = (hour: number) => ({ startsAt: `${farDay}T${String(hour).padStart(2, "0")}:00:00.000Z`, endsAt: `${farDay}T${String(hour).padStart(2, "0")}:30:00.000Z` });
const booking = (actor: Actor, patientId: number, hour: number) => ({
  clientOpId: randomUUID(), clinicId: actor.clinicId, doctorId: actor.doctorId!, patientId, ...interval(hour), source: "phone",
});
async function request(actor: Actor | null, path: string, method = "GET", body?: unknown, csrf = true) {
  const response = await fetch(`${base}${path}`, {
    method, headers: {
      origin: process.env.AUTH_ALLOWED_ORIGINS!, ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(actor ? { cookie: `amal_session=${actor.session}${actor.device ? `; amal_device=${actor.device}` : ""}`, ...(csrf ? { "x-csrf-token": actor.csrf } : {}) } : {}),
    }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}
async function makeActor(role: "doctor" | "receptionist" | "administrator", clinicId: number, doctorId: number | null = null): Promise<Actor> {
  const { rows: [user] } = await admin.query(`INSERT INTO operational.users(email,password_hash,role,clinic_id,doctor_id)
    VALUES($1,'test-unused',$2,$3,$4) RETURNING id`, [`${randomUUID()}@appointments.test`, role, clinicId, doctorId]);
  userIds.push(user.id);
  if (doctorId) await admin.query("UPDATE operational.doctors SET user_id=$1 WHERE doctor_id=$2", [user.id, doctorId]);
  const actor: Actor = { id: user.id, clinicId, doctorId, session: randomUUID(), csrf: randomUUID() };
  let deviceId: number | null = null;
  if (role === "receptionist") {
    const { rows: [device] } = await admin.query("INSERT INTO operational.devices(clinic_id,label) VALUES($1,'appointmentTest') RETURNING id", [clinicId]);
    deviceId = device.id;
    deviceIds.push(device.id);
    actor.device = randomUUID();
    await admin.query("INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)", [deviceId, digest(actor.device)]);
  }
  await admin.query(`INSERT INTO operational.auth_sessions(token_digest,user_id,device_id,csrf_token,absolute_expires_at,pin_verified_at)
    VALUES($1,$2,$3,$4,now()+interval '8 hours',now())`, [digest(actor.session), actor.id, deviceId, actor.csrf]);
  return actor;
}
before(async () => {
  await admin.connect();
  seedBefore = await seedSnapshot();
  // Entire fixture creation is committed atomically; no source or demo rows are borrowed or modified.
  await admin.query("BEGIN");
  for (let index = 0; index < 2; index++) {
    const { rows: [clinic] } = await admin.query(`INSERT INTO operational.clinics(clinic_name,city,booking_method,working_days,open_time,close_time,timezone)
      VALUES($1,'test','phone',ARRAY[0,1,2,3,4,5,6],'00:00','23:59','Asia/Hebron') RETURNING clinic_id`, [`appointment-test-${marker}-${index}`]);
    clinicIds.push(clinic.clinic_id);
  }
  for (const clinicId of [clinicIds[0]!, clinicIds[0]!, clinicIds[1]!]) {
    const { rows: [row] } = await admin.query("INSERT INTO operational.doctors(doctor_name,clinic_id,specialty,email) VALUES('appointment-test',$1,'test',$2) RETURNING doctor_id", [clinicId, `${randomUUID()}@appointments.test`]);
    doctorIds.push(row.doctor_id);
  }
  doctor = await makeActor("doctor", clinicIds[0]!, doctorIds[0]!);
  otherDoctor = await makeActor("doctor", clinicIds[0]!, doctorIds[1]!);
  remoteDoctor = await makeActor("doctor", clinicIds[1]!, doctorIds[2]!);
  desk = await makeActor("receptionist", clinicIds[0]!);
  desk2 = await makeActor("receptionist", clinicIds[0]!);
  manager = await makeActor("administrator", clinicIds[0]!);
  for (let index = 0; index < 24; index++) {
    const { rows: [patient] } = await admin.query(`INSERT INTO operational.patients(patient_name,phone,dob,name_normalized)
      VALUES($1,'test-phone','1980-01-01',$1) RETURNING patient_id`, [`appointment-test-${marker}-${index}`]);
    patientIds.push(patient.patient_id);
    // Explicit trusted fixture grants, independent of any booking. Cross-clinic
    // scheduling tests exercise authorized shared patients, not guessed IDs.
    for (const clinicId of clinicIds) await admin.query(
      "INSERT INTO operational.patient_clinic_access(patient_id,clinic_id) VALUES($1,$2)",
      [patient.patient_id, clinicId]);
  }
  await admin.query("COMMIT");
});
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  // Targeted fixture cleanup only. Append-only audit deletion uses the existing dedicated
  // cleanup role, never disables its trigger and never invokes demo reset/prerequisite tasks.
  try {
    await admin.query("ROLLBACK");
    await admin.query("BEGIN");
    await admin.query("DELETE FROM operational.sync_resolution_history WHERE actor_id=ANY($1::integer[])", [userIds]);
    await admin.query(`DELETE FROM operational.sync_device_operations WHERE client_op_id IN
      (SELECT client_op_id FROM operational.appointment_operations WHERE actor_id=ANY($1::integer[]))`, [userIds]);
    await admin.query("DELETE FROM operational.sync_conflicts WHERE actor_id=ANY($1::integer[])", [userIds]);
    await admin.query("DELETE FROM operational.sync_changes WHERE clinic_id=ANY($1::integer[])", [clinicIds]);
    await admin.query("DELETE FROM operational.appointment_operations WHERE actor_id=ANY($1::integer[])", [userIds]);
    await admin.query("DELETE FROM operational.appointment_holds WHERE owner_id=ANY($1::integer[])", [userIds]);
    await admin.query("SET LOCAL ROLE amal_demo_reset");
    await admin.query("DELETE FROM operational.audit_log WHERE patient_id=ANY($1::integer[]) OR user_id=ANY($2::integer[]) OR clinic_id=ANY($3::integer[])", [patientIds, userIds, clinicIds]);
    await admin.query(`DELETE FROM operational.waitlist_transitions WHERE actor_id=ANY($1::integer[])
      OR opportunity_id IN (SELECT id FROM operational.waitlist_opportunities WHERE source_appointment_id IN
        (SELECT appointment_id FROM operational.appointments WHERE patient_id=ANY($2::integer[])))`, [userIds, patientIds]);
    await admin.query("RESET ROLE");
    await admin.query("DELETE FROM operational.waitlist_opportunities WHERE source_appointment_id IN (SELECT appointment_id FROM operational.appointments WHERE patient_id=ANY($1::integer[]))", [patientIds]);
    await admin.query("DELETE FROM operational.appointments WHERE patient_id=ANY($1::integer[])", [patientIds]);
    // Deletes emit tombstones; remove only this fixture's newly emitted changes.
    await admin.query("DELETE FROM operational.sync_changes WHERE clinic_id=ANY($1::integer[])", [clinicIds]);
    await admin.query("DELETE FROM operational.patient_clinic_access WHERE patient_id=ANY($1::integer[])", [patientIds]);
    await admin.query("DELETE FROM operational.auth_sessions WHERE user_id=ANY($1::integer[])", [userIds]);
    await admin.query("DELETE FROM operational.auth_devices WHERE device_id=ANY($1::integer[])", [deviceIds]);
    await admin.query("DELETE FROM operational.devices WHERE id=ANY($1::integer[])", [deviceIds]);
    await admin.query("DELETE FROM operational.users WHERE id=ANY($1::integer[])", [userIds]);
    await admin.query("DELETE FROM operational.doctors WHERE doctor_id=ANY($1::integer[])", [doctorIds]);
    await admin.query("DELETE FROM operational.patients WHERE patient_id=ANY($1::integer[])", [patientIds]);
    await admin.query("DELETE FROM operational.clinics WHERE clinic_id=ANY($1::integer[])", [clinicIds]);
    await admin.query("COMMIT");
    assert.deepEqual(await seedSnapshot(), seedBefore, "All six immutable seed tables must remain byte-identical");
  } finally { await admin.end(); await pool.end(); }
});

test("appointment APIs: authenticated scope, transactions, idempotency, holds and audit", async t => {
  await t.test("reception directories require auth and preserve clinic/doctor scope with minimal projections", async () => {
    for (const path of ["/clinics", `/doctors?clinicId=${doctor.clinicId}`]) {
      assert.equal((await request(null, path)).status, 401);
      assert.equal((await request(manager, path)).status, 403);
    }
    const clinics = await request(desk, "/clinics");
    assert.equal(clinics.status, 200, JSON.stringify(clinics.data));
    assert.deepEqual(clinics.data.items.map((c: { id: number }) => c.id), [desk.clinicId]);
    assert.deepEqual(Object.keys(clinics.data.items[0]).sort(), ["id", "name", "mode", "timezone", "adoption"].sort());
    assert.equal((await request(desk, `/doctors?clinicId=${remoteDoctor.clinicId}`)).status, 403);
    assert.equal((await request(desk, `/doctors?clinicId=${desk.clinicId}&patientId=1`)).status, 400);
    const own = await request(doctor, `/doctors?clinicId=${doctor.clinicId}`);
    assert.deepEqual(own.data.items.map((d: { id: number }) => d.id), [doctor.doctorId]);
    const first = await request(desk, `/doctors?clinicId=${desk.clinicId}&limit=1`);
    assert.equal(first.status, 200);
    assert(first.data.nextCursor);
    assert.deepEqual(Object.keys(first.data.items[0]).sort(), ["id", "clinicId", "name", "networkVisible"].sort());
    assert.equal(first.data.items[0].networkVisible, false, "scheduling directory never grants network access");
    const second = await request(desk, `/doctors?clinicId=${desk.clinicId}&limit=1&cursor=${first.data.nextCursor}`);
    assert.equal(second.status, 200);
    assert.notEqual(first.data.items[0].id, second.data.items[0].id);
    assert.equal(second.data.nextCursor, null);
    assert.equal((await request(doctor, `/doctors?clinicId=${doctor.clinicId}&cursor=${first.data.nextCursor}`)).status, 400);
  });
  await t.test("availability is authenticated, patient-scoped and configured, and never returns clinical/collision details", async () => {
    const path = `/appointments/availability?clinicId=${desk.clinicId}&patientId=${patientIds[22]}`;
    assert.equal((await request(null, path)).status, 401);
    assert.equal((await request(manager, path)).status, 403);
    assert.equal((await request(remoteDoctor, path)).status, 403);
    for (const query of [`?clinicId=${desk.clinicId}`, `?patientId=${patientIds[22]}`,
      `?clinicId=${desk.clinicId}&patientId=0`, `?clinicId=${desk.clinicId}&patientId=${patientIds[22]}&durationMinutes=5`]) {
      assert.equal((await request(desk, "/appointments/availability" + query)).status, 400);
    }
    const got = await request(desk, path);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(Object.keys(got.data).sort(), ["items", "durationMinutes", "checkedAt"].sort());
    assert.equal(got.data.durationMinutes, 30);
    assert.deepEqual(got.data.items.map((s: { doctorId: number }) => s.doctorId), doctorIds.slice(0, 2));
    for (const slot of got.data.items) {
      assert.deepEqual(Object.keys(slot).sort(), ["doctorId", "startsAt", "endsAt"].sort());
      assert(Date.parse(slot.startsAt) > Date.parse(got.data.checkedAt));
      assert.equal(Date.parse(slot.endsAt) - Date.parse(slot.startsAt), got.data.durationMinutes * 60000);
    }
    const own = await request(doctor, path);
    assert.deepEqual(own.data.items.map((s: { doctorId: number }) => s.doctorId), [doctor.doctorId]);
    const slot = own.data.items[0];
    const held = await request(doctor, "/appointments/holds", "POST", {
      clientOpId: randomUUID(), clinicId: doctor.clinicId, patientId: patientIds[22], ...slot,
    });
    assert.equal(held.status, 201, JSON.stringify(held.data));
    const after = await request(doctor, path);
    assert.equal(after.status, 200);
    assert(Date.parse(after.data.items[0].startsAt) >= Date.parse(slot.endsAt), "even own active hold blocks adapter");
    await admin.query("UPDATE operational.appointment_holds SET expires_at=now()-interval '1 second' WHERE token=$1", [held.data.token]);
    const expired = await request(doctor, path);
    assert.equal(expired.data.items[0].startsAt, slot.startsAt);
    await admin.query("UPDATE operational.clinics SET open_time='00:00',close_time='00:01' WHERE clinic_id=$1", [desk.clinicId]);
    try {
      const empty = await request(desk, path);
      assert.equal(empty.status, 200);
      assert.deepEqual(empty.data.items, []);
    } finally { await admin.query("UPDATE operational.clinics SET close_time='23:59' WHERE clinic_id=$1", [desk.clinicId]); }
    await admin.query("DELETE FROM operational.patient_clinic_access WHERE patient_id=$1 AND clinic_id=$2", [patientIds[23], desk.clinicId]);
    const unauthorized = `/appointments/availability?clinicId=${desk.clinicId}&patientId=${patientIds[23]}`;
    assert.equal((await request(desk, unauthorized)).status, 404);
  });
  await t.test("upcoming requires an authorized patient, excludes historical statuses/past and uses chronological stable cursors", async () => {
    const patientId = patientIds[20]!;
    const add = async (doctor: Actor, p: number, at: string, status: string) =>
      (await admin.query(`INSERT INTO operational.appointments(clinic_id,doctor_id,patient_id,scheduled_at,booking_method,status)
        VALUES($1,$2,$3,$4,'phone',$5) RETURNING appointment_id`, [doctor.clinicId, doctor.doctorId, p, at, status])).rows[0].appointment_id;
    const late = await add(doctor, patientId, "2092-01-02T10:00:00Z", "booked");
    const early = await add(doctor, patientId, "2092-01-01T10:00:00Z", "booked");
    const tied = await add(otherDoctor, patientId, "2092-01-01T10:00:00Z", "double_booked");
    for (const status of ["cancelled", "completed", "no_show"]) await add(doctor, patientId, "2092-01-01T09:00:00Z", status);
    await add(doctor, patientId, "2000-01-01T10:00:00Z", "booked");
    await add(doctor, patientId, new Date(Date.now() - 60000).toISOString(), "booked");
    await add(remoteDoctor, patientId, "2092-01-01T09:30:00Z", "booked");
    await add(doctor, patientIds[21]!, "2092-01-01T09:45:00Z", "booked");
    await add(doctor, patientIds[23]!, "2092-01-01T09:50:00Z", "booked");
    await admin.query("DELETE FROM operational.patient_clinic_access WHERE patient_id=$1 AND clinic_id=$2", [patientIds[23], desk.clinicId]);
    const path = `/appointments?clinicId=${desk.clinicId}&patientId=${patientId}&upcoming=true&limit=1`;
    const ids: number[] = [];
    let cursor: string | null = null, firstCursor = "";
    do {
      const page = await request(desk, path + (cursor ? `&cursor=${cursor}` : ""));
      assert.equal(page.status, 200, JSON.stringify(page.data));
      for (const row of page.data.items) {
        ids.push(row.id);
        assert.equal(row.patientId, patientId);
        assert.equal(row.clinicId, desk.clinicId);
        assert.deepEqual(Object.keys(row).sort(), ["id", "clinicId", "doctorId", "patientId", "startsAt", "endsAt", "source", "clientOpId", "status", "version"].sort());
      }
      cursor = page.data.nextCursor;
      if (!firstCursor && cursor) firstCursor = cursor;
    } while (cursor);
    assert.deepEqual(ids, [early, tied, late], "time order wins over insertion ID; same-time ties use ID");
    const own = await request(doctor, path);
    assert.deepEqual(own.data.items.map((a: { id: number }) => a.id), [early]);
    assert.equal((await request(desk, `/appointments?clinicId=${desk.clinicId}&upcoming=true`)).status, 400);
    assert.equal((await request(desk, `/appointments?clinicId=${desk.clinicId}&patientId=${patientId}&upcoming=true&status=cancelled`)).status, 400);
    assert.equal((await request(desk, `/appointments?clinicId=${desk.clinicId}&patientId=${patientIds[23]}&upcoming=true`)).status, 404);
    assert.equal((await request(desk, `/appointments?clinicId=${desk.clinicId}&patientId=${patientIds[21]}&upcoming=true&cursor=${firstCursor}`)).status, 400);
    assert.equal((await request(remoteDoctor, path)).status, 403);
    const filtered = await request(desk, `/appointments?clinicId=${desk.clinicId}&patientId=${patientId}&upcoming=true&from=2092-01-02T00:00:00Z&to=2092-01-03T00:00:00Z`);
    assert.deepEqual(filtered.data.items.map((a: { id: number }) => a.id), [late]);
    assert.equal((await request(desk, `/appointments?clinicId=${desk.clinicId}&patientId=${patientIds[22]}&upcoming=true`)).data.items.length, 0);
  });
  await t.test("anonymous, CSRF, admin, doctor and clinic denials do not write", async () => {
    const body = booking(doctor, patientIds[0]!, 5);
    assert.equal((await request(null, "/appointments", "POST", body)).status, 401);
    assert.equal((await request(doctor, "/appointments", "POST", body, false)).status, 403);
    assert.equal((await request(manager, "/appointments", "POST", body)).status, 403);
    assert.equal((await request(otherDoctor, "/appointments", "POST", body)).status, 403);
    assert.equal((await request(remoteDoctor, "/appointments/check", "POST", body)).status, 403);
    assert.equal((await request(desk, "/appointments", "POST", booking(remoteDoctor, patientIds[0]!, 5))).status, 403);
    assert.equal((await admin.query("SELECT count(*)::integer n FROM operational.appointments WHERE client_op_id=$1", [body.clientOpId])).rows[0].n, 0);
  });
  await t.test("check is exact and read-only; strict UTC, reversed intervals and malformed reference", async () => {
    const body = booking(doctor, patientIds[0]!, 5);
    const before = await admin.query("SELECT (SELECT count(*) FROM operational.appointment_operations) ops,(SELECT count(*) FROM operational.appointments) bookings");
    const first = await request(doctor, "/appointments/check", "POST", body);
    assert.equal(first.status, 200);
    assert.deepEqual(first.data, { ok: true, conflicts: [] });
    assert.deepEqual((await request(doctor, "/appointments/check", "POST", body)).data, first.data);
    assert.deepEqual((await admin.query("SELECT (SELECT count(*) FROM operational.appointment_operations) ops,(SELECT count(*) FROM operational.appointments) bookings")).rows, before.rows);
    assert.equal((await request(doctor, "/appointments", "POST", { ...body, startsAt: `${farDay}T05:00:00+00:00` })).status, 400);
    assert.equal((await request(doctor, "/appointments", "POST", { ...body, startsAt: "2091-02-30T05:00:00Z" })).status, 400);
    assert.equal((await request(doctor, "/appointments", "POST", { ...body, endsAt: body.startsAt })).status, 400);
    assert.equal((await request(doctor, "/appointments", "POST", { ...body, patientId: 2147483647 })).status, 422);
  });
  await t.test("simultaneous doctor-overlap commits serialize; same op retries preserve response", async () => {
    const body = booking(doctor, patientIds[1]!, 6);
    const [first, second] = await Promise.all([request(doctor, "/appointments", "POST", body), request(doctor, "/appointments", "POST", { ...body, patientId: patientIds[2]!, clientOpId: randomUUID() })]);
    assert.deepEqual([first.status, second.status].sort(), [201, 409]);
    const winner = first.status === 201 ? first : second;
    const retryBody = first.status === 201 ? body : { ...body, patientId: patientIds[2]!, clientOpId: winner.data.clientOpId };
    const [retry1, retry2] = await Promise.all([request(doctor, "/appointments", "POST", retryBody), request(doctor, "/appointments", "POST", retryBody)]);
    assert.deepEqual(retry1.data, winner.data);
    assert.deepEqual(retry2.data, winner.data);
    assert.equal((await request(doctor, "/appointments", "POST", { ...retryBody, source: "walk-in" })).status, 409);
    assert.equal((await request(desk, "/appointments", "POST", retryBody)).status, 409);
  });
  await t.test("simultaneous cross-clinic patient commits block overrides with redacted evidence", async () => {
    const patientId = patientIds[3]!;
    const a = booking(doctor, patientId, 7), b = booking(remoteDoctor, patientId, 7);
    const results = await Promise.all([request(doctor, "/appointments", "POST", a), request(remoteDoctor, "/appointments", "POST", b)]);
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    const winner = results[0]!.status === 201 ? results[0]! : results[1]!;
    const loserActor = results[0]!.status === 201 ? remoteDoctor : doctor;
    const loserBody = results[0]!.status === 201 ? b : a;
    const preview = await request(loserActor, "/appointments/check", "POST", loserBody);
    assert.equal(preview.data.ok, false);
    assert.equal(preview.data.conflicts[0].type, "patient-overlap");
    assert.equal(preview.data.conflicts[0].with, null);
    const accepted = { ...loserBody, clientOpId: randomUUID(), overrideReason: "Patient confirmed both visits" };
    const result = await request(loserActor, "/appointments", "POST", accepted);
    assert.equal(result.status, 409);
    assert.deepEqual((await request(loserActor, "/appointments", "POST", accepted)).data, result.data);
    const { rows: audits } = await admin.query("SELECT detail FROM operational.audit_log WHERE patient_id=$1 AND action='appointment.patient_overlap_override'", [patientId]);
    assert.equal(audits.length, 0);
    assert.equal((await admin.query("SELECT count(*)::int n FROM operational.appointments WHERE patient_id=$1", [patientId])).rows[0].n, 1);
  });
  await t.test("Trial, Lite and left clinics still enforce global patient safety with hidden evidence", async () => {
    const patientId = patientIds[0]!;
    const body = { ...booking(doctor, patientId, 6), startsAt: "2096-06-04T06:00:00.000Z", endsAt: "2096-06-04T06:30:00.000Z" };
    const setState = async (clinicId: number, adoption: string, membership: string) => {
      await admin.query(`UPDATE operational.clinics SET adoption_state=$2,membership_status=$3,
        left_at=CASE WHEN $3='left' THEN clock_timestamp() ELSE NULL END,
        left_by=CASE WHEN $3='left' THEN $4::integer ELSE NULL END,
        network_mode=CASE WHEN $2='full' AND $3='active' THEN 'full'::operational.network_mode
          ELSE 'lite'::operational.network_mode END WHERE clinic_id=$1`, [clinicId, adoption, membership, manager.id]);
    };
    try {
      for (const clinicId of clinicIds) await setState(clinicId, "full", "active");
      assert.equal((await request(remoteDoctor, "/appointments", "POST", {
        ...body, clientOpId: randomUUID(), clinicId: remoteDoctor.clinicId, doctorId: remoteDoctor.doctorId,
      })).status, 201);
      assert.equal((await request(doctor, "/appointments/check", "POST", body)).data.ok, false);
      for (const restricted of [doctor.clinicId, remoteDoctor.clinicId]) {
        for (const [adoption, membership] of [["trial", "active"], ["lite", "active"], ["lite", "left"]]) {
          await setState(restricted, adoption!, membership!);
          const preview = await request(doctor, "/appointments/check", "POST", body);
          assert.equal(preview.status, 200);
          assert.equal(preview.data.ok, false, `${restricted}: ${adoption}/${membership}`);
          assert.equal(preview.data.conflicts[0].with, null);
          assert.equal(preview.data.conflicts[0].severity, "blocking");
          // Local clinical/scheduling directories must remain local in every state.
          const directory = await request(desk, "/clinics");
          assert.deepEqual(directory.data.items.map((c: { id: number }) => c.id), [desk.clinicId]);
          await setState(restricted, "full", "active");
        }
      }
      await setState(doctor.clinicId, "trial", "active");
      const created = await request(doctor, "/appointments", "POST", body);
      assert.equal(created.status, 409, JSON.stringify(created.data));
      const localConflict = await request(doctor, "/appointments/check", "POST", { ...body, clientOpId: randomUUID() });
      assert(localConflict.data.conflicts.some((c: { type: string }) => c.type === "patient-overlap"));
    } finally {
      for (const clinicId of clinicIds) await setState(clinicId, "full", "active");
    }
  });
  await t.test("availability suggestions respect restricted source clinic patient occupancy", async () => {
    const patientId = patientIds[0]!;
    const path = `/appointments/availability?clinicId=${doctor.clinicId}&patientId=${patientId}`;
    const baseline = await request(doctor, path);
    assert.equal(baseline.status, 200);
    const slot = baseline.data.items.find((item: { doctorId: number }) => item.doctorId === doctor.doctorId);
    assert(slot);
    const remote = await request(remoteDoctor, "/appointments", "POST", {
      ...booking(remoteDoctor, patientId, 1), startsAt: slot.startsAt, endsAt: slot.endsAt,
    });
    assert.equal(remote.status, 201, JSON.stringify(remote.data));
    try {
      await admin.query(`UPDATE operational.clinics SET adoption_state='lite',network_mode='lite' WHERE clinic_id=$1`, [remoteDoctor.clinicId]);
      const hidden = await request(doctor, path);
      assert.notDeepEqual(hidden.data.items, baseline.data.items);
      assert(hidden.data.items.every((item: { startsAt: string }) => item.startsAt !== slot.startsAt));
    } finally {
      await admin.query(`UPDATE operational.clinics SET adoption_state='full',membership_status='active',network_mode='full' WHERE clinic_id=$1`, [remoteDoctor.clinicId]);
    }
  });
  await t.test("moves use expectedVersion; cancellation keeps history/reason; update and cancel replay exactly", async () => {
    const created = await request(doctor, "/appointments", "POST", booking(doctor, patientIds[4]!, 8));
    assert.equal(created.status, 201);
    const move = { clientOpId: randomUUID(), expectedVersion: 1, ...interval(9) };
    const moved = await request(doctor, `/appointments/${created.data.id}`, "PATCH", move);
    assert.equal(moved.status, 200);
    assert.equal(moved.data.version, 2);
    assert.deepEqual((await request(doctor, `/appointments/${created.data.id}`, "PATCH", move)).data, moved.data);
    assert.equal((await request(doctor, `/appointments/${created.data.id}`, "PATCH", { ...move, clientOpId: randomUUID() })).status, 409);
    assert.equal((await request(otherDoctor, `/appointments/${created.data.id}`, "PATCH", { ...move, clientOpId: randomUUID() })).status, 403);
    const cancel = { clientOpId: randomUUID(), expectedVersion: 2, status: "cancelled", cancelReason: "Patient requested cancellation" };
    const cancelled = await request(doctor, `/appointments/${created.data.id}`, "PATCH", cancel);
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.data.version, 3);
    assert.equal(cancelled.data.status, "cancelled");
    assert.deepEqual((await request(doctor, `/appointments/${created.data.id}`, "PATCH", cancel)).data, cancelled.data);
    assert.equal((await admin.query("SELECT cancel_reason FROM operational.appointments WHERE appointment_id=$1", [created.data.id])).rows[0].cancel_reason, cancel.cancelReason);
    // Replay still returns the first exact response, even after later mutations.
    assert.deepEqual((await request(doctor, `/appointments/${created.data.id}`, "PATCH", move)).data, moved.data);
    assert.equal((await request(doctor, "/appointments", "POST", booking(doctor, patientIds[5]!, 9))).status, 201);
  });
  await t.test("holds serialize, exact owner+interval required, retries do not extend and consumption is atomic", async () => {
    const { source: _source, ...hold } = booking(doctor, patientIds[6]!, 10);
    const first = await request(desk, "/appointments/holds", "POST", hold);
    assert.equal(first.status, 201);
    assert(Date.parse(first.data.expiresAt) > Date.now());
    assert(Date.parse(first.data.expiresAt) <= Date.now() + 30000);
    assert.deepEqual((await request(desk, "/appointments/holds", "POST", hold)).data, first.data);
    assert.deepEqual((await request(desk, "/appointments/holds", "POST", { ...hold, clientOpId: randomUUID() })).data, first.data);
    const denied = await request(desk2, "/appointments/holds", "POST", { ...hold, clientOpId: randomUUID() });
    assert.equal(denied.status, 409);
    assert.equal((await request(doctor, "/appointments", "POST", { ...hold, clientOpId: randomUUID(), source: "phone", holdToken: first.data.token })).status, 409);
    assert.equal((await request(desk, "/appointments", "POST", { ...hold, clientOpId: randomUUID(), ...interval(11), source: "phone", holdToken: first.data.token })).status, 409);
    const booked = await request(desk, "/appointments", "POST", { ...hold, clientOpId: randomUUID(), source: "phone", holdToken: first.data.token });
    assert.equal(booked.status, 201);
    assert.equal((await admin.query("SELECT count(*)::integer n FROM operational.appointment_holds WHERE token=$1", [first.data.token])).rows[0].n, 0);
  });
  await t.test("rescheduling excludes itself, preserves identity, and atomically rejects competing moves", async () => {
    const a = await request(doctor, "/appointments", "POST", booking(doctor, patientIds[12]!, 16));
    const b = await request(doctor, "/appointments", "POST", booking(doctor, patientIds[13]!, 17));
    assert.equal(a.status, 201); assert.equal(b.status, 201);
    const snapshot = async (id: number) => (await admin.query(
      "SELECT * FROM operational.appointments WHERE appointment_id=$1", [id])).rows[0];
    const beforeA = await snapshot(a.data.id), beforeB = await snapshot(b.data.id);
    const check = { ...booking(doctor, patientIds[12]!, 16), appointmentId: a.data.id, expectedVersion: 1 };
    assert.deepEqual((await request(doctor, "/appointments/check", "POST", check)).data, { ok: true, conflicts: [] });
    const noop = { clientOpId: randomUUID(), expectedVersion: 1, ...interval(16) };
    const unchanged = await request(desk, `/appointments/${a.data.id}`, "PATCH", noop);
    assert.equal(unchanged.status, 200);
    assert.equal(unchanged.data.id, a.data.id);
    assert.deepEqual((await request(desk, `/appointments/${a.data.id}`, "PATCH", noop)).data, unchanged.data);
    const currentA = await snapshot(a.data.id);
    const blocked = await request(desk, `/appointments/${a.data.id}`, "PATCH",
      { clientOpId: randomUUID(), expectedVersion: 2, ...interval(17) });
    assert.equal(blocked.status, 409);
    assert.deepEqual(await snapshot(a.data.id), currentA, "Rejected move must preserve every persisted field");
    const denied = await request(remoteDoctor, `/appointments/${a.data.id}`, "PATCH",
      { clientOpId: randomUUID(), expectedVersion: 2, ...interval(18) });
    assert.equal(denied.status, 403);
    assert.deepEqual(await snapshot(a.data.id), currentA);
    const [moveA, moveB] = await Promise.all([
      request(desk, `/appointments/${a.data.id}`, "PATCH", { clientOpId: randomUUID(), expectedVersion: 2, ...interval(18) }),
      request(desk2, `/appointments/${b.data.id}`, "PATCH", { clientOpId: randomUUID(), expectedVersion: 1, ...interval(18) }),
    ]);
    assert.deepEqual([moveA.status, moveB.status].sort(), [200, 409]);
    const loserId = moveA.status === 409 ? a.data.id : b.data.id;
    assert.deepEqual(await snapshot(loserId), moveA.status === 409 ? currentA : beforeB);
    for (const [id, original] of [[a.data.id, beforeA], [b.data.id, beforeB]] as const) {
      const persisted = await snapshot(id);
      for (const key of ["appointment_id", "patient_id", "doctor_id", "clinic_id", "booking_method", "status", "client_op_id", "created_by"]) {
        assert.deepEqual(persisted[key], original[key], `Rescheduling preserves ${key}`);
      }
    }
  });
  await t.test("edit holds retain target identity and a stale preview cannot bypass version checks", async () => {
    const created = await request(doctor, "/appointments", "POST", booking(doctor, patientIds[14]!, 19));
    assert.equal(created.status, 201);
    const target = { clinicId: doctor.clinicId, doctorId: doctor.doctorId, patientId: patientIds[14], appointmentId: created.data.id, ...interval(19) };
    const held = await request(desk, "/appointments/holds", "POST", { ...target, clientOpId: randomUUID() });
    assert.equal(held.status, 201);
    const body = { clientOpId: randomUUID(), expectedVersion: 1, ...interval(19), holdToken: held.data.token };
    const moved = await request(desk, `/appointments/${created.data.id}`, "PATCH", body);
    assert.equal(moved.status, 200);
    assert.equal((await admin.query("SELECT count(*)::integer n FROM operational.appointment_holds WHERE token=$1", [held.data.token])).rows[0].n, 0);
    const stale = await request(desk, "/appointments/check", "POST", { ...target, source: "phone", expectedVersion: 1 });
    assert.equal(stale.status, 409);
    assert.equal(stale.data.code, "VERSION_CONFLICT");
    assert.deepEqual((await request(desk, `/appointments/${created.data.id}`, "PATCH", body)).data, moved.data);
  });
  await t.test("expired holds reject supplied token without extension; token release is owner-bound and idempotent", async () => {
    const { source: _source, ...hold } = booking(doctor, patientIds[7]!, 11);
    const created = await request(desk, "/appointments/holds", "POST", hold);
    assert.equal(created.status, 201);
    assert.equal((await request(desk2, `/appointments/holds/${created.data.token}`, "DELETE", { clientOpId: randomUUID() })).status, 403);
    await admin.query("UPDATE operational.appointment_holds SET expires_at=clock_timestamp()-interval '1 second' WHERE token=$1", [created.data.token]);
    assert.deepEqual((await request(desk, "/appointments/holds", "POST", hold)).data, created.data);
    assert.equal((await request(desk, "/appointments", "POST", { ...hold, source: "phone", clientOpId: randomUUID(), holdToken: created.data.token })).status, 409);
    const release = { clientOpId: randomUUID() };
    assert.equal((await request(desk, `/appointments/holds/${created.data.token}`, "DELETE", release)).status, 204);
    assert.equal((await request(desk, `/appointments/holds/${created.data.token}`, "DELETE", release)).status, 204);
    assert.equal((await request(desk, `/appointments/holds/${created.data.token}`, "DELETE", { clientOpId: randomUUID() })).status, 404);
  });
  await t.test("simultaneous hold acquisition has one committed owner and prevents an unheld booking", async () => {
    const { source: _source, ...a } = booking(doctor, patientIds[11]!, 15);
    const b = { ...a, clientOpId: randomUUID() };
    const [left, right] = await Promise.all([
      request(desk, "/appointments/holds", "POST", a),
      request(desk2, "/appointments/holds", "POST", b),
    ]);
    assert.deepEqual([left.status, right.status].sort(), [201, 409]);
    assert.equal((await request(doctor, "/appointments", "POST", { ...a, clientOpId: randomUUID(), source: "phone" })).status, 409);
    const winner = left.status === 201 ? desk : desk2;
    const held = left.status === 201 ? left : right;
    assert.equal((await request(winner, `/appointments/holds/${held.data.token}`, "DELETE", { clientOpId: randomUUID() })).status, 204);
  });
  await t.test("scoped pagination binds opaque cursors to filters and preserves historical values", async () => {
    const query = `clinicId=${doctor.clinicId}&from=${farDay}T00:00:00Z&to=2091-06-05T00:00:00Z&limit=1`;
    const first = await request(doctor, `/appointments?${query}`);
    assert.equal(first.status, 200);
    assert.equal(first.data.items.length, 1);
    assert(first.data.items.every((a: { doctorId: number }) => a.doctorId === doctor.doctorId));
    assert(first.data.nextCursor && !/^[0-9]+$/.test(first.data.nextCursor));
    const second = await request(doctor, `/appointments?${query}&cursor=${first.data.nextCursor}`);
    assert.equal(second.status, 200);
    assert.notEqual(second.data.items[0].id, first.data.items[0].id);
    assert.equal((await request(doctor, `/appointments?${query}&status=cancelled&cursor=${first.data.nextCursor}`)).status, 400);
    assert.equal((await request(doctor, `/appointments?${query}&doctorId=${otherDoctor.doctorId}`)).status, 403);
    assert.equal((await request(manager, `/appointments?${query}`)).status, 403);
    assert.equal((await request(remoteDoctor, `/appointments?${query}`)).status, 403);
    await admin.query(`INSERT INTO operational.appointments(clinic_id,doctor_id,patient_id,scheduled_at,booking_method,status)
      VALUES($1,$2,$3,$4,'calendar_app','no_show')`, [doctor.clinicId, doctor.doctorId, patientIds[8], `${farDay}T12:00:00Z`]);
    const legacy = await request(doctor, `/appointments?${query.replace("limit=1", "limit=100")}&status=no_show`);
    assert.equal(legacy.status, 200);
    assert.equal(legacy.data.items[0].source, "calendar_app");
    assert.equal(legacy.data.items[0].clientOpId, null);
  });
  await t.test("replays reauthorize after actor clinic changes", async () => {
    const body = booking(doctor, patientIds[9]!, 13);
    const created = await request(desk2, "/appointments", "POST", body);
    assert.equal(created.status, 201);
    // Direct service exercise avoids the session's independent device-clinic invalidation.
    await admin.query("UPDATE operational.users SET clinic_id=$2 WHERE id=$1", [desk2.id, remoteDoctor.clinicId]);
    try {
      await assert.rejects(createAppointment({ id: desk2.id } as never, body), (error: unknown) => (error as { status: number }).status === 403);
    } finally { await admin.query("UPDATE operational.users SET clinic_id=$2 WHERE id=$1", [desk2.id, desk2.clinicId]); }
  });
  await t.test("patient override rejection never reaches override audit insertion or changes the original", async () => {
    const patientId = patientIds[10]!;
    const first = await request(remoteDoctor, "/appointments", "POST", booking(remoteDoctor, patientId, 14));
    assert.equal(first.status, 201);
    const body = { ...booking(doctor, patientId, 14), overrideReason: "Confirmed" };
    const trigger = `appointment_test_${marker.replaceAll("-", "")}`;
    // A temporary test-only trigger fails only this disposable patient; cleanup always removes it.
    await admin.query(`CREATE FUNCTION operational.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced appointment audit failure'; END $$`);
    await admin.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON operational.audit_log FOR EACH ROW WHEN (NEW.patient_id=${patientId}) EXECUTE FUNCTION operational.${trigger}()`);
    try {
      assert.equal((await request(doctor, "/appointments", "POST", body)).status, 409);
      assert.equal((await admin.query("SELECT count(*)::integer n FROM operational.appointments WHERE client_op_id=$1", [body.clientOpId])).rows[0].n, 0);
      assert.equal((await admin.query("SELECT count(*)::integer n FROM operational.appointment_operations WHERE client_op_id=$1 AND status='conflict'", [body.clientOpId])).rows[0].n, 1);
    } finally {
      await admin.query(`DROP TRIGGER ${trigger} ON operational.audit_log`);
      await admin.query(`DROP FUNCTION operational.${trigger}()`);
    }
    assert.equal((await request(doctor, "/appointments", "POST", body)).status, 409);
    assert.equal((await admin.query("SELECT version FROM operational.appointments WHERE appointment_id=$1", [first.data.id])).rows[0].version, 1);
  });
});
