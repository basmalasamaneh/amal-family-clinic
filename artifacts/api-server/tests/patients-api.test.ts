import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { normalizeName } from "@workspace/db/patient-search";
import pg from "pg";

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Patient tests prohibited in deployment");
process.env.AUTH_ALLOWED_ORIGINS = "http://patients-test.local";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
const { default: app } = await import("../src/app");
const { pool } = await import("@workspace/db");
const { digest } = await import("../src/lib/auth");
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/api/patients`;
const clinics: number[] = [], users: number[] = [], doctors: number[] = [], devices: number[] = [];
type Actor = { id: number; clinic: number; session: string; csrf: string; device?: string };
let doctor: Actor, remote: Actor, desk: Actor, manager: Actor;
let beforeSeeds: unknown;
async function snapshot() {
  const result: Record<string, unknown> = {};
  for (const table of ["clinics", "doctors", "patients", "appointments", "patient_visit_history", "calendar_app_export"]) {
    result[table] = (await admin.query(`SELECT count(*)::integer n,md5(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text)) hash FROM public.${table} t`)).rows[0];
  }
  return result;
}
async function actor(role: string, clinic: number): Promise<Actor> {
  let doctorId: number | null = null;
  if (role === "doctor") {
    doctorId = (await admin.query(`INSERT INTO operational.doctors(doctor_name,clinic_id,specialty,email)
      VALUES('patient-test',$1,'test',$2) RETURNING doctor_id`, [clinic, `${randomUUID()}@patients.test`])).rows[0].doctor_id;
    doctors.push(doctorId!);
  }
  const id = (await admin.query(`INSERT INTO operational.users(email,password_hash,role,clinic_id,doctor_id)
    VALUES($1,'unused',$2,$3,$4) RETURNING id`, [`${randomUUID()}@patients.test`, role, clinic, doctorId])).rows[0].id;
  users.push(id);
  if (doctorId) await admin.query("UPDATE operational.doctors SET user_id=$1 WHERE doctor_id=$2", [id, doctorId]);
  const a: Actor = { id, clinic, session: randomUUID(), csrf: randomUUID() };
  let deviceId = null;
  if (role === "receptionist") {
    deviceId = (await admin.query("INSERT INTO operational.devices(clinic_id,label) VALUES($1,'patientTest') RETURNING id", [clinic])).rows[0].id;
    devices.push(deviceId);
    a.device = randomUUID();
    await admin.query("INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)", [deviceId, digest(a.device)]);
  }
  await admin.query(`INSERT INTO operational.auth_sessions(token_digest,user_id,device_id,csrf_token,absolute_expires_at,pin_verified_at)
    VALUES($1,$2,$3,$4,now()+interval '8 hours',now())`, [digest(a.session), id, deviceId, a.csrf]);
  return a;
}
async function request(a: Actor | null, path = "", method = "GET", body?: unknown, csrf = true) {
  const response = await fetch(base + path, {
    method, headers: {
      origin: process.env.AUTH_ALLOWED_ORIGINS!, "content-type": "application/json",
      ...(a ? { cookie: `amal_session=${a.session}${a.device ? `; amal_device=${a.device}` : ""}`, ...(csrf ? { "x-csrf-token": a.csrf } : {}) } : {}),
    }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}
const body = (name = "أحمد", phone = "059-001-2345") => ({ name, phone, dateOfBirth: "1990-01-01", clientOpId: randomUUID() });
async function create(a = doctor, name?: string, phone?: string) {
  const r = await request(a, "", "POST", body(name, phone));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}
before(async () => {
  await admin.connect();
  beforeSeeds = await snapshot();
  await admin.query("BEGIN");
  for (let i = 0; i < 2; i++) clinics.push((await admin.query(`INSERT INTO operational.clinics(clinic_name,city,booking_method,working_days,open_time,close_time,timezone)
    VALUES($1,'test','phone',ARRAY[0,1,2,3,4,5,6],'00:00','23:59','Asia/Hebron') RETURNING clinic_id`, [`patient-test-${randomUUID()}`])).rows[0].clinic_id);
  doctor = await actor("doctor", clinics[0]!);
  desk = await actor("receptionist", clinics[0]!);
  manager = await actor("administrator", clinics[0]!);
  remote = await actor("doctor", clinics[1]!);
  await admin.query("COMMIT");
});
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  try {
    await admin.query("ROLLBACK");
    assert.deepEqual(await snapshot(), beforeSeeds, "all six immutable seed tables unchanged");
    await admin.query("BEGIN");
    await admin.query("DELETE FROM operational.import_rows WHERE batch_id IN (SELECT id FROM operational.import_batches WHERE clinic_id=ANY($1::integer[]))", [clinics]);
    await admin.query("DELETE FROM operational.import_batches WHERE clinic_id=ANY($1::integer[])", [clinics]);
    await admin.query("DELETE FROM operational.patient_consents WHERE recorded_by_user=ANY($1::integer[])", [users]);
    await admin.query("DELETE FROM operational.patient_visit_history WHERE clinic_id=ANY($1::integer[])", [clinics]);
    await admin.query("DELETE FROM operational.appointments WHERE clinic_id=ANY($1::integer[])", [clinics]);
    await admin.query("SET LOCAL ROLE amal_demo_reset");
    await admin.query("DELETE FROM operational.audit_log WHERE user_id=ANY($1::integer[])", [users]);
    await admin.query("RESET ROLE");
    await admin.query("DELETE FROM operational.patient_create_receipts WHERE clinic_id=ANY($1::integer[])", [clinics]);
    await admin.query("DELETE FROM operational.patient_clinic_access WHERE clinic_id=ANY($1::integer[])", [clinics]);
    await admin.query("DELETE FROM operational.patients WHERE created_clinic_id=ANY($1::integer[])", [clinics]);
    await admin.query("DELETE FROM operational.auth_sessions WHERE user_id=ANY($1::integer[])", [users]);
    await admin.query("DELETE FROM operational.auth_devices WHERE device_id=ANY($1::integer[])", [devices]);
    await admin.query("DELETE FROM operational.devices WHERE id=ANY($1::integer[])", [devices]);
    await admin.query("DELETE FROM operational.users WHERE id=ANY($1::integer[])", [users]);
    await admin.query("DELETE FROM operational.doctors WHERE doctor_id=ANY($1::integer[])", [doctors]);
    await admin.query("DELETE FROM operational.clinics WHERE clinic_id=ANY($1::integer[])", [clinics]);
    await admin.query("COMMIT");
  } finally { await admin.end(); await pool.end(); }
});

test("patients: CRUD, deterministic ranking, authorization and protected data", async t => {
  await t.test("strict validation, required demographics, real date-only DOB and scope forgery", async () => {
    for (const change of [
      { name: "" }, { name: "َ " }, { phone: "" }, { phone: "n/a" }, { dateOfBirth: null },
      { dateOfBirth: "2025-02-29" }, { dateOfBirth: "1990-01-01T00:00:00Z" }, { dateOfBirth: "2999-01-01" },
      { clinicId: clinics[1] }, { name_normalized: "forged" }, { merged_into_id: 1 }, { consent: "clinical" }, { audit: {} },
    ]) assert.equal((await request(doctor, "", "POST", { ...body(), ...change })).status, 400);
    for (const key of ["name", "phone", "dateOfBirth"]) {
      const value: Record<string, unknown> = body(); delete value[key];
      assert.equal((await request(doctor, "", "POST", value)).status, 400);
    }
    for (const suffix of ["?limit=0", "?limit=101", "?limit=2.5", "?q=a&q=b", "?q=" + "x".repeat(201), "?clinicId=1", "?cursor=bad"]) {
      assert.equal((await request(doctor, suffix)).status, 400);
    }
    assert.equal((await request(doctor, "/not-a-number")).status, 400);
  });
  await t.test("roles, device, CSRF and clinic isolation for all methods", async () => {
    const p = await create();
    for (const method of ["GET", "PATCH", "DELETE"]) {
      const payload = method === "PATCH" ? { name: "Updated" } : undefined;
      assert.equal((await request(null, `/${p.id}`, method, payload)).status, 401);
      assert.equal((await request(manager, `/${p.id}`, method, payload)).status, 403);
      assert.equal((await request(remote, `/${p.id}`, method, payload)).status, 404);
    }
    assert.equal((await request(null)).status, 401);
    assert.equal((await request(manager)).status, 403);
    assert.equal((await request(manager, "", "POST", body())).status, 403);
    assert.equal((await request(doctor, "", "POST", body(), false)).status, 403);
    assert.equal((await request(desk, `/${p.id}`, "PATCH", { name: "No" }, false)).status, 403);
    assert.equal((await request(doctor, `/${p.id}`, "DELETE", undefined, false)).status, 403);
    assert.equal((await request({ ...desk, device: undefined })).status, 401);
    assert.deepEqual((await request(remote, "?q=احمد")).data, { items: [], nextCursor: null });
    const got = await request(desk, `/${p.id}`);
    assert.deepEqual(Object.keys(got.data).sort(), ["id", "name", "phone", "dateOfBirth", "clinicId", "visibility"].sort());
  });
  await t.test("same name/phone is not identity; idempotent create serialized per clinic", async () => {
    const b = body("إيمان");
    const results = await Promise.all([request(doctor, "", "POST", b), request(desk, "", "POST", b)]);
    assert.equal(results[0]!.status, 201); assert.equal(results[1]!.status, 201);
    assert.equal(results[0]!.data.id, results[1]!.data.id);
    assert.equal((await request(doctor, "", "POST", { ...b, name: "Changed" })).status, 409);
    const duplicate = await create(doctor, b.name, b.phone);
    assert.notEqual(duplicate.id, results[0]!.data.id);
  });
  await t.test("ranking happens before pagination; updates refresh names and leading-zero phone search", async () => {
    const fuzzy = await create(doctor, "احمر"), partial = await create(doctor, "محمد احمد");
    const exact = await create(desk, "أَحمد");
    await create(remote, "أحمد");
    const ids: number[] = [];
    let cursor: string | null = null;
    do {
      const r = await request(doctor, `?q=احمد&limit=1${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`);
      assert.equal(r.status, 200);
      ids.push(...r.data.items.map((p: { id: number }) => p.id));
      cursor = r.data.nextCursor;
    } while (cursor);
    assert(ids.indexOf(exact.id) < ids.indexOf(partial.id));
    assert(ids.indexOf(partial.id) < ids.indexOf(fuzzy.id));
    const patch = await request(desk, `/${exact.id}`, "PATCH", { name: "ٱمَل José", phone: "001-234-567", dateOfBirth: "2000-02-29" });
    assert.equal(patch.status, 200); assert.equal(patch.data.dateOfBirth, "2000-02-29");
    assert.equal((await request(desk, "?q=امل%20jose")).data.items[0].id, exact.id);
    assert.equal((await request(desk, "?q=001234567")).data.items[0].id, exact.id);
    assert.equal((await admin.query("SELECT name_normalized FROM operational.patients WHERE patient_id=$1", [exact.id])).rows[0].name_normalized, "امل jose");
    assert.equal((await request(desk, `/${exact.id}`, "PATCH", {})).status, 400);
    for (const q of ["%", "_", "\\", "' OR 1=1--", "NoMatchingPatientHere"]) assert.deepEqual((await request(desk, "?q=" + encodeURIComponent(q))).data, { items: [], nextCursor: null });
    const blank = await request(doctor, "?q=%20%20");
    assert.deepEqual(blank.data.items.map((p: { id: number }) => p.id), [...blank.data.items.map((p: { id: number }) => p.id)].sort((a, b) => a - b));
  });
  await t.test("eligible delete retains audit and receipt, replay never recreates", async () => {
    const b = body("Delete synthetic");
    const { data: p } = await request(doctor, "", "POST", b);
    assert.equal((await request(desk, `/${p.id}`, "DELETE")).status, 204);
    assert.equal((await request(doctor, `/${p.id}`)).status, 404);
    assert.equal((await request(doctor, "", "POST", b)).status, 404);
    const { rows } = await admin.query("SELECT action FROM operational.audit_log WHERE detail->>'patientId'=$1 AND user_id=ANY($2::integer[])", [String(p.id), users]);
    assert(rows.some(r => r.action === "patient.created")); assert(rows.some(r => r.action === "patient.deleted"));
  });
  await t.test("derived backfill preserves display names and reconciles copied patients", async () => {
    const p = await create(doctor, "ٱسْمَة José");
    await admin.query("UPDATE operational.patients SET name_normalized='outdated' WHERE patient_id=$1", [p.id]);
    await promisify(execFile)("pnpm", ["patients:migrate"], { cwd: new URL("../", import.meta.url).pathname });
    const { rows } = await admin.query("SELECT patient_name,name_normalized FROM operational.patients");
    for (const row of rows) assert.equal(row.name_normalized, normalizeName(row.patient_name));
    assert.equal((await request(doctor, `/${p.id}`)).data.name, p.name);
    assert.equal((await request(doctor, "?q=اسمه%20jose")).data.items[0].id, p.id);
    assert.deepEqual(await snapshot(), beforeSeeds);
  });
  await t.test("import suggestions block deletion but never grant local access", async () => {
    const p = await create(remote, "Remote suggestion");
    const batch = (await admin.query("INSERT INTO operational.import_batches(clinic_id,source_name,source_checksum) VALUES($1,'test','test') RETURNING id", [doctor.clinic])).rows[0].id;
    await admin.query("INSERT INTO operational.import_rows(batch_id,source_event_id,source_payload,suggested_patient_id) VALUES($1,1,'{}',$2)", [batch, p.id]);
    assert.equal((await request(doctor, `/${p.id}`)).status, 404);
    assert.deepEqual((await request(doctor, "?q=Remote%20suggestion")).data.items, []);
    assert.equal((await request(remote, `/${p.id}`, "DELETE")).status, 409);
  });
  await t.test("existing seed copies stay protected, with only local demographics visible", async () => {
    const { rows: [seed] } = await admin.query("SELECT p.patient_id FROM operational.patients p JOIN public.patients s USING(patient_id) WHERE p.merged_into_id IS NULL LIMIT 1");
    assert(seed, "prerequisite copied patients exist");
    // Trusted fixture authorization, never established by the booking below.
    await admin.query("INSERT INTO operational.patient_clinic_access(patient_id,clinic_id) VALUES($1,$2)", [seed.patient_id, doctor.clinic]);
    await admin.query("INSERT INTO operational.appointments(patient_id,clinic_id,doctor_id,scheduled_at,booking_method,status) VALUES($1,$2,$3,'2036-01-01T12:00:00Z','phone','booked')", [seed.patient_id, doctor.clinic, doctors[0]]);
    assert.equal((await request(desk, `/${seed.patient_id}`)).status, 200);
    assert.equal((await request(doctor, `/${seed.patient_id}`, "DELETE")).status, 409);
  });
  await t.test("concurrent protected reference insertion cannot be bypassed by deletion", async () => {
    const p = await create();
    await admin.query("BEGIN");
    try {
      await admin.query("INSERT INTO operational.audit_log(patient_id,user_id,action) VALUES($1,$2,'patient.test.concurrent')", [p.id, doctor.id]);
      const deletion = request(doctor, `/${p.id}`, "DELETE");
      await admin.query("COMMIT");
      assert.equal((await deletion).status, 409);
    } finally { await admin.query("ROLLBACK"); }
    assert.equal((await request(doctor, `/${p.id}`)).status, 200);
    const { rows } = await admin.query(`SELECT conname,confdeltype FROM pg_constraint WHERE confrelid='operational.patients'::regclass AND contype='f'`);
    assert(rows.length > 5);
    assert(rows.every(r => ["a", "r"].includes(r.confdeltype)), "all protected patient references must reject, never cascade");
  });
  await t.test("guessed cross-clinic booking never grants GET/PATCH or search access", async () => {
    const p = await create(remote, "Private remote patient");
    for (const actor of [doctor, desk]) {
      const response = await fetch(base.replace(/patients$/, "appointments"), {
        method: "POST", headers: {
          origin: process.env.AUTH_ALLOWED_ORIGINS!, "content-type": "application/json",
          cookie: `amal_session=${actor.session}${actor.device ? `; amal_device=${actor.device}` : ""}`,
          "x-csrf-token": actor.csrf,
        }, body: JSON.stringify({ clientOpId: randomUUID(), clinicId: actor.clinic, doctorId: doctors[0],
          patientId: p.id, startsAt: "2091-06-04T10:00:00Z", endsAt: "2091-06-04T10:30:00Z", source: "phone" }),
      });
      assert.equal(response.status, 422);
      assert.equal((await request(actor, `/${p.id}`)).status, 404);
      assert.equal((await request(actor, `/${p.id}`, "PATCH", { name: "Forged" })).status, 404);
    }
    // Even a legacy/unverified booking inserted outside the new guarded API
    // must not turn into demographic authority.
    await admin.query("INSERT INTO operational.appointments(patient_id,clinic_id,doctor_id,scheduled_at,booking_method,status) VALUES($1,$2,$3,'2037-01-01T12:00:00Z','phone','booked')", [p.id, doctor.clinic, doctors[0]]);
    assert.equal((await request(doctor, `/${p.id}`)).status, 404);
    assert.equal((await request(desk, `/${p.id}`, "PATCH", { phone: "1234567" })).status, 404);
    assert.deepEqual((await request(desk, "?q=Private%20remote%20patient")).data.items, []);
    assert.equal((await request(remote, `/${p.id}`)).data.name, p.name);
    await assert.rejects(pool.query("INSERT INTO operational.patient_clinic_access(patient_id,clinic_id) VALUES($1,$2)", [p.id, doctor.clinic]), (e: { code?: string }) => e.code === "42501");
  });
  await t.test("consent, history, appointment and audit references block deletion", async () => {
    for (const kind of ["consent", "history", "appointment", "audit"]) {
      const p = await create(doctor, "Protected synthetic");
      if (kind === "consent") await admin.query("INSERT INTO operational.patient_consents(patient_id,level,given_by,recorded_by_user) VALUES($1,'basic','patient',$2)", [p.id, doctor.id]);
      if (kind === "history") await admin.query("INSERT INTO operational.patient_visit_history(patient_id,clinic_id,doctor_id,visit_date,diagnosis_notes) VALUES($1,$2,$3,'2020-01-01','NEVER RETURN THIS')", [p.id, doctor.clinic, doctors[0]]);
      if (kind === "appointment") await admin.query("INSERT INTO operational.appointments(patient_id,clinic_id,doctor_id,scheduled_at,booking_method,status) VALUES($1,$2,$3,'2035-01-01T12:00:00Z','phone','booked')", [p.id, doctor.clinic, doctors[0]]);
      if (kind === "audit") await admin.query("INSERT INTO operational.audit_log(patient_id,user_id,action) VALUES($1,$2,'patient.test')", [p.id, doctor.id]);
      const r = await request(doctor, `/${p.id}`, "DELETE");
      assert.equal(r.status, 409, JSON.stringify(r));
      assert.deepEqual(r.data, { code: "PATIENT_REFERENCED", messageKey: "error.patientReferenced", params: {} });
      assert.equal((await request(desk, `/${p.id}`)).data.visits, undefined);
    }
  });
});
