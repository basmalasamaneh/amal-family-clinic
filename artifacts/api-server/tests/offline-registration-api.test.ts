import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import pg from "pg";

// This child suite cannot import the app/database singleton against a live URL.
// Run offline-registration-isolated.test.ts, not this child alone.
test("existing createPatient followed by canonical-ID appointment/sync", {
  timeout: 180_000,
  skip: process.env.OFFLINE_REGISTRATION_ISOLATED !== "1",
}, async t => {
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.notEqual(process.env.REPLIT_DEPLOYMENT, "1");
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "localhost");
  assert.equal(url.port, "55441");
  assert.match(url.searchParams.get("host") ?? "", /^\/tmp\/amal-auth-security-[^/]+$/);
  process.env.AUTH_ALLOWED_ORIGINS = "http://offline-registration.test";
  process.env.AUTH_PROXY_HOPS = "0";
  const { default: app } = await import("../src/app");
  const { pool } = await import("@workspace/db");
  const { digest } = await import("../src/lib/auth");
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  type Actor = { id: number; clinicId: number; session: string; csrf: string; device?: string };
  async function actor(clinicId: number, role = "receptionist"): Promise<Actor> {
    const user = (await admin.query(`INSERT INTO operational.users(email,password_hash,role,clinic_id)
      VALUES($1,'unused',$2,$3) RETURNING id`, [`${randomUUID()}@offline.test`, role, clinicId])).rows[0];
    const result: Actor = { id: user.id, clinicId, session: randomUUID(), csrf: randomUUID() };
    let deviceId: number | null = null;
    if (role === "receptionist") {
      deviceId = (await admin.query(`INSERT INTO operational.devices(clinic_id,label)
        VALUES($1,'offline-registration-test') RETURNING id`, [clinicId])).rows[0].id;
      result.device = randomUUID();
      await admin.query("INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)",
        [deviceId, digest(result.device)]);
    }
    await admin.query(`INSERT INTO operational.auth_sessions
      (token_digest,user_id,device_id,csrf_token,absolute_expires_at,pin_verified_at)
      VALUES($1,$2,$3,$4,now()+interval '1 hour',now())`,
    [digest(result.session), result.id, deviceId, result.csrf]);
    return result;
  }
  async function clinic() {
    const clinicId = (await admin.query(`INSERT INTO operational.clinics
      (clinic_name,city,booking_method,working_days,open_time,close_time,timezone)
      VALUES('Offline registration test','Test','phone',ARRAY[0,1,2,3,4,5,6],'00:00','23:59','Asia/Hebron')
      RETURNING clinic_id`)).rows[0].clinic_id as number;
    const doctorId = (await admin.query(`INSERT INTO operational.doctors(doctor_name,clinic_id,specialty,email)
      VALUES('Test',$1,'Test',$2) RETURNING doctor_id`, [clinicId, `${randomUUID()}@offline.test`])).rows[0].doctor_id as number;
    return { clinicId, doctorId, actor: await actor(clinicId) };
  }
  async function request(a: Actor | null, path: string, method = "GET", body?: unknown, csrf = true) {
    const response = await fetch(base + path, {
      method, headers: {
        origin: process.env.AUTH_ALLOWED_ORIGINS!, "content-type": "application/json",
        ...(a ? { cookie: `amal_session=${a.session}${a.device ? `; amal_device=${a.device}` : ""}`,
          ...(csrf ? { "x-csrf-token": a.csrf } : {}) } : {}),
      }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }
  const registration = () => ({ name: `Offline ${randomUUID()}`, phone: "0591234567",
    dateOfBirth: "1980-01-01", clientOpId: randomUUID() });
  async function create(a: Actor, input = registration()) {
    const response = await request(a, "/patients", "POST", input);
    assert.equal(response.status, 201);
    assert(Number.isSafeInteger(response.data.id) && response.data.id > 0);
    return response.data;
  }
  async function patientRow(id: number) {
    return (await admin.query("SELECT * FROM operational.patients WHERE patient_id=$1", [id])).rows[0];
  }
  async function evidence(clinicIds: number[]) {
    return (await admin.query(`SELECT
      (SELECT count(*) FROM operational.patients WHERE created_clinic_id=ANY($1::integer[])) patients,
      (SELECT count(*) FROM operational.patient_create_receipts WHERE clinic_id=ANY($1::integer[])) receipts,
      (SELECT count(*) FROM operational.appointments WHERE clinic_id=ANY($1::integer[])) appointments,
      (SELECT count(*) FROM operational.appointment_operations WHERE clinic_id=ANY($1::integer[])) operations,
      (SELECT count(*) FROM operational.sync_changes WHERE clinic_id=ANY($1::integer[])) changes,
      (SELECT count(*) FROM operational.audit_log WHERE clinic_id=ANY($1::integer[])) audits`,
    [clinicIds])).rows[0];
  }
  try {
    const a = await clinic(), b = await clinic();
    const clinics = [a.clinicId, b.clinicId];
    const peer = await actor(a.clinicId), manager = await actor(a.clinicId, "administrator");
    const booking = (f: typeof a, patientId: number, day: number) => ({
      clinicId: f.clinicId, doctorId: f.doctorId, patientId,
      startsAt: `2092-06-${String(day).padStart(2, "0")}T10:00:00.000Z`,
      endsAt: `2092-06-${String(day).padStart(2, "0")}T10:30:00.000Z`,
      source: "phone", clientOpId: randomUUID(),
    });
    await t.test("concurrent first submissions serialize to one patient, receipt and creation audit", async () => {
      const input = registration();
      const before = await evidence(clinics);
      const results = await Promise.all([create(a.actor, input), create(peer, input), create(a.actor, input)]);
      assert(results.every(p => p.id === results[0].id));
      const after = await evidence(clinics);
      assert.equal(Number(after.patients), Number(before.patients) + 1);
      assert.equal(Number(after.receipts), Number(before.receipts) + 1);
      assert.equal(Number(after.audits), Number(before.audits) + 1);
      assert.equal(after.appointments, before.appointments);
      assert.equal((await admin.query(`SELECT count(*)::int n FROM operational.patients
        WHERE patient_name=$1`, [input.name])).rows[0].n, 1);
    });
    await t.test("lost-response and simultaneous same-operation retries yield one canonical patient and receipt", async () => {
      const input = registration();
      // Consume/discard the committed response body: the client never learns its ID.
      const lost = await fetch(base + "/patients", { method: "POST", headers: {
        origin: process.env.AUTH_ALLOWED_ORIGINS!, "content-type": "application/json",
        cookie: `amal_session=${a.actor.session}; amal_device=${a.actor.device}`,
        "x-csrf-token": a.actor.csrf,
      }, body: JSON.stringify(input) });
      assert.equal(lost.status, 201);
      await lost.arrayBuffer();
      const before = await evidence(clinics);
      const retries = await Promise.all([create(a.actor, input), create(peer, input), create(a.actor, input)]);
      assert(retries.every(p => p.id === retries[0].id));
      assert.deepEqual(await evidence(clinics), before);
      assert.equal((await admin.query(`SELECT count(*)::int n FROM operational.patients
        WHERE patient_name=$1`, [input.name])).rows[0].n, 1);
      assert.equal((await admin.query(`SELECT count(*)::int n FROM operational.patient_create_receipts
        WHERE clinic_id=$1 AND client_op_id=$2`, [a.clinicId, input.clientOpId])).rows[0].n, 1);
      const saved = await patientRow(retries[0].id);
      for (const change of [{ name: "Changed" }, { phone: "0597654321" }, { dateOfBirth: "1981-01-01" }]) {
        const response = await request(a.actor, "/patients", "POST", { ...input, ...change });
        assert.equal(response.status, 409);
        assert.equal(response.data.code, "CONFLICT");
      }
      assert.deepEqual(await patientRow(retries[0].id), saved);
      assert.deepEqual(await evidence(clinics), before);
    });
    await t.test("authorization remains clinic-scoped; forged scope, missing actor/device/CSRF and admin cannot register", async () => {
      const input = registration(), p = await create(a.actor, input);
      const before = await evidence(clinics);
      const saved = await patientRow(p.id);
      assert.equal((await request(null, "/patients", "POST", registration())).status, 401);
      assert.equal((await request(manager, "/patients", "POST", registration())).status, 403);
      assert.equal((await request(a.actor, "/patients", "POST", registration(), false)).status, 403);
      assert.equal((await request({ ...a.actor, device: undefined }, "/patients", "POST", registration())).status, 401);
      assert.equal((await request(a.actor, "/patients", "POST", { ...registration(), clinicId: b.clinicId })).status, 400);
      assert.equal((await request(b.actor, `/patients/${p.id}`)).status, 404);
      assert.equal((await request(b.actor, "/appointments", "POST", booking(b, p.id, 1))).status, 422);
      assert.deepEqual(await patientRow(p.id), saved);
      // A receipt is clinic scoped, not a globally reusable demographic disclosure token.
      const other = await create(b.actor, input);
      assert.notEqual(other.id, p.id);
      assert.equal(other.clinicId, b.clinicId);
      assert.equal((await request(b.actor, `/patients/${p.id}`)).status, 404);
      assert.equal(Number((await evidence(clinics)).patients), Number(before.patients) + 1);
    });
    await t.test("distinct registration operation does not auto-merge exact demographics", async () => {
      const input = registration();
      const first = await create(a.actor, input);
      const second = await create(a.actor, { ...input, clientOpId: randomUUID() });
      assert.notEqual(first.id, second.id);
      for (const p of [first, second]) {
        const row = await patientRow(p.id);
        assert.equal(row.merged_into_id, null);
        assert.equal(row.patient_name, input.name);
        assert.equal(row.phone, input.phone);
      }
    });
    for (const transport of ["direct", "sync"] as const) {
      await t.test(`${transport}: register first, book canonical ID, exact replay has no duplicate writes`, async () => {
        const input = registration(), p = await create(a.actor, input);
        const body = booking(a, p.id, transport === "direct" ? 2 : 3);
        const operations = [{ sequence: 1, type: "create", input: body }];
        const send = () => transport === "direct"
          ? request(a.actor, "/appointments", "POST", body)
          : request(a.actor, "/sync/push", "POST", { operations });
        const first = await send();
        assert.equal(first.status, transport === "direct" ? 201 : 200);
        const appointment = transport === "direct" ? first.data : first.data.outcomes[0].result;
        if (transport === "sync") assert.equal(first.data.outcomes[0].status, "applied");
        assert.equal(appointment.patientId, p.id);
        const before = await evidence(clinics);
        assert.equal((await create(a.actor, input)).id, p.id);
        assert.deepEqual(await send(), first);
        assert.deepEqual(await evidence(clinics), before);
        assert.equal((await admin.query(`SELECT count(*)::int n FROM operational.appointments
          WHERE client_op_id=$1 AND patient_id=$2`, [body.clientOpId, p.id])).rows[0].n, 1);
      });
    }
    for (const identity of ["same ID", "exact demographics"] as const) {
      await t.test(`cross-clinic ${identity} overlap rejects with and without override, preserving patient and original booking`, async () => {
        const input = registration(), p = await create(a.actor, input);
        const q = identity === "same ID" ? p : await create(b.actor, { ...input, clientOpId: randomUUID() });
        if (identity === "same ID") {
          // Trusted fixture grant, never a side effect of guessed booking or sync.
          await admin.query("INSERT INTO operational.patient_clinic_access(patient_id,clinic_id) VALUES($1,$2)",
            [p.id, b.clinicId]);
        } else assert.notEqual(q.id, p.id);
        const day = identity === "same ID" ? 4 : 5;
        const original = await request(a.actor, "/appointments", "POST", booking(a, p.id, day));
        assert.equal(original.status, 201);
        const originalRow = (await admin.query("SELECT * FROM operational.appointments WHERE appointment_id=$1", [original.data.id])).rows[0];
        const patientBefore = [await patientRow(p.id), await patientRow(q.id)];
        for (const overrideReason of [undefined, "Patient explicitly requested override"]) {
          // Independent device streams ensure a prior unresolved conflict does not
          // mask validation of the override attempt as PREDECESSOR_UNRESOLVED.
          const remote = await actor(b.clinicId);
          const body = { ...booking(b, q.id, day), ...(overrideReason ? { overrideReason } : {}) };
          const direct = await request(remote, "/appointments", "POST", body);
          assert.equal(direct.status, 409);
          assert.equal(direct.data.code, "APPOINTMENT_CONFLICT");
          const syncBody = { operations: [{ sequence: 1, type: "create", input: { ...body, clientOpId: randomUUID() } }] };
          const sync = await request(remote, "/sync/push", "POST", syncBody);
          assert.equal(sync.status, 200);
          assert.equal(sync.data.outcomes[0].status, "conflict");
          assert.equal(sync.data.outcomes[0].code, "APPOINTMENT_CONFLICT");
          const beforeReplay = await evidence(clinics);
          assert.deepEqual(await request(remote, "/sync/push", "POST", syncBody), sync);
          assert.deepEqual(await evidence(clinics), beforeReplay);
          assert.equal((await admin.query(`SELECT count(*)::int n FROM operational.audit_log
            WHERE user_id=$1 AND action='appointment.patient_overlap_override'`, [remote.id])).rows[0].n, 0);
        }
        assert.deepEqual((await admin.query("SELECT * FROM operational.appointments WHERE appointment_id=$1", [original.data.id])).rows[0], originalRow);
        assert.deepEqual([await patientRow(p.id), await patientRow(q.id)], patientBefore);
        assert.equal((await admin.query(`SELECT count(*)::int n FROM operational.appointments
          WHERE patient_id=ANY($1::integer[])`, [[p.id, q.id]])).rows[0].n, 1);
      });
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await admin.end();
    await pool.end();
  }
});
