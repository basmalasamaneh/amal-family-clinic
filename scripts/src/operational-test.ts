import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { compare } from "bcryptjs";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { runtimeConnectionString } from "@workspace/db/runtime-connection";
import { demoPassword, demoPin, minorAsOf, normalizeName } from "./demo-fixtures";
import { populate } from "./demo-populate";
import { clearOperational } from "./demo-reset";
import { migrate } from "./operational-migrate";
import { adminClient, operationalCounts, operationalTables, requireDemo, seedFingerprint, transaction, verifySource } from "./operational-support";
import { root, tables, zone } from "./seed-source";

requireDemo();
const expectedCounts = {
  clinics: 3, doctors: 5, users: 9, devices: 3, patients: 25, appointments: 102,
  patient_visit_history: 32, patient_consents: 2, visit_alerts: 1, audit_log: 0,
  sync_operations: 0, import_batches: 1, import_rows: 24, patient_merge_candidates: 1,
  notifications: 0, kpi_snapshots: 0,
};
const client = adminClient();
await client.connect();
async function snapshot(c: pg.Client) {
  const result: Record<string, unknown> = {};
  for (const table of operationalTables) {
    result[table] = (await c.query(`SELECT to_jsonb(t) row FROM operational.${table} t ORDER BY to_jsonb(t)::text`)).rows;
  }
  return result;
}
async function rejects(c: pg.Client, sql: string, codes: string[]) {
  await c.query("SAVEPOINT expected_failure");
  let code: string | undefined;
  try { await c.query(sql); } catch (e) { code = (e as { code: string }).code; }
  await c.query("ROLLBACK TO SAVEPOINT expected_failure");
  assert(codes.includes(code ?? ""), `Expected ${codes.join("/")}, got ${code}: ${sql}`);
}
try {
  await verifySource(client);
  const seedsBefore = await seedFingerprint(client);
  await migrate();
  await migrate();
  assert.equal(await seedFingerprint(client), seedsBefore, "Migration modified seeds");

  // Concurrent real transactions exercise the same lock used by CLI population/reset.
  const clients = [adminClient(), adminClient()];
  await Promise.all(clients.map(c => c.connect()));
  try {
    await Promise.all(clients.map(c => transaction(c, () => populate(c))));
  } finally { await Promise.all(clients.map(c => c.end())); }
  const first = await snapshot(client);
  await transaction(client, () => populate(client));
  assert.deepEqual(await snapshot(client), first, "Rerun altered logical data or credentials");
  assert.equal(await seedFingerprint(client), seedsBefore, "Concurrent population modified seeds");
  console.log("PASS migration checksum/safety, concurrent population, byte-identical logical rerun.");

  // Reset and all mutation tests run in a rollback transaction; existing edits are restored.
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(761901)");
  await clearOperational(client);
  await populate(client);
  await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  await client.query("SET CONSTRAINTS ALL DEFERRED");
  assert.deepEqual(await operationalCounts(client), expectedCounts);
  for (const t of tables.filter(t => t.name !== "calendar_app_export")) {
    const columns = t.columns.map(c => c.name).join(",");
    assert.equal((await client.query(`SELECT count(*) n FROM (
      (SELECT ${columns} FROM public.${t.name} EXCEPT SELECT ${columns} FROM operational.${t.name})
      UNION ALL
      (SELECT ${columns} FROM operational.${t.name} EXCEPT SELECT ${columns} FROM public.${t.name})
    ) differences`)).rows[0].n, "0", `${t.name}: copied identities, relationships or source values differ`);
  }
  assert.equal((await client.query(`SELECT count(*) n FROM operational.import_rows
    WHERE review_state='review_required' AND confirmed_patient_id IS NULL
    AND confirmed_doctor_id IS NULL AND appointment_id IS NULL AND chosen_action IS NULL`)).rows[0].n, "24");
  assert.equal((await client.query(`SELECT count(*) n FROM operational.import_rows r
    JOIN public.calendar_app_export e ON e.event_id=r.source_event_id
    WHERE r.source_payload=to_jsonb(e)`)).rows[0].n, "24");
  assert.equal((await client.query(`SELECT count(*) n FROM operational.visit_alerts a
    JOIN public.patient_visit_history v ON v.visit_id=a.visit_id
    WHERE a.patient_id=v.patient_id AND a.source_note_excerpt=v.diagnosis_notes`)).rows[0].n, "1");
  const users = (await client.query("SELECT * FROM operational.users")).rows;
  for (const user of users) {
    assert(await compare(demoPassword, user.password_hash));
    if (user.role === "receptionist") assert(await compare(demoPin, user.pin_hash));
    else assert.equal(user.pin_hash, null);
  }
  assert.equal((await client.query(`SELECT count(*) n FROM operational.doctors d JOIN operational.users u
    ON u.id=d.user_id AND u.doctor_id=d.doctor_id AND u.clinic_id=d.clinic_id WHERE u.role='doctor'`)).rows[0].n, "5");
  assert.equal((await client.query(`SELECT count(*) n FROM operational.patient_consents c
    JOIN operational.patients p USING(patient_id)
    WHERE c.fixture_key='demo.minor.guardian' AND p.is_minor
    AND c.given_by='guardian' AND c.guardian_name<>'' AND c.guardian_relation<>''`)).rows[0].n, "1");
  assert.equal((await client.query(`SELECT count(*) n FROM operational.patients
    WHERE is_minor<>(dob > minor_as_of - interval '18 years')`)).rows[0].n, "0");
  const merge = (await client.query(`SELECT a.dob<>b.dob AND a.phone<>b.phone different,c.status
    FROM operational.patient_merge_candidates c JOIN operational.patients a ON a.patient_id=c.patient_a
    JOIN operational.patients b ON b.patient_id=c.patient_b`)).rows;
  assert.deepEqual(merge, [{ different: true, status: "not_a_match" }]);

  const sequenceProbe = (await client.query(`INSERT INTO operational.patients(patient_name,phone,dob,name_normalized,minor_as_of)
    VALUES ('Synthetic test','0000','2000-01-01','synthetic test','${minorAsOf}') RETURNING patient_id`)).rows[0];
  assert(sequenceProbe.patient_id > 25, "Preserved IDs collide with future allocation");
  await client.query(`UPDATE operational.clinics SET slot_minutes=45 WHERE clinic_id=(SELECT min(clinic_id) FROM operational.clinics);
    UPDATE operational.patients SET patient_name='Edited synthetic name',name_normalized='edited synthetic name' WHERE patient_id=15;
    UPDATE operational.appointments SET cancel_reason='demo.test.edit',status='cancelled' WHERE appointment_id=(SELECT min(appointment_id) FROM operational.appointments);
    UPDATE operational.patient_consents SET withdrawn_at=given_at+interval '1 hour' WHERE fixture_key='demo.reem.clinical';
    UPDATE operational.devices SET label='demo.devices.edited' WHERE fixture_key=(SELECT min(fixture_key) FROM operational.devices)`);
  const edited = await snapshot(client);
  await populate(client);
  assert.deepEqual(await snapshot(client), edited, "Population overwrote operational edits");
  await rejects(client, "UPDATE operational.appointments SET duration_minutes=0", ["23514"]);
  await rejects(client, "UPDATE operational.appointments SET patient_id=-123456", ["23503"]);
  await rejects(client, "UPDATE operational.patient_consents SET given_by='guardian',guardian_name=NULL,guardian_relation=NULL", ["23514"]);
  await rejects(client, "UPDATE operational.import_rows SET confirmed_patient_id=15 WHERE review_state='review_required'", ["23514"]);
  await rejects(client, "UPDATE operational.appointments SET client_op_id='duplicate-test'", ["23505"]);
  await client.query(`INSERT INTO operational.sync_operations(clinic_id,device_id,client_op_id,type,payload,status)
    SELECT clinic_id,id,'test.unique.operation','appointment.create','{}','pending' FROM operational.devices ORDER BY id LIMIT 1`);
  await rejects(client, `INSERT INTO operational.sync_operations(clinic_id,device_id,client_op_id,type,payload,status)
    SELECT clinic_id,id,'test.unique.operation','appointment.create','{}','pending' FROM operational.devices ORDER BY id LIMIT 1`, ["23505"]);
  await client.query(`INSERT INTO operational.audit_log(action,detail) VALUES ('demo.test','{}')`);
  await rejects(client, "DELETE FROM operational.audit_log", ["42501"]);
  await clearOperational(client);
  await populate(client);
  await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  assert.deepEqual(await operationalCounts(client), expectedCounts, "Reset failed to restore initial fixture counts");
  assert.equal(await seedFingerprint(client), seedsBefore, "Reset modified seeds");
  await client.query("ROLLBACK");
  assert.deepEqual(await snapshot(client), first, "Reset/mutation rollback did not restore previous data");
  console.log("PASS exact counts/copies, hashes, provenance, review-only import, edits preserved, constraints, reset rollback.");

  // A failed transaction after population must not retain deletes, inserts or sequence restarts.
  await assert.rejects(transaction(client, async () => {
    await clearOperational(client);
    await populate(client);
    throw new Error("deliberate population failure");
  }), /deliberate population failure/);
  assert.deepEqual(await snapshot(client), first);
  assert.equal(await seedFingerprint(client), seedsBefore);

  const runtime = new pg.Client({ connectionString: runtimeConnectionString() });
  await runtime.connect();
  try {
    await runtime.query("BEGIN");
    assert.deepEqual((await runtime.query("SELECT current_user,session_user")).rows,
      [{ current_user: "amal_app", session_user: "amal_app" }]);
    await runtime.query("INSERT INTO operational.audit_log(action,detail) VALUES ('demo.test.runtime','{}')");
    for (const sql of ["UPDATE operational.audit_log SET action='x'", "DELETE FROM operational.audit_log",
      "TRUNCATE operational.audit_log", "ALTER TABLE operational.audit_log DISABLE TRIGGER ALL",
      "SET ROLE amal_demo_reset"]) await rejects(runtime, sql, ["42501"]);
    await runtime.query("RESET ROLE");
    for (const t of tables) {
      for (const sql of [`INSERT INTO public.${t.name} SELECT * FROM public.${t.name} WHERE false`,
        `UPDATE public.${t.name} SET ${t.columns[0]!.name}=${t.columns[0]!.name} WHERE false`,
        `DELETE FROM public.${t.name} WHERE false`, `TRUNCATE public.${t.name}`]) {
        await rejects(runtime, sql, ["42501"]);
      }
    }
    await runtime.query("ROLLBACK");
  } finally { await runtime.end(); }

  // Test actual DST transitions and nearby safe local instants, not fixed offsets.
  for (const local of ["2026-03-27T12:00:00", "2026-03-28T12:00:00", "2026-10-23T12:00:00", "2026-10-24T12:00:00"]) {
    const utc = fromZonedTime(local, zone);
    assert.equal(formatInTimeZone(utc, zone, "yyyy-MM-dd'T'HH:mm:ss"), local);
    const sql = await client.query("SELECT to_char($1::timestamptz AT TIME ZONE 'Asia/Hebron','YYYY-MM-DD\"T\"HH24:MI:SS') local", [utc.toISOString()]);
    assert.equal(sql.rows[0].local, local, "PostgreSQL and date-fns-tz disagree");
  }
  assert.notEqual(formatInTimeZone(fromZonedTime("2026-03-27T12:00:00",zone),zone,"XXX"),
    formatInTimeZone(fromZonedTime("2026-03-28T12:00:00",zone),zone,"XXX"), "Spring DST boundary not exercised");
  assert.notEqual(formatInTimeZone(fromZonedTime("2026-10-23T12:00:00",zone),zone,"XXX"),
    formatInTimeZone(fromZonedTime("2026-10-24T12:00:00",zone),zone,"XXX"), "Autumn DST boundary not exercised");
  for (const timezone of ["UTC", "America/Los_Angeles", "Asia/Hebron"]) {
    await client.query("SELECT set_config('TimeZone',$1,false)", [timezone]);
    assert.equal((await client.query(`SELECT count(*) n FROM operational.appointments o
      JOIN public.appointments s USING(appointment_id) WHERE o.scheduled_at=s.scheduled_at`)).rows[0].n, "102");
    assert.equal((await client.query(`SELECT count(*) n FROM operational.patients o
      JOIN public.patients s USING(patient_id) WHERE o.dob=s.dob`)).rows[0].n, "25");
  }
  assert.equal(normalizeName("  أَحمد   فاطمة  "), "احمد فاطمه");
  // CLI gates execute before database connections, so no reset can occur here.
  for (const args of [[], ["--demo"]]) {
    assert.throws(() => execFileSync("pnpm", ["exec", "tsx", "src/demo-reset.ts", ...args],
      { cwd: root + "scripts", stdio: "pipe" }));
  }
  assert.equal(await seedFingerprint(client), seedsBefore);
  await verifySource(client);
  console.log("PASS failed transaction, real runtime seed/audit denial, UTC/DST/date-only checks and reset guards.");
  console.log(JSON.stringify({ seedFingerprint: seedsBefore, initialCounts: expectedCounts }, null, 2));
} finally {
  await client.query("ROLLBACK");
  await client.end();
}
