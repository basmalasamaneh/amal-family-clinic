import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import pg from "pg";
import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("Consent tests prohibited in deployment");
}
process.env.AUTH_ALLOWED_ORIGINS = "http://consent-test.local";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
const { default: app } = await import("../src/app");
const { pool } = await import("@workspace/db");
const { digest } = await import("../src/lib/auth");
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
const run = randomUUID();
type Actor = { id: number; clinic: number; doctorId?: number; session: string; csrf: string; device?: string };
type Patient = { id: number; name: string };
type NetworkVisit = {
  clinicId: number; doctorId: number; clinicName: string; doctorName: string;
  seenAt: string; visibility: string; complaint?: string; keyAlerts?: unknown[];
};
type NetworkPatient = { id: number; name: string; identityVerified: false; effectiveConsentLevel: string; visits: NetworkVisit[] };
const users: number[] = [];
let localDoctor: Actor, otherDoctor: Actor, remoteDoctor: Actor, liteDoctor: Actor;
let desk: Actor, secondDesk: Actor, remoteDesk: Actor, liteDesk: Actor, manager: Actor;
let seedFingerprint: unknown;
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/api`;

async function snapshot() {
  const result: Record<string, unknown> = {};
  for (const table of ["clinics", "doctors", "patients", "appointments", "patient_visit_history", "calendar_app_export"]) {
    result[table] = (await admin.query(`SELECT count(*)::integer n,
      md5(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text)) hash
      FROM public.${table} t`)).rows[0];
  }
  return result;
}

async function clinic(mode = "full") {
  return (await admin.query(`INSERT INTO operational.clinics
    (clinic_name,city,booking_method,network_mode) VALUES($1,'consent-test','phone',$2)
    RETURNING clinic_id`, [`consent-${run}-${randomUUID()}`, mode])).rows[0].clinic_id as number;
}

async function actor(role: string, clinicId: number, pinHash: string | null = null): Promise<Actor> {
  let doctorId: number | undefined;
  if (role === "doctor") {
    doctorId = (await admin.query(`INSERT INTO operational.doctors(doctor_name,clinic_id,specialty,email)
      VALUES($1,$2,'consent-test',$3) RETURNING doctor_id`,
    [`Consent doctor ${randomUUID()}`, clinicId, `${randomUUID()}@consent.test`])).rows[0].doctor_id;
  }
  const id = (await admin.query(`INSERT INTO operational.users(email,password_hash,role,clinic_id,doctor_id,pin_hash)
    VALUES($1,'unused',$2,$3,$4,$5) RETURNING id`,
  [`${randomUUID()}@consent.test`, role, clinicId, doctorId ?? null, pinHash])).rows[0].id as number;
  users.push(id);
  if (doctorId) await admin.query("UPDATE operational.doctors SET user_id=$1 WHERE doctor_id=$2", [id, doctorId]);
  const a: Actor = { id, clinic: clinicId, doctorId, session: randomUUID(), csrf: randomUUID() };
  let deviceId: number | null = null;
  if (role === "receptionist") {
    deviceId = (await admin.query(`INSERT INTO operational.devices(clinic_id,label)
      VALUES($1,'consentTest') RETURNING id`, [clinicId])).rows[0].id;
    a.device = randomUUID();
    await admin.query("INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)", [deviceId, digest(a.device)]);
  }
  await admin.query(`INSERT INTO operational.auth_sessions
    (token_digest,user_id,device_id,csrf_token,absolute_expires_at,pin_verified_at)
    VALUES($1,$2,$3,$4,now()+interval '8 hours',now())`, [digest(a.session), id, deviceId, a.csrf]);
  return a;
}

async function request(a: Actor | null, path: string, method = "GET", body?: unknown, csrf = true) {
  const response = await fetch(base + path, {
    method,
    headers: {
      origin: process.env.AUTH_ALLOWED_ORIGINS!, "content-type": "application/json",
      ...(a ? {
        cookie: `amal_session=${a.session}${a.device ? `; amal_device=${a.device}` : ""}`,
        ...(csrf ? { "x-csrf-token": a.csrf } : {}),
      } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status, data: text ? JSON.parse(text) : null,
    requestId: response.headers.get("x-request-id"), cacheControl: response.headers.get("cache-control"),
    setCookies: response.headers.getSetCookie(),
  };
}

async function patient(a = desk, name = `Consent ${run} ${randomUUID()}`, minor = false): Promise<Patient> {
  const r = await request(a, "/patients", "POST", {
    name, phone: "0599876543", dateOfBirth: minor ? "2020-01-01" : "1990-01-01",
    ...(minor ? { guardianName: "Parent", guardianRelation: "mother" } : {}),
    clientOpId: randomUUID(),
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}
const input = (level = "clinical") => ({ level, evidence: "signed", clientOpId: randomUUID() });
async function record(p: Patient, level = "clinical", a = desk) {
  const r = await request(a, `/patients/${p.id}/consent`, "POST", input(level));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}
async function consent(p: Patient, a = desk) {
  const r = await request(a, `/patients/${p.id}/consent`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
async function visit(p: Patient, doctor = localDoctor, note = `CONFIDENTIAL-${randomUUID()}`) {
  const id = (await admin.query(`INSERT INTO operational.patient_visit_history
    (patient_id,clinic_id,doctor_id,visit_date,diagnosis_notes)
    VALUES($1,$2,$3,'2025-01-12',$4) RETURNING visit_id`, [p.id, doctor.clinic, doctor.doctorId, note])).rows[0].visit_id;
  await admin.query(`INSERT INTO operational.visit_alerts(visit_id,patient_id,kind,label,source_note_excerpt)
    VALUES($1,$2,'allergy','allergy.test',$3)`, [id, p.id, note]);
  return { id, note };
}
async function trustedDoctor(p: Patient, doctor = localDoctor) {
  // Explicit trusted fixture setup, never derived from mutable visits/bookings.
  await admin.query(`INSERT INTO operational.patient_clinic_access(patient_id,clinic_id)
    VALUES($1,$2) ON CONFLICT DO NOTHING`, [p.id, doctor.clinic]);
  await admin.query(`INSERT INTO operational.patient_doctor_access(patient_id,clinic_id,doctor_id)
    VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [p.id, doctor.clinic, doctor.doctorId]);
}
async function lookup(a: Actor | null, q: string, suffix = "") {
  return request(a, `/network/lookup?q=${encodeURIComponent(q)}${suffix}`);
}
async function networkPatient(p: Patient, a = remoteDoctor): Promise<NetworkPatient | undefined> {
  const r = await lookup(a, p.name);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(Object.keys(r.data).sort(), ["items", "nextCursor"]);
  return r.data.items.find((item: NetworkPatient) => item.id === p.id);
}
function basicOnly(p: NetworkPatient) {
  assert.deepEqual(Object.keys(p).sort(), ["effectiveConsentLevel", "id", "identityVerified", "name", "visits"]);
  assert.equal(p.effectiveConsentLevel, "basic");
  assert.equal(p.identityVerified, false);
  assert(p.visits.length > 0);
  for (const v of p.visits) {
    assert.deepEqual(Object.keys(v).sort(), ["clinicId", "clinicName", "doctorId", "doctorName", "seenAt", "visibility"]);
    assert.equal(v.visibility, "basic");
  }
}

before(async () => {
  await admin.connect();
  for (const table of ["clinics", "doctors", "patients", "appointments", "patient_visit_history",
    "users", "auth_sessions", "patient_clinic_access", "patient_doctor_access", "patient_consents", "visit_alerts", "audit_log"]) {
    assert((await admin.query("SELECT to_regclass($1) AS relation", [`operational.${table}`])).rows[0].relation,
      `Missing prerequisite operational.${table}; run the completed upstream migrations, not seed mutations`);
  }
  seedFingerprint = await snapshot();
  await admin.query("BEGIN");
  try {
    const local = await clinic(), remote = await clinic(), lite = await clinic("lite");
    localDoctor = await actor("doctor", local);
    otherDoctor = await actor("doctor", local);
    remoteDoctor = await actor("doctor", remote);
    liteDoctor = await actor("doctor", lite);
    desk = await actor("receptionist", local);
    secondDesk = await actor("receptionist", local);
    remoteDesk = await actor("receptionist", remote);
    liteDesk = await actor("receptionist", lite);
    manager = await actor("administrator", local);
    await admin.query("COMMIT");
  } catch (error) { await admin.query("ROLLBACK"); throw error; }
});

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  try {
    assert.deepEqual(await snapshot(), seedFingerprint, "all six immutable source tables retain their exact fingerprint");
  } finally {
    // Deliberately retain synthetic patients, consent history, receipts and audits.
    // There is no reset role, cleanup exception, audit deletion, or seed mutation.
    await admin.query("UPDATE operational.auth_sessions SET revoked_at=now() WHERE user_id=ANY($1::integer[])", [users]);
    await admin.end();
    await pool.end();
  }
});

test("doctor reads: exact patient scope, My Day, privacy and source-clinic audit", async t => {
  const { dayInterval } = await import("../src/doctor/service");
  await t.test("Hebron half-open days include both DST boundaries and local midnight rollover", () => {
    const hours = new Set<number>();
    for (let i = 0; i < 365; i++) {
      const now = new Date(Date.UTC(2025, 0, 1 + i, 12));
      const interval = dayInterval(now);
      hours.add((interval.end.getTime() - interval.start.getTime()) / 3600000);
      assert.equal(dayInterval(interval.start).day, interval.day);
      assert.equal(dayInterval(new Date(interval.end.getTime() - 1)).day, interval.day);
      assert.notEqual(dayInterval(interval.end).day, interval.day);
    }
    assert(hours.has(23), "spring day is 23h");
    assert(hours.has(25), "autumn day is 25h");
  });
  await t.test("strict doctor identity, roles and forged query context", async () => {
    for (const path of ["/doctor/day", "/doctor/privacy", "/doctor/patients/1", "/audit"]) {
      assert.equal((await request(null, path)).status, 401);
      for (const a of [desk, manager]) assert.equal((await request(a, path)).status, 403);
      const forged = await request(localDoctor, `${path}?clinicId=${remoteDoctor.clinic}`);
      assert.equal(forged.status, 400);
      assert.equal(forged.cacheControl, "private, no-store");
    }
    for (const suffix of ["limit=0", "limit=101", "limit=1.1", "cursor=garbage", "limit=2&limit=3"]) {
      for (const path of ["/doctor/day", "/audit"]) assert.equal((await request(localDoctor, `${path}?${suffix}`)).status, 400);
    }
    for (const id of ["abc", "0", "-1", "2147483648", "1&patientId=2"]) {
      assert.equal((await request(localDoctor, `/audit?patientId=${id}`)).status, 400);
    }
    const { requireDoctor } = await import("../src/consent/service");
    const client = await pool.connect();
    try {
      for (const doctorId of [otherDoctor.doctorId, remoteDoctor.doctorId, null]) {
        await assert.rejects(requireDoctor(client, {
          role: "doctor", clinicId: localDoctor.clinic, doctorId, id: localDoctor.id,
        } as import("../src/lib/auth").Auth), (error: { status?: number }) => error.status === 403);
      }
    } finally {
      client.release();
    }
  });
  await t.test("stable ID includes assigned patients without visits, never name or appointment authority", async () => {
    const p = await patient(), twin = await patient(desk, p.name);
    await trustedDoctor(p);
    const result = await request(localDoctor, `/doctor/patients/${p.id}`);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.deepEqual(result.data, { id: p.id, name: p.name, identityVerified: false, effectiveConsentLevel: "none", visits: [] });
    assert.equal((await request(localDoctor, `/doctor/patients/${twin.id}`)).status, 404);
    for (const a of [otherDoctor, remoteDoctor]) assert.equal((await request(a, `/doctor/patients/${p.id}`)).status, 404);
    const { start, end, day } = dayInterval();
    const booking = async (patientId: number, at: Date, doctor = localDoctor) =>
      (await admin.query(`INSERT INTO operational.appointments(clinic_id,doctor_id,patient_id,scheduled_at,booking_method,status)
        VALUES($1,$2,$3,$4,'phone','booked') RETURNING appointment_id`,
      [doctor.clinic, doctor.doctorId, patientId, at])).rows[0].appointment_id;
    const first = await booking(p.id, start);
    const second = await booking(p.id, new Date(start.getTime() + 3600000));
    await booking(p.id, end);
    await booking(p.id, new Date(start.getTime() - 3600000));
    await booking(twin.id, new Date(start.getTime() + 7200000));
    await booking(p.id, new Date(start.getTime() + 10800000), otherDoctor);
    assert.equal((await request(localDoctor, `/doctor/patients/${twin.id}`)).status, 404, "mutable bookings do not grant access");
    const page = await request(localDoctor, "/doctor/day?limit=1");
    assert.equal(page.status, 200, JSON.stringify(page.data));
    assert.equal(page.data.day, day);
    assert.equal(page.data.items[0].id, first);
    assert.equal(page.data.items[0].startsAt, start.toISOString());
    assert.equal(page.data.items[0].patient.id, p.id);
    assert(page.data.nextCursor);
    const next = await request(localDoctor, `/doctor/day?limit=1&cursor=${page.data.nextCursor}`);
    assert.equal(next.status, 200, JSON.stringify(next.data));
    assert.deepEqual(next.data.items.map((r: { id: number }) => r.id), [second]);
    assert.equal(next.data.nextCursor, null);
    assert.equal((await request(otherDoctor, `/doctor/day?cursor=${page.data.nextCursor}`)).status, 400);
    assert.deepEqual((await request(otherDoctor, "/doctor/day")).data.items, []);
    assert.equal(page.cacheControl, "private, no-store");
  });
  await t.test("shared exact-ID projection keeps local data, gates network consent/modes and audits disclosures", async () => {
    const p = await patient();
    await trustedDoctor(p);
    const own = await visit(p), remote = await visit(p, remoteDoctor);
    const get = () => request(localDoctor, `/doctor/patients/${p.id}`);
    assert.deepEqual((await get()).data.visits.map((v: NetworkVisit) => v.clinicId), [localDoctor.clinic]);
    await record(p, "basic");
    let result = await get();
    const basic = result.data.visits.find((v: NetworkVisit) => v.clinicId === remoteDoctor.clinic);
    assert.equal(basic.visibility, "basic");
    for (const key of ["complaint", "keyAlerts", "alerts"]) assert.equal(key in basic, false);
    const clinical = await record(p);
    result = await get();
    assert.equal(result.data.visits.find((v: NetworkVisit) => v.clinicId === remoteDoctor.clinic).complaint, remote.note);
    const disclosures = (await admin.query(`SELECT detail FROM operational.audit_log
      WHERE user_id=$1 AND patient_id=$2 AND action='network.lookup'`, [localDoctor.id, p.id])).rows;
    assert(disclosures.some(row => row.detail.sourceVisitId === remote.id && row.detail.projection === "clinical"));
    const restore = async () => admin.query("UPDATE operational.clinics SET adoption_state='full',network_mode='full' WHERE clinic_id=ANY($1::integer[])", [[localDoctor.clinic, remoteDoctor.clinic]]);
    try {
      for (const clinicId of [localDoctor.clinic, remoteDoctor.clinic]) {
        await admin.query("UPDATE operational.clinics SET adoption_state='lite',network_mode='lite' WHERE clinic_id=$1", [clinicId]);
        const lite = await get();
        assert.deepEqual(lite.data.visits.map((v: NetworkVisit) => v.complaint), [own.note]);
        await restore();
      }
    } finally { await restore(); }
    assert.equal((await request(desk, `/consent/${clinical.id}/withdraw`, "POST", { clientOpId: randomUUID() })).status, 200);
    const withdrawn = await get();
    assert.equal(withdrawn.data.effectiveConsentLevel, "none");
    assert.deepEqual(withdrawn.data.visits.map((v: NetworkVisit) => v.complaint), [own.note]);
  });
  await t.test("lifecycle restrictions revalidate clinical, consent and disclosure-history projections", async () => {
    const p = await patient();
    await trustedDoctor(p);
    await trustedDoctor(p, remoteDoctor);
    const localGrant = await record(p);
    await record(p, "clinical", remoteDesk);
    const own = await visit(p);
    await visit(p, remoteDoctor);
    const card = () => request(localDoctor, `/doctor/patients/${p.id}`);
    assert.equal((await card()).data.visits.length, 2);
    await networkPatient(p, remoteDoctor); // durable remote-view evidence at the local source
    const setState = async (clinicId: number, adoption: string, membership: string) => {
      await admin.query(`UPDATE operational.clinics SET adoption_state=$2,membership_status=$3,
        left_at=CASE WHEN $3='left' THEN clock_timestamp() ELSE NULL END,
        left_by=CASE WHEN $3='left' THEN $4::integer ELSE NULL END,
        network_mode=CASE WHEN $2='full' AND $3='active' THEN 'full'::operational.network_mode
          ELSE 'lite'::operational.network_mode END WHERE clinic_id=$1`, [clinicId, adoption, membership, manager.id]);
    };
    try {
      for (const restricted of [localDoctor.clinic, remoteDoctor.clinic]) {
        for (const [adoption, membership] of [["trial", "active"], ["lite", "active"], ["lite", "left"]]) {
          await setState(restricted, adoption!, membership!);
          const result = await card();
          assert.equal(result.status, 200);
          assert.deepEqual(result.data.visits.map((v: NetworkVisit) => v.complaint), [own.note]);
          assert.equal(result.data.effectiveConsentLevel, "none", "hidden remote consent is not an existence badge");
          const grants = await consent(p);
          assert.equal(grants.current, null);
          assert.equal(grants.effectiveLevel, "none", "do not resurrect the older local grant");
          assert.deepEqual(grants.history.map((c: { id: number }) => c.id), [localGrant.id]);
          const audit = await request(localDoctor, `/audit?patientId=${p.id}`);
          assert.deepEqual(audit.data.items, []);
          const assisted = await request(desk, `/patients/${p.id}/access-history`, "POST", { patientRequestConfirmed: true });
          assert.deepEqual(assisted.data.items, []);
          assert.equal(assisted.data.nextCursor, null);
          await setState(restricted, "full", "active");
        }
      }
    } finally {
      for (const clinicId of [localDoctor.clinic, remoteDoctor.clinic]) await setState(clinicId, "full", "active");
    }
  });
  await t.test("three-clinic consent provenance gates Full-to-Full sharing without reviving older grants", async () => {
    // Requester and visit source remain Full throughout. Only the independent
    // consent-recording clinic changes lifecycle state.
    const recorderClinic = await clinic("full");
    const recorder = await actor("receptionist", recorderClinic);
    const ownPatient = await patient(), remoteOnly = await patient();
    await trustedDoctor(ownPatient);
    const own = await visit(ownPatient);
    for (const p of [ownPatient, remoteOnly]) {
      await record(p); // older eligible Full grant must never become a fallback
      await visit(p, remoteDoctor);
      await admin.query("INSERT INTO operational.patient_clinic_access(patient_id,clinic_id) VALUES($1,$2)", [p.id, recorderClinic]);
    }
    const setRecorderState = async (adoption: string, membership = "active") => {
      await admin.query(`UPDATE operational.clinics SET adoption_state=$2,membership_status=$3,
        left_at=CASE WHEN $3='left' THEN clock_timestamp() ELSE NULL END,
        left_by=CASE WHEN $3='left' THEN $4::integer ELSE NULL END,
        network_mode=CASE WHEN $2='full' AND $3='active' THEN 'full'::operational.network_mode
          ELSE 'lite'::operational.network_mode END WHERE clinic_id=$1`, [recorderClinic, adoption, membership, manager.id]);
    };
    const assertDenied = async () => {
      const result = await request(localDoctor, `/doctor/patients/${ownPatient.id}`);
      assert.equal(result.status, 200);
      assert.deepEqual(result.data.visits.map((v: NetworkVisit) => v.complaint), [own.note]);
      assert.equal(result.data.effectiveConsentLevel, "none");
      const search = await lookup(localDoctor, remoteOnly.name);
      assert.equal(search.status, 200);
      assert.deepEqual(search.data, { items: [], nextCursor: null }, "no patient existence or pagination metadata");
    };
    try {
      for (const [adoption, membership] of [["trial", "active"], ["lite", "active"], ["lite", "left"]]) {
        const latest = [];
        for (const p of [ownPatient, remoteOnly]) latest.push(await record(p, "clinical", recorder));
        assert.equal((await request(localDoctor, `/doctor/patients/${ownPatient.id}`)).data.visits.length, 2);
        assert((await networkPatient(remoteOnly, localDoctor))?.visits.some(v => v.clinicId === remoteDoctor.clinic));
        await setRecorderState(adoption!, membership!);
        await assertDenied(); // hidden newest clinical grant cannot authorize Full source data
        for (const grant of latest) {
          assert.equal((await request(recorder, `/consent/${grant.id}/withdraw`, "POST", { clientOpId: randomUUID() })).status, 200);
        }
        await assertDenied(); // hidden newest withdrawal must remain a denial
        await setRecorderState("full");
        await assertDenied(); // restoring provenance must not undo withdrawal
        for (const p of [ownPatient, remoteOnly]) await record(p, "none", recorder);
        await setRecorderState(adoption!, membership!);
        await assertDenied(); // hidden explicit denial must not resurrect the older Full grant
        await setRecorderState("full");
        await assertDenied();
      }
    } finally { await setRecorderState("full"); }
  });
  await t.test("a clinical request queued behind a downgrade reads its committed authoritative mode", async () => {
    const p = await patient();
    await trustedDoctor(p);
    await record(p);
    const own = await visit(p);
    await visit(p, remoteDoctor);
    const blocker = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    let pending: ReturnType<typeof request> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(160005)");
      await blocker.query("SELECT pg_advisory_xact_lock(761910)");
      await blocker.query(`UPDATE operational.clinics SET adoption_state='lite',network_mode='lite' WHERE clinic_id=$1`, [remoteDoctor.clinic]);
      pending = request(localDoctor, `/doctor/patients/${p.id}`);
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        waiting = (await admin.query(`SELECT EXISTS(SELECT 1 FROM pg_locks
          WHERE locktype='advisory' AND objid=160005 AND mode='ShareLock' AND NOT granted) AS waiting`)).rows[0].waiting;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert(waiting, "protected request must participate in the lifecycle transaction lock");
      await blocker.query("COMMIT");
      const result = await pending;
      assert.equal(result.status, 200);
      assert.deepEqual(result.data.visits.map((v: NetworkVisit) => v.complaint), [own.note]);
    } finally {
      await blocker.query("ROLLBACK");
      await blocker.end();
      if (pending) await pending;
      await admin.query(`UPDATE operational.clinics SET adoption_state='full',membership_status='active',network_mode='full' WHERE clinic_id=$1`, [remoteDoctor.clinic]);
    }
  });
  await t.test("privacy exposes persisted adoption with Trial support and trusted sharing state", async () => {
    for (const [a, mode] of [[localDoctor, "full"], [liteDoctor, "lite"]] as const) {
      const r = await request(a, "/doctor/privacy");
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal(r.data.clinic.id, a.clinic);
      assert(r.data.clinic.name);
      assert.equal(r.data.mode, mode);
      assert.equal(r.data.effectiveSharing, mode === "full" ? "consent" : "local-only");
      assert.equal(r.data.trialStateAvailable, true);
      assert.equal(r.data.adoption.clinicId, a.clinic);
      assert.equal(r.data.adoption.state, mode);
      assert.equal(r.data.adoption.capabilities.networkSharing, mode === "full");
      assert.equal(r.cacheControl, "private, no-store");
    }
  });
  await t.test("audit filters source/success/immutable scope before paging and redacts foreign or unknown actors", async () => {
    const p = await patient(), unrelated = await patient();
    await trustedDoctor(p);
    const at = "2026-01-01T12:00:00.123456Z";
    const event = async (patientId: number, source: number, actor: Actor | null, outcome = "disclosed", action = "network.lookup") =>
      (await admin.query(`INSERT INTO operational.audit_log(user_id,clinic_id,action,patient_id,detail,at)
        VALUES($1,$2,$3,$4,$5::jsonb,$6) RETURNING id`,
      [actor?.id ?? null, actor?.clinic ?? null, action, patientId,
        JSON.stringify({ outcome, sourceClinicId: source, privateNotes: "NEVER EXPOSE", email: "private@example.invalid" }), at])).rows[0].id;
    const own = await event(p.id, localDoctor.clinic, localDoctor);
    const foreign = await event(p.id, localDoctor.clinic, remoteDoctor);
    const unknown = await event(p.id, localDoctor.clinic, null);
    await event(unrelated.id, localDoctor.clinic, remoteDoctor);
    await event(p.id, remoteDoctor.clinic, remoteDoctor);
    await event(p.id, localDoctor.clinic, remoteDoctor, "denied");
    await event(p.id, localDoctor.clinic, remoteDoctor, "no-result");
    await event(p.id, localDoctor.clinic, remoteDoctor, "disclosed", "consent.record");
    const collected: any[] = [];
    let cursor: string | null = null;
    do {
      const r = await request(localDoctor, `/audit?patientId=${p.id}&limit=1${cursor ? `&cursor=${cursor}` : ""}`);
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal(r.cacheControl, "private, no-store");
      assert.equal(r.data.items.length, 1);
      collected.push(...r.data.items);
      cursor = r.data.nextCursor;
      if (cursor) {
        assert.equal((await request(otherDoctor, `/audit?patientId=${p.id}&cursor=${cursor}`)).status, 400);
        assert.equal((await request(localDoctor, `/audit?patientId=${unrelated.id}&cursor=${cursor}`)).status, 400);
      }
    } while (cursor);
    assert.deepEqual(collected.map(r => r.id), [unknown, foreign, own], "microsecond timestamp ties do not skip events");
    for (const row of collected) {
      assert.deepEqual(Object.keys(row).sort(), ["action", "at", "id", "patient", "viewerClinicName", "viewerName"]);
      assert.deepEqual(row.patient, { id: p.id, name: p.name });
      assert.equal(row.action, "patient-view");
    }
    for (const row of collected.slice(0, 2)) {
      assert.equal(row.viewerName, null);
      assert.equal(row.viewerClinicName, null);
    }
    assert(collected[2].viewerName);
    assert(collected[2].viewerClinicName);
    assert.deepEqual((await request(otherDoctor, `/audit?patientId=${p.id}`)).data, { items: [], nextCursor: null });
    assert.deepEqual((await request(localDoctor, `/audit?patientId=${unrelated.id}`)).data, { items: [], nextCursor: null });
    assert.equal(JSON.stringify(collected).includes("NEVER EXPOSE"), false);
    assert.equal(JSON.stringify(collected).includes("@"), false);
  });
  await t.test("merged identities and doctor grants without source-clinic authority cannot enter audit or cards", async () => {
    const target = await patient(), merged = await patient(), outside = await patient(remoteDesk);
    await trustedDoctor(merged);
    await admin.query("UPDATE operational.patients SET merged_into_id=$1 WHERE patient_id=$2", [target.id, merged.id]);
    await admin.query(`INSERT INTO operational.patient_doctor_access(patient_id,clinic_id,doctor_id)
      VALUES($1,$2,$3)`, [outside.id, localDoctor.clinic, localDoctor.doctorId]);
    for (const p of [merged, outside]) {
      await admin.query(`INSERT INTO operational.audit_log(user_id,clinic_id,action,patient_id,detail)
        VALUES($1,$2,'network.lookup',$3,$4::jsonb)`, [remoteDoctor.id, remoteDoctor.clinic, p.id,
        JSON.stringify({ outcome: "disclosed", sourceClinicId: localDoctor.clinic })]);
      assert.equal((await request(localDoctor, `/doctor/patients/${p.id}`)).status, 404);
      assert.deepEqual((await request(localDoctor, `/audit?patientId=${p.id}`)).data, { items: [], nextCursor: null });
    }
  });
});

test("reception-assisted access history: authorization, confirmation, bounded projection and cursors", async t => {
  const read = (a: Actor | null, p: Patient, body: unknown = { patientRequestConfirmed: true }, csrf = true) =>
    request(a, `/patients/${p.id}/access-history`, "POST", body, csrf);
  await t.test("every read requires reception, device, CSRF, fresh PIN, confirmation and clinic scope", async () => {
    const p = await patient(), outside = await patient(remoteDesk);
    assert.equal((await read(null, p)).status, 401);
    for (const a of [localDoctor, remoteDoctor, manager]) assert.equal((await read(a, p)).status, 403);
    assert.equal((await read(remoteDesk, p)).status, 404);
    assert.equal((await read(desk, outside)).status, 404);
    assert.equal((await read(desk, { id: 2147483647, name: "" })).status, 404);
    assert.equal((await read({ ...desk, device: undefined }, p)).status, 401);
    assert.equal((await read(desk, p, { patientRequestConfirmed: true }, false)).status, 403);
    for (const body of [{}, { patientRequestConfirmed: false }, { patientRequestConfirmed: "true" },
      { patientRequestConfirmed: true, patientId: outside.id }, { patientRequestConfirmed: true, clinicId: desk.clinic },
      ...[0, 101, 1.5, "1", null].map(limit => ({ patientRequestConfirmed: true, limit })),
      { patientRequestConfirmed: true, cursor: "garbage" }]) {
      assert.equal((await read(desk, p, body)).status, 400, JSON.stringify(body));
    }
    await admin.query("UPDATE operational.auth_sessions SET pin_verified_at=now()-interval '6 minutes' WHERE token_digest=$1", [digest(desk.session)]);
    try {
      const stale = await read(desk, p);
      assert.equal(stale.status, 403);
      assert.equal(stale.data.code, "REAUTH_REQUIRED");
    } finally {
      await admin.query("UPDATE operational.auth_sessions SET pin_verified_at=now() WHERE token_digest=$1", [digest(desk.session)]);
    }
    const empty = await read(desk, p);
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.data, { items: [], nextCursor: null });
    assert.equal(empty.cacheControl, "private, no-store");
    const merged = await patient();
    await admin.query("UPDATE operational.patients SET merged_into_id=$1 WHERE patient_id=$2", [p.id, merged.id]);
    assert.equal((await read(desk, merged)).status, 404);
  });
  await t.test("disclosed cross-clinic events only; verified viewers; stable descending paging and signed scope", async () => {
    const p = await patient(), other = await patient();
    const at = "2026-01-01T12:00:00.123456Z";
    const event = async (patientId: number, a: Actor | null, source: number | null = desk.clinic,
      outcome = "disclosed", action = "network.lookup", auditClinic = a?.clinic ?? remoteDoctor.clinic) =>
      (await admin.query(`INSERT INTO operational.audit_log(user_id,clinic_id,action,patient_id,detail,at)
        VALUES($1,$2,$3,$4,$5::jsonb,$6) RETURNING id`,
      [a?.id ?? null, auditClinic, action, patientId,
        JSON.stringify({ outcome, sourceClinicId: source, privateNotes: "NEVER EXPOSE", email: "private@example.invalid" }), at])).rows[0].id;
    const verified = await event(p.id, remoteDoctor);
    const unknown = await event(p.id, null);
    const mismatched = await event(p.id, localDoctor, desk.clinic, "disclosed", "network.lookup", remoteDoctor.clinic);
    await event(other.id, remoteDoctor);
    await event(p.id, remoteDoctor, desk.clinic, "denied");
    await event(p.id, remoteDoctor, desk.clinic, "no-result");
    await event(p.id, remoteDoctor, desk.clinic, "disclosed", "consent.record");
    await event(p.id, remoteDoctor, remoteDoctor.clinic); // Not cross-clinic.
    await event(p.id, remoteDoctor, null); // No source attribution.
    const collected: any[] = [];
    let cursor: string | null = null;
    do {
      const r = await read(desk, p, { patientRequestConfirmed: true, limit: 1, ...(cursor ? { cursor } : {}) });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal(r.data.items.length, 1);
      collected.push(...r.data.items);
      cursor = r.data.nextCursor;
      if (cursor) {
        assert.equal((await read(desk, other, { patientRequestConfirmed: true, cursor })).status, 400);
        assert.equal((await read(secondDesk, p, { patientRequestConfirmed: true, cursor })).status, 400);
        assert.equal((await read(remoteDesk, p, { patientRequestConfirmed: true, cursor })).status, 404);
        assert.equal((await read(desk, p, { cursor })).status, 400, "confirmation repeated on next page");
        assert.equal((await read(desk, p, { patientRequestConfirmed: true, cursor }, false)).status, 403);
        const forged = JSON.parse(Buffer.from(cursor, "base64url").toString());
        forged.id++;
        assert.equal((await read(desk, p, { patientRequestConfirmed: true,
          cursor: Buffer.from(JSON.stringify(forged)).toString("base64url") })).status, 400);
      }
    } while (cursor);
    assert.deepEqual(collected.map(row => row.id), [mismatched, unknown, verified]);
    for (const row of collected) {
      assert.deepEqual(Object.keys(row).sort(), ["action", "at", "id", "viewerClinicName", "viewerName", "viewerRole"]);
      assert.equal(row.action, "patient-view");
    }
    for (const row of collected.slice(0, 2)) {
      assert.equal(row.viewerName, null);
      assert.equal(row.viewerRole, null);
      assert.equal(row.viewerClinicName, null);
    }
    assert(collected[2].viewerName);
    assert.equal(collected[2].viewerRole, "doctor");
    assert(collected[2].viewerClinicName);
    assert(!JSON.stringify(collected).includes("NEVER EXPOSE"));
    assert(!JSON.stringify(collected).includes("@"));
    const audits = (await admin.query(`SELECT user_id,clinic_id,patient_id,detail FROM operational.audit_log
      WHERE patient_id=$1 AND action='patient.access-history.read'`, [p.id])).rows;
    assert.equal(audits.length, 3);
    for (const audit of audits) {
      assert.equal(audit.user_id, desk.id);
      assert.equal(audit.clinic_id, desk.clinic);
      assert.equal(audit.patient_id, p.id);
      assert.deepEqual(Object.keys(audit.detail).sort(), ["correlationId", "outcome"]);
      assert.equal(audit.detail.outcome, "read");
    }
  });
  await t.test("real disclosure survives withdrawal, never includes local reads or denied reads", async () => {
    const p = await patient();
    await trustedDoctor(p);
    await visit(p);
    await networkPatient(p, localDoctor);
    assert.deepEqual((await read(desk, p)).data.items, []);
    const grant = await record(p);
    await networkPatient(p, remoteDoctor);
    const before = await read(desk, p);
    assert.equal(before.data.items.length, 1);
    assert.equal((await request(desk, `/consent/${grant.id}/withdraw`, "POST", { clientOpId: randomUUID() })).status, 200);
    assert.equal(await networkPatient(p, remoteDoctor), undefined);
    assert((await networkPatient(p, localDoctor))!.visits.length);
    assert.deepEqual((await read(desk, p)).data.items, before.data.items);
  });
  await t.test("default/max bounds, continuation PIN freshness and cross-clinic cursor binding", async () => {
    const p = await patient();
    await admin.query("INSERT INTO operational.patient_clinic_access(patient_id,clinic_id) VALUES($1,$2)", [p.id, remoteDesk.clinic]);
    await admin.query(`INSERT INTO operational.audit_log(user_id,clinic_id,action,patient_id,detail,at)
      SELECT $1,$2,'network.lookup',$3,jsonb_build_object('outcome','disclosed','sourceClinicId',$4::integer),
        '2026-01-01T00:00:00Z'::timestamptz+(n * interval '1 second') FROM generate_series(1,103) n`,
    [remoteDoctor.id, remoteDoctor.clinic, p.id, desk.clinic]);
    const defaultPage = await read(desk, p);
    assert.equal(defaultPage.data.items.length, 25);
    assert(defaultPage.data.nextCursor);
    const maxPage = await read(desk, p, { patientRequestConfirmed: true, limit: 100 });
    assert.equal(maxPage.data.items.length, 100);
    const cursor = maxPage.data.nextCursor;
    assert(cursor);
    assert.equal((await read(remoteDesk, p, { patientRequestConfirmed: true, cursor })).status, 400);
    await admin.query("UPDATE operational.auth_sessions SET pin_verified_at=now()-interval '6 minutes' WHERE token_digest=$1", [digest(desk.session)]);
    try {
      const stale = await read(desk, p, { patientRequestConfirmed: true, cursor });
      assert.equal(stale.status, 403);
      assert.equal(stale.data.code, "REAUTH_REQUIRED");
    } finally {
      await admin.query("UPDATE operational.auth_sessions SET pin_verified_at=now() WHERE token_digest=$1", [digest(desk.session)]);
    }
    const next = await read(desk, p, { patientRequestConfirmed: true, cursor, limit: 100 });
    assert.equal(next.data.items.length, 3);
    assert.equal(next.data.nextCursor, null);
    const events = [...maxPage.data.items, ...next.data.items];
    assert.equal(new Set(events.map(row => row.id)).size, 103);
    for (let i = 1; i < events.length; i++) assert(events[i - 1].at > events[i].at);
  });
  await t.test("real PIN reauth rotates credentials without invalidating a same-device continuation", async () => {
    // Provision the PIN before issuing the session: credential changes revoke
    // existing sessions and must not be bypassed by the fixture.
    const a = await actor("receptionist", desk.clinic, await bcrypt.hash("0123", 4)), p = await patient(a);
    await visit(p);
    await record(p, "clinical", a);
    await networkPatient(p, remoteDoctor);
    await networkPatient(p, remoteDoctor);
    const first = await read(a, p, { patientRequestConfirmed: true, limit: 1 });
    assert.equal(first.status, 200);
    const cursor = first.data.nextCursor;
    assert(cursor);
    await admin.query("UPDATE operational.auth_sessions SET pin_verified_at=now()-interval '6 minutes' WHERE token_digest=$1", [digest(a.session)]);
    const stale = await read(a, p, { patientRequestConfirmed: true, cursor, limit: 1 });
    assert.equal(stale.status, 403);
    assert.equal(stale.data.code, "REAUTH_REQUIRED");
    const reauth = await request(a, "/auth/reauth", "POST", { pin: "0123" });
    assert.equal(reauth.status, 200, JSON.stringify(reauth.data));
    const cookie = reauth.setCookies.find(value => value.startsWith("amal_session="));
    assert(cookie);
    const session = cookie.split(";")[0]!.slice("amal_session=".length);
    assert.notEqual(session, a.session);
    assert.notEqual(reauth.data.csrfToken, a.csrf);
    const rotated = { ...a, session, csrf: reauth.data.csrfToken };
    assert.equal((await read(a, p, { patientRequestConfirmed: true, cursor })).status, 401, "revoked session cannot continue");
    assert.equal((await read(rotated, p, { cursor })).status, 400, "confirmation still required");
    const next = await read(rotated, p, { patientRequestConfirmed: true, cursor, limit: 1 });
    assert.equal(next.status, 200, JSON.stringify(next.data));
    assert.equal(next.data.items.length, 1);
    assert.notEqual(next.data.items[0].id, first.data.items[0].id);
    assert.equal(next.data.nextCursor, null);
  });
  await t.test("scope and verified viewer relationships recheck on every subsequent page", async () => {
    const p = await patient(remoteDesk);
    await admin.query("INSERT INTO operational.patient_clinic_access(patient_id,clinic_id) VALUES($1,$2)", [p.id, desk.clinic]);
    await visit(p, remoteDoctor);
    await record(p, "clinical", remoteDesk);
    await networkPatient(p, localDoctor);
    await networkPatient(p, localDoctor);
    const first = await read(desk, p, { patientRequestConfirmed: true, limit: 1 });
    assert(first.data.nextCursor);
    await admin.query("DELETE FROM operational.patient_clinic_access WHERE patient_id=$1 AND clinic_id=$2", [p.id, desk.clinic]);
    assert.equal((await read(desk, p, { patientRequestConfirmed: true, cursor: first.data.nextCursor })).status, 404);
    await admin.query("BEGIN");
    let doctor: Actor;
    try {
      doctor = await actor("doctor", remoteDoctor.clinic);
      await admin.query("COMMIT");
    } catch (error) { await admin.query("ROLLBACK"); throw error; }
    await admin.query(`INSERT INTO operational.audit_log(user_id,clinic_id,action,patient_id,detail)
      VALUES($1,$2,'network.lookup',$3,$4::jsonb)`, [doctor.id, doctor.clinic, p.id,
      JSON.stringify({ outcome: "disclosed", sourceClinicId: desk.clinic })]);
    await admin.query("BEGIN");
    try {
      await admin.query("UPDATE operational.users SET role='receptionist',doctor_id=NULL WHERE id=$1", [doctor.id]);
      await admin.query("UPDATE operational.doctors SET user_id=NULL WHERE doctor_id=$1", [doctor.doctorId]);
      await admin.query("COMMIT");
    } catch (error) { await admin.query("ROLLBACK"); throw error; }
    const redacted = await read(remoteDesk, p);
    assert.equal(redacted.data.items[0].viewerName, null);
    assert.equal(redacted.data.items[0].viewerRole, null);
    assert.equal(redacted.data.items[0].viewerClinicName, null);
  });
});

test("consent: role × scope × level, transactional history and network disclosure", async t => {
  await t.test("extracted chips keep evidence and metadata behind Clinical consent", async () => {
    const { extractVisit } = await import("../src/alerts/service");
    const p = await patient();
    const v = await visit(p, localDoctor, "Started on blood pressure medication (Amlodipine 5mg) - review in 3 months");
    await extractVisit(v.id);
    assert.equal(await networkPatient(p), undefined);
    await record(p, "basic");
    basicOnly((await networkPatient(p))!);
    const c = await record(p, "clinical");
    const result = (await lookup(remoteDoctor, p.name));
    assert.equal(result.cacheControl, "private, no-store");
    const chips = result.data.items[0].visits[0].alerts;
    const chip = chips.find((a: { ruleId: string }) => a.ruleId === "med.amlodipine");
    assert(chip);
    assert.equal(chip.label, "Blood-pressure medication (Amlodipine 5 mg)");
    assert.equal(chip.sourceNoteExcerpt, v.note);
    assert.equal(chip.sourceVisitId, v.id);
    assert.equal(chip.patientId, p.id);
    assert.equal(chip.sourceClinicId, localDoctor.clinic);
    assert.equal(chip.sourceVisitDate, "2025-01-12");
    assert.equal(chip.crossClinicDisclaimerKey, "alerts.crossClinic");
    assert.equal((await lookup(desk, p.name)).status, 403);
    assert.equal((await lookup(manager, p.name)).status, 403);
    assert.equal(await networkPatient(p, liteDoctor), undefined);
    assert.equal(await networkPatient(p, otherDoctor), undefined, "same-clinic without trusted doctor scope is denied");
    await trustedDoctor(p);
    assert.equal((await lookup(localDoctor, p.name)).data.items[0].visits[0].alerts[1].crossClinicDisclaimerKey, null);
    assert.equal((await request(desk, `/consent/${c.id}/withdraw`, "POST", { clientOpId: randomUUID() })).status, 200);
    assert.equal(await networkPatient(p), undefined);
  });
  await t.test("consent read/write roles, clinic isolation, fresh PIN, trusted device and CSRF", async () => {
    const p = await patient();
    const initial = await consent(p);
    assert.deepEqual(initial, {
      current: null, history: [], effectiveLevel: "none", patient: { id: p.id, name: p.name }, canWithdraw: false,
      eligibility: { dateOfBirth: "1990-01-01", ageStatus: "adult", asOfDate: initial.eligibility.asOfDate },
    });
    for (const a of [localDoctor, otherDoctor]) assert.equal((await request(a, `/patients/${p.id}/consent`)).status, 404);
    await trustedDoctor(p);
    assert.deepEqual(await consent(p, localDoctor), initial);
    assert.equal((await request(null, `/patients/${p.id}/consent`)).status, 401);
    assert.equal((await request(manager, `/patients/${p.id}/consent`)).status, 403);
    for (const a of [remoteDoctor, remoteDesk]) {
      assert.equal((await request(a, `/patients/${p.id}/consent`)).status, 404);
      assert.equal((await request(a, `/patients/${p.id}/consent`, "POST", input())).status, a === remoteDoctor ? 403 : 404);
    }
    for (const a of [localDoctor, otherDoctor, manager]) {
      assert.equal((await request(a, `/patients/${p.id}/consent`, "POST", input())).status, 403);
    }
    assert.equal((await request(desk, `/patients/${p.id}/consent`, "POST", input(), false)).status, 403);
    assert.equal((await request({ ...desk, device: undefined }, `/patients/${p.id}/consent`, "POST", input())).status, 401);
    await admin.query("UPDATE operational.auth_sessions SET pin_verified_at=now()-interval '6 minutes' WHERE token_digest=$1", [digest(desk.session)]);
    try {
      assert.equal((await request(desk, `/patients/${p.id}/consent`)).status, 200);
      const stale = await request(desk, `/patients/${p.id}/consent`, "POST", input());
      assert.equal(stale.status, 403);
      assert.equal(stale.data.code, "REAUTH_REQUIRED");
    } finally {
      await admin.query("UPDATE operational.auth_sessions SET pin_verified_at=now() WHERE token_digest=$1", [digest(desk.session)]);
    }
    for (const a of [null, desk, manager, remoteDesk]) {
      assert.equal((await lookup(a, p.name)).status, a ? 403 : 401);
    }
  });

  await t.test("strict mutation validation rejects forged actor/scope and guardian-attribution fields", async () => {
    const p = await patient();
    for (const change of [
      { clinicId: remoteDoctor.clinic }, { patientId: p.id }, { recordedByUserId: manager.id },
      { recordedClinicId: remoteDoctor.clinic }, { givenBy: "guardian" }, { givenAt: "2020-01-01" },
      { withdrawnAt: new Date().toISOString() }, { level: "everything" }, { evidence: null },
      { evidence: "forged" }, { clientOpId: "not-a-uuid" }, { guardian: { name: "", relationship: "mother" } },
    ]) {
      assert.equal((await request(desk, `/patients/${p.id}/consent`, "POST", { ...input(), ...change })).status, 400, JSON.stringify(change));
    }
    for (const key of ["level", "evidence", "clientOpId"]) {
      const b: Record<string, unknown> = input(); delete b[key];
      assert.equal((await request(desk, `/patients/${p.id}/consent`, "POST", b)).status, 400);
    }
    assert.equal((await consent(p)).history.length, 0);
    assert.equal((await request(desk, "/patients/not-a-number/consent")).status, 400);
  });

  await t.test("consent metadata is server-owned, scoped and latest recording-clinic withdrawal authority", async () => {
    const p = await patient(), minor = await patient(desk, undefined, true);
    const state = await consent(p);
    assert.match(state.eligibility.asOfDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(state.patient, { id: p.id, name: p.name });
    assert.equal((await consent(minor)).eligibility.ageStatus, "minor");
    const first = await record(p);
    assert.equal((await consent(p)).canWithdraw, true);
    await trustedDoctor(p);
    assert.equal((await consent(p, localDoctor)).canWithdraw, false);
    await admin.query("INSERT INTO operational.patient_clinic_access(patient_id,clinic_id) VALUES($1,$2)", [p.id, remoteDesk.clinic]);
    assert.equal((await consent(p, remoteDesk)).canWithdraw, false);
    const replacement = await record(p, "basic", remoteDesk);
    assert.equal((await consent(p)).current.id, replacement.id);
    assert.equal((await consent(p)).canWithdraw, false);
    assert.equal((await consent(p, remoteDesk)).canWithdraw, true);
    assert.equal((await request(desk, `/consent/${first.id}/withdraw`, "POST", { clientOpId: randomUUID() })).status, 409);
    assert.equal((await request(remoteDesk, `/consent/${replacement.id}/withdraw`, "POST", { clientOpId: randomUUID() })).status, 200);
    assert.equal((await consent(p, remoteDesk)).canWithdraw, false);
    // Operational DOB is currently NOT NULL; unknown/future/invalid date fallbacks
    // are exercised directly in the pure eligibility policy tests, not by weakening DB constraints.
  });

  await t.test("minor consent needs its own guardian evidence, never merely registration guardian", async () => {
    const p = await patient(desk, undefined, true);
    assert.equal((await consent(p)).effectiveLevel, "none");
    assert.equal((await request(desk, `/patients/${p.id}/consent`, "POST", input())).status, 400);
    for (const guardian of [{ name: "Parent" }, { relationship: "mother" }, { name: " ", relationship: "mother" }]) {
      assert.equal((await request(desk, `/patients/${p.id}/consent`, "POST", { ...input(), guardian })).status, 400);
    }
    const r = await request(desk, `/patients/${p.id}/consent`, "POST", {
      ...input(), guardian: { name: "Consent parent", relationship: "mother" },
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const state = await consent(p);
    assert.equal(state.current.givenBy, "guardian");
    assert.equal(state.current.recordedByUserId, desk.id);
    assert.equal(state.current.recordedClinicId, desk.clinic);
    assert.equal(state.current.evidence, "signed");
    assert.equal(state.current.withdrawnAt, null);
    const row = (await admin.query("SELECT given_by,guardian_name,guardian_relation FROM operational.patient_consents WHERE patient_id=$1", [p.id])).rows[0];
    assert.deepEqual(row, { given_by: "guardian", guardian_name: "Consent parent", guardian_relation: "mother" });
  });

  await t.test("none/basic/clinical disclose only allowed network fields without a preexisting relationship", async () => {
    for (const level of ["none", "basic", "clinical"]) {
      const p = await patient();
      const v = await visit(p);
      await record(p, level);
      const state = await consent(p);
      assert.equal(state.effectiveLevel, level);
      assert.equal(state.current.recordedByUserId, desk.id);
      assert.equal(state.current.givenBy, "patient");
      assert.equal((await admin.query("SELECT count(*)::integer n FROM operational.patient_doctor_access WHERE patient_id=$1 AND doctor_id=$2", [p.id, remoteDoctor.doctorId])).rows[0].n, 0);
      const found = await networkPatient(p);
      if (level === "none") assert.equal(found, undefined);
      else {
        assert(found);
        if (level === "basic") {
          basicOnly(found);
          assert(!JSON.stringify(found).includes(v.note));
        } else {
          assert.equal(found.identityVerified, false);
          assert.equal(found.visits[0]!.visibility, "clinical");
          assert.equal(found.visits[0]!.complaint, v.note);
          assert(Array.isArray(found.visits[0]!.keyAlerts));
          assert(found.visits[0]!.keyAlerts!.length > 0);
        }
      }
      // Local demographic endpoints are never an accidental clinical-history adapter.
      for (const a of [desk, localDoctor, otherDoctor]) {
        const local = await request(a, `/patients/${p.id}`);
        assert.equal(local.status, 200);
        for (const field of ["visits", "history", "keyAlerts", "complaint", "consents"]) assert.equal(local.data[field], undefined);
      }
      assert.equal((await request(remoteDoctor, `/patients/${p.id}`)).status, 404);
    }
  });

  await t.test("trusted own-doctor clinical access is independent of sharing and never widens to another local doctor", async () => {
    const p = await patient();
    const local = await visit(p);
    const remote = await visit(p, remoteDoctor);
    await trustedDoctor(p);
    // A local mutable visit by a different doctor is not a trusted assignment.
    await visit(p, otherDoctor);
    const own = await networkPatient(p, localDoctor);
    assert(own);
    assert.equal(own.effectiveConsentLevel, "none", "local clinical authority is not network consent");
    assert.equal(own.visits.length, 2);
    assert(own.visits.every(v => v.clinicId === localDoctor.clinic && v.visibility === "clinical"));
    assert(own.visits.some(v => v.complaint === local.note));
    assert(!JSON.stringify(own).includes(remote.note), "own relationship is not authority for another clinic's visit");
    assert.equal(await networkPatient(p, otherDoctor), undefined);
    assert.equal((await request(otherDoctor, `/patients/${p.id}/consent`)).status, 404);
    assert.equal((await consent(p, localDoctor)).effectiveLevel, "none");
    await record(p, "clinical");
    const combined = await networkPatient(p, localDoctor);
    assert(combined);
    assert(combined.visits.some(v => v.clinicId === remoteDoctor.clinic && v.complaint === remote.note && v.visibility === "clinical"));
    assert(combined.visits.some(v => v.clinicId === localDoctor.clinic && v.complaint === local.note && v.visibility === "clinical"));
    await record(p, "basic");
    const downgraded = await networkPatient(p, localDoctor);
    assert(downgraded);
    assert.equal(downgraded.effectiveConsentLevel, "basic", "badge follows current consent despite local clinical visits");
    const cross = downgraded.visits.find(v => v.clinicId === remoteDoctor.clinic)!;
    assert.equal(cross.visibility, "basic");
    assert.equal(cross.complaint, undefined);
    assert.equal(cross.keyAlerts, undefined);
    assert(downgraded.visits.filter(v => v.clinicId === localDoctor.clinic).every(v => v.visibility === "clinical" && typeof v.complaint === "string"));
    // Even sharing does not confer local-own authority on another doctor.
    const unassigned = await networkPatient(p, otherDoctor);
    assert(unassigned);
    assert(unassigned.visits.every(v => v.clinicId === remoteDoctor.clinic && v.visibility === "basic"));
  });

  await t.test("a doctor link without clinic authority cannot unlock local own-patient access", async () => {
    const p = await patient(remoteDesk);
    await visit(p, localDoctor);
    await visit(p, remoteDoctor);
    await admin.query(`INSERT INTO operational.patient_doctor_access(patient_id,clinic_id,doctor_id)
      VALUES($1,$2,$3)`, [p.id, localDoctor.clinic, localDoctor.doctorId]);
    assert.equal((await request(localDoctor, `/patients/${p.id}/consent`)).status, 404);
    assert.equal(await networkPatient(p, localDoctor), undefined);
    await record(p, "basic", remoteDesk);
    const visible = await networkPatient(p, localDoctor);
    assert(visible);
    assert(visible.visits.every(v => v.clinicId === remoteDoctor.clinic && v.visibility === "basic"));
    assert.equal((await request(localDoctor, `/patients/${p.id}/consent`)).status, 404, "network sharing never confers local consent-history access");
  });

  await t.test("withdrawal takes effect on the next and every repeated request; older clinical consent never resurrects", async () => {
    const p = await patient();
    await visit(p);
    await record(p, "clinical");
    const newest = await record(p, "basic");
    basicOnly((await networkPatient(p))!);
    const op = { clientOpId: randomUUID() };
    const r = await request(desk, `/consent/${newest.id}/withdraw`, "POST", op);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    for (let n = 0; n < 4; n++) {
      assert.equal(await networkPatient(p), undefined);
      const state = await consent(p);
      assert.equal(state.effectiveLevel, "none");
      assert.equal(state.history.length, 2);
      assert(state.history.find((c: { id: number }) => c.id === newest.id).withdrawnAt);
    }
    const replay = await request(desk, `/consent/${newest.id}/withdraw`, "POST", op);
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.data, r.data);
    const rows = (await admin.query("SELECT level,withdrawn_at FROM operational.patient_consents WHERE patient_id=$1 ORDER BY id", [p.id])).rows;
    assert.equal(rows[0].level, "clinical");
    assert.equal(rows[0].withdrawn_at, null, "old grant retained for history, not resurrected");
    await record(p, "clinical");
    assert.equal((await networkPatient(p))!.visits[0]!.visibility, "clinical");
    await record(p, "none");
    assert.equal(await networkPatient(p), undefined, "explicit downgrade to none is immediate");
  });

  await t.test("withdraw authorization, PIN, CSRF and scope are independent of knowing a consent ID", async () => {
    const p = await patient(), c = await record(p);
    for (const a of [localDoctor, manager]) assert.equal((await request(a, `/consent/${c.id}/withdraw`, "POST", { clientOpId: randomUUID() })).status, 403);
    assert.equal((await request(remoteDesk, `/consent/${c.id}/withdraw`, "POST", { clientOpId: randomUUID() })).status, 404);
    assert.equal((await request(desk, `/consent/${c.id}/withdraw`, "POST", { clientOpId: randomUUID() }, false)).status, 403);
    for (const change of [{ clinicId: remoteDesk.clinic }, { recordedByUserId: manager.id }, { patientId: p.id }]) {
      assert.equal((await request(desk, `/consent/${c.id}/withdraw`, "POST", { clientOpId: randomUUID(), ...change })).status, 400);
    }
    await admin.query("UPDATE operational.auth_sessions SET pin_verified_at=now()-interval '6 minutes' WHERE token_digest=$1", [digest(desk.session)]);
    try {
      const r = await request(desk, `/consent/${c.id}/withdraw`, "POST", { clientOpId: randomUUID() });
      assert.equal(r.status, 403); assert.equal(r.data.code, "REAUTH_REQUIRED");
    } finally {
      await admin.query("UPDATE operational.auth_sessions SET pin_verified_at=now() WHERE token_digest=$1", [digest(desk.session)]);
    }
    assert.equal((await consent(p)).effectiveLevel, "clinical");
  });

  await t.test("Lite source and Lite requester never expose network visits, even with clinical consent", async () => {
    const p = await patient(liteDesk);
    await visit(p, liteDoctor);
    await record(p, "clinical", liteDesk);
    assert.equal(await networkPatient(p), undefined);
    const full = await patient();
    await visit(full);
    await record(full);
    const r = await lookup(liteDoctor, full.name);
    assert([200, 403].includes(r.status), JSON.stringify(r.data));
    if (r.status === 200) assert.deepEqual(r.data, { items: [], nextCursor: null });
    assert.equal((await consent(p, liteDesk)).effectiveLevel, "clinical", "Lite is a network exclusion, not consent deletion");
  });

  await t.test("duplicate display names remain separate candidates; cursor is stable and scope/query bound", async () => {
    const name = `Consent duplicates ${run}`;
    const a = await patient(desk, name), b = await patient(desk, name);
    assert.notEqual(a.id, b.id);
    for (const p of [a, b]) { await visit(p); await record(p, "basic"); }
    const first = await lookup(remoteDoctor, name, "&limit=1");
    assert.equal(first.status, 200);
    assert.equal(first.data.items.length, 1);
    assert.equal(first.data.items[0].identityVerified, false);
    assert.equal(typeof first.data.nextCursor, "string");
    const next = await lookup(remoteDoctor, name, `&limit=1&cursor=${encodeURIComponent(first.data.nextCursor)}`);
    assert.equal(next.status, 200);
    assert.deepEqual(new Set([first.data.items[0].id, next.data.items[0].id]), new Set([a.id, b.id]));
    assert.equal(next.data.nextCursor, null);
    assert.equal((await lookup(remoteDoctor, name + " changed", `&cursor=${encodeURIComponent(first.data.nextCursor)}`)).status, 400);
    assert.equal((await lookup(localDoctor, name, `&cursor=${encodeURIComponent(first.data.nextCursor)}`)).status, 400);
    for (const suffix of ["&limit=0", "&limit=101", "&cursor=invalid", "&clinicId=1", "&doctorId=1"]) {
      assert.equal((await lookup(remoteDoctor, name, suffix)).status, 400);
    }
    assert.equal((await lookup(remoteDoctor, "x")).status, 400);
  });

  await t.test("simultaneous replay is exactly-once; changed payload conflicts; concurrent decisions follow persisted order", async () => {
    const p = await patient();
    await visit(p);
    const op = input("clinical");
    const results = await Promise.all(Array.from({ length: 4 }, () => request(desk, `/patients/${p.id}/consent`, "POST", op)));
    for (const r of results) { assert.equal(r.status, 201, JSON.stringify(r.data)); assert.deepEqual(r.data, results[0]!.data); }
    assert.equal((await consent(p)).history.length, 1);
    assert.equal((await request(desk, `/patients/${p.id}/consent`, "POST", { ...op, level: "basic" })).status, 409);
    assert.equal((await request(secondDesk, `/patients/${p.id}/consent`, "POST", op)).status, 409, "receipt is actor-bound, not merely clinic-bound");
    assert.equal((await admin.query(`SELECT count(*)::integer n FROM operational.audit_log
      WHERE patient_id=$1 AND action='consent.record'`, [p.id])).rows[0].n, 1, "idempotent replay does not duplicate mutation audits");
    const mutations = await Promise.all(["basic", "clinical", "none"].map(level =>
      request(desk, `/patients/${p.id}/consent`, "POST", input(level))));
    for (const r of mutations) assert.equal(r.status, 201, JSON.stringify(r.data));
    const state = await consent(p);
    assert.equal(state.history.length, 4);
    const rows = (await admin.query("SELECT id,level FROM operational.patient_consents WHERE patient_id=$1 ORDER BY id DESC", [p.id])).rows;
    assert.equal(state.current.id, rows[0].id);
    assert.equal(state.effectiveLevel, rows[0].level);
    const race = await Promise.all([
      request(desk, `/consent/${state.current.id}/withdraw`, "POST", { clientOpId: randomUUID() }),
      request(desk, `/patients/${p.id}/consent`, "POST", input("basic")),
    ]);
    assert([200, 409].includes(race[0]!.status), JSON.stringify(race[0]!.data));
    assert.equal(race[1]!.status, 201, JSON.stringify(race[1]!.data));
    assert.equal((await consent(p)).effectiveLevel, "basic");
    basicOnly((await networkPatient(p))!);
    assert.equal((await request(desk, `/patients/${p.id}/consent`, "POST", op)).status, 201);
    assert.equal((await consent(p)).effectiveLevel, "basic", "replaying an older receipt cannot reapply its clinical grant");
  });

  await t.test("network audits cover every disclosed visit, no-result and denied requests without logging sensitive text", async () => {
    const p = await patient();
    const firstVisit = await visit(p);
    const secondVisit = await visit(p, otherDoctor);
    await record(p, "clinical");
    const response = await lookup(remoteDoctor, p.name);
    assert.equal(response.status, 200);
    assert.equal(response.data.items[0].visits.length, 2);
    assert.equal(response.cacheControl, "private, no-store");
    assert(response.requestId);
    const rows = (await admin.query(`SELECT * FROM operational.audit_log
      WHERE detail->>'correlationId'=$1 ORDER BY id`, [response.requestId])).rows;
    assert.equal(rows.length, 2, "one audit per disclosed cross-clinic visit");
    assert.deepEqual(new Set(rows.map(row => row.detail.sourceVisitId)), new Set([firstVisit.id, secondVisit.id]));
    for (const row of rows) {
      assert.equal(row.action, "network.lookup");
      assert.equal(row.user_id, remoteDoctor.id);
      assert.equal(row.clinic_id, remoteDoctor.clinic);
      assert.equal(row.patient_id, p.id);
      assert.equal(row.detail.outcome, "disclosed");
      assert.equal(row.detail.projection, "clinical");
      assert.equal(row.detail.effectiveLevel, "clinical");
      assert.equal(row.detail.sourceClinicId, localDoctor.clinic);
      for (const secret of [p.name, firstVisit.note, secondVisit.note, "0599876543", "allergy.test"]) {
        assert(!JSON.stringify(row.detail).includes(secret));
      }
    }
    const noMatch = await lookup(remoteDoctor, `No match ${randomUUID()}`);
    assert.equal(noMatch.status, 200);
    assert.deepEqual(noMatch.data, { items: [], nextCursor: null });
    const noResult = (await admin.query("SELECT * FROM operational.audit_log WHERE detail->>'correlationId'=$1", [noMatch.requestId])).rows;
    assert.equal(noResult.length, 1);
    assert.equal(noResult[0].detail.outcome, "no-result");
    assert.equal(noResult[0].patient_id, null);
    for (const a of [desk, manager, null]) {
      const denied = await lookup(a, p.name);
      assert.equal(denied.status, a ? 403 : 401);
      const audit = (await admin.query("SELECT * FROM operational.audit_log WHERE detail->>'correlationId'=$1", [denied.requestId])).rows;
      assert.equal(audit.length, 1);
      assert.equal(audit[0].detail.outcome, "denied");
      assert.equal(audit[0].patient_id, null);
      assert.equal(audit[0].user_id, a?.id ?? null);
      assert(!JSON.stringify(audit[0].detail).includes(p.name));
    }
  });

  await t.test("database audit rejection rolls back record/withdraw and fails closed before network disclosure", async () => {
    const p = await patient();
    await visit(p);
    let rejectAction = "consent.record";
    let rejectUser = desk.id;
    let rejected = 0;
    const originals = new Map<PoolClient, PoolClient["query"]>();
    // Scope fault injection to this process's acquired runtime clients and one
    // actor/action. Force a real NOT NULL failure in the existing audit INSERT:
    // no persistent trigger, global role change, schema edit, or audit deletion.
    const inject = (client: PoolClient) => {
      if (originals.has(client)) return;
      const original = client.query;
      originals.set(client, original);
      client.query = function (this: PoolClient, ...args: unknown[]) {
        const sql = args[0], values = args[1];
        if (typeof sql === "string" && /INSERT INTO operational\.audit_log\(user_id,clinic_id,action,patient_id,detail\)/.test(sql)
          && Array.isArray(values) && values[0] === rejectUser && values[2] === rejectAction) {
          const failingValues = [...values];
          failingValues[2] = null;
          args[1] = failingValues;
          rejected++;
        }
        return Reflect.apply(original, this, args);
      } as PoolClient["query"];
    };
    pool.on("acquire", inject);
    try {
      const op = input();
      const failed = await request(desk, `/patients/${p.id}/consent`, "POST", op);
      assert.equal(failed.status, 500, JSON.stringify(failed.data));
      assert.deepEqual(failed.data, { code: "INTERNAL", messageKey: "error.internal", params: {} });
      assert.equal((await consent(p)).history.length, 0, "grant rolled back with rejected audit");
      assert.equal((await admin.query("SELECT count(*)::integer n FROM operational.consent_operations WHERE clinic_id=$1 AND client_op_id=$2", [desk.clinic, op.clientOpId])).rows[0].n, 0);
      rejectAction = "";
      const c = await record(p);
      rejectAction = "consent.withdraw";
      const withdrawOp = { clientOpId: randomUUID() };
      assert.equal((await request(desk, `/consent/${c.id}/withdraw`, "POST", withdrawOp)).status, 500);
      assert.equal((await consent(p)).effectiveLevel, "clinical");
      assert.equal((await consent(p)).current.withdrawnAt, null, "withdraw transition rolled back");
      assert.equal((await admin.query("SELECT count(*)::integer n FROM operational.consent_operations WHERE clinic_id=$1 AND client_op_id=$2", [desk.clinic, withdrawOp.clientOpId])).rows[0].n, 0);
      rejectAction = "network.lookup";
      rejectUser = remoteDoctor.id;
      const deniedDisclosure = await lookup(remoteDoctor, p.name);
      assert.equal(deniedDisclosure.status, 500);
      assert.deepEqual(deniedDisclosure.data, { code: "INTERNAL", messageKey: "error.internal", params: {} });
      assert.equal("items" in deniedDisclosure.data, false, "never return data if its audit cannot commit");
      const failedNoResult = await lookup(remoteDoctor, `No result ${randomUUID()}`);
      assert.equal(failedNoResult.status, 500, "no-result responses also require a committed audit");
      rejectAction = "network.lookup.denied";
      rejectUser = desk.id;
      assert.equal((await lookup(desk, p.name)).status, 500, "audit failures are not hidden by a normal authorization response");
      rejectAction = "patient.access-history.read";
      const failedHistory = await request(desk, `/patients/${p.id}/access-history`, "POST", { patientRequestConfirmed: true });
      assert.equal(failedHistory.status, 500);
      assert.deepEqual(failedHistory.data, { code: "INTERNAL", messageKey: "error.internal", params: {} });
      assert.equal("items" in failedHistory.data, false, "assisted history must not return if its audit cannot commit");
      rejectAction = "patient.access-history.denied";
      assert.equal((await request(desk, `/patients/${p.id}/access-history`, "POST", {})).status, 500);
      assert.equal(rejected, 7);
    } finally {
      pool.removeListener("acquire", inject);
      for (const [client, original] of originals) client.query = original;
    }
    assert((await networkPatient(p))!.visits.length > 0, "fault injection restored without affecting later requests");
  });

  await t.test("runtime audit is append-only: UPDATE, DELETE and TRUNCATE fail without altering retained evidence", async () => {
    const p = await patient();
    await record(p);
    const rows = (await admin.query("SELECT * FROM operational.audit_log WHERE user_id=ANY($1::integer[]) ORDER BY id", [users])).rows;
    assert(rows.length > 0);
    const auditId = rows[0].id;
    for (const statement of [
      `UPDATE operational.audit_log SET action='forged' WHERE id=${auditId}`,
      `DELETE FROM operational.audit_log WHERE id=${auditId}`,
      "TRUNCATE operational.audit_log",
    ]) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await assert.rejects(client.query(statement), (error: { code?: string }) => error.code === "42501");
      } finally { await client.query("ROLLBACK"); client.release(); }
    }
    assert.deepEqual((await admin.query("SELECT * FROM operational.audit_log WHERE id=$1", [auditId])).rows[0], rows[0]);
    const audit = (await admin.query("SELECT action,patient_id,user_id,clinic_id,detail FROM operational.audit_log WHERE user_id=ANY($1::integer[])", [users])).rows;
    for (const action of ["consent.record", "consent.withdraw", "network.lookup"]) {
      assert(audit.some(row => row.action === action), `missing ${action} audit`);
    }
    const recorded = audit.find(row => row.action === "consent.record" && row.patient_id === p.id);
    assert(recorded);
    assert.equal(recorded.user_id, desk.id);
    assert.equal(recorded.clinic_id, desk.clinic);
  });

  await t.test("database retains consent history and enforces minor guardian attribution even outside the API", async () => {
    const p = await patient(), c = await record(p);
    for (const statement of [
      `UPDATE operational.patient_consents SET level='none' WHERE id=${c.id}`,
      `UPDATE operational.patient_consents SET recorded_by_user=${manager.id} WHERE id=${c.id}`,
      `DELETE FROM operational.patient_consents WHERE id=${c.id}`,
      "TRUNCATE operational.patient_consents",
    ]) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await assert.rejects(client.query(statement), (error: { code?: string }) => error.code === "42501");
      } finally { await client.query("ROLLBACK"); client.release(); }
    }
    assert.equal((await consent(p)).effectiveLevel, "clinical");
    assert.equal((await consent(p)).history.length, 1);
    const minor = await patient(desk, undefined, true);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO operational.patient_consents
        (patient_id,level,given_by,recorded_by_user,recorded_clinic_id,evidence)
        VALUES($1,'clinical','patient',$2,$3,'signed')`, [minor.id, desk.id, desk.clinic]);
      await assert.rejects(client.query("COMMIT"), (error: { code?: string }) => error.code === "23514");
    } finally { await client.query("ROLLBACK"); client.release(); }
    assert.equal((await consent(minor)).history.length, 0);
  });
});

// Register after prerequisite tests so their local scheduling fixtures stay isolated.
if (process.env.PRIVACY_TEST_DATABASE_URL) {
  const { registerPrivacyRegression } = await import("./privacy/regression");
  registerPrivacyRegression({
    admin, pool, patient, actor, clinic, visit, trustedDoctor, request, record, input,
    actors: () => ({ localDoctor, remoteDoctor, desk, manager }),
  });
}
