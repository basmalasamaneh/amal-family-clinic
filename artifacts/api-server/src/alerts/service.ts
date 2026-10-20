import { pool } from "@workspace/db";
import type pg from "pg";
import { extractAlerts } from "./extract";

export class ExtractionError extends Error {
  constructor(public readonly messageKey: string) { super(messageKey); }
}
const validId = (id: number) => Number.isInteger(id) && id > 0 && id <= 2147483647;
/** Internal operational service, not a public route or an authorization grant. */
export async function extractVisit(visitId: number): Promise<number> {
  if (!validId(visitId)) throw new ExtractionError("alerts.error.invalidInput");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const count = await extractVisitInTransaction(client, visitId);
    await client.query("COMMIT");
    return count;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Same extraction implementation, composed into the atomic demo reset. */
export async function extractVisitInTransaction(client: Pick<pg.Client, "query">, visitId: number): Promise<number> {
    const { rows: [visit] } = await client.query(`SELECT patient_id,diagnosis_notes
      FROM operational.patient_visit_history WHERE visit_id=$1 FOR UPDATE`, [visitId]);
    if (!visit) throw new ExtractionError("alerts.error.visitNotFound");
    const alerts = extractAlerts(visit.diagnosis_notes);
    const { rows: owned } = await client.query(`SELECT extractor_rule_id,fixture_key
      FROM operational.visit_alerts WHERE visit_id=$1 AND extractor_rule_id IS NOT NULL`, [visitId]);
    const fixtureKeys = new Map<string, string>(owned.filter(r => r.fixture_key).map(r => [r.extractor_rule_id, r.fixture_key]));
    // Adopt only the explicitly designated legacy generated fixture, never a
    // same-label manual flag. Recognize its old evidence, not a patient/name ID.
    const { rows: legacy } = await client.query(`SELECT id,source_note_excerpt FROM operational.visit_alerts
      WHERE visit_id=$1 AND fixture_key='demo.reem.medication'
      AND kind='medication' AND label='demo.alerts.bloodPressureMedication'
      AND extractor_rule_id IS NULL`, [visitId]);
    for (const row of legacy) {
      if (extractAlerts(row.source_note_excerpt).some(a => a.ruleId === "med.amlodipine")) {
        fixtureKeys.set("med.amlodipine", "demo.reem.medication");
        await client.query("DELETE FROM operational.visit_alerts WHERE id=$1", [row.id]);
      }
    }
    await client.query("DELETE FROM operational.visit_alerts WHERE visit_id=$1 AND extractor_rule_id IS NOT NULL", [visitId]);
    for (const a of alerts) {
      await client.query(`INSERT INTO operational.visit_alerts
        (visit_id,patient_id,kind,label,source_note_excerpt,extractor_rule_id,dictionary_version,label_params,excerpt_start,excerpt_end,fixture_key)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
      [visitId, visit.patient_id, a.kind, a.labelKey, a.sourceNoteExcerpt, a.ruleId,
        a.dictionaryVersion, JSON.stringify(a.labelParams), a.excerptStart, a.excerptEnd, fixtureKeys.get(a.ruleId) ?? null]);
    }
    return alerts.length;
}

/** Finite initialization run: snapshot the upper ID, then process bounded pages.
 * Visits inserted during the run are intentionally left for the next invocation. */
export async function initializeAlerts() {
  const { rows: [upper] } = await pool.query("SELECT coalesce(max(visit_id),0) AS id FROM operational.patient_visit_history");
  let after = 0, visits = 0, flags = 0;
  while (after < upper.id) {
    const { rows } = await pool.query(`SELECT visit_id FROM operational.patient_visit_history
      WHERE visit_id>$1 AND visit_id<=$2 ORDER BY visit_id LIMIT 100`, [after, upper.id]);
    if (!rows.length) break;
    for (const row of rows) { flags += await extractVisit(row.visit_id); visits++; }
    after = rows.at(-1)!.visit_id;
  }
  return { visits, flags };
}

/** One bounded page per invocation. Resume using nextCursor; no hidden loop. */
export async function backfillAlerts(after = 0, limit = 100) {
  if ((!validId(after) && after !== 0) || !Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new ExtractionError("alerts.error.invalidInput");
  }
  const { rows } = await pool.query(`SELECT visit_id FROM operational.patient_visit_history
    WHERE visit_id>$1 ORDER BY visit_id LIMIT $2`, [after, limit + 1]);
  const page = rows.slice(0, limit);
  let flags = 0;
  for (const row of page) flags += await extractVisit(row.visit_id);
  return { visits: page.length, flags, nextCursor: rows.length > limit ? page.at(-1)!.visit_id as number : null };
}
