import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import express from "express";
import cookieParser from "cookie-parser";
import pg from "pg";
import { ZodError } from "zod/v4";
import { pool } from "@workspace/db";
import { digest } from "../src/lib/auth";
import { ApiError } from "../src/lib/auth-errors";
import networkRouter from "../src/routes/network-health";
import syncRouter from "../src/routes/sync";
import { heartbeatTimeoutSeconds } from "../src/network-health/service";

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Network tests prohibited in deployment");
process.env.NODE_ENV = "test";
process.env.NETWORK_HEARTBEAT_TIMEOUT_SECONDS = "120";
const schema = `network_test_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
const originalConnect = pool.connect.bind(pool);
const originalQuery = pool.query.bind(pool);
const rewrite = (sql: string) => sql.replaceAll("operational.", `${schema}.`);
type Actor = { id: number; session: string; csrf: string; device?: string; deviceId?: number };
let server: ReturnType<express.Express["listen"]>;
let base: string, clinicId: number, emptyClinicId: number, doctorId: number, patientId: number;
let manager: Actor, desk: Actor, other: Actor;
let seedBefore: unknown;
async function seedSnapshot() {
  const snapshot = [];
  for (const table of ["clinics", "doctors", "patients", "appointments", "patient_visit_history", "calendar_app_export"]) {
    snapshot.push((await admin.query(`SELECT count(*)::integer n,
      md5(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text)) h FROM public.${table} t`)).rows[0]);
  }
  return snapshot;
}
async function actor(role = "receptionist"): Promise<Actor> {
  const { rows: [user] } = await pool.query(`INSERT INTO operational.users(email,password_hash,role,clinic_id)
    VALUES($1,'unused',$2,$3) RETURNING id`, [`${randomUUID()}@network.test`, role, role === "administrator" ? null : clinicId]);
  const result: Actor = { id: user.id, session: randomUUID(), csrf: randomUUID() };
  if (role === "receptionist") {
    result.deviceId = (await pool.query("INSERT INTO operational.devices(clinic_id,label) VALUES($1,'networkTest') RETURNING id", [clinicId])).rows[0].id;
    result.device = randomUUID();
    await pool.query("INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)", [result.deviceId, digest(result.device)]);
  }
  await pool.query(`INSERT INTO operational.auth_sessions(token_digest,user_id,device_id,csrf_token,absolute_expires_at,pin_verified_at)
    VALUES($1,$2,$3,$4,now()+interval '8 hours',now())`, [digest(result.session), result.id, result.deviceId ?? null, result.csrf]);
  return result;
}
async function request(actor: Actor | null, path: string, body?: unknown, csrf = true) {
  const response = await fetch(base + path, { method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(actor ? {
      cookie: `amal_session=${actor.session}; amal_device=${actor.device ?? ""}`,
      ...(csrf ? { "x-csrf-token": actor.csrf } : {}),
    } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json() as any };
}
const beat = (a: Actor, sequence: number, count = 3) => request(a, "/network/heartbeat", { sequence, unsubmittedOperationCount: count });
const health = async () => {
  const result = await request(manager, "/network/health");
  assert.equal(result.status, 200);
  return result.data.clinics.find((c: any) => c.clinicId === clinicId);
};
before(async () => {
  await admin.connect();
  seedBefore = await seedSnapshot();
  await admin.query(`CREATE SCHEMA ${schema}`);
  // Disposable real PostgreSQL tables; no production/fixture rows are modified.
  const { rows } = await admin.query("SELECT tablename FROM pg_tables WHERE schemaname='operational'");
  for (const { tablename } of rows) {
    assert.match(tablename, /^[a-z_]+$/);
    await admin.query(`CREATE TABLE ${schema}.${tablename} (LIKE operational.${tablename} INCLUDING ALL)`);
  }
  const migration = await readFile(new URL("../../../lib/db/migrations/0013_network_health.sql", import.meta.url), "utf8");
  await admin.query(rewrite(migration));
  await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO amal_app;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO amal_app;
    GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO amal_app`);
  (pool as any).query = async (text: string, values?: unknown[]) => {
    const client = await originalConnect();
    try { return await client.query(rewrite(text), values); } finally { client.release(); }
  };
  (pool as any).connect = async () => {
    const client = await originalConnect();
    const query = client.query.bind(client), release = client.release.bind(client);
    (client as any).query = (text: string, ...args: unknown[]) => (query as any)(rewrite(text), ...args);
    client.release = (...args) => { client.query = query; client.release = release; release(...args); };
    return client;
  };
  clinicId = (await pool.query("INSERT INTO operational.clinics(clinic_name,city,booking_method) VALUES('Observed','Test','phone') RETURNING clinic_id")).rows[0].clinic_id;
  emptyClinicId = (await pool.query("INSERT INTO operational.clinics(clinic_name,city,booking_method,network_mode) VALUES('Never observed','Test','phone','lite') RETURNING clinic_id")).rows[0].clinic_id;
  doctorId = (await pool.query("INSERT INTO operational.doctors(clinic_id,doctor_name,specialty,email) VALUES($1,'Test','Test',$2) RETURNING doctor_id", [clinicId, `${randomUUID()}@network.test`])).rows[0].doctor_id;
  patientId = (await pool.query(`INSERT INTO operational.patients(patient_name,phone,dob,name_normalized,created_clinic_id)
    VALUES('Test','0599000000','1990-01-01','test',$1) RETURNING patient_id`, [clinicId])).rows[0].patient_id;
  await pool.query("INSERT INTO operational.patient_clinic_access(patient_id,clinic_id) VALUES($1,$2)", [patientId, clinicId]);
  manager = await actor("administrator"); desk = await actor(); other = await actor();
  const app = express();
  app.use(express.json(), cookieParser(), networkRouter, syncRouter);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = error instanceof ApiError ? error.status : error instanceof ZodError ? 400 : 500;
    res.status(status).json({ code: error instanceof ApiError ? error.code : status === 400 ? "VALIDATION" : "INTERNAL" });
  });
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address(); assert(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  (pool as any).connect = originalConnect; (pool as any).query = originalQuery;
  try {
    assert.deepEqual(await seedSnapshot(), seedBefore, "Six workbook tables are unchanged");
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally { await admin.end(); await pool.end(); }
});

test("network telemetry: authority, freshness, distinct queues and successful sync evidence", async t => {
  await t.test("admin health enumerates never-observed clinics offline with unknown queues", async () => {
    assert.equal((await request(null, "/network/health")).status, 401);
    assert.equal((await request(desk, "/network/health")).status, 403);
    const { data } = await request(manager, "/network/health");
    const empty = data.clinics.find((c: any) => c.clinicId === emptyClinicId);
    assert.equal(empty.connectivity, "offline");
    assert.equal(empty.unsubmittedOperationCount, null);
    assert.equal(empty.queueCoverage.complete, false);
    assert.equal(empty.lastSuccessfulSyncAt, null);
  });
  await t.test("opaque device cookie, session binding, CSRF and strict allowlist", async () => {
    assert.equal((await request(null, "/network/heartbeat", { sequence: 1, unsubmittedOperationCount: 0 })).status, 401);
    assert.equal((await request(desk, "/network/heartbeat", { sequence: 1, unsubmittedOperationCount: 0 }, false)).status, 403);
    assert.equal((await beat({ ...desk, device: other.device }, 1)).status, 401);
    for (const field of [{ deviceId: other.deviceId }, { clinicId: emptyClinicId }, { lastSuccessfulSyncAt: new Date().toISOString() }, { receivedAt: new Date().toISOString() }]) {
      assert.equal((await request(desk, "/network/heartbeat", { sequence: 1, unsubmittedOperationCount: 0, ...field })).status, 400);
    }
    assert.equal((await beat(desk, 0)).status, 400);
    assert.equal((await beat(desk, 1, -1)).status, 400);
  });
  await t.test("monotonic receipts reject replay without refreshing server receipt time", async () => {
    assert.equal((await beat(desk, 10)).status, 200);
    const initial = (await health()).devices.find((d: any) => d.deviceId === desk.deviceId);
    assert.equal((await beat(desk, 10, 99)).data.code, "HEARTBEAT_REPLAY");
    assert.equal((await beat(desk, 9)).status, 409);
    const replayed = (await health()).devices.find((d: any) => d.deviceId === desk.deviceId);
    assert.equal(replayed.lastHeartbeatAt, initial.lastHeartbeatAt);
    assert.equal(replayed.unsubmittedOperationCount, 3);
    const concurrent = await Promise.all([beat(desk, 11), beat(desk, 11)]);
    assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
    assert.equal((await health()).unsubmittedOperationCount, null, "Second device is still unknown");
    assert.equal((await beat(other, 1, 2)).status, 200);
    assert.equal((await health()).unsubmittedOperationCount, 5);
  });
  await t.test("expiry and revocation cannot report or refresh heartbeat", async () => {
    await pool.query("UPDATE operational.auth_sessions SET absolute_expires_at=now()-interval '1 second' WHERE user_id=$1", [other.id]);
    assert.equal((await beat(other, 2)).status, 401);
    await pool.query("UPDATE operational.auth_sessions SET absolute_expires_at=now()+interval '1 hour' WHERE user_id=$1", [other.id]);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE operational.auth_devices SET revoked_at=clock_timestamp() WHERE device_id=$1", [other.deviceId]);
      const pending = beat(other, 2);
      await new Promise(resolve => setTimeout(resolve, 30));
      await client.query("COMMIT");
      assert.notEqual((await pending).status, 200);
    } finally { client.release(); }
    const state = await health();
    assert.equal(state.queueCoverage.revokedDeviceCount, 1);
    assert.equal(state.devices.find((d: any) => d.deviceId === other.deviceId).unsubmittedOperationCount, null);
  });
  let successfulAt: string;
  const input = { clientOpId: randomUUID(), clinicId: 0, doctorId: 0, patientId: 0,
    startsAt: "2091-06-04T09:00:00.000Z", endsAt: "2091-06-04T09:30:00.000Z", source: "phone" };
  const push = (sequence: number, booking = input) => request(desk, "/sync/push",
    { operations: [{ sequence, type: "create", input: booking }] });
  await t.test("only actual newly applied successful push writes server timestamp, not replay/empty/failure", async () => {
    assert.equal((await health()).lastSuccessfulSyncAt, null);
    Object.assign(input, { clinicId, doctorId, patientId });
    const result = await push(1);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.outcomes[0].status, "applied", JSON.stringify(result.data));
    successfulAt = (await health()).lastSuccessfulSyncAt;
    assert.ok(successfulAt);
    assert.equal((await pool.query("SELECT count(*)::integer n FROM operational.appointments")).rows[0].n, 1);
    assert.equal((await push(1)).status, 200);
    assert.equal((await request(desk, "/sync/push", { operations: [] })).status, 400);
    assert.equal((await health()).lastSuccessfulSyncAt, successfulAt);
    const appointmentId = result.data.outcomes[0].result.id;
    const noop = await request(desk, "/sync/push", { operations: [{
      sequence: 2, type: "update", appointmentId,
      input: { clientOpId: randomUUID(), expectedVersion: 1, status: "booked" },
    }] });
    assert.equal(noop.status, 200);
    assert.equal(noop.data.outcomes[0].status, "applied");
    assert.equal((await health()).lastSuccessfulSyncAt, successfulAt, "Version-only/no-op update is not sync progress");
  });
  await t.test("persisted open conflicts are counted once, never added to device UNSUBMITTED counts", async () => {
    const result = await push(3, { ...input, clientOpId: randomUUID() });
    assert.equal(result.status, 200);
    assert.equal(result.data.outcomes[0].status, "conflict");
    await beat(desk, 12, 3);
    const state = await health();
    assert.equal(state.serverOpenConflictCount, 1);
    assert.equal(state.unsubmittedOperationCount, 3);
    assert.equal(state.lastSuccessfulSyncAt, successfulAt);
    assert.equal((await push(4, { ...input, clientOpId: randomUUID() })).data.outcomes[0].status, "blocked");
    assert.equal((await health()).lastSuccessfulSyncAt, successfulAt);
  });
  await t.test("server receipt timeout produces offline/stale and unknown queue, configurable fail closed", async () => {
    await pool.query("UPDATE operational.device_network_health SET last_heartbeat_at=now()-interval '121 seconds' WHERE device_id=$1", [desk.deviceId]);
    const state = await health();
    assert.equal(state.connectivity, "offline");
    assert.equal(state.unsubmittedOperationCount, null);
    assert.equal(state.queueCoverage.staleDeviceCount, 1);
    assert.equal(state.lastSuccessfulSyncAt, successfulAt);
    process.env.NETWORK_HEARTBEAT_TIMEOUT_SECONDS = "180";
    assert.equal((await health()).connectivity, "online");
    process.env.NETWORK_HEARTBEAT_TIMEOUT_SECONDS = "NaN";
    assert.throws(heartbeatTimeoutSeconds);
    process.env.NETWORK_HEARTBEAT_TIMEOUT_SECONDS = "120";
  });
});
