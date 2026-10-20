import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import pg from "pg";
import scenario from "../src/adoption/scenario.json";

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("Adoption results tests prohibited in deployment");
}
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
const { default: app } = await import("../src/app");
const { pool } = await import("@workspace/db");
const { digest } = await import("../src/lib/auth");
const { adoptionResults, parseScenario, resultsWindow } = await import("../src/adoption/results");
const { LOOKUP_METRIC, LOOKUP_VERSION } = await import("../src/kpis/lookup");
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/api`;
const originalConfig = structuredClone(scenario);
const clinics: number[] = [], users: number[] = [], doctors: number[] = [];
let doctorToken: string, adminToken: string, receptionToken: string, deviceToken: string, deviceId: number;
let seedBefore: unknown;
let ready = false;

async function seedState() {
  const state: Record<string, unknown> = {};
  for (const table of ["clinics", "doctors", "patients", "appointments", "patient_visit_history", "calendar_app_export"]) {
    state[table] = (await admin.query(`SELECT count(*)::integer AS count,
      md5(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text)) AS hash FROM public.${table} t`)).rows;
  }
  return state;
}
function configure(value: unknown) {
  // Test-process memory only: never write the committed config or seed tables.
  for (const key of Object.keys(scenario)) delete (scenario as Record<string, unknown>)[key];
  Object.assign(scenario, value);
}
const validConfig = () => ({ trialClinicId: clinics[0], resultClinicIds: [clinics[2], clinics[1]] });
async function request(path = "/adoption/results", token: string | null = doctorToken, device?: string) {
  const response = await fetch(`${base}${path}`, { headers: token ? {
    cookie: `amal_session=${token}${device ? `; amal_device=${device}` : ""}`,
  } : {} });
  return { status: response.status, headers: response.headers, body: await response.json() };
}
async function operation(clinicId: number, status: string, code: string | null, at: string) {
  const clientOpId = randomUUID();
  await admin.query(`INSERT INTO operational.appointment_operations
    (client_op_id,actor_id,clinic_id,doctor_id,payload_hash,result,status,created_at,request)
    VALUES($1,$2,$3,$4,'test-only',$5,$6,$7,'{"target":"create"}')`,
  [clientOpId, users[0], clinicId, doctors[0], JSON.stringify(code ? { code } : { id: 123 }), status, at]);
  return clientOpId;
}
async function distribution(clinicId: number, day: string, frequencies: Record<string, number>) {
  await admin.query(`INSERT INTO operational.kpi_snapshots
    (date,period_end,metric,clinic_id,value,source,calculation_version,evidence)
    VALUES($1::date,$1::date+1,$2,$3,NULL,'after',$4,$5)`,
  [day, LOOKUP_METRIC, clinicId, LOOKUP_VERSION, JSON.stringify({
    sampleCount: Object.values(frequencies).reduce((a, b) => a + b, 0), frequencies,
  })]);
}
before(async () => {
  await admin.connect();
  seedBefore = await seedState();
  ready = true;
  // Generated operational keys deliberately bear no relation to scenario IDs or names.
  for (let n = 0; n < 4; n++) {
    const { rows: [clinic] } = await admin.query(`INSERT INTO operational.clinics
      (clinic_name,city,booking_method,adoption_state,network_mode) VALUES($1,'test','phone','trial','lite') RETURNING clinic_id`,
    [`Renamed ${randomUUID()}`]);
    clinics.push(clinic.clinic_id);
  }
  const { rows: [doctor] } = await admin.query(`INSERT INTO operational.doctors
    (doctor_name,clinic_id,specialty,email) VALUES('Private doctor',$1,'test',$2) RETURNING doctor_id`,
  [clinics[0], `${randomUUID()}@results.test`]);
  doctors.push(doctor.doctor_id);
  for (const role of ["doctor", "administrator", "receptionist"]) {
    await admin.query("BEGIN");
    const { rows: [user] } = await admin.query(`INSERT INTO operational.users
      (email,password_hash,role,clinic_id,doctor_id) VALUES($1,'unused',$2,$3,$4) RETURNING id`,
    [`${randomUUID()}@results.test`, role, role === "administrator" ? null : clinics[0], role === "doctor" ? doctor.doctor_id : null]);
    users.push(user.id);
    if (role === "doctor") await admin.query("UPDATE operational.doctors SET user_id=$1 WHERE doctor_id=$2", [user.id, doctor.doctor_id]);
    if (role === "receptionist") {
      const { rows: [device] } = await admin.query("INSERT INTO operational.devices(clinic_id,label) VALUES($1,'results-test') RETURNING id", [clinics[0]]);
      deviceId = device.id;
      deviceToken = randomUUID();
      await admin.query("INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)", [deviceId, digest(deviceToken)]);
    }
    const token = randomUUID();
    await admin.query(`INSERT INTO operational.auth_sessions
      (token_digest,user_id,csrf_token,device_id,absolute_expires_at)
      VALUES($1,$2,$3,$4,now()+interval '1 hour')`,
    [digest(token), user.id, randomUUID(), role === "receptionist" ? deviceId : null]);
    if (role === "doctor") doctorToken = token;
    else if (role === "administrator") adminToken = token;
    else receptionToken = token;
    await admin.query("COMMIT");
  }
  configure(validConfig());
});
after(async () => {
  configure(originalConfig);
  await new Promise<void>(resolve => server.close(() => resolve()));
  try {
    if (ready) {
      await admin.query("ROLLBACK");
      assert.deepEqual(await seedState(), seedBefore, "all six seed tables unchanged");
      await admin.query("BEGIN");
      await admin.query("SET LOCAL ROLE amal_demo_reset");
      await admin.query("DELETE FROM operational.audit_log WHERE clinic_id=ANY($1::int[]) OR user_id=ANY($2::int[])", [clinics, users]);
      await admin.query("DELETE FROM operational.appointment_operations WHERE clinic_id=ANY($1::int[])", [clinics]);
      await admin.query("RESET ROLE");
      await admin.query("DELETE FROM operational.kpi_snapshots WHERE clinic_id=ANY($1::int[])", [clinics]);
      await admin.query("DELETE FROM operational.auth_sessions WHERE user_id=ANY($1::int[])", [users]);
      if (deviceId) {
        await admin.query("DELETE FROM operational.auth_devices WHERE device_id=$1", [deviceId]);
        await admin.query("DELETE FROM operational.devices WHERE id=$1", [deviceId]);
      }
      await admin.query("SET CONSTRAINTS ALL DEFERRED");
      await admin.query("DELETE FROM operational.users WHERE id=ANY($1::int[])", [users]);
      await admin.query("DELETE FROM operational.doctors WHERE doctor_id=ANY($1::int[])", [doctors]);
      await admin.query("DELETE FROM operational.clinics WHERE clinic_id=ANY($1::int[])", [clinics]);
      await admin.query("COMMIT");
    }
  } finally { await admin.end(); await pool.end(); }
});

test("configuration is strict, explicit, distinct and cannot infer identities", () => {
  for (const raw of [undefined, null, {}, { trialClinicId: null, resultClinicIds: null },
    { trialClinicId: 1, resultClinicIds: [2] }, { trialClinicId: 1, resultClinicIds: [2, 3, 4] },
    { trialClinicId: 1, resultClinicIds: [1, 2] }, { trialClinicId: 1, resultClinicIds: [2, 2] },
    { trialClinicId: "1", resultClinicIds: [2, 3] }, { trialClinicId: 0, resultClinicIds: [2, 3] },
    { trialClinicId: 2147483648, resultClinicIds: [2, 3] },
    { trialClinicId: 1, resultClinicIds: [2, 3], clinicNames: ["A", "B"] }]) {
    assert.equal(parseScenario(raw), null, JSON.stringify(raw));
  }
  assert.deepEqual(parseScenario(validConfig()), validConfig());
});

test("fixed rolling complete-week window uses exclusive Asia/Hebron midnights across DST", () => {
  const spring = resultsWindow(new Date("2026-03-30T12:00:00Z"));
  assert.equal(spring.startDate, "2026-03-23");
  assert.equal(spring.endDateExclusive, "2026-03-30");
  assert.equal(spring.days, 7);
  assert.equal((Date.parse(spring.end) - Date.parse(spring.start)) / 3600000, 167);
  const autumn = resultsWindow(new Date("2026-10-26T12:00:00Z"));
  assert.equal((Date.parse(autumn.end) - Date.parse(autumn.start)) / 3600000, 169);
});

test("authentication, device trust, no arbitrary filters, and admin KPI boundary", async () => {
  assert.equal((await request("/adoption/results", null)).status, 401);
  assert.equal((await request("/adoption/results", adminToken)).status, 403);
  assert.equal((await request("/adoption/results", receptionToken)).status, 401);
  assert.equal((await request("/adoption/results", receptionToken, deviceToken)).status, 200);
  for (const query of ["?clinicId=1", "?date=2026-01-01", "?range=week", "?doctorId=1",
    "?clinicId=1&clinicId=2", "?anything="]) {
    assert.equal((await request(`/adoption/results${query}`)).status, 400, query);
  }
  assert.equal((await request("/kpis?range=week")).status, 403);
  assert.equal((await request("/kpis?range=week", receptionToken, deviceToken)).status, 403);
  await admin.query("UPDATE operational.auth_sessions SET revoked_at=now() WHERE token_digest=$1", [digest(doctorToken)]);
  assert.equal((await request()).status, 401);
  await admin.query("UPDATE operational.auth_sessions SET revoked_at=NULL WHERE token_digest=$1", [digest(doctorToken)]);
});

test("missing, malformed, ambiguous and unresolved config fails closed with no clinic disclosure", async () => {
  try {
    for (const config of [{}, { trialClinicId: null, resultClinicIds: null }, { ...validConfig(), trialClinicId: clinics[1] },
      { ...validConfig(), resultClinicIds: [clinics[1], clinics[1]] }]) {
      configure(config);
      const response = await request();
      assert.equal(response.status, 200);
      assert.equal(response.body.available, false);
      assert.equal(response.body.reason, "SCENARIO_UNCONFIGURED");
      assert.deepEqual(response.body.clinics, []);
    }
    // Choose a missing identity explicitly; never silently select a replacement.
    const { rows: [missing] } = await admin.query("SELECT max(clinic_id)+1 AS id FROM operational.clinics");
    configure({ ...validConfig(), trialClinicId: missing.id });
    const result = await request();
    assert.equal(result.body.reason, "SCENARIO_CLINICS_UNAVAILABLE");
    assert.deepEqual(result.body.clinics, []);
  } finally { configure(validConfig()); }
});

test("renamed/rekeyed configured clinics only, independent no-evidence states and no read mutations", async () => {
  const before = (await admin.query("SELECT to_jsonb(c) AS row FROM operational.clinics c WHERE clinic_id=ANY($1::int[]) ORDER BY clinic_id", [clinics])).rows;
  const sessions = (await admin.query("SELECT last_seen_at FROM operational.auth_sessions WHERE token_digest=$1", [digest(doctorToken)])).rows;
  const result = await request();
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.equal(result.body.available, true);
  assert.deepEqual(result.body.clinics.map((c: { clinicId: number }) => c.clinicId), validConfig().resultClinicIds);
  for (const clinic of result.body.clinics) {
    assert.match(clinic.clinicName, /^Renamed /);
    assert.equal(clinic.preventedBlocks.value, null);
    assert.equal(clinic.preventedBlocks.reason, "NO_PREVENTION_EVIDENCE");
    assert.equal(clinic.preventedBlocks.sampleCount, 0);
    assert.equal(clinic.medianLookupSeconds.value, null);
    assert.equal(clinic.medianLookupSeconds.reason, "NO_LOOKUP_SAMPLES");
  }
  await admin.query("UPDATE operational.clinics SET clinic_name='Same renamed source name' WHERE clinic_id=ANY($1::int[])", [validConfig().resultClinicIds]);
  const renamed = await request();
  assert(renamed.body.clinics.every((c: { clinicName: string }) => c.clinicName === "Same renamed source name"));
  assert.deepEqual(renamed.body.clinics.map((c: { clinicId: number }) => c.clinicId), validConfig().resultClinicIds);
  // The GET itself must not upgrade Trial or refresh sessions.
  const afterRows = (await admin.query("SELECT to_jsonb(c) AS row FROM operational.clinics c WHERE clinic_id=ANY($1::int[]) ORDER BY clinic_id", [clinics])).rows;
  for (let i = 0; i < before.length; i++) {
    assert.deepEqual({ ...afterRows[i].row, clinic_name: before[i].row.clinic_name }, before[i].row);
  }
  assert.deepEqual((await admin.query("SELECT last_seen_at FROM operational.auth_sessions WHERE token_digest=$1", [digest(doctorToken)])).rows, sessions);
});

test("actual blocks, warnings excluded, observed zero vs missing, exact whole-window median and scalar-only disclosure", async () => {
  const window = resultsWindow();
  const at = new Date(Date.parse(window.start) + 3600000).toISOString();
  const zeroClinic = clinics[1], blockedClinic = clinics[2];
  // A completed decision proves an observed zero in this partial instrumented scope.
  const override = await operation(zeroClinic, "applied", null, at);
  await admin.query(`INSERT INTO operational.audit_log(user_id,clinic_id,action,detail,at)
    VALUES($1,$2,'appointment.patient_overlap_override',$3,$4)`,
  [users[0], zeroClinic, JSON.stringify({ clientOpId: override, reason: "private" }), at]);
  await operation(blockedClinic, "conflict", "APPOINTMENT_CONFLICT", at);
  await operation(blockedClinic, "conflict", "VERSION_CONFLICT", at);
  await operation(blockedClinic, "rejected", "HOLD_EXPIRED", at);
  // End is exclusive. Another nonpublished clinic and trial evidence must not leak.
  await operation(blockedClinic, "conflict", "APPOINTMENT_CONFLICT", window.end);
  await operation(clinics[0], "conflict", "APPOINTMENT_CONFLICT", at);
  await operation(clinics[3], "conflict", "APPOINTMENT_CONFLICT", at);
  await distribution(blockedClinic, window.startDate, { "1000": 9 });
  const nextDay = new Date(`${window.startDate}T12:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  await distribution(blockedClinic, nextDay.toISOString().slice(0, 10), { "10000": 1 });
  await distribution(zeroClinic, window.startDate, { "0": 1 });
  const result = await request();
  assert.equal(result.status, 200);
  const [blocked, zero] = result.body.clinics;
  assert.equal(blocked.preventedBlocks.value, 1);
  assert.equal(blocked.preventedBlocks.sampleCount, 1);
  assert.equal(blocked.preventedBlocks.units, "blocks");
  assert.equal(blocked.medianLookupSeconds.value, 1, "merged window median, not daily median average");
  assert.equal(blocked.medianLookupSeconds.sampleCount, 10);
  assert.equal(zero.preventedBlocks.available, true);
  assert.equal(zero.preventedBlocks.value, 0, "approved warning/override is not a prevented block");
  assert.equal(zero.preventedBlocks.sampleCount, 1);
  assert.equal(zero.medianLookupSeconds.available, true);
  assert.equal(zero.medianLookupSeconds.value, 0, "zero-duration evidence is genuine zero");
  assert.equal(zero.medianLookupSeconds.sampleCount, 1);
  assert.deepEqual(Object.keys(result.body).sort(), ["available", "calculationVersion", "clinics", "generatedAt", "reason", "window"]);
  for (const clinic of result.body.clinics) {
    assert.deepEqual(Object.keys(clinic).sort(), ["clinicId", "clinicName", "medianLookupSeconds", "preventedBlocks"]);
    for (const metric of [clinic.preventedBlocks, clinic.medianLookupSeconds]) {
      assert.deepEqual(Object.keys(metric).sort(), ["available", "coverage", "provenance", "reason", "sampleCount", "units", "value"]);
      assert(Object.values(metric).every(value => value === null || typeof value !== "object"));
    }
  }
  const noEvidence = await adoptionResults(new Date("2090-01-10T12:00:00Z"), validConfig());
  assert(noEvidence.clinics.every(clinic => clinic.preventedBlocks.value === null && clinic.medianLookupSeconds.value === null));
});
