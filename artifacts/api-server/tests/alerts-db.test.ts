import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { pool } from "@workspace/db";
import { backfillAlerts, extractVisit } from "../src/alerts/service";
import { renderAlert } from "../src/alerts/dictionary";
if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Tests prohibited in deployment");
const note = "Started on blood pressure medication (Amlodipine 5mg) - review in 3 months";

test("operational extraction: isolation, concurrency, legacy adoption, stale evidence, rollback and immutable seeds", async () => {
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  let synthetic: number | undefined;
  const snapshot = async () => {
    const data = [];
    for (const table of ["clinics", "doctors", "patients", "appointments", "patient_visit_history", "calendar_app_export"]) {
      data.push((await admin.query(`SELECT md5(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text)) h FROM public.${table} t`)).rows);
    }
    return data;
  };
  const before = await snapshot();
  try {
    const { rows: [source] } = await admin.query(`SELECT v.*,v.visit_date::text AS day,s.diagnosis_notes AS seed_note
      FROM operational.patient_visit_history v JOIN public.patient_visit_history s USING(visit_id) WHERE v.visit_id=31`);
    assert(source);
    assert.equal(source.patient_id, 15);
    assert.equal(source.clinic_id, 1);
    assert.equal(source.day, "2026-03-12");
    assert.equal(source.diagnosis_notes, note);
    assert.equal(source.seed_note, note);
    assert.equal(formatInTimeZone(fromZonedTime(`${source.day}T00:00:00`, "Asia/Hebron"), "Asia/Hebron", "yyyy-MM-dd"), source.day);
    synthetic = (await admin.query(`INSERT INTO operational.patient_visit_history
      (patient_id,clinic_id,doctor_id,visit_date,diagnosis_notes) VALUES($1,$2,$3,$4,$5) RETURNING visit_id`,
    [source.patient_id, source.clinic_id, source.doctor_id, source.day, note])).rows[0].visit_id;
    const rows = async () => (await admin.query("SELECT * FROM operational.visit_alerts WHERE visit_id=$1 ORDER BY id", [synthetic])).rows;
    assert.equal((await rows()).length, 0, "generation does not rely on demo fixture");
    await Promise.all(Array.from({ length: 6 }, () => extractVisit(synthetic!)));
    let alerts = await rows();
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].source_note_excerpt, note);
    assert.equal(alerts[0].patient_id, source.patient_id);
    assert.equal(renderAlert(alerts[0].label, alerts[0].label_params), "Blood-pressure medication (Amlodipine 5 mg)");
    // A real database failure after DELETE must not lose the previous result.
    const originalConnect = pool.connect.bind(pool);
    const lockedClient = await originalConnect();
    const originalQuery = lockedClient.query;
    lockedClient.query = function (...args: unknown[]) {
      if (typeof args[0] === "string" && args[0].includes("INSERT INTO operational.visit_alerts")) {
        return Reflect.apply(originalQuery, this, ["SELECT 1/0"]);
      }
      return Reflect.apply(originalQuery, this, args);
    } as typeof lockedClient.query;
    pool.connect = (async () => lockedClient) as typeof pool.connect;
    try {
      await assert.rejects(extractVisit(synthetic!));
      assert.deepEqual(await rows(), alerts, "failed reconciliation preserves previous rows exactly");
    } finally {
      lockedClient.query = originalQuery;
      pool.connect = originalConnect;
    }
    await admin.query(`INSERT INTO operational.visit_alerts(visit_id,patient_id,kind,label,source_note_excerpt)
      VALUES($1,$2,'condition','manual.keep',$3)`, [synthetic, source.patient_id, note]);
    await admin.query("UPDATE operational.patient_visit_history SET diagnosis_notes='Asthma; حساسية من البنسلين' WHERE visit_id=$1", [synthetic]);
    assert.equal((await rows()).length, 1, "note edit immediately invalidates derived data only");
    await extractVisit(synthetic!);
    alerts = await rows();
    assert.equal(alerts.length, 3);
    assert(alerts.some(a => a.label === "manual.keep"));
    assert(!alerts.some(a => a.extractor_rule_id && a.source_note_excerpt === note));
    await admin.query("BEGIN");
    await admin.query("UPDATE operational.patient_visit_history SET diagnosis_notes='No asthma' WHERE visit_id=$1", [synthetic]);
    await admin.query("ROLLBACK");
    assert.equal((await rows()).length, 3, "invalidation rolls back with the note");
    await admin.query("UPDATE operational.patient_visit_history SET diagnosis_notes='No asthma' WHERE visit_id=$1", [synthetic]);
    await extractVisit(synthetic!);
    assert.equal((await rows()).length, 1);
    // Existing designated fixture is deduplicated without identity-specific production branching.
    await Promise.all([extractVisit(31), extractVisit(31)]);
    const acceptance = (await admin.query("SELECT * FROM operational.visit_alerts WHERE visit_id=31 AND kind='medication'")).rows;
    assert.equal(acceptance.filter(a => a.extractor_rule_id === "med.amlodipine").length, 1);
    assert.equal(acceptance.filter(a => a.label === "demo.alerts.bloodPressureMedication").length, 0);
    const page = await backfillAlerts(0, 1);
    assert.equal(page.visits, 1);
    assert(page.nextCursor !== null);
    await assert.rejects(backfillAlerts(0, 501));
    await assert.rejects(extractVisit(-1));
    await assert.rejects(extractVisit(2147483647));
    assert.deepEqual(await snapshot(), before);
    const imports = (await admin.query("SELECT review_state FROM operational.import_rows")).rows;
    assert(imports.every(r => r.review_state === "review_required"), "calendar rows remain review-required");
  } finally {
    if (synthetic) {
      await admin.query("DELETE FROM operational.visit_alerts WHERE visit_id=$1", [synthetic]);
      await admin.query("DELETE FROM operational.patient_visit_history WHERE visit_id=$1", [synthetic]);
    }
    await admin.end();
    await pool.end();
  }
});
