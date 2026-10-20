import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import express from "express";
import cookieParser from "cookie-parser";
import mergeRouter from "../src/routes/patient-merge";
import { digest } from "../src/lib/auth";
import { pool } from "@workspace/db";
import { normalizeName } from "@workspace/db/patient-search";
import type { Auth } from "../src/lib/auth";
import { listPatientDuplicates, mergePatients, duplicateIdentity, previewPatientMerge } from "../src/patients/merge";

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Merge tests prohibited in deployment");
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
let auth: Auth, clinic: number, doctor: number, beforeSeeds: unknown;
const patients: number[] = [], operations: string[] = [], visits: number[] = [], batches: number[] = [];
const extraSessions: string[] = [];
let device: number, user: number;
const sessionCredential = randomUUID(), deviceCredential = randomUUID();
async function snapshot() {
  const result: Record<string, unknown> = {};
  for (const table of ["clinics", "doctors", "patients", "appointments", "patient_visit_history", "calendar_app_export"]) {
    result[table] = (await admin.query(`SELECT count(*)::integer n,md5(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text)) hash FROM public.${table} t`)).rows[0];
  }
  return result;
}
async function patient(name = `merge-${randomUUID()}`, phone = "0591234567", dob = "1990-01-01") {
  const { rows: [p] } = await admin.query(`INSERT INTO operational.patients(patient_name,phone,dob,name_normalized,created_clinic_id)
    VALUES($1,$2,$3,$4,$5) RETURNING patient_id`, [name, phone, dob, normalizeName(name), clinic]);
  patients.push(p.patient_id);
  return p.patient_id as number;
}
async function pair() {
  const name = `merge-${randomUUID()}`;
  return [await patient(name), await patient(name)] as const;
}
function body(sourceId: number, targetId: number, patch = {}) {
  const clientOpId = randomUUID();
  operations.push(clientOpId);
  return { sourceId, targetId, sourceVersion: 1, targetVersion: 1, confirmed: true,
    reason: "Synthetic operational duplicate reviewed", clientOpId, ...patch };
}
const code = (expected: string) => (e: unknown) => {
  assert(e && typeof e === "object" && "code" in e);
  assert.equal(e.code, expected);
  return true;
};
async function unchanged(source: number, target: number) {
  const { rows } = await admin.query("SELECT version,merged_into_id FROM operational.patients WHERE patient_id=ANY($1) ORDER BY patient_id", [[source, target]]);
  assert.deepEqual(rows, [{ version: 1, merged_into_id: null }, { version: 1, merged_into_id: null }]);
}
before(async () => {
  await admin.connect();
  beforeSeeds = await snapshot();
  assert((await admin.query("SELECT to_regclass('operational.patient_merge_operations') AS t")).rows[0].t, "Run merge:migrate first");
  const d = (await admin.query("SELECT doctor_id,clinic_id FROM operational.doctors ORDER BY doctor_id LIMIT 1")).rows[0];
  assert(d, "Operational baseline prerequisite missing");
  clinic = d.clinic_id; doctor = d.doctor_id;
  user = (await admin.query(`INSERT INTO operational.users(email,password_hash,role,clinic_id)
    VALUES($1,'unused','receptionist',$2) RETURNING id`, [`${randomUUID()}@merge.test`, clinic])).rows[0].id;
  device = (await admin.query("INSERT INTO operational.devices(clinic_id,label) VALUES($1,'mergeTest') RETURNING id", [clinic])).rows[0].id;
  await admin.query("INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)", [device, digest(deviceCredential)]);
  const token = digest(sessionCredential);
  await admin.query(`INSERT INTO operational.auth_sessions(token_digest,user_id,device_id,csrf_token,absolute_expires_at)
    VALUES($1,$2,$3,'unused',now()+interval '1 hour')`, [token, user, device]);
  auth = { id: user, email: "unused", clinicId: clinic, doctorId: null, role: "front-desk",
    locale: "en", theme: "light", sessionDigest: token, csrfToken: "unused", device: { id: device, clinicId: clinic },
    expiresAt: new Date(Date.now() + 3600000), absoluteExpiresAt: new Date(Date.now() + 3600000), pinVerifiedAt: null };
});
after(async () => {
  try {
    assert.deepEqual(await snapshot(), beforeSeeds, "All six immutable seed checksums unchanged");
    if (!user) return;
    await admin.query("BEGIN");
    await admin.query("SET LOCAL ROLE amal_demo_reset");
    await admin.query("DELETE FROM operational.audit_log WHERE user_id=$1", [user]);
    await admin.query("DELETE FROM operational.patient_merge_moves WHERE client_op_id=ANY($1::uuid[])", [operations]);
    await admin.query("DELETE FROM operational.patient_merge_operations WHERE client_op_id=ANY($1::uuid[])", [operations]);
    await admin.query("DELETE FROM operational.visit_alerts WHERE patient_id=ANY($1) OR visit_id=ANY($2)", [patients, visits]);
    await admin.query("DELETE FROM operational.notifications WHERE patient_id=ANY($1)", [patients]);
    await admin.query("DELETE FROM operational.patient_visit_history WHERE patient_id=ANY($1)", [patients]);
    await admin.query("DELETE FROM operational.import_rows WHERE batch_id=ANY($1)", [batches]);
    await admin.query("DELETE FROM operational.import_batches WHERE id=ANY($1)", [batches]);
    await admin.query("DELETE FROM operational.appointments WHERE patient_id=ANY($1)", [patients]);
    await admin.query("DELETE FROM operational.appointment_holds WHERE patient_id=ANY($1)", [patients]);
    await admin.query("DELETE FROM operational.patient_consents WHERE patient_id=ANY($1)", [patients]);
    await admin.query("DELETE FROM operational.patient_clinic_access WHERE patient_id=ANY($1)", [patients]);
    await admin.query("DELETE FROM operational.patients WHERE patient_id=ANY($1)", [patients]);
    await admin.query("RESET ROLE");
    await admin.query("DELETE FROM operational.auth_sessions WHERE token_digest=ANY($1)", [extraSessions]);
    await admin.query("DELETE FROM operational.auth_sessions WHERE user_id=$1", [user]);
    await admin.query("DELETE FROM operational.auth_devices WHERE device_id=$1", [device]);
    await admin.query("DELETE FROM operational.devices WHERE id=$1", [device]);
    await admin.query("DELETE FROM operational.users WHERE id=$1", [user]);
    await admin.query("COMMIT");
  } finally { await admin.end(); await pool.end(); }
});
test("real seed Samer records are never exact duplicate candidates; real export remains readable", async () => {
  const { rows } = await admin.query("SELECT patient_name,phone,dob::text FROM public.patients WHERE patient_name ILIKE '%Samer%' OR patient_name LIKE '%سامر%'");
  assert(rows.length >= 2, "Actual Samer baseline must be present");
  const keys = rows.map(duplicateIdentity).filter(Boolean);
  assert.equal(keys.length, new Set(keys).size);
  assert.equal((await admin.query("SELECT count(*)::integer n FROM public.calendar_app_export")).rows[0].n, 24);
});
test("preview is read-only, clinic-scoped, sanitized and never authorizes a later merge", async () => {
  const [source, target] = await pair();
  await admin.query(`INSERT INTO operational.appointments(clinic_id,doctor_id,patient_id,scheduled_at,booking_method,status)
    VALUES($1,$2,$3,'2020-01-01T08:00Z','phone','completed')`, [clinic, doctor, source]);
  async function operationalSnapshot() {
    const tables = (await admin.query(`SELECT tablename FROM pg_tables WHERE schemaname='operational' ORDER BY tablename`)).rows;
    const result: Record<string, unknown> = {};
    for (const { tablename } of tables) {
      result[tablename] = (await admin.query(`SELECT count(*)::integer n,
        md5(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text)) hash
        FROM operational."${tablename.replaceAll('"', '""')}" t`)).rows[0];
    }
    return result;
  }
  const before = await operationalSnapshot();
  const app = express();
  app.use(express.json(), cookieParser(), mergeRouter);
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status ?? 400).json({ code: error.code ?? "VALIDATION" });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/patients/merge/preview`;
    const headers = { "Content-Type": "application/json", "x-csrf-token": "unused",
      Cookie: `amal_session=${sessionCredential}; amal_device=${deviceCredential}` };
    const request = { method: "POST", headers, body: JSON.stringify({ sourceId: source, targetId: target }) };
    const response = await fetch(url, request);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).sourceVersion, 1);
    assert.equal((await fetch(url, { ...request, headers: { ...headers, Cookie: "" } })).status, 401);
    assert.equal((await fetch(url, { ...request, headers: { ...headers, "x-csrf-token": "" } })).status, 403);
    assert.equal((await fetch(url, { ...request, body: JSON.stringify({ sourceId: source, targetId: 2147483647 }) })).status, 404);
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
  const result = await previewPatientMerge(auth, { sourceId: source, targetId: target });
  assert.deepEqual(result, { sourceId: source, targetId: target, sourceVersion: 1, targetVersion: 1,
    canMerge: true, blockers: [], references: { appointments: { sourceCount: 1, targetCount: 0, scope: "current-actor" },
      clinicalReferences: "withheld", auditHistory: "retained-on-source" }, requiresTransactionalRevalidation: true });
  assert.deepEqual(await operationalSnapshot(), before, "Every operational table unchanged");
  await admin.query(`INSERT INTO operational.patient_consents(patient_id,level,given_by,recorded_by_user,recorded_clinic_id,evidence)
    VALUES($1,'none','patient',$2,$3,'verbal')`, [target, user, clinic]);
  const blocked = await previewPatientMerge(auth, { sourceId: source, targetId: target });
  assert.deepEqual(blocked.blockers, ["MERGE_RESTRICTED"]);
  assert.equal(blocked.canMerge, false);
  assert(!JSON.stringify(blocked).includes("consent"));
  await assert.rejects(mergePatients(auth, body(source, target)), code("MERGE_CONSENT"));
  await assert.rejects(previewPatientMerge({ ...auth, role: "admin" }, { sourceId: source, targetId: target }), code("FORBIDDEN"));
  await admin.query("UPDATE operational.patients SET created_clinic_id=NULL WHERE patient_id=$1", [target]);
  await assert.rejects(previewPatientMerge(auth, { sourceId: source, targetId: target }), code("NOT_FOUND"));
  await assert.rejects(previewPatientMerge(auth, { sourceId: source, targetId: 2147483647 }), code("NOT_FOUND"));
  await assert.rejects(previewPatientMerge(auth, { sourceId: source, targetId: source, clinicId: clinic }));
  assert.equal((await previewPatientMerge(auth, { sourceId: source, targetId: source })).canMerge, false);
  const [a, b] = await pair();
  const preview = await previewPatientMerge(auth, { sourceId: a, targetId: b });
  await admin.query("UPDATE operational.patients SET phone=phone WHERE patient_id=$1", [a]);
  assert.equal((await previewPatientMerge(auth, { sourceId: a, targetId: b })).sourceVersion, 2);
  await assert.rejects(mergePatients(auth, body(a, b, { sourceVersion: preview.sourceVersion })), code("MERGE_STALE"));
});
test("scoped duplicate pagination and exact matching reject name-only, different DOB and out-of-scope", async () => {
  const [a, b] = await pair();
  const p = (await admin.query("SELECT patient_name FROM operational.patients WHERE patient_id=$1", [a])).rows[0];
  const c = await patient(p.patient_name, "0599999999");
  const d = await patient(p.patient_name, "0591234567", "1991-01-01");
  const hidden = await patient(p.patient_name);
  await admin.query("UPDATE operational.patients SET created_clinic_id=NULL WHERE patient_id=$1", [hidden]);
  const page = await listPatientDuplicates(auth, { limit: "100" });
  assert(page.items.some(x => x.source.id === a && x.target.id === b));
  assert(!page.items.some(x => [c, d, hidden].includes(x.source.id) || [c, d, hidden].includes(x.target.id)));
  assert(!JSON.stringify(page).includes("0591234567"));
  await assert.rejects(listPatientDuplicates({ ...auth, role: "admin" }, {}), code("FORBIDDEN"));
  await assert.rejects(mergePatients(auth, body(hidden, a)), code("NOT_FOUND"));
});
test("atomic merge moves appointments, visits, alerts and notifications; audit subject and provenance survive", async () => {
  const [source, target] = await pair();
  const appointment = (await admin.query(`INSERT INTO operational.appointments(clinic_id,doctor_id,patient_id,scheduled_at,booking_method,status,source_ref)
    VALUES($1,$2,$3,'2020-01-01T08:00Z','phone','completed',$4) RETURNING appointment_id`, [clinic, doctor, source, `merge:${randomUUID()}`])).rows[0].appointment_id;
  const visit = (await admin.query(`INSERT INTO operational.patient_visit_history(patient_id,clinic_id,doctor_id,visit_date,diagnosis_notes)
    VALUES($1,$2,$3,'2020-01-01','Original clinical note') RETURNING visit_id`, [source, clinic, doctor])).rows[0].visit_id;
  visits.push(visit);
  await admin.query(`INSERT INTO operational.visit_alerts(visit_id,patient_id,kind,label,source_note_excerpt)
    VALUES($1,$2,'medication','test.merge','Original clinical note')`, [visit, source]);
  await admin.query(`INSERT INTO operational.notifications(clinic_id,patient_id,appointment_id,message_key,scheduled_at)
    VALUES($1,$2,$3,'test.merge',now())`, [clinic, source, appointment]);
  const audit = (await admin.query(`INSERT INTO operational.audit_log(user_id,clinic_id,patient_id,action,detail)
    VALUES($1,$2,$3,'test.merge.before','{"original":true}') RETURNING id`, [user, clinic, source])).rows[0].id;
  const request = body(source, target);
  const [result, replay] = await Promise.all([mergePatients(auth, request), mergePatients(auth, request)]);
  assert.deepEqual(result, replay);
  assert.equal(result.sourceVersion, 2); assert.equal(result.targetVersion, 2);
  assert.equal((await admin.query("SELECT patient_id FROM operational.appointments WHERE appointment_id=$1", [appointment])).rows[0].patient_id, target);
  assert.deepEqual((await admin.query("SELECT patient_id,diagnosis_notes,clinic_id,doctor_id FROM operational.patient_visit_history WHERE visit_id=$1", [visit])).rows[0],
    { patient_id: target, diagnosis_notes: "Original clinical note", clinic_id: clinic, doctor_id: doctor });
  assert.equal((await admin.query("SELECT patient_id FROM operational.visit_alerts WHERE visit_id=$1", [visit])).rows[0].patient_id, target);
  assert.equal((await admin.query("SELECT patient_id FROM operational.notifications WHERE appointment_id=$1", [appointment])).rows[0].patient_id, target);
  assert.equal((await admin.query("SELECT patient_id FROM operational.audit_log WHERE id=$1", [audit])).rows[0].patient_id, source);
  assert.equal((await admin.query("SELECT count(*)::integer n FROM operational.patient_merge_moves WHERE client_op_id=$1", [request.clientOpId])).rows[0].n, 4);
  assert.equal((await admin.query("SELECT count(*)::integer n FROM operational.audit_log WHERE action='patient.merged' AND patient_id=$1", [source])).rows[0].n, 1);
  await assert.rejects(mergePatients(auth, { ...request, reason: "different" }), code("IDEMPOTENCY_CONFLICT"));
  await assert.rejects(mergePatients(auth, body(target, source)), code("MERGE_UNSAFE"));
  await assert.rejects(admin.query(`INSERT INTO operational.patient_visit_history(patient_id,clinic_id,doctor_id,visit_date,diagnosis_notes)
    VALUES($1,$2,$3,'2020-01-01','stale writer')`, [source, clinic, doctor]), code("23514"));
});
test("versions cover existing writers and stale merges roll back without receipt", async () => {
  const [source, target] = await pair();
  await admin.query("UPDATE operational.patients SET phone=phone WHERE patient_id=$1", [source]);
  await assert.rejects(mergePatients(auth, body(source, target)), code("MERGE_STALE"));
  assert.equal((await admin.query("SELECT version FROM operational.patients WHERE patient_id=$1", [source])).rows[0].version, 2);
  assert.equal((await admin.query("SELECT count(*)::integer n FROM operational.patient_merge_operations WHERE source_id=$1", [source])).rows[0].n, 0);
});
test("any consent including explicit none blocks merge and evidence is unchanged", async () => {
  const [source, target] = await pair();
  await admin.query(`INSERT INTO operational.patient_consents(patient_id,level,given_by,recorded_by_user,recorded_clinic_id,evidence)
    VALUES($1,'none','patient',$2,$3,'verbal')`, [target, user, clinic]);
  const prior = (await admin.query("SELECT * FROM operational.patient_consents WHERE patient_id=$1", [target])).rows;
  await assert.rejects(mergePatients(auth, body(source, target)), code("MERGE_CONSENT"));
  await unchanged(source, target);
  assert.deepEqual((await admin.query("SELECT * FROM operational.patient_consents WHERE patient_id=$1", [target])).rows, prior);
});
test("different trusted doctor grants or clinic grants cannot broaden visibility", async () => {
  const [source, target] = await pair();
  await admin.query("INSERT INTO operational.patient_doctor_access(patient_id,clinic_id,doctor_id) VALUES($1,$2,$3)", [source, clinic, doctor]);
  await assert.rejects(mergePatients(auth, body(source, target)), code("MERGE_VISIBILITY"));
  await unchanged(source, target);
});
test("doctor candidates require trusted grants before comparison", async () => {
  const [source, target] = await pair();
  const u = (await admin.query("SELECT * FROM operational.users WHERE doctor_id=$1 AND role='doctor'", [doctor])).rows[0];
  assert(u, "Baseline doctor must have a linked login");
  const token = randomUUID(); extraSessions.push(token);
  await admin.query("INSERT INTO operational.auth_sessions(token_digest,user_id,csrf_token) VALUES($1,$2,'unused')", [token, u.id]);
  const doctorAuth: Auth = { ...auth, id: u.id, role: "doctor", doctorId: doctor, sessionDigest: token, device: null, absoluteExpiresAt: null };
  let page = await listPatientDuplicates(doctorAuth, { limit: "100" });
  assert(!page.items.some(p => p.source.id === source || p.target.id === target));
  await admin.query(`INSERT INTO operational.patient_doctor_access(patient_id,clinic_id,doctor_id)
    VALUES($1,$3,$4),($2,$3,$4)`, [source, target, clinic, doctor]);
  page = await listPatientDuplicates(doctorAuth, { limit: "100" });
  assert(page.items.some(p => p.source.id === source && p.target.id === target));
});
test("booking overlap rejects merge without deleting history; adjacent intervals are safe", async () => {
  const [source, target] = await pair();
  const ids: number[] = [];
  for (const p of [source, target]) {
    ids.push((await admin.query(`INSERT INTO operational.appointments(clinic_id,doctor_id,patient_id,scheduled_at,duration_minutes,booking_method,status)
      VALUES($1,$2,$3,'2020-01-01T08:00Z',30,'phone','booked') RETURNING appointment_id`, [clinic, doctor, p])).rows[0].appointment_id);
  }
  await assert.rejects(mergePatients(auth, body(source, target)), code("MERGE_PATIENT_OVERLAP"));
  await unchanged(source, target);
  await admin.query("UPDATE operational.appointments SET scheduled_at=scheduled_at+interval '30 minutes' WHERE appointment_id=$1", [ids[1]]);
  await mergePatients(auth, body(source, target));
  assert.equal((await admin.query("SELECT count(*)::integer n FROM operational.appointments WHERE appointment_id=ANY($1) AND patient_id=$2", [ids, target])).rows[0].n, 2);
});
test("unknown future patient FK fails closed without changing patients", async () => {
  const [source, target] = await pair();
  await admin.query("CREATE TABLE operational.merge_test_unknown_reference(patient_id integer REFERENCES operational.patients(patient_id))");
  try {
    await assert.rejects(mergePatients(auth, body(source, target)), code("MERGE_UNKNOWN_REFERENCE"));
    await unchanged(source, target);
  } finally { await admin.query("DROP TABLE operational.merge_test_unknown_reference"); }
});
test("competing merges have a single winner and one durable success audit", async () => {
  const name = `merge-${randomUUID()}`, source = await patient(name), a = await patient(name), b = await patient(name);
  const results = await Promise.allSettled([mergePatients(auth, body(source, a)), mergePatients(auth, body(source, b))]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected").length, 1);
  assert.equal((await admin.query("SELECT count(*)::integer n FROM operational.audit_log WHERE action='patient.merged' AND patient_id=$1", [source])).rows[0].n, 1);
});
test("JSON staging references are blocked without reattributing manual confirmation", async () => {
  const [source, target] = await pair();
  const batch = (await admin.query(`INSERT INTO operational.import_batches(clinic_id,source_name,source_checksum)
    VALUES($1,'merge-test',$2) RETURNING id`, [clinic, randomUUID()])).rows[0].id;
  batches.push(batch);
  await admin.query(`INSERT INTO operational.import_rows(batch_id,source_event_id,source_payload,staging)
    VALUES($1,1,'{}',$2::jsonb)`, [batch, JSON.stringify({ review: { patientId: source } })]);
  await assert.rejects(mergePatients(auth, body(source, target)), code("MERGE_UNSAFE"));
  await unchanged(source, target);
});
test("unsafe late unique collision rolls back earlier reference moves and journal", async () => {
  const [source, target] = await pair();
  const sourceVisit = (await admin.query(`INSERT INTO operational.patient_visit_history(patient_id,clinic_id,doctor_id,visit_date,diagnosis_notes)
    VALUES($1,$2,$3,'2020-01-01','source note') RETURNING visit_id`, [source, clinic, doctor])).rows[0].visit_id;
  const targetVisit = (await admin.query(`INSERT INTO operational.patient_visit_history(patient_id,clinic_id,doctor_id,visit_date,diagnosis_notes)
    VALUES($1,$2,$3,'2020-01-01','target note') RETURNING visit_id`, [target, clinic, doctor])).rows[0].visit_id;
  visits.push(sourceVisit, targetVisit);
  await admin.query(`CREATE UNIQUE INDEX merge_test_unique_patient ON operational.patient_visit_history(patient_id)
    WHERE patient_id IN (${source},${target})`);
  const request = body(source, target);
  try {
    await assert.rejects(mergePatients(auth, request), code("MERGE_UNSAFE"));
    await unchanged(source, target);
    assert.equal((await admin.query("SELECT patient_id FROM operational.patient_visit_history WHERE visit_id=$1", [sourceVisit])).rows[0].patient_id, source);
    assert.equal((await admin.query("SELECT count(*)::integer n FROM operational.patient_merge_moves WHERE client_op_id=$1", [request.clientOpId])).rows[0].n, 0);
  } finally { await admin.query("DROP INDEX operational.merge_test_unique_patient"); }
});
test("consent readers exclude merge; authorization is checked after waiting", async () => {
  const [source, target] = await pair();
  const blocker = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await blocker.connect();
  await blocker.query("BEGIN");
  await blocker.query("SELECT pg_advisory_xact_lock_shared(160005)");
  let settled = false;
  const merge = mergePatients(auth, body(source, target)).finally(() => { settled = true; });
  // Attach rejection handling immediately, before releasing the lock.
  const rejected = assert.rejects(merge, code("FORBIDDEN"));
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(settled, false);
    await admin.query("UPDATE operational.auth_sessions SET revoked_at=now() WHERE token_digest=$1", [auth.sessionDigest]);
    await blocker.query("COMMIT");
    await rejected;
    await unchanged(source, target);
  } finally {
    await blocker.query("ROLLBACK");
    await blocker.end();
    await admin.query("UPDATE operational.auth_sessions SET revoked_at=NULL WHERE token_digest=$1", [auth.sessionDigest]);
  }
});
