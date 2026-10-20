import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type pg from "pg";

/** Invoked only after developer-reset.test has switched DATABASE_URL to its
 * isolated cluster. Never imported by a workspace-database test or the app. */
export async function exerciseDeveloperHttp(admin: pg.Client) {
  process.env.AUTH_ALLOWED_ORIGINS = "http://developer-test.local";
  process.env.LOG_LEVEL = "silent";
  const { default: app } = await import("../../src/app");
  const { digest } = await import("../../src/lib/auth");
  const { closeDemoBoundary } = await import("../../src/developer/boundary");
  const { seedFingerprint } = await import("../../../../scripts/src/operational-support");
  const { demoPassword, demoPin } = await import("../../../../scripts/src/demo-fixtures");
  const seeds = await seedFingerprint(admin);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  type Actor = { cookie: string; csrf: string; clinicId: number | null };
  let generation = "";
  async function request(actor: Actor | null, path: string, method = "GET", body?: unknown,
    options: { generation?: string; csrf?: boolean } = {}) {
    const response = await fetch(base + path, {
      method, headers: {
        origin: process.env.AUTH_ALLOWED_ORIGINS!,
        "X-Amal-Demo-Generation": options.generation ?? generation,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(actor ? { cookie: actor.cookie, ...(options.csrf === false ? {} : { "X-CSRF-Token": actor.csrf }) } : {}),
      }, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null, response };
  }
  const ok = (result: { status: number; data: unknown }, status = 200) =>
    assert.equal(result.status, status, JSON.stringify(result.data));
  async function loginAdmin() {
    const { rows: [user] } = await admin.query("SELECT email FROM operational.users WHERE role='administrator' AND clinic_id IS NULL ORDER BY id LIMIT 1");
    assert(user);
    const result = await request(null, "/auth/login", "POST", { email: user.email, password: demoPassword });
    ok(result);
    return { cookie: result.response.headers.getSetCookie().map(c => c.split(";")[0]).join("; "),
      csrf: result.data.csrfToken, clinicId: null } satisfies Actor;
  }
  async function loginDesk(clinicId: number) {
    const { rows: [user] } = await admin.query("SELECT email FROM operational.users WHERE role='receptionist' AND clinic_id=$1 ORDER BY id LIMIT 1", [clinicId]);
    assert(user);
    const credential = randomUUID();
    const { rows: [device] } = await admin.query("INSERT INTO operational.devices(clinic_id,label) VALUES($1,'developerTest') RETURNING id", [clinicId]);
    await admin.query("INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)", [device.id, digest(credential)]);
    const cookie = `amal_device=${credential}`;
    const result = await request({ cookie, csrf: "", clinicId }, "/auth/pin", "POST", { email: user.email, pin: demoPin });
    ok(result);
    return { cookie: cookie + "; " + result.response.headers.getSetCookie().map(c => c.split(";")[0]).join("; "),
      csrf: result.data.csrfToken, clinicId } satisfies Actor;
  }
  const enable = (actor: Actor, clinicId: number, enabled: boolean) => request(actor,
    `/admin/developer/clinics/${clinicId}/outage`, "PUT", { enabled, expectedGeneration: generation });
  async function scopedAdministrator(clinicId: number) {
    const credential = randomUUID(), csrf = randomUUID();
    const { rows: [user] } = await admin.query(`INSERT INTO operational.users(email,password_hash,role,clinic_id)
      VALUES($1,'unused','administrator',$2) RETURNING id`, [`${randomUUID()}@developer.test`, clinicId]);
    await admin.query("INSERT INTO operational.auth_sessions(token_digest,user_id,csrf_token) VALUES($1,$2,$3)",
      [digest(credential), user.id, csrf]);
    return { cookie: `amal_session=${credential}`, csrf, clinicId } satisfies Actor;
  }
  try {
    const context = await request(null, "/demo/context");
    ok(context);
    generation = context.data.generation;
    let networkAdmin = await loginAdmin();
    const status = await request(networkAdmin, "/admin/developer/status");
    ok(status);
    const clinics = status.data.clinics as { id: number; name: string; outage: boolean }[];
    assert(clinics.length >= 2);
    const clinicId = clinics[0]!.id, otherClinicId = clinics[1]!.id;
    let desk = await loginDesk(clinicId), otherDesk = await loginDesk(otherClinicId);
    ok(await request(null, "/admin/developer/status"), 401);
    ok(await request(desk, "/admin/developer/status"), 403);
    ok(await enable(desk, clinicId, true), 403);
    for (const unauthorized of [null, desk]) {
      ok(await request(unauthorized, "/admin/developer/reset", "POST", {
        requestId: randomUUID(), expectedGeneration: generation, confirmation: "RESET-OPERATIONAL-DEMO-DATA",
      }), unauthorized ? 403 : 401);
    }
    const scoped = await scopedAdministrator(clinicId);
    ok(await enable(scoped, otherClinicId, true), 403);
    ok(await request(scoped, "/admin/developer/reset", "POST", {
      requestId: randomUUID(), expectedGeneration: generation, confirmation: "RESET-OPERATIONAL-DEMO-DATA",
    }), 403);
    ok(await request(networkAdmin, `/admin/developer/clinics/${clinicId}/outage`, "PUT",
      { enabled: true, expectedGeneration: generation }, { csrf: false }), 403);
    for (const invalid of ["0", "-1", "not-a-number", "2147483648"]) {
      const invalidResult = await request(networkAdmin, `/admin/developer/clinics/${invalid}/outage`, "PUT",
        { enabled: true, expectedGeneration: generation });
      assert.equal(invalidResult.status, 400, `clinicId=${invalid}: ${JSON.stringify(invalidResult.data)}`);
    }
    const missingId = Number((await admin.query("SELECT max(clinic_id)+10000 AS id FROM operational.clinics")).rows[0].id);
    ok(await enable(networkAdmin, missingId, true), 404);
    const { rows: [added] } = await admin.query(`INSERT INTO operational.clinics(clinic_name,city,booking_method,network_mode,joined_at)
      SELECT clinic_name||' integration test',city,booking_method,'lite',now()
      FROM operational.clinics ORDER BY clinic_id LIMIT 1 RETURNING clinic_id`);
    assert((await request(networkAdmin, "/admin/developer/status")).data.clinics.some((c: any) => c.id === added.clinic_id));
    ok(await enable(networkAdmin, added.clinic_id, true));
    ok(await enable(networkAdmin, added.clinic_id, false));
    // Off-by-default and deployment denial are enforced by the server, not UI.
    delete process.env.AMAL_DEVELOPER_TOOLS;
    ok(await request(networkAdmin, "/admin/developer/status"), 403);
    assert.equal((await request(null, "/demo/context")).data.enabled, false);
    process.env.AMAL_DEVELOPER_TOOLS = "1";
    process.env.REPLIT_DEPLOYMENT = "1";
    ok(await request(networkAdmin, "/admin/developer/status"), 403);
    delete process.env.REPLIT_DEPLOYMENT;
    ok(await request(networkAdmin, "/admin/developer/reset", "POST", {
      requestId: randomUUID(), expectedGeneration: generation, confirmation: "WRONG",
    }), 400);

    for (let run = 0; run < 2; run++) {
      const { rows: [doctor] } = await admin.query("SELECT doctor_id FROM operational.doctors WHERE clinic_id=$1 ORDER BY doctor_id LIMIT 1", [clinicId]);
      const patients = (await admin.query("SELECT patient_id FROM operational.patient_clinic_access WHERE clinic_id=$1 ORDER BY patient_id LIMIT 4", [clinicId])).rows;
      assert(doctor && patients.length === 4);
      const booking = (slot: number, patientIndex: number) => {
        const startsAt = new Date(Date.UTC(2094, 3, 4, slot));
        return { clientOpId: randomUUID(), clinicId, doctorId: doctor.doctor_id, patientId: patients[patientIndex]!.patient_id,
          startsAt: startsAt.toISOString(), endsAt: new Date(+startsAt + 30 * 60_000).toISOString(), source: "phone" };
      };
      // The prepared local view misses this known server-side collision. It is
      // committed before outage activation, not smuggled through the outage.
      const blocker = booking(12, 0);
      ok(await request(desk, "/appointments", "POST", blocker), 201);
      ok(await enable(networkAdmin, clinicId, true));
      ok(await enable(networkAdmin, clinicId, true)); // reload/retry-safe enable
      const operations = [booking(10, 1), booking(11, 2), booking(12, 3)]
        .map((input, index) => ({ sequence: index + 1, type: "create", input }));
      const oldGeneration = generation;
      const priorAppointments = (await admin.query("SELECT count(*)::int n FROM operational.appointments")).rows[0].n;
      for (const [path, method, body] of [
        ["/appointments", "POST", operations[0]!.input],
        ["/sync/push", "POST", { operations }],
        ["/sync/pull", "GET", undefined],
      ] as const) {
        const unavailable = await request(desk, path, method, body);
        ok(unavailable, 503);
        assert.equal(unavailable.data.code, "CLINIC_OUTAGE");
      }
      assert.equal((await admin.query("SELECT count(*)::int n FROM operational.appointments")).rows[0].n, priorAppointments);
      ok(await request(otherDesk, "/sync/pull")); // independent clinic stays online
      ok(await request(desk, "/me")); // auth and recovery are not stranded
      ok(await request(desk, "/auth/device-context"));
      assert.equal((await request(desk, "/demo/context")).data.outage, true);
      assert.equal((await request(networkAdmin, "/admin/developer/status")).data.clinics.find((c: any) => c.id === clinicId).outage, true);
      // A second browser session can reconcile and restore the persistent outage.
      const recoveryAdmin = await loginAdmin();
      ok(await enable(recoveryAdmin, clinicId, false));
      ok(await enable(recoveryAdmin, clinicId, false));
      assert.equal((await request(desk, "/demo/context")).data.outage, false);
      const synced = await request(desk, "/sync/push", "POST", { operations });
      ok(synced);
      assert.deepEqual(synced.data.outcomes.map((o: any) => o.status), ["applied", "applied", "conflict"]);
      assert(synced.data.outcomes[2].conflictId);
      const repeated = await request(desk, "/sync/push", "POST", { operations });
      ok(repeated);
      assert.deepEqual(repeated.data, synced.data, "same operation IDs replay their durable outcomes");
      assert.equal((await admin.query("SELECT count(*)::int n FROM operational.appointments")).rows[0].n, priorAppointments + 2);
      ok(await request(desk, "/sync/pull"));
      assert.equal((await admin.query("SELECT count(*)::int n FROM operational.sync_conflicts")).rows[0].n, 1);
      // Reset with an active outage proves settings are cleared along with data.
      ok(await enable(networkAdmin, clinicId, true));
      const requestId = randomUUID();
      const resetBody = { requestId, expectedGeneration: generation, confirmation: "RESET-OPERATIONAL-DEMO-DATA" };
      const reset = await request(networkAdmin, "/admin/developer/reset", "POST", resetBody);
      ok(reset);
      assert.notEqual(reset.data.generation, oldGeneration);
      generation = reset.data.generation;
      ok(await request(networkAdmin, "/admin/developer/status"), 401);
      const writeState = async () => (await admin.query(`SELECT
        (SELECT count(*) FROM operational.appointments)::int appointments,
        (SELECT count(*) FROM operational.appointment_operations)::int receipts,
        (SELECT count(*) FROM operational.sync_device_operations)::int sync_operations,
        (SELECT count(*) FROM operational.audit_log)::int audits`)).rows[0];
      const beforeStale = await writeState();
      for (const [path, method, body] of [
        ["/appointments", "POST", operations[0]!.input],
        ["/sync/push", "POST", { operations }],
        ["/sync/pull", "GET", undefined],
      ] as const) {
        const stale = await request(desk, path, method, body, { generation: oldGeneration });
        ok(stale, 409);
        assert.equal(stale.data.code, "DEMO_RESET_REQUIRED");
      }
      assert.deepEqual(await writeState(), beforeStale, "Stale normal booking/push/pull reject before any operational write");
      assert.equal((await request(null, "/demo/context")).data.generation, generation);
      assert.equal((await admin.query("SELECT count(*)::int n FROM operational.developer_outages")).rows[0].n, 0);
      assert.equal((await admin.query("SELECT count(*)::int n FROM operational.sync_device_operations")).rows[0].n, 0);
      networkAdmin = await loginAdmin(); // explicit password reauthentication
      const receipt = await request(networkAdmin, `/admin/developer/resets/${requestId}`);
      ok(receipt);
      assert.deepEqual(receipt.data, reset.data, "lost-response receipt reconciliation performs no reset");
      const replay = await request(networkAdmin, "/admin/developer/reset", "POST", resetBody);
      ok(replay);
      assert.deepEqual(replay.data, reset.data);
      assert.equal((await request(null, "/demo/context")).data.generation, generation);
      ok(await request(networkAdmin, `/admin/developer/resets/${randomUUID()}`), 404);
      desk = await loginDesk(clinicId);
      otherDesk = await loginDesk(otherClinicId);
      assert.equal((await admin.query("SELECT count(*)::int n FROM operational.import_rows WHERE review_state='review_required' AND confirmed_patient_id IS NULL AND confirmed_doctor_id IS NULL")).rows[0].n, 24);
      assert.equal(await seedFingerprint(admin), seeds);
    }
    console.log("PASS real Express developer authorization/outage isolation/recovery, 2-applied/1-conflict sync twice, reset receipts and stale generation rejection");
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await closeDemoBoundary();
  }
}
