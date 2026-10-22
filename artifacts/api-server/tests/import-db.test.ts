import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomInt, createHash } from "node:crypto";
import pg from "pg";
import { pool } from "@workspace/db";
import type { Auth } from "../src/lib/auth";
import { uploadImport, mapImport, commitImport, getImport, importReport } from "../src/imports/service";
import { createAppointment } from "../src/appointments/service";
import { localTime, wallToUtc } from "../src/imports/validation";
import { GetImportBatchResponse, DownloadImportReportResponse } from "@workspace/api-zod";

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Import tests prohibited in deployment");
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
let actor: Auth, other: Auth, doctor: any, patient: any, clinic: any, baseline: unknown;
const users: number[] = [], appointments: number[] = [], createdPatients: number[] = [], batches: number[] = [];
const devices: number[] = [];
const namespace = `import-test-${randomUUID()}`;
let eventId = randomInt(100000000, 1000000000), dayOffset = 0;
async function snapshot() {
  const s: Record<string, unknown> = {};
  for (const t of ["clinics", "doctors", "patients", "appointments", "patient_visit_history", "calendar_app_export"]) {
    s[t] = (await admin.query(`SELECT count(*)::integer n,md5(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text)) hash FROM public.${t} t`)).rows[0];
  }
  return s;
}
async function makeActor(clinicId: number): Promise<Auth> {
  const { rows: [u] } = await admin.query("INSERT INTO operational.users(email,password_hash,role,clinic_id) VALUES($1,'unused','receptionist',$2) RETURNING id,email", [`${randomUUID()}@imports.test`, clinicId]);
  users.push(u.id);
  // Booking now revalidates persisted session/device authority, not just Auth.
  const device = (await admin.query("INSERT INTO operational.devices(clinic_id,label) VALUES($1,'import-test') RETURNING id", [clinicId])).rows[0].id;
  devices.push(device);
  await admin.query("INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)", [device, randomUUID()]);
  const sessionDigest = randomUUID();
  await admin.query(`INSERT INTO operational.auth_sessions(token_digest,user_id,device_id,csrf_token,absolute_expires_at)
    VALUES($1,$2,$3,'unused',now()+interval '1 hour')`, [sessionDigest, u.id, device]);
  return { id: u.id, email: u.email, role: "front-desk", clinicId, doctorId: null, locale: "en", theme: "light",
    sessionDigest, csrfToken: "unused", device: { id: device, clinicId },
    expiresAt: new Date(Date.now() + 3600000), absoluteExpiresAt: new Date(Date.now() + 3600000), pinVerifiedAt: new Date() };
}
function slot() {
  // Distinct real working dates, based solely on operational clinic settings.
  for (;;) {
    const d = new Date(Date.UTC(2042, 0, 1 + dayOffset++));
    if (!clinic.working_days.includes(d.getUTCDay())) continue;
    const date = d.toISOString().slice(0, 10);
    return `${date}T${String(clinic.open_time).slice(0, 5)}:00`;
  }
}
function source(start = slot(), status = "confirmed") {
  const end = new Date(Date.parse(`${start}Z`) + 30 * 60000).toISOString().slice(0, 19);
  return { event_id: eventId++, doctor_email: doctor.email, patient_name_typed: patient.patient_name, start_time: start, end_time: end, event_status: status };
}
async function upload(sourceRows: any[], sourceName = namespace) {
  const b: any = await uploadImport(actor, { source: "json", sourceName, clientOpId: randomUUID(), rows: sourceRows });
  batches.push(b.id); return b;
}
function include(b: any, i = 0, extra: Record<string, unknown> = {}) {
  return { rowId: b.rows[i].id, action: "include", doctorId: doctor.doctor_id,
    identity: { kind: "existing", patientId: patient.patient_id, verification: { method: "phone", value: patient.phone } }, ...extra };
}
async function review(b: any, rs = [include(b)]) { return await mapImport(actor, b.id, { expectedVersion: b.version, rows: rs }) as any; }
async function commit(b: any, key = randomUUID()) {
  const result: any = await commitImport(actor, b.id, { expectedVersion: b.version, clientOpId: key });
  for (const r of result.rows) if (r.outcome === "created") appointments.push(r.appointmentId);
  return result;
}
async function count(table: string) { return Number((await admin.query(`SELECT count(*) AS n FROM operational.${table}`)).rows[0].n); }
before(async () => {
  await admin.connect(); baseline = await snapshot();
  assert.equal((baseline as any).calendar_app_export.n, 24);
  assert.equal((baseline as any).patients.n, 25);
  assert.equal((baseline as any).appointments.n, 102);
  doctor = (await admin.query(`SELECT d.* FROM operational.doctors d JOIN public.calendar_app_export e ON lower(d.email)=lower(e.doctor_email) ORDER BY e.event_id LIMIT 1`)).rows[0];
  clinic = (await admin.query("SELECT * FROM operational.clinics WHERE clinic_id=$1", [doctor.clinic_id])).rows[0];
  patient = (await admin.query(`SELECT p.*,p.dob::text birth FROM operational.patients p JOIN operational.patient_clinic_access a ON a.patient_id=p.patient_id WHERE a.clinic_id=$1 AND p.merged_into_id IS NULL ORDER BY p.patient_id LIMIT 1`, [clinic.clinic_id])).rows[0];
  actor = await makeActor(clinic.clinic_id); other = await makeActor(clinic.clinic_id);
});
after(async () => {
  try {
  // Only fixture-owned operational records; never reset or touch any seed.
  const owned = (await admin.query("SELECT id FROM operational.import_batches WHERE owner_id=ANY($1::integer[])", [users])).rows.map(r => r.id);
  await admin.query("DELETE FROM operational.import_source_links WHERE batch_id=ANY($1::integer[])", [owned]);
  await admin.query("DELETE FROM operational.import_reviews WHERE batch_id=ANY($1::integer[])", [owned]);
  await admin.query("DELETE FROM operational.import_operations WHERE user_id=ANY($1::integer[])", [users]);
  await admin.query("DELETE FROM operational.import_rows WHERE batch_id=ANY($1::integer[])", [owned]);
  await admin.query("DELETE FROM operational.import_batches WHERE id=ANY($1::integer[])", [owned]);
  await admin.query("DELETE FROM operational.sync_resolution_history WHERE actor_id=ANY($1::integer[])", [users]);
  await admin.query("DELETE FROM operational.sync_conflicts WHERE actor_id=ANY($1::integer[])", [users]);
  await admin.query("DELETE FROM operational.sync_device_operations WHERE device_id=ANY($1::integer[])", [devices]);
  await admin.query("DELETE FROM operational.appointment_operations WHERE actor_id=ANY($1::integer[])", [users]);
  await admin.query("SET ROLE amal_demo_reset");
  await admin.query("DELETE FROM operational.audit_log WHERE user_id=ANY($1::integer[])", [users]);
  await admin.query("RESET ROLE");
  await admin.query("DELETE FROM operational.notifications WHERE appointment_id IN (SELECT appointment_id FROM operational.appointments WHERE created_by=ANY($1::integer[]))", [users]);
  await admin.query("DELETE FROM operational.appointments WHERE created_by=ANY($1::integer[])", [users]);
  if (createdPatients.length) await admin.query("DELETE FROM operational.patients WHERE patient_id=ANY($1::integer[])", [createdPatients]);
  await admin.query("DELETE FROM operational.auth_sessions WHERE user_id=ANY($1::integer[])", [users]);
  await admin.query("DELETE FROM operational.auth_devices WHERE device_id=ANY($1::integer[])", [devices]);
  await admin.query("DELETE FROM operational.devices WHERE id=ANY($1::integer[])", [devices]);
  await admin.query("DELETE FROM operational.users WHERE id=ANY($1::integer[])", [users]);
  assert.deepEqual(await snapshot(), baseline);
  } finally { await admin.end(); await pool.end(); }
});
test("actual immutable export preview: 0/24/3, one collision pair and five separate doctor/time coincidences", async () => {
  const b: any = await uploadImport(actor, { source: "seed", clientOpId: randomUUID() }); batches.push(b.id);
  GetImportBatchResponse.parse(b);
  assert.equal(b.totals.autoLinked, 0); assert.equal(b.totals.reviewRequired, 24); assert.equal(b.totals.suggestedRows, 3);
  assert.equal(b.totals.intraExportPairs, 1); assert.equal(b.totals.existingCoincidences, 5);
  const pair = b.conflicts.find((c: any) => c.kind === "intra-export" && c.code === "doctor-overlap");
  assert.deepEqual(pair.rowIds.map((id: number) => b.rows.find((r: any) => r.id === id).source.event_id), [22, 23]);
  assert.equal(b.rows.find((r: any) => r.source.event_id === 22).mapping.startLocal, "2026-09-13T09:00:00");
  assert.ok(b.rows.every((r: any) => r.confirmedPatientId === null && r.availableActions.includes("create-patient")));
  await assert.rejects(commit(b), (e: any) => e.code === "IMPORT_REVIEW_REQUIRED");
  const report = await importReport(actor, b.id, "ar"); DownloadImportReportResponse.parse(report);
  assert.ok(report.labels.source.includes("المصدر"));
  assert.equal(JSON.stringify(report).includes(patient.phone), false);
});
test("bounded malformed upload preserves raw values with row errors and no operational writes", async () => {
  const n = await count("appointments"), p = await count("patients");
  const valid = source();
  const b = await upload([{ ...valid, unexpected: "preserved" }, { ...source(), event_status: "unknown" },
    { ...source(), start_time: "2026-02-30T12:00:00" }, { ...source(), end_time: "1900-01-01T12:00:00" }]);
  assert.equal(b.rows[0].source.unexpected, "preserved");
  assert.ok(b.rows.every((r: any) => r.errors.length));
  GetImportBatchResponse.parse(b);
  assert.equal(await count("appointments"), n); assert.equal(await count("patients"), p);
  await assert.rejects(uploadImport(actor, { source: "json", sourceName: namespace, clientOpId: randomUUID(), rows: Array.from({ length: 101 }, () => valid) }));
  await assert.rejects(uploadImport(actor, { source: "json", sourceName: namespace, clientOpId: randomUUID(), rows: [{ huge: "x".repeat(131072) }] }));
});
test("manual verification, stale batch, complete replacement, privacy and scope are enforced", async () => {
  const b = await upload([source()]);
  await assert.rejects(review(b, [{ ...include(b), identity: { kind: "existing", patientId: patient.patient_id, verification: { method: "phone", value: "000" } } }]), (e: any) => e.code === "IMPORT_IDENTITY_VERIFICATION_FAILED");
  await assert.rejects(review(b, [{ rowId: b.rows[0].id, action: "include", doctorId: doctor.doctor_id }]));
  await assert.rejects(getImport(other, b.id), (e: any) => e.status === 403);
  await assert.rejects(importReport(other, b.id, "en"), (e: any) => e.status === 403);
  const remote = (await admin.query("SELECT doctor_id FROM operational.doctors WHERE clinic_id<>$1 LIMIT 1", [actor.clinicId])).rows[0];
  await assert.rejects(review(b, [include(b, 0, { doctorId: remote.doctor_id })]), (e: any) => e.status === 403);
  const mapped = await review(b);
  assert.equal(JSON.stringify(mapped).includes(patient.phone), false);
  const evidence = (await admin.query("SELECT staging::text FROM operational.import_rows WHERE batch_id=$1", [b.id])).rows[0].staging;
  assert.equal(evidence.includes(patient.phone), false);
  await assert.rejects(review(b), (e: any) => e.code === "VERSION_CONFLICT");
  await assert.rejects(mapImport(actor, b.id, { expectedVersion: mapped.version, rows: [{ rowId: b.rows[0].id, action: "include", doctorId: doctor.doctor_id, startLocal: slot() }] }));
  // Existing identity changes invalidate its previous verification.
  await admin.query("UPDATE operational.patients SET phone=phone||'1' WHERE patient_id=$1", [patient.patient_id]);
  try { await assert.rejects(commit(mapped), (e: any) => e.code === "IMPORT_STALE_IDENTITY"); }
  finally { await admin.query("UPDATE operational.patients SET phone=$2 WHERE patient_id=$1", [patient.patient_id, patient.phone]); }
});
test("new patient staged only; rollback unresolved pair; successful commit is atomic and durable", async () => {
  const start = slot(), a = source(start), b = await upload([a, source(start)]);
  const beforePatients = await count("patients"), beforeAppointments = await count("appointments");
  const demographics = { name: `${namespace} New`, phone: "0591239876", dateOfBirth: "1990-01-01" };
  let mapped = await review(b, [include(b, 0, { identity: { kind: "new", patient: demographics } }), include(b, 1)]);
  assert.equal(await count("patients"), beforePatients);
  await assert.rejects(commit(mapped), (e: any) => e.code === "IMPORT_CONFLICT");
  assert.equal(await count("patients"), beforePatients); assert.equal(await count("appointments"), beforeAppointments);
  mapped = await review(mapped, [{ rowId: mapped.rows[1].id, action: "skip", reason: "Duplicate appointment time reviewed" }]);
  const committed = await commit(mapped); createdPatients.push(committed.rows[0].confirmedPatientId);
  assert.equal(await count("patients"), beforePatients + 1); assert.equal(await count("appointments"), beforeAppointments + 1);
  assert.equal(committed.totals.skipped, 1); assert.equal(committed.totals.created, 1);
  assert.equal(committed.rows[0].review.identityAction, "create");
  assert.equal(committed.adapter, "calendar_app_export"); assert.equal(committed.sourceName, namespace);
  assert.equal(committed.rows[1].reviewHistory.length, 2);
  assert.ok(committed.rows[1].reviewHistory[1].priorConflicts.some((c: any) => c.code === "doctor-overlap"));
  assert.deepEqual(await getImport(actor, committed.id), committed);
  const report = await importReport(actor, committed.id, "en");
  assert.equal(JSON.stringify(report).includes(demographics.phone), false);
  assert.equal(JSON.stringify(report).includes(demographics.dateOfBirth), false);
  const state = (await admin.query("SELECT staging::text FROM operational.import_rows WHERE id=$1", [committed.rows[0].id])).rows[0].staging;
  assert.equal(state.includes(demographics.phone), false);
});
test("concurrent identical commit and repeated renamed source produce exactly one appointment", async () => {
  const s = source(), b = await review(await upload([s])), key = randomUUID();
  const n = await count("appointments");
  const [a, replay]: any[] = await Promise.all([commit(b, key), commit(b, key)]);
  assert.deepEqual(a, replay); assert.equal(await count("appointments"), n + 1);
  await assert.rejects(commitImport(actor, b.id, { expectedVersion: b.version + 1, clientOpId: key }), (e: any) => e.code === "IDEMPOTENCY_CONFLICT");
  const renamed = await review(await upload([s], `${namespace}-renamed`));
  const linked = await commit(renamed);
  assert.equal(linked.rows[0].outcome, "source-replay"); assert.equal(linked.rows[0].appointmentId, a.rows[0].appointmentId);
  assert.equal(await count("appointments"), n + 1);
  const changed = await review(await upload([{ ...s, patient_name_typed: "changed" }], `${namespace}-changed`));
  await assert.rejects(commit(changed), (e: any) => e.code === "IMPORT_SOURCE_CHANGED");
});
test("full UID identities replay across filenames, formats and row order without numeric collisions", async () => {
  const longPrefix = "界".repeat(1000);
  const a = { ...source(), event_id: 1, event_uid: `${longPrefix}a` };
  const b = { ...source(), event_id: 1, event_uid: `${longPrefix}b` };
  const numeric = { ...source(), event_id: 1 };
  const malformed = { ...source(), event_id: -1, event_uid: "bad" };
  const n = await count("appointments"), p = await count("patients");
  const batch = await upload([a, malformed, numeric, b], "calendar.csv");
  GetImportBatchResponse.parse(batch);
  assert.equal(batch.rows[1].errors[0].code, "INVALID_COLUMNS");
  assert.deepEqual(batch.rows.map((r: any) => r.source.event_id), [1, -1, 1, 1]);
  const locators = (await admin.query("SELECT source_event_id FROM operational.import_rows WHERE batch_id=$1 ORDER BY id", [batch.id])).rows;
  assert.deepEqual(locators.map(r => r.source_event_id), [-1, -2, 1, -4]);
  await assert.rejects(commit(batch), (e: any) => e.code === "IMPORT_REVIEW_REQUIRED");
  await assert.rejects(review(batch, [include(batch, 1)]), (e: any) => e.code === "IMPORT_INVALID_SOURCE_ROW");
  await assert.rejects(getImport(other, batch.id), (e: any) => e.status === 403);
  await assert.rejects(review(batch, [{ ...include(batch), identity: { kind: "existing", patientId: patient.patient_id,
    verification: { method: "phone", value: "wrong" } } }]), (e: any) => e.code === "IMPORT_IDENTITY_VERIFICATION_FAILED");
  const first = await commit(await review(batch, [include(batch), { rowId: batch.rows[1].id, action: "skip", reason: "Malformed source" },
    { rowId: batch.rows[2].id, action: "skip", reason: "Reserve seed numeric provenance for seed replay test" }, include(batch, 3)]));
  assert.equal(first.totals.created, 2);
  const links = (await admin.query("SELECT source_name,source_event_id FROM operational.import_source_links WHERE batch_id=$1", [batch.id])).rows;
  assert.equal(links.length, 2);
  for (const s of [a, b]) assert.ok(links.some(r => r.source_name ===
    `calendar_app_export:uid:${createHash("sha256").update(s.event_uid).digest("hex")}` && r.source_event_id === 1));
  for (const name of ["renamed.xlsx", "roundtrip.xls", "calendar.ics", "renamed.csv"]) {
    // Reverse order and change insignificant UID edge whitespace. Format and
    // parser timezone flags are not provenance fields; timestamps are normalized
    // to the same Hebron wall-time JSON contract before reaching this API.
    const next = await upload([{ ...b, event_uid: ` ${b.event_uid} ` }, a], name);
    const replay = await commit(await review(next, next.rows.map((_: any, i: number) => include(next, i))));
    assert.deepEqual(replay.rows.map((r: any) => r.outcome), ["source-replay", "source-replay"]);
    assert.deepEqual(replay.rows.map((r: any) => r.appointmentId),
      [first.rows[3].appointmentId, first.rows[0].appointmentId]);
  }
  assert.equal(await count("appointments"), n + 2);
  assert.equal(await count("patients"), p);
  const changed = await review(await upload([{ ...a, patient_name_typed: "Changed original" }], "changed.ics"));
  await assert.rejects(commit(changed), (e: any) => e.code === "IMPORT_SOURCE_CHANGED");
  assert.equal(await count("appointments"), n + 2);
});
test("duplicate trimmed UIDs reject atomically while invalid rows keep actionable errors", async () => {
  const s = { ...source(), event_id: 1, event_uid: randomUUID() };
  const n = await count("import_batches");
  await assert.rejects(upload([s, { ...source(), event_id: 1, event_uid: ` ${s.event_uid} ` }]),
    (e: any) => e.code === "IMPORT_DUPLICATE_EVENT_ID" && e.params.row === 2);
  assert.equal(await count("import_batches"), n);
  const rows = ["", " ".repeat(2), "x".repeat(1025), null, 9].map(event_uid => ({ ...s, event_uid }));
  const batch = await upload([...rows, { ...s, event_id: -1 }, { ...s, event_id: 2 }, { ...s, uid: "alias" }]);
  assert.equal(batch.rows.length, 8);
  assert.ok(batch.rows.every((r: any) => r.errors.some((e: any) => e.code === "INVALID_COLUMNS")));
  await assert.rejects(review(batch), (e: any) => e.code === "IMPORT_INVALID_SOURCE_ROW");
});
test("UID replay fails closed when the prior linked full UID differs despite a matching hash namespace", async () => {
  const s = { ...source(), event_id: 1, event_uid: randomUUID() };
  const original = await commit(await review(await upload([s])));
  const namespace = `calendar_app_export:uid:${createHash("sha256").update(s.event_uid).digest("hex")}`;
  const otherUid = `${s.event_uid}-collision-witness`;
  // Simulate the otherwise theoretical SHA256 collision without replacing the
  // hash implementation: the immutable prior row is the independent witness.
  await admin.query("UPDATE operational.import_rows SET source_payload=jsonb_set(source_payload,'{event_uid}',to_jsonb($2::text)) WHERE id=$1",
    [original.rows[0].id, otherUid]);
  try {
    const next = await review(await upload([s]));
    await assert.rejects(commit(next), (e: any) => e.code === "IMPORT_SOURCE_CHANGED");
    assert.equal((await admin.query("SELECT source_name FROM operational.import_source_links WHERE row_id=$1", [original.rows[0].id])).rows[0].source_name, namespace);
  } finally {
    await admin.query("UPDATE operational.import_rows SET source_payload=$2 WHERE id=$1", [original.rows[0].id, JSON.stringify(s)]);
  }
});
test("UIDs do not relax scheduling conflicts or doctor scope", async () => {
  const s = source(), batch = await upload([{ ...s, event_id: 1, event_uid: randomUUID() },
    { ...s, event_id: 1, event_uid: randomUUID() }]);
  const remote = (await admin.query("SELECT doctor_id FROM operational.doctors WHERE clinic_id<>$1 LIMIT 1", [actor.clinicId])).rows[0];
  await assert.rejects(review(batch, [include(batch, 0, { doctorId: remote.doctor_id })]), (e: any) => e.status === 403);
  const mapped = await review(batch, [include(batch), include(batch, 1)]);
  assert.ok(mapped.conflicts.some((c: any) => c.code === "doctor-overlap" && c.severity === "blocking"));
  const n = await count("appointments");
  await assert.rejects(commit(mapped), (e: any) => e.code === "IMPORT_CONFLICT");
  assert.equal(await count("appointments"), n);
});
test("seed instant and equivalent JSON wall-time source share event provenance", async () => {
  const b: any = await uploadImport(actor, { source: "seed", clientOpId: randomUUID() }); batches.push(b.id);
  const index = b.rows.findIndex((r: any) => r.source.event_status === "completed" && r.mapping.doctorId === doctor.doctor_id);
  const choices = b.rows.map((r: any, i: number) => i === index ? include(b, i) : { rowId: r.id, action: "skip", reason: "Not selected in reviewed source" });
  const mapped = await review(b, choices), original = await commit(mapped);
  const s = b.rows[index].source, converted = { ...s, start_time: localTime(s.start_time), end_time: localTime(s.end_time) };
  const replay = await commit(await review(await upload([converted], `${namespace}-seed-equivalent`)));
  assert.equal(replay.rows[0].outcome, "source-replay"); assert.equal(replay.rows[0].appointmentId, original.rows[index].appointmentId);
});
test("competing independent batches and appointment booking use same doctor coordination", async () => {
  const start = slot(), b1 = await review(await upload([source(start)])), b2 = await review(await upload([source(start)]));
  const n = await count("appointments");
  const attempts = await Promise.allSettled([commit(b1), commit(b2)]);
  assert.equal(attempts.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(await count("appointments"), n + 1);
  const s = source(), b = await review(await upload([s]));
  const booking = { clinicId: actor.clinicId, doctorId: doctor.doctor_id, patientId: patient.patient_id,
    startsAt: wallToUtc(s.start_time), endsAt: wallToUtc(s.end_time), source: "phone", clientOpId: randomUUID() };
  const competing = await Promise.allSettled([commit(b), createAppointment(actor, booking)]);
  assert.equal(competing.filter(r => r.status === "fulfilled").length, 1);
});
test("half-open adjacency, historical dates, cancelled and completed status mapping", async () => {
  const start = slot(), a = source(start), b = await upload([a, source(a.end_time)]);
  const result = await commit(await review(b, [include(b), include(b, 1)]));
  assert.equal(result.totals.created, 2);
  const historical = await upload([source("2000-01-03T09:00:00", "completed"), source("2000-01-03T09:00:00", "cancelled")]);
  const complete = await commit(await review(historical, [include(historical), include(historical, 1)]));
  assert.equal(complete.rows[0].mapping.status, "completed"); assert.equal(complete.rows[1].mapping.status, "cancelled");
});
test("report replay reauthorizes current actor and request key cannot be reused across upload data", async () => {
  const key = randomUUID(), s = source();
  const b: any = await uploadImport(actor, { source: "json", sourceName: namespace, clientOpId: key, rows: [s] }); batches.push(b.id);
  await assert.rejects(uploadImport(actor, { source: "json", sourceName: namespace, clientOpId: key, rows: [source()] }), (e: any) => e.code === "IDEMPOTENCY_CONFLICT");
  const committed = await commit(await review(b));
  await admin.query("UPDATE operational.users SET role='administrator' WHERE id=$1", [actor.id]);
  try { await assert.rejects(importReport(actor, committed.id, "en"), (e: any) => e.status === 403); }
  finally {
    await admin.query("UPDATE operational.users SET role='receptionist' WHERE id=$1", [actor.id]);
    // Role changes revoke sessions by contract. Subsequent booking assertions
    // need fresh persisted authority, not the now-revoked pre-change session.
    actor.sessionDigest = randomUUID();
    await admin.query(`INSERT INTO operational.auth_sessions(token_digest,user_id,device_id,csrf_token,absolute_expires_at)
      VALUES($1,$2,$3,'unused',now()+interval '1 hour')`, [actor.sessionDigest, actor.id, actor.device!.id]);
  }
});
test("late database failure rolls back new patients, appointments, provenance, audits and report together", async () => {
  const b = await upload([source()], `import-test-rollback-${randomUUID()}`);
  const mapped = await review(b, [include(b, 0, { identity: { kind: "new", patient: {
    name: `${namespace} rollback`, phone: "0591239800", dateOfBirth: "1980-01-01",
  } } })]);
  const before = { patients: await count("patients"), appointments: await count("appointments"),
    sources: await count("import_source_links"), audit: await count("audit_log"), operations: await count("import_operations") };
  await admin.query(`CREATE FUNCTION operational.import_test_fail_commit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.source_name LIKE 'import-test-rollback-%' AND NEW.status='committed' THEN
      RAISE EXCEPTION 'test induced final report failure';
    END IF; RETURN NEW; END $$`);
  await admin.query("CREATE TRIGGER import_test_fail_commit BEFORE UPDATE ON operational.import_batches FOR EACH ROW EXECUTE FUNCTION operational.import_test_fail_commit()");
  try {
    await assert.rejects(commit(mapped), /test induced final report failure/);
    assert.deepEqual({ patients: await count("patients"), appointments: await count("appointments"),
      sources: await count("import_source_links"), audit: await count("audit_log"), operations: await count("import_operations") }, before);
    const unchanged: any = await getImport(actor, b.id);
    assert.equal(unchanged.version, mapped.version); assert.equal(unchanged.status, "reviewed");
    assert.equal(unchanged.rows[0].appointmentId, null);
  } finally {
    await admin.query("DROP TRIGGER import_test_fail_commit ON operational.import_batches");
    await admin.query("DROP FUNCTION operational.import_test_fail_commit()");
  }
});
test("existing association requires exact patient/time/status; patient overlap overrides are rejected", async () => {
  const s = source(), booked: any = await createAppointment(actor, {
    clinicId: actor.clinicId, doctorId: doctor.doctor_id, patientId: patient.patient_id, startsAt: wallToUtc(s.start_time),
    endsAt: wallToUtc(s.end_time), source: "phone", clientOpId: randomUUID(),
  });
  const b = await upload([s]);
  await assert.rejects(review(b, [include(b, 0, { associateAppointmentId: booked.id,
    startLocal: s.end_time, endLocal: new Date(Date.parse(`${s.end_time}Z`) + 1800000).toISOString().slice(0, 19) })]),
    (e: any) => e.code === "IMPORT_ASSOCIATION_MISMATCH");
  const linked = await commit(await review(b, [include(b, 0, { associateAppointmentId: booked.id })]));
  assert.equal(linked.rows[0].appointmentId, booked.id); assert.equal(linked.rows[0].outcome, "linked");
  const second = (await admin.query("SELECT * FROM operational.doctors WHERE clinic_id=$1 AND doctor_id<>$2 LIMIT 1", [actor.clinicId, doctor.doctor_id])).rows[0];
  assert.ok(second);
  const overlap = await upload([{ ...s, event_id: eventId++, doctor_email: second.email }]);
  let mapped = await review(overlap, [include(overlap, 0, { doctorId: second.doctor_id })]);
  assert.ok(mapped.conflicts.some((c: any) => c.code === "patient-overlap" && c.severity === "blocking"));
  await assert.rejects(commit(mapped), (e: any) => e.code === "IMPORT_CONFLICT");
  mapped = await review(mapped, [include(mapped, 0, { doctorId: second.doctor_id, overrideReason: "Reviewed sequential clinical handoff" })]);
  await assert.rejects(commit(mapped), (e: any) => e.code === "IMPORT_CONFLICT");
  const audit = await admin.query("SELECT detail FROM operational.audit_log WHERE user_id=$1 AND action='import.row_committed' AND (detail->>'batchId')::integer=$2", [actor.id, mapped.id]);
  assert.equal(audit.rows.length, 0);
});
test("DOB verification is date-only, missing doctors remain unresolved, outside-hours imports cannot override blockers", async () => {
  const invalidDoctor = await upload([{ ...source(), doctor_email: "missing@imports.invalid" }]);
  assert.equal(invalidDoctor.rows[0].mapping, null);
  assert.equal(invalidDoctor.rows[0].errors[0].code, "MISSING_DOCTOR");
  const mapped = await review(invalidDoctor, [include(invalidDoctor, 0, {
    identity: { kind: "existing", patientId: patient.patient_id, verification: { method: "dob", value: patient.birth } },
  })]);
  assert.equal(mapped.rows[0].review.verificationMethod, "dob");
  assert.equal(JSON.stringify(mapped).includes(patient.birth), false);
  const b = await upload([source(`${slot().slice(0, 10)}T01:00:00`)]);
  const outside = await review(b, [include(b, 0, { overrideReason: "Cannot override closed hours" })]);
  assert.ok(outside.conflicts.some((c: any) => c.code === "outside-hours" && c.severity === "blocking"));
  await assert.rejects(commit(outside), (e: any) => e.code === "IMPORT_CONFLICT");
});
test("corrected malformed source dates and invalid source intervals commit and replay original provenance", async () => {
  for (const invalid of ["date", "interval"] as const) {
    const corrected = source();
    const original = invalid === "date"
      ? { ...corrected, start_time: "2026-02-30T09:00:00" }
      : { ...corrected, end_time: corrected.start_time };
    const b = await upload([original]);
    assert.ok(b.rows[0].errors.some((e: any) => e.code === (invalid === "date" ? "INVALID_LOCAL_TIME" : "INVALID_INTERVAL")));
    const correction = { startLocal: corrected.start_time, endLocal: corrected.end_time };
    const mapped = await review(b, [include(b, 0, correction)]);
    assert.deepEqual(mapped.rows[0].source, original);
    assert.deepEqual(mapped.rows[0].errors, []);
    const before = await count("appointments"), key = randomUUID();
    const committed = await commit(mapped, key);
    assert.equal(committed.rows[0].outcome, "created");
    assert.deepEqual(committed.rows[0].source, original);
    assert.equal(committed.rows[0].mapping.startLocal, corrected.start_time);
    assert.deepEqual(await commit(mapped, key), committed);
    assert.equal(await count("appointments"), before + 1);
    const renamed = await upload([original], `${namespace}-corrected-${invalid}`);
    const reviewedAgain = await review(renamed, [include(renamed, 0, correction)]);
    const replay = await commit(reviewedAgain);
    assert.equal(replay.rows[0].outcome, "source-replay");
    assert.equal(replay.rows[0].appointmentId, committed.rows[0].appointmentId);
    assert.deepEqual(replay.rows[0].source, original);
    assert.equal(await count("appointments"), before + 1);
  }
});
test("both staged patient-overlap participants remain blocked even with override reasons", async () => {
  const second = (await admin.query("SELECT * FROM operational.doctors WHERE clinic_id=$1 AND doctor_id<>$2 LIMIT 1",
    [actor.clinicId, doctor.doctor_id])).rows[0];
  assert.ok(second);
  const s = source(), b = await upload([s, { ...s, event_id: eventId++, doctor_email: second.email }]);
  let mapped = await review(b, [
    include(b, 0, { overrideReason: "First row reviewed handoff" }),
    include(b, 1, { doctorId: second.doctor_id }),
  ]);
  const warnings = mapped.conflicts.filter((c: any) => c.kind === "intra-export" && c.code === "patient-overlap");
  assert.equal(warnings.length, 1);
  assert.deepEqual(warnings[0].rowIds, b.rows.map((r: any) => r.id));
  assert.equal(warnings[0].severity, "blocking");
  const counts = async () => ({ appointments: await count("appointments"), patients: await count("patients"),
    sourceLinks: await count("import_source_links"), audit: await count("audit_log"), receipts: await count("import_operations") });
  const before = await counts();
  await assert.rejects(commit(mapped), (e: any) => e.code === "IMPORT_CONFLICT");
  assert.deepEqual(await counts(), before, "A missing participant acknowledgement must roll back all writes");
  assert.equal((await getImport(actor, b.id) as any).status, "reviewed");
  // Reversing which row acknowledges must not change eligibility.
  mapped = await review(mapped, [
    include(mapped, 0),
    include(mapped, 1, { doctorId: second.doctor_id, overrideReason: "Second row reviewed handoff" }),
  ]);
  assert.equal(mapped.conflicts.find((c: any) => c.code === "patient-overlap").severity, "blocking");
  await assert.rejects(commit(mapped), (e: any) => e.code === "IMPORT_CONFLICT");
  mapped = await review(mapped, [
    include(mapped, 0, { overrideReason: "First row reviewed handoff" }),
    include(mapped, 1, { doctorId: second.doctor_id, overrideReason: "Second row reviewed handoff" }),
  ]);
  assert.equal(mapped.conflicts.filter((c: any) => c.code === "patient-overlap").length, 1);
  assert.equal(mapped.conflicts.find((c: any) => c.code === "patient-overlap").severity, "blocking");
  await assert.rejects(commit(mapped), (e: any) => e.code === "IMPORT_CONFLICT");
  assert.equal(await count("appointments"), before.appointments);
  const evidence = (await admin.query(`SELECT detail->>'overrideReason' reason FROM operational.audit_log
    WHERE user_id=$1 AND action='import.row_committed' AND (detail->>'batchId')::integer=$2 ORDER BY (detail->>'rowId')::integer`,
  [actor.id, b.id])).rows.map(r => r.reason);
  assert.deepEqual(evidence, []);
});
