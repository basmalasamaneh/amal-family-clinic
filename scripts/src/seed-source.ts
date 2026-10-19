import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const zone = "Asia/Hebron";
export const sourceHash = "b3249b281f503b8a6b6bc935a203dff756d431b1bc24ecf953a108c7efa610dd";
export const definitions = {
  clinics: "clinic_id:integer clinic_name:text city:text booking_method:text",
  doctors: "doctor_id:integer doctor_name:text clinic_id:integer specialty:text",
  patients: "patient_id:integer patient_name:text phone:text dob:date",
  appointments: "appointment_id:integer clinic_id:integer doctor_id:integer patient_id:integer scheduled_at:timestamptz booking_method:text status:text",
  patient_visit_history: "visit_id:integer patient_id:integer clinic_id:integer doctor_id:integer visit_date:date diagnosis_notes:text",
  calendar_app_export: "event_id:integer doctor_email:text patient_name_typed:text start_time:timestamptz end_time:timestamptz event_status:text",
} as const;
export const counts = [3, 5, 25, 102, 32, 24];
export const tables = Object.entries(definitions).map(([name, spec], i) => ({
  name, count: counts[i],
  columns: spec.split(" ").map(c => { const [name, type] = c.split(":"); return { name: name!, type: type! }; }),
}));
export function readSource() {
  const path = root + "docs/data/Amal_Family_Clinic_Group_data.xlsx";
  for (const file of [path, root + "attached_assets/Amal_Family_Clinic_Group_data_1792331449501.xlsx"]) {
    assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), sourceHash, "Workbook provenance mismatch");
  }
  const sheets = JSON.parse(execFileSync("python", [root + "scripts/src/read-seed-workbook.py", path], { encoding: "utf8" })) as Record<string, { columns: string[]; rows: (string | number)[][] }>;
  assert.deepEqual(Object.keys(sheets), tables.map(t => t.name));
  for (const table of tables) {
    const sheet = sheets[table.name]!;
    assert.deepEqual(sheet.columns, table.columns.map(c => c.name));
    assert.equal(sheet.rows.length, table.count);
    assert.equal(new Set(sheet.rows.map(r => r[0])).size, table.count);
    for (const row of sheet.rows) table.columns.forEach((c, i) => {
      const v = row[i];
      if (c.type === "integer") assert(Number.isSafeInteger(v));
      else assert.equal(typeof v, "string");
      if (c.type === "timestamptz") {
        const utc = fromZonedTime(v as string, zone);
        assert.equal(formatInTimeZone(utc, zone, "yyyy-MM-dd'T'HH:mm:ss"), v, "Non-reversible local time");
      }
    });
  }
  return sheets;
}
export function dbValue(type: string, value: string | number) {
  return type === "timestamptz" ? fromZonedTime(value as string, zone).toISOString() : value;
}
