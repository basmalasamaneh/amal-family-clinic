import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { fromZonedTime } from "date-fns-tz";
import { projectVisit } from "../src/consent/policy";
if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Tests prohibited in deployment");
const root = fileURLToPath(new URL("../../../", import.meta.url));
test("normal demo initialization and population rerun retain exactly one projected generated chip", async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const run = () => execFileSync("pnpm", ["--filter", "@workspace/scripts", "demo:populate", "--demo"],
    { cwd: root, stdio: "pipe" });
  try {
    // No explicit extraction call: exercise the real operator entry point.
    for (let i = 0; i < 2; i++) {
      run();
      const { rows: [v] } = await client.query(`SELECT v.*,v.visit_date::text AS visit_day,c.clinic_name,d.doctor_name
        FROM operational.patient_visit_history v JOIN operational.clinics c USING(clinic_id)
        JOIN operational.doctors d USING(doctor_id) WHERE v.visit_id=31`);
      const { rows: alerts } = await client.query("SELECT * FROM operational.visit_alerts WHERE visit_id=31");
      const projected = projectVisit({ ...v, seen_at: fromZonedTime(`${v.visit_day}T00:00:00`, "Asia/Hebron"),
        alerts, key_alerts: alerts.map(a => a.label), cross_clinic: true }, "clinical");
      assert.equal(projected.alerts!.filter(a => a.kind === "medication").length, 1);
      assert.equal(projected.alerts![0]!.label, "Blood-pressure medication (Amlodipine 5 mg)");
      assert.equal(projected.alerts![0]!.sourceNoteExcerpt, v.diagnosis_notes);
      assert.equal(alerts[0].fixture_key, "demo.reem.medication", "durable adoption prevents fixture recreation");
      assert.equal(alerts[0].extractor_rule_id, "med.amlodipine");
    }
  } finally { await client.end(); }
});
