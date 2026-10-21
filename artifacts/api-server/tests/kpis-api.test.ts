import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { parseKpiQuery, BASELINE_PERIOD } from "../src/kpis/period";
import { aggregateLookup, ingestLookup, isLookupTelemetryPath, lookupBody, summarizeLookup } from "../src/kpis/lookup";
import type { Auth } from "../src/lib/auth";

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("KPI tests prohibited in deployment");
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.AUTH_ALLOWED_ORIGINS = "http://lookup.test";
const { default: app } = await import("../src/app");
const { pool } = await import("@workspace/db");
const { refreshKpis } = await import("../src/kpis/service");
const { digest } = await import("../src/lib/auth");
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/api/kpis`;
const users: number[] = [];
let adminToken: string, doctorToken: string, clinicId: number;
let doctorId: number;
let seedBefore: unknown;
async function seedState() {
  return (await admin.query(`SELECT table_name,column_name,data_type,is_nullable,column_default
    FROM information_schema.columns WHERE table_schema='public'
    AND table_name IN ('clinics','doctors','patients','appointments','patient_visit_history','calendar_app_export')
    ORDER BY table_name,ordinal_position`)).rows;
}
before(async () => {
  await admin.connect();
  seedBefore = await seedState();
  const { rows: [clinic] } = await admin.query("SELECT clinic_id FROM operational.clinics ORDER BY clinic_id LIMIT 1");
  clinicId = clinic.clinic_id;
  await admin.query("BEGIN");
  const { rows: [doctor] } = await admin.query(`INSERT INTO operational.doctors(doctor_name,clinic_id,specialty,email)
    VALUES('KPI test',$1,'test',$2) RETURNING doctor_id`, [clinicId, `${randomUUID()}@kpis.test`]);
  doctorId = doctor.doctor_id;
  for (const role of ["administrator", "doctor"]) {
    const { rows: [user] } = await admin.query(`INSERT INTO operational.users(email,password_hash,role,clinic_id,doctor_id)
      VALUES($1,'unused',$2,$3,$4) RETURNING id`, [`${randomUUID()}@kpis.test`, role, role === "administrator" ? null : clinicId, role === "doctor" ? doctorId : null]);
    users.push(user.id);
    if (role === "doctor") await admin.query("UPDATE operational.doctors SET user_id=$1 WHERE doctor_id=$2", [user.id, doctorId]);
    const token = randomUUID();
    await admin.query(`INSERT INTO operational.auth_sessions(token_digest,user_id,csrf_token,absolute_expires_at)
      VALUES($1,$2,$3,now()+interval '1 hour')`, [digest(token), user.id, randomUUID()]);
    if (role === "administrator") adminToken = token; else doctorToken = token;
  }
  await admin.query("COMMIT");
});
after(async () => {
  try {
    assert.deepEqual(await seedState(), seedBefore);
    await admin.query("BEGIN");
    await admin.query("DELETE FROM operational.auth_sessions WHERE user_id=ANY($1::int[])", [users]);
    await admin.query("UPDATE operational.doctors SET user_id=NULL WHERE doctor_id=$1", [doctorId]);
    await admin.query("DELETE FROM operational.users WHERE id=ANY($1::int[])", [users]);
    await admin.query("DELETE FROM operational.doctors WHERE doctor_id=$1", [doctorId]);
    await admin.query("COMMIT");
  } finally {
    server.close();
    await pool.end();
    await admin.end();
  }
});
async function request(query: string, token?: string) {
  const res = await fetch(`${base}${query}`, { headers: token ? { cookie: `amal_session=${token}` } : {} });
  return { status: res.status, body: await res.json() };
}
test("KPI access is administrator-only with stable errors and strict filters", async () => {
  assert.equal((await request("?range=day")).status, 401);
  assert.equal((await request("?range=day", doctorToken)).status, 403);
  for (const query of ["", "?range=year", "?range=day&date=2026-02-30",
    "?range=day&doctorId=1", "?range=day&clinicId=-1", "?range=day&clinicId=2147483647",
    "?range=day&range=week", "?range=day&date=2101-01-01", "?range=day&start=2026-09-01"]) {
    const result = await request(query, adminToken);
    assert.equal(result.status, 400, query);
    assert.equal(result.body.messageKey, "error.validation");
  }
});
test("API GET is pure; explicit refresh persists evidence that reconciles against independent SQL", async () => {
  const snapshotState = async () => (await admin.query(`SELECT count(*)::integer AS count,
    md5(string_agg(row_to_json(s)::text,E'\\n' ORDER BY row_to_json(s)::text)) AS hash
    FROM operational.kpi_snapshots s`)).rows;
  const snapshotsBefore = await snapshotState();
  const response = await request("?range=month&date=2026-09-09", adminToken);
  assert.equal(response.status, 200);
  assert.deepEqual(await snapshotState(), snapshotsBefore, "GET must not persist or update KPI snapshots");
  const result = response.body;
  assert.equal(result.before.metrics.totalAppointments, 102);
  assert.equal(result.before.metrics.noShow.percent, 21.6);
  assert.deepEqual(result.before.period, BASELINE_PERIOD);
  assert.equal(result.comparison.equalExposure, false);
  const { rows: [expected] } = await admin.query(`SELECT count(*)::int AS n,
    count(*) FILTER(WHERE status='no_show')::numeric/nullif(count(*),0) AS ratio
    FROM operational.appointments WHERE scheduled_at >= $1 AND scheduled_at < $2`,
  [result.periodStart, result.periodEnd]);
  assert.equal(result.appointments, expected.n);
  assert.equal(result.noShowRate, expected.ratio === null ? null : Number(expected.ratio));
  const refreshed = await refreshKpis({ range: "month", date: "2026-09-09" });
  assert.deepEqual(refreshed.after.metrics, result.after.metrics);
  const { rows: [saved] } = await admin.query(`SELECT evidence FROM operational.kpi_snapshots
    WHERE date='2026-09-01' AND period_end='2026-10-01' AND metric='appointments'
    AND source='after' AND calculation_version=$1 AND clinic_id IS NULL`, [result.calculationVersion]);
  assert.deepEqual(saved.evidence.metrics, result.after.metrics);
  const forbidden = ["patientId", "doctorId", "actorId", "query", "clientOpId", "email", "phone", "complaint"];
  function check(value: unknown) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      // phone is the allowed booking-source aggregate bucket, never a phone value.
      assert(!forbidden.includes(key) || key === "phone" && typeof child === "number", key);
      check(child);
    }
  }
  check(result);
  assert.equal(result.after.telemetry.lookupTime.medianSeconds, null);
  assert.equal(result.after.telemetry.networkActivity.daily, null);
  assert.equal(result.after.telemetry.downtime.lost.value, null);
});
test("concurrent network/clinic refresh is unique and late operational arrivals replace totals", async () => {
  const query = { range: "day", date: "2095-01-08" };
  const initial = await refreshKpis(query);
  assert.equal(initial.noShowRate, null);
  await Promise.all(Array.from({ length: 4 }, () => refreshKpis(query)));
  await Promise.all(Array.from({ length: 3 }, () => refreshKpis({ ...query, clinicId: String(clinicId) })));
  const { rows: [counts] } = await admin.query(`SELECT count(*)::int AS n FROM operational.kpi_snapshots
    WHERE date='2095-01-08' AND source='after' AND calculation_version='amal-kpi-1'`);
  assert.equal(counts.n, 6); // three metric families per scope, not one row per refresh
  let appointmentId: number | undefined;
  try {
    const { rows: [inserted] } = await admin.query(`INSERT INTO operational.appointments
      (clinic_id,doctor_id,patient_id,scheduled_at,status,booking_method,duration_minutes)
      SELECT clinic_id,doctor_id,patient_id,$1,'no_show','amal_network',30
      FROM operational.appointments WHERE clinic_id=$2 ORDER BY appointment_id LIMIT 1 RETURNING appointment_id`,
    [initial.periodStart, clinicId]);
    appointmentId = inserted.appointment_id;
    const updated = await refreshKpis(query);
    assert.equal(updated.appointments, initial.appointments + 1);
    assert.equal(updated.noShowRate, 1);
    const { rows: [persisted] } = await admin.query(`SELECT value::int AS n FROM operational.kpi_snapshots
      WHERE date='2095-01-08' AND metric='appointments' AND source='after' AND clinic_id IS NULL
      AND calculation_version='amal-kpi-1'`);
    assert.equal(persisted.n, updated.appointments);
  } finally {
    if (appointmentId) await admin.query("DELETE FROM operational.appointments WHERE appointment_id=$1", [appointmentId]);
    await refreshKpis(query);
    await refreshKpis({ ...query, clinicId: String(clinicId) });
  }
});
test("Asia/Hebron calendar anchors preserve DST and exclusive local midnight", () => {
  const spring = parseKpiQuery({ range: "day", date: "2026-03-28" }).period;
  const autumn = parseKpiQuery({ range: "day", date: "2026-10-24" }).period;
  assert.equal((Date.parse(spring.end) - Date.parse(spring.start)) / 3600000, 23);
  assert.equal((Date.parse(autumn.end) - Date.parse(autumn.start)) / 3600000, 25);
  assert.equal(parseKpiQuery({ range: "week", date: "2026-09-13" }).period.startDate, "2026-09-07");
  assert.equal(parseKpiQuery({ range: "month", date: "2028-02-29" }).period.days, 29);
});
test("strict duration validation, path privacy variants and exact percentiles", () => {
  for (const durationMs of [-1, 0.1, NaN, Infinity, "1", Number.MAX_SAFE_INTEGER + 1, null]) {
    assert.equal(lookupBody.safeParse({ durationMs }).success, false);
  }
  assert.equal(lookupBody.safeParse({ durationMs: 1, clinicId }).success, false);
  for (const durationMs of [0, 1, Number.MAX_SAFE_INTEGER]) assert(lookupBody.safeParse({ durationMs }).success);
  for (const path of ["/api/kpis/lookup-duration", "/API/KPIS/LOOKUP-DURATION/", "/api/kpis/lookup-duration/?private=value"]) assert(isLookupTelemetryPath(path));
  assert.deepEqual([summarizeLookup([]).medianSeconds, summarizeLookup([]).p90Seconds], [null, null]);
  assert.equal(summarizeLookup([[1000, 1], [3000, 1]]).medianSeconds, 2);
  assert.equal(summarizeLookup([[1000, 9], [10000, 1]]).p90Seconds, 1);
});
test("lookup auth, strict API, concurrent daily increments, midnight attribution and refresh preservation", async () => {
  const { rows: [session] } = await admin.query("SELECT csrf_token FROM operational.auth_sessions WHERE token_digest=$1", [digest(doctorToken)]);
  const post = (token?: string, body: unknown = { durationMs: 10 }, csrf = session.csrf_token, path = "/kpis/lookup-duration") =>
    fetch(base.replace(/\/kpis$/, "") + path, { method: "POST", headers: {
      origin: "http://lookup.test", "content-type": "application/json", "x-csrf-token": csrf,
      ...(token ? { cookie: `amal_session=${token}` } : {}),
    }, body: JSON.stringify(body) });
  const auth = { id: users[1], role: "doctor", clinicId, doctorId } as Auth;
  const query = { range: "week", date: "2094-06-09", clinicId: String(clinicId) };
  const period = parseKpiQuery(query).period;
  // Two adjacent receipt dates with deliberately unequal counts. Range median
  // must be 1s, not the 5.5s average of the two daily medians.
  const first = new Date("2094-06-08T20:59:59Z"), second = new Date("2094-06-08T21:00:00Z");
  const { rows: [auditBefore] } = await admin.query("SELECT count(*)::int AS n FROM operational.audit_log WHERE user_id=$1", [auth.id]);
  const client = await pool.connect();
  try {
    await ingestLookup(auth, { durationMs: 1000 }, first);
    const { rows: [original] } = await admin.query("SELECT generated_at FROM operational.kpi_snapshots WHERE metric='lookup_duration_ms' AND clinic_id=$1 AND date='2094-06-08'", [clinicId]);
    await Promise.all([
      ...Array.from({ length: 19 }, () => ingestLookup(auth, { durationMs: 1000 }, first)),
      ...Array.from({ length: 2 }, () => ingestLookup(auth, { durationMs: 10000 }, second)),
      refreshKpis(query),
    ]);
    const result = await refreshKpis(query);
    assert.equal(result.after.telemetry.lookupTime.sampleCount, 22);
    assert.equal(result.after.telemetry.lookupTime.medianSeconds, 1);
    assert.equal(result.after.telemetry.lookupTime.p90Seconds, 1);
    const { rows } = await admin.query("SELECT date::text,evidence,generated_at FROM operational.kpi_snapshots WHERE metric='lookup_duration_ms' AND clinic_id=$1 AND date BETWEEN '2094-06-08' AND '2094-06-09' ORDER BY date", [clinicId]);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(r => r.evidence), [
      { sampleCount: 20, frequencies: { "1000": 20 } },
      { sampleCount: 2, frequencies: { "10000": 2 } },
    ]);
    assert.equal(rows[0].generated_at.toISOString(), original.generated_at.toISOString());
    await client.query("SET TIME ZONE 'Pacific/Honolulu'");
    assert.equal((await aggregateLookup(client, period.start, period.end, clinicId)).sampleCount, 22);
    await assert.rejects(ingestLookup({ ...auth, clinicId: 2147483647 }, { durationMs: 1 }));
    const { rows: [auditAfter] } = await admin.query("SELECT count(*)::int AS n FROM operational.audit_log WHERE user_id=$1", [auth.id]);
    assert.equal(auditAfter.n, auditBefore.n);
    assert.equal((await post()).status, 401);
    assert.equal((await post(adminToken)).status, 403);
    assert.equal((await post(doctorToken, { durationMs: 1 }, "wrong")).status, 403);
    assert.equal((await post(doctorToken, { durationMs: 1, clinicId: 999 })).status, 400);
    assert.equal((await post(doctorToken, { durationMs: -1 })).status, 400);
    // Unknown query fields are rejected even on Express's valid case/trailing-
    // slash variants; the equivalent queryless variant remains a valid receipt.
    const today = parseKpiQuery({ range: "day" }).period.startDate;
    const { rows: [saved] } = await admin.query("SELECT id,evidence FROM operational.kpi_snapshots WHERE metric='lookup_duration_ms' AND clinic_id=$1 AND date=$2", [clinicId, today]);
    try {
      assert.equal((await post(doctorToken, { durationMs: 0 }, session.csrf_token, "/KPIS/LOOKUP-DURATION/?ignored=true")).status, 400);
      assert.equal((await post(doctorToken, { durationMs: 0 }, session.csrf_token, "/KPIS/LOOKUP-DURATION/")).status, 204);
    } finally {
      if (saved) await admin.query("UPDATE operational.kpi_snapshots SET evidence=$2 WHERE id=$1", [saved.id, saved.evidence]);
      else await admin.query("DELETE FROM operational.kpi_snapshots WHERE metric='lookup_duration_ms' AND clinic_id=$1 AND date=$2", [clinicId, today]);
    }
  } finally {
    await client.query("RESET TIME ZONE");
    client.release();
    await admin.query("DELETE FROM operational.kpi_snapshots WHERE clinic_id=$1 AND date BETWEEN $2 AND $3 AND source='after'", [clinicId, period.startDate, period.endDateExclusive]);
  }
});
