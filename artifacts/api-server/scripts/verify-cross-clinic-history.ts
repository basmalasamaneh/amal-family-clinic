/** Projection check for the explicitly synthetic practice case, not a login test. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pool } from "@workspace/db";
import { projectNetworkPatients } from "../src/consent/service";
import type { Auth } from "../src/lib/auth";

assert(process.argv.includes("--demo") && process.env.NODE_ENV !== "production" && process.env.REPLIT_DEPLOYMENT !== "1");
const manifest = JSON.parse(readFileSync(new URL("../../../docs/CROSS_CLINIC_HISTORY_CASE.json", import.meta.url), "utf8"));
assert.equal(manifest.synthetic, true);
const client = await pool.connect();
try {
  await client.query("BEGIN");
  for (const visit of manifest.visits) {
    const { rows: [user] } = await client.query(`SELECT u.id,u.role,u.clinic_id,d.doctor_id
      FROM operational.users u JOIN operational.doctors d ON d.user_id=u.id
      WHERE u.email=$1 AND u.disabled_at IS NULL`, [visit.email]);
    assert(user && user.role === "doctor" && user.clinic_id === visit.clinic_id);
    // Exercise the real disclosure projection with the actual doctor's scope.
    // No session or credentials are created, and all read-audit writes roll back.
    const actor = { id: user.id, role: "doctor", clinicId: user.clinic_id, doctorId: user.doctor_id } as Auth;
    const result = await projectNetworkPatients(client, actor, { patientIds: [manifest.patientId], limit: 1 }, crypto.randomUUID());
    assert.equal(result.items.length, 1);
    const visits = result.items[0]!.visits;
    assert.equal(visits.length, 2);
    assert.equal(new Set(visits.map(v => v.clinicId)).size, 2);
    console.log(JSON.stringify({ doctor: visit.email, patient: manifest.name, visibleClinics: visits.map(v => v.clinicId), verified: true }));
  }
} finally {
  await client.query("ROLLBACK");
  client.release();
  await pool.end();
}
