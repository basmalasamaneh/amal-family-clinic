import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg, { type PoolClient } from "pg";
import { buildClinicExport, CLINIC_EXPORT_LIMITS } from "../src/adoption/export";
import { ApiError } from "../src/lib/auth-errors";

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("Export tests prohibited in deployment");
}

test("real export SQL: shared patients never pull foreign notes/provenance; repeatable snapshot and seeds remain intact", async () => {
  const schema = `export_test_${randomUUID().replaceAll("-", "")}`;
  const connection = { connectionString: process.env.DATABASE_URL };
  const admin = new pg.Client(connection), reader = new pg.Client(connection);
  await admin.connect();
  await reader.connect();
  const rewrite = (sql: string) => sql.replaceAll("operational.", `${schema}.`);
  const q = (sql: string, values?: unknown[]) => admin.query(rewrite(sql), values);
  const reads: string[] = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      reads.push(sql);
      return reader.query(rewrite(sql), values);
    },
  } as unknown as PoolClient;
  const seedSnapshot = async () => {
    const result = [];
    for (const table of ["clinics", "doctors", "patients", "appointments", "patient_visit_history", "calendar_app_export"]) {
      result.push((await admin.query(`SELECT count(*)::integer n,
        md5(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text)) h FROM public.${table} t`)).rows);
    }
    return result;
  };
  const before = await seedSnapshot();
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    for (const table of ["clinics", "doctors", "patients", "patient_clinic_access", "patient_doctor_access",
      "appointments", "patient_visit_history", "patient_consents", "import_batches", "import_rows", "import_source_links"]) {
      await admin.query(`CREATE TABLE ${schema}.${table} (LIKE operational.${table} INCLUDING ALL)`);
    }
    // LIKE INCLUDING ALL copies defaults/checks, not the adoption default trigger.
    await q(`INSERT INTO operational.clinics(clinic_id,clinic_name,city,booking_method,adoption_state,
      adoption_changed_at,full_started_at)
      VALUES(41,'عيادة أمل','Test','phone','full','2026-06-01T10:00:00Z','2026-06-01T10:00:00Z'),
      (42,'FOREIGN_CLINIC','Test','phone','full','2026-06-01T10:00:00Z','2026-06-01T10:00:00Z'),
      (43,'Empty','Test','phone','full','2026-06-01T10:00:00Z','2026-06-01T10:00:00Z')`);
    await q(`UPDATE operational.clinics SET network_mode='lite',adoption_state='lite',membership_status='left',
      adoption_changed_at='2026-06-09T10:00:00Z',lite_started_at='2026-06-09T10:00:00Z',
      left_at='2026-06-09T10:00:00Z',left_by=999 WHERE clinic_id=43`);
    await q(`INSERT INTO operational.doctors(doctor_id,clinic_id,doctor_name,specialty,email)
      VALUES(51,41,'Own doctor','Family','own@example.test'),(52,42,'FOREIGN_DOCTOR','Family','foreign@example.test')`);
    for (let id = 61; id <= 66; id++) {
      await q(`INSERT INTO operational.patients(patient_id,created_clinic_id,patient_name,phone,dob,name_normalized)
        VALUES($1,$2,$3,'0599000000','1990-01-02','test')`,
      [id, id === 65 ? 41 : 42, id < 65 ? `مريض ${id}` : "UNASSOCIATED_PATIENT"]);
    }
    await q("INSERT INTO operational.patient_clinic_access(patient_id,clinic_id) VALUES(61,41),(66,42)");
    await q("INSERT INTO operational.patient_doctor_access(patient_id,clinic_id,doctor_id) VALUES(62,41,51)");
    await q(`INSERT INTO operational.appointments
      (appointment_id,clinic_id,doctor_id,patient_id,scheduled_at,booking_method,status,source_ref,client_op_id)
      VALUES(71,41,51,63,'2026-06-11T00:30:00+03','phone','booked','PRIVATE_SOURCE_REF','PRIVATE_OP'),
      (72,42,52,61,'2026-06-11T01:30:00+03','phone','booked',null,null)`);
    await q(`INSERT INTO operational.patient_visit_history(visit_id,patient_id,clinic_id,doctor_id,visit_date,diagnosis_notes)
      VALUES(81,64,41,51,'2026-06-10','ملاحظة محلية'),(82,61,42,52,'2026-06-10','FOREIGN_NOTE')`);
    await q(`INSERT INTO operational.patient_consents
      (id,patient_id,level,given_by,recorded_by_user,recorded_clinic_id,evidence,given_at)
      VALUES(91,61,'clinical','patient',999,41,'signed','2026-06-10T10:00:00Z'),
      (92,61,'basic','patient',999,42,'verbal','2026-06-10T10:00:00Z'),
      (93,61,'basic','patient',999,null,'verbal','2026-06-10T10:00:00Z'),
      (94,66,'basic','patient',999,41,'verbal','2026-06-10T10:00:00Z')`);
    await q(`INSERT INTO operational.import_batches(id,clinic_id,source_name,source_checksum,report)
      VALUES(101,41,'Local calendar','SECRET_CHECKSUM','{"private":"SECRET_REPORT"}'),
      (102,42,'FOREIGN_IMPORT','secret','{}')`);
    await q(`INSERT INTO operational.import_rows
      (id,batch_id,source_event_id,source_payload,staging,review_state,chosen_action,
      confirmed_patient_id,confirmed_doctor_id,appointment_id)
      VALUES(111,101,1,'{"secret":"RAW_PAYLOAD"}','{"secret":"STAGING"}','confirmed','link',63,51,71),
      (112,102,2,'{}','{}','confirmed','link',61,52,72),
      (113,101,3,'{}','{}','confirmed','link',61,52,72)`);
    await q(`INSERT INTO operational.import_source_links
      (source_name,source_event_id,source_hash,appointment_id,batch_id,row_id)
      VALUES('Local calendar',1,'SECRET_HASH',71,101,111),
      ('FOREIGN_IMPORT',2,'hash',72,102,112),('MIXED_FOREIGN',3,'hash',72,101,113)`);

    // Force a non-UTC DB timezone: exported instants must still end in UTC Z.
    await reader.query("SET TIME ZONE 'Asia/Hebron'");
    await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await reader.query(`SELECT clinic_id FROM ${schema}.clinics LIMIT 1`);
    await q("UPDATE operational.doctors SET doctor_name='Changed after snapshot' WHERE doctor_id=51");
    const result = await buildClinicExport(client, 41);
    await reader.query("COMMIT");
    assert.equal(result.manifest.empty, false);
    assert.equal(result.manifest.rowCount, 11);
    assert.deepEqual(result.datasets.patients.map(p => p.patient_id), [61, 62, 63, 64]);
    assert.deepEqual(result.datasets.consents.map(c => c.id), [91]);
    assert.deepEqual(result.datasets.importProvenance.map(p => p.row_id), [111]);
    assert.equal(result.datasets.doctors[0].doctor_name, "Own doctor");
    const settings = result.datasets.clinicSettings[0];
    assert.equal(settings.adoption_state, "full");
    assert.equal(settings.membership_status, "active");
    assert.equal(settings.adoption_changed_at, "2026-06-01T10:00:00.000Z");
    assert.equal(settings.full_started_at, "2026-06-01T10:00:00.000Z");
    for (const field of ["trial_started_at", "lite_started_at", "left_at", "left_by"]) {
      assert.equal(settings[field], null, field);
      assert(Object.hasOwn(settings, field), `${field} is required even when null`);
    }
    assert.equal(result.datasets.visits[0].diagnosis_notes, "ملاحظة محلية");
    assert.equal(result.datasets.visits[0].visit_date, "2026-06-10");
    assert.equal(result.datasets.patients[0].dob, "1990-01-02");
    assert.equal(result.datasets.appointments[0].scheduled_at, "2026-06-10T21:30:00.000Z");
    assert.match(result.manifest.exportedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    const serialized = JSON.stringify(result.datasets);
    for (const sentinel of ["FOREIGN_", "UNASSOCIATED_", "PRIVATE_SOURCE_REF", "PRIVATE_OP", "SECRET_", "RAW_PAYLOAD", "STAGING"]) {
      assert(!serialized.includes(sentinel), sentinel);
    }
    assert(reads.every(sql => !sql.includes("public.")), "service never queries seed tables");
    for (const description of result.manifest.includedDatasets) {
      for (const row of result.datasets[description.dataset]) {
        assert.deepEqual(Object.keys(row).sort(), [...description.fields].sort());
      }
      assert.equal(description.count, result.datasets[description.dataset].length);
    }
    await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const next = await buildClinicExport(client, 41);
    await reader.query("COMMIT");
    assert.equal(next.datasets.doctors[0].doctor_name, "Changed after snapshot");

    await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const empty = await buildClinicExport(client, 43);
    await reader.query("COMMIT");
    assert.equal(empty.manifest.empty, true);
    assert.equal(empty.manifest.rowCount, 1);
    assert.equal(empty.datasets.clinicSettings[0].adoption_state, "lite");
    assert.equal(empty.datasets.clinicSettings[0].membership_status, "left");
    assert.equal(empty.datasets.clinicSettings[0].left_at, "2026-06-09T10:00:00.000Z");
    assert.equal(empty.datasets.clinicSettings[0].left_by, 999);

    // An actual oversized SQL projection must produce a sentinel, not transfer
    // the note into application memory or silently truncate it.
    await q("UPDATE operational.patient_visit_history SET diagnosis_notes=repeat('ع',$1) WHERE visit_id=81",
      [CLINIC_EXPORT_LIMITS.maxBytes / 2 + 1]);
    await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await assert.rejects(buildClinicExport(client, 41),
      error => error instanceof ApiError && error.code === "EXPORT_LIMIT_EXCEEDED" && error.status === 413);
    await reader.query("ROLLBACK");
    await q("UPDATE operational.patient_visit_history SET diagnosis_notes='ملاحظة محلية' WHERE visit_id=81");

    // Overflow is detected with remaining+1, including rows already exported.
    await q(`INSERT INTO operational.patients(patient_id,patient_name,phone,dob,name_normalized)
      SELECT n,'Overflow','0599000000','1990-01-01','overflow' FROM generate_series(1000,10999) n`);
    await q(`INSERT INTO operational.patient_clinic_access(patient_id,clinic_id)
      SELECT n,41 FROM generate_series(1000,10999) n`);
    await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await assert.rejects(buildClinicExport(client, 41),
      error => error instanceof ApiError && error.code === "EXPORT_LIMIT_EXCEEDED" && error.status === 413);
    await reader.query("ROLLBACK");
    assert.deepEqual(await seedSnapshot(), before);
  } finally {
    await reader.query("ROLLBACK");
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await reader.end();
    await admin.end();
  }
});
