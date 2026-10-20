import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import pg from "pg";

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Sync tests prohibited in deployment");
process.env.AUTH_ALLOWED_ORIGINS = "http://sync-test.local";
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
const base = `http://127.0.0.1:${address.port}/api`;
const marker = randomUUID();
const seedTables = ["clinics", "doctors", "patients", "appointments", "patient_visit_history", "calendar_app_export"];
const clinicIds: number[] = [], doctorIds: number[] = [], patientIds: number[] = [], userIds: number[] = [], deviceIds: number[] = [];
type Actor = { id: number; clinicId: number; doctorId: number | null; session: string; csrf: string; device?: string; deviceId?: number };
let desk: Actor, doctor: Actor, remote: Actor, manager: Actor;
let seedBefore: unknown, schemaBefore: unknown;
async function seedSnapshot() {
  const result: Record<string, unknown> = {};
  for (const table of seedTables) result[table] = (await admin.query(`SELECT count(*)::integer AS count,
    md5(string_agg(row_to_json(t)::text, E'\\n' ORDER BY row_to_json(t)::text)) AS hash FROM public.${table} t`)).rows[0];
  return result;
}
async function schemaSnapshot() {
  return (await admin.query(`SELECT table_schema,table_name,column_name,ordinal_position,data_type,
    is_nullable,column_default FROM information_schema.columns
    WHERE table_schema IN ('public','operational') ORDER BY table_schema,table_name,ordinal_position`)).rows;
}
async function makeActor(role: "doctor" | "receptionist" | "administrator" = "receptionist", clinicId = clinicIds[0]!, doctorId: number | null = null): Promise<Actor> {
  const { rows: [user] } = await admin.query(`INSERT INTO operational.users(email,password_hash,role,clinic_id,doctor_id)
    VALUES($1,'test-unused',$2,$3,$4) RETURNING id`, [`${randomUUID()}@sync.test`, role, clinicId, doctorId]);
  userIds.push(user.id);
  if (doctorId) await admin.query("UPDATE operational.doctors SET user_id=$1 WHERE doctor_id=$2", [user.id, doctorId]);
  const actor: Actor = { id: user.id, clinicId, doctorId, session: randomUUID(), csrf: randomUUID() };
  if (role === "receptionist") {
    const { rows: [device] } = await admin.query("INSERT INTO operational.devices(clinic_id,label) VALUES($1,'syncTest') RETURNING id", [clinicId]);
    deviceIds.push(device.id);
    actor.deviceId = device.id;
    actor.device = randomUUID();
    await admin.query("INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)", [device.id, digest(actor.device)]);
  }
  await admin.query(`INSERT INTO operational.auth_sessions(token_digest,user_id,device_id,csrf_token,absolute_expires_at,pin_verified_at)
    VALUES($1,$2,$3,$4,now()+interval '8 hours',now())`, [digest(actor.session), actor.id, actor.deviceId ?? null, actor.csrf]);
  return actor;
}
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
const interval = (slot: number) => {
  const startsAt = new Date(Date.UTC(2091, 5, 4, 0, slot * 60));
  return { startsAt: startsAt.toISOString(), endsAt: new Date(+startsAt + 30 * 60000).toISOString() };
};
const booking = (slot: number, patient = 0, doctorId = doctorIds[0]!, clinicId = clinicIds[0]!) =>
  ({ clientOpId: randomUUID(), clinicId, doctorId, patientId: patientIds[patient]!, ...interval(slot), source: "phone" });
const createOp = (sequence: number, input: ReturnType<typeof booking>) => ({ sequence, type: "create", input });
const updateOp = (sequence: number, appointmentId: number, input: Record<string, unknown>) => ({ sequence, type: "update", appointmentId, input });
async function push(actor: Actor, operations: unknown[]) {
  const result = await request(actor, "/sync/push", "POST", { operations });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data.outcomes;
}
async function restartPush(actor: Actor, operations: unknown[]) {
  // Fresh OS process, fresh authentication and a fresh DB pool: no application caches survive.
  const script = `
    import { authenticate } from ${JSON.stringify(new URL("../src/lib/auth.ts", import.meta.url).href)};
    import { pushSync } from ${JSON.stringify(new URL("../src/sync/service.ts", import.meta.url).href)};
    import { pool } from "@workspace/db";
    let text = ""; for await (const chunk of process.stdin) text += chunk;
    const input = JSON.parse(text);
    const req = { cookies: { amal_session: input.session, amal_device: input.device } };
    try {
      await new Promise((resolve, reject) => authenticate(req, {}, error => error ? reject(error) : resolve()));
      process.stdout.write(JSON.stringify(await pushSync(req.auth, { operations: input.operations })));
    } finally { await pool.end(); }
  `;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
  const finished = once(child, "close");
  child.stdin.end(JSON.stringify({ session: actor.session, device: actor.device, operations }));
  const [code] = await finished;
  assert.equal(code, 0, `Fresh-process sync probe failed: ${stderr}`);
  return JSON.parse(stdout).outcomes;
}
async function direct(actor: Actor, input: ReturnType<typeof booking>) {
  const result = await request(actor, "/appointments", "POST", input);
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data;
}
async function appointment(id: number) {
  return (await admin.query("SELECT * FROM operational.appointments WHERE appointment_id=$1", [id])).rows[0];
}
async function evidence() {
  return (await admin.query(`SELECT
    (SELECT count(*) FROM operational.appointments WHERE patient_id=ANY($1::integer[])) appointments,
    (SELECT count(*) FROM operational.appointment_operations WHERE actor_id=ANY($2::integer[])) operations,
    (SELECT count(*) FROM operational.sync_conflicts WHERE actor_id=ANY($2::integer[])) conflicts,
    (SELECT count(*) FROM operational.sync_changes WHERE clinic_id=ANY($3::integer[])) changes,
    (SELECT count(*) FROM operational.audit_log WHERE user_id=ANY($2::integer[])) audits`,
  [patientIds, userIds, clinicIds])).rows[0];
}
async function conflict(actor: Actor, slot: number, patient = 1) {
  await direct(desk, booking(slot, 0));
  const input = booking(slot, patient);
  const [outcome] = await push(actor, [createOp(1, input)]);
  assert.equal(outcome.status, "conflict", JSON.stringify(outcome));
  assert(outcome.conflictId);
  return { input, id: outcome.conflictId as string, outcome };
}
before(async () => {
  await admin.connect();
  seedBefore = await seedSnapshot();
  schemaBefore = await schemaSnapshot();
  await admin.query("BEGIN");
  for (let i = 0; i < 2; i++) {
    const { rows: [row] } = await admin.query(`INSERT INTO operational.clinics(clinic_name,city,booking_method,working_days,open_time,close_time,timezone)
      VALUES($1,'test','phone',ARRAY[0,1,2,3,4,5,6],'00:00','23:59','Asia/Hebron') RETURNING clinic_id`, [`sync-test-${marker}-${i}`]);
    clinicIds.push(row.clinic_id);
  }
  for (const clinicId of [clinicIds[0]!, clinicIds[0]!, clinicIds[1]!]) {
    const { rows: [row] } = await admin.query(`INSERT INTO operational.doctors(doctor_name,clinic_id,specialty,email)
      VALUES('sync-test',$1,'test',$2) RETURNING doctor_id`, [clinicId, `${randomUUID()}@sync.test`]);
    doctorIds.push(row.doctor_id);
  }
  for (let i = 0; i < 16; i++) {
    const { rows: [row] } = await admin.query(`INSERT INTO operational.patients(patient_name,phone,dob,name_normalized)
      VALUES($1,'sync-fixture-phone','1980-01-01',$1) RETURNING patient_id`, [`sync-test-${marker}-${i}`]);
    patientIds.push(row.patient_id);
    for (const clinicId of clinicIds) await admin.query("INSERT INTO operational.patient_clinic_access(patient_id,clinic_id) VALUES($1,$2)", [row.patient_id, clinicId]);
  }
  desk = await makeActor();
  doctor = await makeActor("doctor", clinicIds[0]!, doctorIds[0]!);
  remote = await makeActor("receptionist", clinicIds[1]!);
  manager = await makeActor("administrator");
  await admin.query("COMMIT");
});
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  try {
    await admin.query("ROLLBACK");
    await admin.query("BEGIN");
    await admin.query("DELETE FROM operational.sync_resolution_history WHERE actor_id=ANY($1::integer[])", [userIds]);
    await admin.query("DELETE FROM operational.sync_device_operations WHERE device_id=ANY($1::integer[])", [deviceIds]);
    await admin.query("DELETE FROM operational.sync_conflicts WHERE actor_id=ANY($1::integer[])", [userIds]);
    await admin.query("DELETE FROM operational.appointment_operations WHERE actor_id=ANY($1::integer[])", [userIds]);
    await admin.query("DELETE FROM operational.appointment_holds WHERE owner_id=ANY($1::integer[])", [userIds]);
    await admin.query("SET LOCAL ROLE amal_demo_reset");
    await admin.query("DELETE FROM operational.audit_log WHERE patient_id=ANY($1::integer[]) OR user_id=ANY($2::integer[])", [patientIds, userIds]);
    await admin.query("RESET ROLE");
    await admin.query("DELETE FROM operational.appointments WHERE patient_id=ANY($1::integer[])", [patientIds]);
    // Appointment deletion itself emits tombstones; remove those only after deleting fixtures.
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
    assert.deepEqual(await seedSnapshot(), seedBefore, "All six immutable seed tables remain byte-identical");
    assert.deepEqual(await schemaSnapshot(), schemaBefore, "Tests never change seed or operational schemas");
  } finally { await admin.end(); await pool.end(); }
});

test("sync API: ordered durable operations, explicit resolutions and scoped cursors", async t => {
  await t.test("authentication, CSRF, trusted devices and strict operational allowlist", async () => {
    const body = { operations: [createOp(1, booking(1))] };
    const before = await evidence();
    assert.equal((await request(null, "/sync/push", "POST", body)).status, 401);
    for (const actor of [doctor, manager]) assert.equal((await request(actor, "/sync/push", "POST", body)).status, 403);
    assert.equal((await request(desk, "/sync/push", "POST", body, false)).status, 403);
    assert.equal((await request(desk, "/sync/push", "POST", { operations: [{ sequence: 1, type: "delete", table: "patients", input: {} }] })).status, 400);
    assert.equal((await request(desk, "/sync/push", "POST", { operations: [createOp(1, { ...booking(1), clinicalNotes: "forbidden" } as never)] })).status, 400);
    assert.equal((await request(desk, "/sync/push", "POST", { operations: [] })).status, 400);
    assert.equal((await request(desk, "/sync/push", "POST", { operations: Array.from({ length: 51 }, (_, i) => createOp(i + 1, booking(1))) })).status, 400);
    assert.deepEqual(await evidence(), before);
  });
  await t.test("sequence gaps are recoverable; dependent updates/cancellation preserve declared order", async () => {
    const actor = await makeActor();
    const input = booking(2);
    const [gap] = await push(actor, [createOp(2, input)]);
    assert.equal(gap.code, "SEQUENCE_GAP");
    assert.equal(gap.expectedSequence, 1);
    const [created] = await push(actor, [createOp(1, input)]);
    assert.equal(created.status, "applied");
    const operations = [
      updateOp(2, created.result.id, { clientOpId: randomUUID(), expectedVersion: 1, ...interval(3) }),
      updateOp(3, created.result.id, { clientOpId: randomUUID(), expectedVersion: 2, status: "cancelled", cancelReason: "Offline patient cancellation" }),
    ];
    const outcomes = await push(actor, operations);
    assert.deepEqual(outcomes.map((o: { status: string }) => o.status), ["applied", "applied"]);
    assert.equal(outcomes[1].result.version, 3);
    assert.equal(outcomes[1].result.status, "cancelled");
    const before = await evidence();
    assert.deepEqual(await push(actor, operations), outcomes);
    assert.deepEqual(await restartPush(actor, operations), outcomes);
    assert.deepEqual(await evidence(), before, "Replay never duplicates writes, audits or feed events");
  });
  await t.test("simultaneous retries and direct/sync cross-endpoint retries share one ledger", async () => {
    const actor = await makeActor(), input = booking(4);
    const [a, b] = await Promise.all([push(actor, [createOp(1, input)]), push(actor, [createOp(1, input)])]);
    assert.deepEqual(a, b);
    assert.equal(a[0].status, "applied");
    const before = await evidence();
    assert.deepEqual((await request(actor, "/appointments", "POST", input)).data, a[0].result);
    assert.deepEqual(await evidence(), before);
    const input2 = booking(5);
    const first = await direct(actor, input2);
    const afterDirect = await evidence();
    assert.deepEqual((await push(actor, [createOp(2, input2)]))[0].result, first);
    assert.deepEqual(await evidence(), afterDirect);
    const input3 = booking(6);
    const [directResult, syncResult] = await Promise.all([
      request(actor, "/appointments", "POST", input3), push(actor, [createOp(3, input3)]),
    ]);
    assert.equal(directResult.status, 201);
    assert.deepEqual(syncResult[0].result, directResult.data);
    assert.equal((await admin.query("SELECT count(*)::int n FROM operational.appointments WHERE client_op_id=$1", [input3.clientOpId])).rows[0].n, 1);
    assert.equal((await admin.query("SELECT count(*)::int n FROM operational.sync_changes WHERE kind='appointment' AND entity_id=$1", [String(directResult.data.id)])).rows[0].n, 1);
  });
  await t.test("changed payload, target, sequence and owner cannot overwrite or disclose an operation", async () => {
    const actor = await makeActor(), input = booking(7);
    const [original] = await push(actor, [createOp(1, input)]);
    const before = await evidence();
    const [changed] = await push(actor, [createOp(1, { ...input, source: "walk-in" })]);
    assert.equal(changed.error.code, "IDEMPOTENCY_CONFLICT");
    assert.equal(changed.result, undefined);
    const [target] = await push(actor, [updateOp(1, original.result.id, { clientOpId: input.clientOpId, expectedVersion: 1, ...interval(8) })]);
    assert.equal(target.error.code, "IDEMPOTENCY_CONFLICT");
    const [reuse] = await push(actor, [createOp(1, booking(8))]);
    assert.equal(reuse.error.code, "SEQUENCE_REUSE");
    const [owner] = await push(await makeActor(), [createOp(1, input)]);
    assert.equal(owner.error.code, "IDEMPOTENCY_CONFLICT");
    assert.equal(owner.result, undefined);
    assert.deepEqual(await evidence(), before);
  });
  await t.test("authorized patient-overlap override is audited atomically and replay never duplicates that audit", async () => {
    const actor = await makeActor();
    await direct(desk, booking(42, 0));
    const input = { ...booking(42, 0, doctorIds[1]!), overrideReason: "Patient confirmed both appointments" };
    const [outcome] = await push(actor, [createOp(1, input)]);
    assert.equal(outcome.status, "applied", JSON.stringify(outcome));
    const audits = (await admin.query(`SELECT detail FROM operational.audit_log WHERE user_id=$1
      AND action='appointment.patient_overlap_override' AND detail->>'clientOpId'=$2`, [actor.id, input.clientOpId])).rows;
    assert.equal(audits.length, 1);
    assert.equal(audits[0].detail.reason, input.overrideReason);
    const before = await evidence();
    assert.deepEqual(await push(actor, [createOp(1, input)]), [outcome]);
    assert.deepEqual((await request(actor, "/appointments", "POST", input)).data, outcome.result);
    assert.deepEqual(await restartPush(actor, [createOp(1, input)]), [outcome]);
    assert.deepEqual(await evidence(), before);
  });
  await t.test("direct-first and sync-first conflicts replay the same durable outcome across endpoints", async () => {
    const actor = await makeActor();
    await direct(desk, booking(40, 13));
    const input = booking(40, 14);
    const first = await request(actor, "/appointments", "POST", input);
    assert.equal(first.status, 409);
    const before = await evidence();
    const [replayed] = await push(actor, [createOp(1, input)]);
    assert.equal(replayed.status, "conflict");
    assert.deepEqual({ code: replayed.code, messageKey: replayed.messageKey, params: replayed.params }, first.data);
    assert.deepEqual(await evidence(), before, "Direct conflict to sync cannot add conflict rows or events");
    const beforeRow = (await admin.query("SELECT * FROM operational.sync_conflicts WHERE client_op_id=$1", [input.clientOpId])).rows[0];
    assert.equal(beforeRow.id, replayed.conflictId);
    assert.deepEqual(await restartPush(actor, [createOp(1, input)]), [replayed]);
    assert.equal((await request(actor, "/appointments", "POST", { ...input, source: "walk-in" })).data.code, "IDEMPOTENCY_CONFLICT");
    const other = await makeActor(), saved = await conflict(other, 41, 15);
    const afterSync = await evidence();
    const directReplay = await request(other, "/appointments", "POST", saved.input);
    assert.equal(directReplay.status, 409);
    assert.deepEqual(directReplay.data, { code: saved.outcome.code, messageKey: saved.outcome.messageKey, params: saved.outcome.params });
    assert.deepEqual(await evidence(), afterSync);
    assert.equal((await admin.query("SELECT id FROM operational.sync_conflicts WHERE client_op_id=$1", [saved.input.clientOpId])).rows[0].id, saved.id);
  });
  await t.test("partial success persists conflict after business rollback and blocks later dependent operations", async () => {
    const actor = await makeActor();
    await direct(desk, booking(10));
    const input = booking(10, 1), first = booking(9, 2), last = booking(11, 3);
    const operations = [createOp(1, first), createOp(2, input), createOp(3, last)];
    const outcomes = await push(actor, operations);
    assert.deepEqual(outcomes.map((o: { status: string }) => o.status), ["applied", "conflict", "blocked"]);
    assert.equal(outcomes[2].code, "PREDECESSOR_UNRESOLVED");
    const before = await evidence();
    assert.deepEqual(await push(actor, operations), outcomes);
    assert.deepEqual(await evidence(), before);
    const fresh = new pg.Client({ connectionString: process.env.DATABASE_URL });
    try {
      await fresh.connect();
      const { rows: [saved] } = await fresh.query("SELECT * FROM operational.sync_conflicts WHERE id=$1", [outcomes[1].conflictId]);
      assert.equal(saved.status, "open");
      assert.deepEqual(saved.operation.payload, input);
      assert.equal((await fresh.query("SELECT count(*)::int n FROM operational.appointments WHERE client_op_id=ANY($1::text[])", [[input.clientOpId, last.clientOpId]])).rows[0].n, 0);
    } finally { await fresh.end(); }
    assert.deepEqual(await restartPush(actor, operations), outcomes, "Persisted results survive a fresh application process");
    assert.deepEqual(await evidence(), before, "Restart replay never duplicates conflict evidence or writes");
    assert.equal((await push(actor, [createOp(3, last)]))[0].code, "PREDECESSOR_UNRESOLVED");
  });
  await t.test("stale revision produces durable safe server evidence, not last-write-wins", async () => {
    const actor = await makeActor(), created = await direct(actor, booking(12));
    const moved = await request(actor, `/appointments/${created.id}`, "PATCH", { clientOpId: randomUUID(), expectedVersion: 1, ...interval(13) });
    assert.equal(moved.status, 200);
    const before = await appointment(created.id);
    const operation = updateOp(1, created.id, { clientOpId: randomUUID(), expectedVersion: 1, status: "cancelled", cancelReason: "stale offline cancellation" });
    const [outcome] = await push(actor, [operation]);
    assert.equal(outcome.status, "conflict");
    assert.equal(outcome.code, "VERSION_CONFLICT");
    assert.deepEqual(await appointment(created.id), before);
    const page = await request(actor, "/sync/conflicts");
    assert.equal(page.status, 200, JSON.stringify(page.data));
    const item = page.data.items.find((c: { id: string }) => c.id === outcome.conflictId);
    assert.equal(item.baseVersion, 1);
    assert.equal(item.targetId, created.id);
    assert.equal(item.serverState.version, 2);
    assert.equal(item.serverState.startsAt, moved.data.startsAt);
    assert.deepEqual(item.operation.payload, operation.input);
    assert(!JSON.stringify(item).includes("password"));
    assert.equal((await request(remote, "/sync/conflicts")).data.items.some((c: { id: string }) => c.id === item.id), false);
  });
  await t.test("call records follow-up without claiming a call or resolving; move-self retries and races are versioned", async () => {
    const actor = await makeActor(), saved = await conflict(actor, 14);
    const call = { clientOpId: randomUUID(), conflictId: saved.id, expectedVersion: 1, action: "call" };
    const first = await request(actor, "/sync/resolve", "POST", call);
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.status, "follow-up");
    assert.equal(first.data.called, false);
    assert.equal(first.data.phone, "sync-fixture-phone");
    const before = await evidence();
    assert.deepEqual((await request(actor, "/sync/resolve", "POST", call)).data, first.data);
    assert.deepEqual(await evidence(), before);
    assert.equal((await admin.query("SELECT status FROM operational.sync_conflicts WHERE id=$1", [saved.id])).rows[0].status, "open");
    const resolution = { clientOpId: randomUUID(), conflictId: saved.id, expectedVersion: 2, action: "move-self", ...interval(15) };
    const competing = { ...resolution, clientOpId: randomUUID(), ...interval(16) };
    const attempts = await Promise.all([request(actor, "/sync/resolve", "POST", resolution), request(actor, "/sync/resolve", "POST", competing)]);
    assert.deepEqual(attempts.map(a => a.status).sort(), [200, 409]);
    const winnerIndex = attempts[0].status === 200 ? 0 : 1;
    assert.equal(attempts[winnerIndex]!.data.status, "resolved");
    const after = await evidence();
    assert.deepEqual((await request(actor, "/sync/resolve", "POST", winnerIndex === 0 ? resolution : competing)).data, attempts[winnerIndex]!.data);
    assert.deepEqual(await evidence(), after);
    const history = await request(actor, "/sync/conflicts?status=resolved");
    const item = history.data.items.find((c: { id: string }) => c.id === saved.id);
    assert(item);
    assert.equal(item.history.length, 2);
    assert.deepEqual(item.operation.payload, saved.input, "Resolution retains original proposal");
    const changes = await request(actor, "/sync/pull?limit=100");
    assert.equal(changes.status, 200);
    assert.deepEqual(changes.data.changes.filter((c: { kind: string; entityId: string }) => c.kind === "conflict" && c.entityId === saved.id)
      .map((c: { payload: { status: string } }) => c.payload.status), ["open", "open", "resolved"], "Resolution state changes reach incremental pull");
    assert.equal((await push(actor, [createOp(2, booking(17, 4))]))[0].status, "applied");
  });
  await t.test("move-other rolls back both appointments on second-leg failure, retains history, then commits atomically", async () => {
    const actor = await makeActor();
    const blocker = await direct(desk, booking(18));
    const input = booking(18, 1);
    const [outcome] = await push(actor, [createOp(1, input)]);
    assert.equal(outcome.status, "conflict");
    // Move an unrelated appointment: proposal still collides with blocker, so second leg must fail.
    const unrelated = await direct(desk, booking(19, 2));
    const beforeRow = await appointment(unrelated.id);
    const failed = await request(actor, "/sync/resolve", "POST", {
      clientOpId: randomUUID(), conflictId: outcome.conflictId, expectedVersion: 1, action: "move-other",
      otherAppointmentId: unrelated.id, otherExpectedVersion: 1, ...interval(20),
    });
    assert.equal(failed.status, 200, JSON.stringify(failed.data));
    assert.equal(failed.data.status, "open");
    assert.deepEqual(await appointment(unrelated.id), beforeRow, "First move is rolled back if original proposal cannot commit");
    assert.equal((await admin.query("SELECT count(*)::int n FROM operational.sync_changes WHERE kind='appointment' AND entity_id=$1", [String(unrelated.id)])).rows[0].n, 1);
    const resolved = await request(actor, "/sync/resolve", "POST", {
      clientOpId: randomUUID(), conflictId: outcome.conflictId, expectedVersion: 2, action: "move-other",
      otherAppointmentId: blocker.id, otherExpectedVersion: 1, ...interval(21),
    });
    assert.equal(resolved.status, 200, JSON.stringify(resolved.data));
    assert.equal(resolved.data.status, "resolved");
    assert.equal(new Date((await appointment(blocker.id)).scheduled_at).toISOString(), interval(21).startsAt);
    assert.equal(resolved.data.appointment.startsAt, input.startsAt);
  });
  await t.test("move-other cannot cross clinic scope or write either leg on an authorization failure", async () => {
    const actor = await makeActor(), saved = await conflict(actor, 22);
    const other = await direct(remote, booking(23, 3, doctorIds[2]!, clinicIds[1]!));
    const before = await evidence(), row = await appointment(other.id);
    const denied = await request(actor, "/sync/resolve", "POST", {
      clientOpId: randomUUID(), conflictId: saved.id, expectedVersion: 1, action: "move-other",
      otherAppointmentId: other.id, otherExpectedVersion: 1, ...interval(24),
    });
    assert.equal(denied.status, 403, JSON.stringify(denied.data));
    assert.deepEqual(await appointment(other.id), row);
    assert.deepEqual(await evidence(), before);
    assert.equal((await request(remote, "/sync/resolve", "POST", {
      clientOpId: randomUUID(), conflictId: saved.id, expectedVersion: 1, action: "call",
    })).status, 403);
  });
  await t.test("overlapping requests from one device cannot overtake missing predecessors", async () => {
    const actor = await makeActor(), first = booking(25, 4), second = booking(26, 5);
    const [a, b] = await Promise.all([push(actor, [createOp(1, first)]), push(actor, [createOp(2, second)])]);
    assert.equal(a[0].status, "applied");
    assert(["applied", "blocked"].includes(b[0].status));
    if (b[0].status === "blocked") assert.equal(b[0].code, "SEQUENCE_GAP");
    assert.equal((await push(actor, [createOp(2, second)]))[0].status, "applied");
    const rows = (await admin.query(`SELECT sequence,client_op_id FROM operational.sync_device_operations
      WHERE device_id=$1 ORDER BY sequence`, [actor.deviceId])).rows;
    assert.deepEqual(rows, [{ sequence: 1, client_op_id: first.clientOpId }, { sequence: 2, client_op_id: second.clientOpId }]);
  });
  await t.test("unexpected feed failure rolls back the whole batch and remains retryable", async () => {
    const actor = await makeActor(), first = booking(27, 6), second = booking(28, 7);
    const name = `sync_test_${marker.replaceAll("-", "")}`;
    const before = await evidence();
    await admin.query(`CREATE FUNCTION operational.${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced sync feed failure'; END $$`);
    await admin.query(`CREATE TRIGGER ${name} BEFORE INSERT ON operational.sync_changes
      FOR EACH ROW WHEN (NEW.payload->>'clientOpId'='${second.clientOpId}') EXECUTE FUNCTION operational.${name}()`);
    try {
      const result = await request(actor, "/sync/push", "POST", { operations: [createOp(1, first), createOp(2, second)] });
      assert.equal(result.status, 500, JSON.stringify(result.data));
      assert.deepEqual(await evidence(), before, "Business writes, ledger, conflict and feed all roll back on transient failure");
      assert.equal((await admin.query("SELECT count(*)::int n FROM operational.sync_device_operations WHERE device_id=$1", [actor.deviceId])).rows[0].n, 0);
    } finally {
      await admin.query(`DROP TRIGGER ${name} ON operational.sync_changes`);
      await admin.query(`DROP FUNCTION operational.${name}()`);
    }
    const outcomes = await push(actor, [createOp(1, first), createOp(2, second)]);
    assert.deepEqual(outcomes.map((o: { status: string }) => o.status), ["applied", "applied"]);
  });
  await t.test("expired offline holds do not guarantee a slot; explicit resolution discards the stale token", async () => {
    const actor = await makeActor(), input = booking(29, 8);
    const { source: _source, ...holdInput } = input;
    const held = await request(actor, "/appointments/holds", "POST", holdInput);
    assert.equal(held.status, 201, JSON.stringify(held.data));
    await admin.query("UPDATE operational.appointment_holds SET expires_at=now()-interval '1 second' WHERE token=$1", [held.data.token]);
    const operation = createOp(1, { ...input, clientOpId: randomUUID(), holdToken: held.data.token } as never);
    const [outcome] = await push(actor, [operation]);
    assert.equal(outcome.status, "conflict");
    assert.equal((await admin.query("SELECT count(*)::int n FROM operational.appointments WHERE client_op_id=$1", [operation.input.clientOpId])).rows[0].n, 0);
    const resolved = await request(actor, "/sync/resolve", "POST", {
      clientOpId: randomUUID(), conflictId: outcome.conflictId, expectedVersion: 1, action: "move-self", ...interval(30),
    });
    assert.equal(resolved.status, 200, JSON.stringify(resolved.data));
    assert.equal(resolved.data.status, "resolved");
  });
  await t.test("UTC intervals survive the Hebron DST boundary without a second timezone conversion", async () => {
    const actor = await makeActor();
    const input = { ...booking(31, 9), startsAt: "2091-03-23T23:45:00.000Z", endsAt: "2091-03-24T00:15:00.000Z" };
    const offset = (instant: string) => new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Hebron", timeZoneName: "shortOffset" })
      .formatToParts(new Date(instant)).find(part => part.type === "timeZoneName")!.value;
    assert.notEqual(offset(input.startsAt), offset(input.endsAt), "Fixture actually crosses Hebron's DST transition");
    const [outcome] = await push(actor, [createOp(1, input)]);
    assert.equal(outcome.status, "applied", JSON.stringify(outcome));
    assert.equal(outcome.result.startsAt, input.startsAt);
    assert.equal(outcome.result.endsAt, input.endsAt);
    assert.equal(new Date((await appointment(outcome.result.id)).scheduled_at).toISOString(), input.startsAt);
    assert.equal((await request(actor, "/sync/push", "POST", {
      operations: [createOp(2, { ...booking(31), startsAt: "2091-03-24T03:30:00+03:00" })],
    })).status, 400);
  });
  await t.test("cached conflicts and operation replays do not redisclose remote existence after downgrade", async () => {
    const actor = await makeActor();
    await direct(remote, booking(90, 15, doctorIds[2]!, clinicIds[1]!));
    const input = booking(90, 15);
    const [original] = await push(actor, [createOp(1, input)]);
    assert.equal(original.status, "conflict");
    const stored = (await admin.query("SELECT reasons FROM operational.sync_conflicts WHERE id=$1", [original.conflictId])).rows[0];
    assert(stored.reasons.some((reason: { type: string }) => reason.type === "patient-overlap"));
    try {
      await admin.query(`UPDATE operational.clinics SET adoption_state='lite',network_mode='lite' WHERE clinic_id=$1`, [clinicIds[1]]);
      const page = await request(actor, "/sync/conflicts");
      assert.equal(page.status, 200);
      const item = page.data.items.find((row: { id: string }) => row.id === original.conflictId);
      assert(item);
      assert.deepEqual(item.reasons, []);
      const [replayed] = await push(actor, [createOp(1, input)]);
      assert.equal(replayed.status, "conflict", "keep durable device ordering; do not reapply a rejected proposal");
      assert.equal("conflictCount" in replayed.params, false);
      const onlineReplay = await request(actor, "/appointments", "POST", input);
      assert.equal(onlineReplay.status, 409);
      assert.equal("conflictCount" in onlineReplay.data.params, false);
      const check = await request(actor, "/appointments/check", "POST", input);
      assert.deepEqual(check.data, { ok: true, conflicts: [] });
      const localBooking = await request(actor, "/appointments", "POST", { ...input, clientOpId: randomUUID() });
      assert.equal(localBooking.status, 201);
      assert.deepEqual((await admin.query("SELECT reasons FROM operational.sync_conflicts WHERE id=$1", [original.conflictId])).rows[0], stored,
        "redaction is a delivery projection, not deletion of durable evidence");
    } finally {
      await admin.query(`UPDATE operational.clinics SET adoption_state='full',membership_status='active',network_mode='full' WHERE clinic_id=$1`, [clinicIds[1]]);
    }
  });
  await t.test("conflict pages are stable, scoped, retain original proposals and redact call history", async () => {
    const actor = await makeActor();
    const saved = await conflict(actor, 32);
    await direct(desk, booking(33, 2));
    const secondInput = booking(33, 3);
    const second = await request(actor, "/appointments", "POST", secondInput);
    assert.equal(second.status, 409);
    const call = await request(actor, "/sync/resolve", "POST", {
      clientOpId: randomUUID(), conflictId: saved.id, expectedVersion: 1, action: "call",
    });
    assert.equal(call.status, 200);
    const firstPage = await request(actor, "/sync/conflicts?limit=1");
    assert.equal(firstPage.status, 200, JSON.stringify(firstPage.data));
    assert.equal(firstPage.data.items.length, 1);
    assert(firstPage.data.nextCursor);
    const next = await request(actor, `/sync/conflicts?limit=1&cursor=${encodeURIComponent(firstPage.data.nextCursor)}`);
    assert.equal(next.status, 200);
    assert.equal(next.data.nextCursor, null);
    const all = [...firstPage.data.items, ...next.data.items];
    assert.equal(new Set(all.map(c => c.id)).size, 2);
    assert(all.some(c => c.id === saved.id));
    for (const item of all) {
      assert.deepEqual(Object.keys(item).sort(), ["id", "clientOpId", "operation", "targetId", "baseVersion", "serverState", "reasons", "status", "version", "createdAt", "updatedAt", "history"].sort());
      assert.equal(item.status, "open");
      assert(Array.isArray(item.reasons));
      assert(!JSON.stringify(item).includes("sync-fixture-phone"), "Phone is not copied into conflict history reads");
    }
    assert.equal((await request(remote, `/sync/conflicts?cursor=${encodeURIComponent(firstPage.data.nextCursor)}`)).status, 409);
    assert.equal((await request(actor, `/sync/conflicts?status=resolved&cursor=${encodeURIComponent(firstPage.data.nextCursor)}`)).status, 400);
    assert.equal((await request(actor, "/sync/conflicts?cursor=invalid")).status, 400);
  });
  await t.test("pull bootstraps and paginates all authorized changes without duplicates, with cancellations and safe fields", async () => {
    const actor = await makeActor(), input = booking(34, 10);
    const created = await direct(actor, input);
    const cancelled = await request(actor, `/appointments/${created.id}`, "PATCH", {
      clientOpId: randomUUID(), expectedVersion: 1, status: "cancelled", cancelReason: "private cancellation reason",
    });
    assert.equal(cancelled.status, 200);
    assert.equal((await request(null, "/sync/pull")).status, 401);
    assert.equal((await request(manager, "/sync/pull")).status, 403);
    const changes: { id: string; kind: string; entityId: string; payload: Record<string, unknown> }[] = [];
    let since: string | null = null, firstCursor = "";
    do {
      const page = await request(actor, `/sync/pull?limit=3${since ? `&since=${encodeURIComponent(since)}` : ""}`);
      assert.equal(page.status, 200, JSON.stringify(page.data));
      assert.equal(typeof page.data.since, "string");
      changes.push(...page.data.changes);
      if (!firstCursor) firstCursor = page.data.since;
      since = page.data.nextCursor;
      if (!since) since = null;
      assert(changes.length < 1000, "Pagination must make progress");
    } while (since);
    const expected = (await admin.query(`SELECT id::text FROM operational.sync_changes
      WHERE clinic_id=$1 AND (kind='appointment' OR (payload->>'actorId')::int=$2) ORDER BY id`, [actor.clinicId, actor.id])).rows.map(r => r.id);
    assert.deepEqual(changes.map(c => c.id), expected, "Cursor never advances past an undelivered authorized event");
    assert.equal(new Set(changes.map(c => c.id)).size, changes.length);
    for (const change of changes) {
      assert.equal(typeof change.id, "string", "Bigint change identities are serialized without precision loss");
      assert.deepEqual(Object.keys(change).sort(), ["id", "kind", "entityId", "payload"].sort());
      assert.equal(change.payload.clinicId, actor.clinicId);
      assert.deepEqual(Object.keys(change.payload).sort(), ["id", "clinicId", "doctorId", "patientId", "startsAt", "endsAt", "status", "source", "clientOpId", "version", "deleted"].sort());
      assert(!JSON.stringify(change).includes("private cancellation reason"));
    }
    const target = changes.filter(c => c.entityId === String(created.id));
    assert.deepEqual(target.map(c => c.payload.status), ["booked", "cancelled"]);
    assert.equal(target[1]!.payload.version, 2);
    assert.equal((await request(remote, `/sync/pull?since=${encodeURIComponent(firstCursor)}`)).status, 409);
    assert.equal((await request(actor, "/sync/pull?since=123")).status, 400);
    const [body, signature] = firstCursor.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, "base64url").toString()), after: "999999" })).toString("base64url");
    assert.equal((await request(actor, `/sync/pull?since=${encodeURIComponent(`${forgedBody}.${signature}`)}`)).status, 400, "Changing the position without a valid signature cannot skip data");
    assert.equal((await request(actor, `/sync/conflicts?cursor=${encodeURIComponent(firstCursor)}`)).status, 400);
    const own = await request(doctor, "/sync/pull?limit=100");
    assert.equal(own.status, 200);
    assert(own.data.changes.every((c: { payload: { doctorId: number } }) => c.payload.doctorId === doctor.doctorId));
  });
  await t.test("pull cannot skip a late-committing writer or a concurrent direct API commit", async () => {
    const actor = await makeActor();
    let since = "";
    // Drain bootstrap before creating the two concurrent changes.
    for (;;) {
      const page = await request(actor, `/sync/pull?limit=100${since ? `&since=${encodeURIComponent(since)}` : ""}`);
      assert.equal(page.status, 200);
      since = page.data.since;
      if (!page.data.nextCursor) break;
    }
    const writer = new pg.Client({ connectionString: process.env.DATABASE_URL });
    const late = booking(35, 11), concurrent = booking(36, 12);
    let lateId: number;
    let read: ReturnType<typeof request>, write: ReturnType<typeof request>;
    try {
      await writer.connect();
      await writer.query("BEGIN");
      const { rows: [row] } = await writer.query(`INSERT INTO operational.appointments
        (clinic_id,doctor_id,patient_id,scheduled_at,booking_method,status,client_op_id)
        VALUES($1,$2,$3,$4,'phone','booked',$5) RETURNING appointment_id`,
      [late.clinicId, late.doctorId, late.patientId, late.startsAt, late.clientOpId]);
      lateId = row.appointment_id;
      // The trigger has allocated the event while retaining the same transaction lock used by pull.
      read = request(actor, `/sync/pull?limit=1&since=${encodeURIComponent(since)}`);
      write = request(actor, "/appointments", "POST", concurrent);
      await writer.query("COMMIT");
    } finally { await writer.query("ROLLBACK"); await writer.end(); }
    const [firstPage, created] = await Promise.all([read!, write!]);
    assert.equal(firstPage.status, 200, JSON.stringify(firstPage.data));
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const delivered = [...firstPage.data.changes];
    since = firstPage.data.since;
    for (;;) {
      const page = await request(actor, `/sync/pull?limit=1&since=${encodeURIComponent(since)}`);
      assert.equal(page.status, 200);
      delivered.push(...page.data.changes);
      since = page.data.since;
      if (!page.data.nextCursor) break;
    }
    assert.deepEqual(delivered.map(c => c.entityId).sort(), [String(lateId!), String(created.data.id)].sort());
    assert.equal(new Set(delivered.map(c => c.id)).size, 2);
    const empty = await request(actor, `/sync/pull?since=${encodeURIComponent(since)}`);
    assert.deepEqual(empty.data.changes, []);
    assert.equal(empty.data.since, since, "An empty poll does not advance past unseen events");
    await admin.query("UPDATE operational.users SET clinic_id=$2 WHERE id=$1", [actor.id, clinicIds[1]]);
    try {
      assert.equal((await request(actor, `/sync/pull?since=${encodeURIComponent(since)}`)).status, 401, "Changed current device/clinic scope invalidates the session");
    } finally { await admin.query("UPDATE operational.users SET clinic_id=$2 WHERE id=$1", [actor.id, actor.clinicId]); }
  });
});
