import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import { fail } from "../lib/auth-errors";
import { aggregateAdoption, aggregateAppointments, aggregateTelemetry } from "./aggregates";
import { BASELINE_PERIOD, KPI_VERSION, parseKpiQuery } from "./period";

type Period = ReturnType<typeof parseKpiQuery>["period"];
async function snapshot(client: PoolClient, p: Period, source: "before" | "after", metric: string,
  clinicId: number | null, value: number | null, evidence: unknown, generatedAt: string) {
  const scope = clinicId === null ? "" : ",clinic_id";
  const predicate = clinicId === null ? "IS NULL" : "IS NOT NULL";
  await client.query(`INSERT INTO operational.kpi_snapshots
    (date,period_end,metric,clinic_id,value,source,calculation_version,generated_at,evidence)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT(date,period_end,metric${scope},source,calculation_version) WHERE clinic_id ${predicate}
    DO UPDATE SET value=excluded.value,evidence=excluded.evidence,generated_at=excluded.generated_at`,
  [p.startDate, p.endDateExclusive, metric, clinicId, value, source, KPI_VERSION, generatedAt,
    JSON.stringify({ period: p, ...evidence as object })]);
}

/**
 * Recompute on every request/backfill. Late arrivals are read, not incrementally
 * added to previous totals. The session lock is acquired BEFORE the repeatable
 * read transaction so a waiting refresh cannot later overwrite newer evidence
 * with a snapshot taken before its predecessor committed.
 */
export async function refreshKpis(raw: unknown, now = new Date()) {
  const query = parseKpiQuery(raw, now);
  const client = await pool.connect();
  let locked = false, releaseError: Error | undefined;
  try {
    await client.query("SELECT pg_advisory_lock(761929)");
    locked = true;
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    if (query.clinicId !== null) {
      const exists = await client.query("SELECT 1 FROM operational.clinics WHERE clinic_id=$1", [query.clinicId]);
      if (!exists.rowCount) throw fail(400, "VALIDATION", "validation");
    }
    const { rows: [clock] } = await client.query<{ at: Date }>("SELECT transaction_timestamp() AS at");
    const generatedAt = clock!.at.toISOString();
    const before = await aggregateAppointments(client, "before", BASELINE_PERIOD.start, BASELINE_PERIOD.end, query.clinicId);
    const after = await aggregateAppointments(client, "after", query.period.start, query.period.end, query.clinicId);
    const telemetry = await aggregateTelemetry(client, query.period.start, query.period.end, query.clinicId);
    const adoption = await aggregateAdoption(client, query.clinicId);
    const baselineProvenance = "Untouched public workbook appointments and clinics; scheduled_at is an already-normalized UTC instant. Fixed original local seed window.";
    const operationalProvenance = "Current operational appointments and durable server evidence, read in one repeatable-read transaction; not a historical state reconstruction.";
    const result = {
      range: query.range, appointments: after.totalAppointments, completed: after.completed,
      noShowRate: after.noShow.ratio, periodStart: query.period.start, periodEnd: query.period.end,
      calculationVersion: KPI_VERSION, generatedAt, scope: { clinicId: query.clinicId },
      comparison: {
        equalExposure: BASELINE_PERIOD.days === query.period.days,
        note: "Fixed before and selected after periods are reported separately. Raw counts are not exposure-adjusted; equal day counts do not establish equal clinic coverage, weekday mix or observation completeness.",
      },
      before: { period: BASELINE_PERIOD, provenance: baselineProvenance, metrics: before },
      after: { period: query.period, provenance: operationalProvenance, metrics: after, telemetry },
      adoption,
    };
    for (const [source, p, metrics, provenance] of [
      ["before", BASELINE_PERIOD, before, baselineProvenance],
      ["after", query.period, after, operationalProvenance],
    ] as const) {
      await snapshot(client, p, source, "appointments", query.clinicId, metrics.totalAppointments, { metrics, provenance }, generatedAt);
    }
    await snapshot(client, query.period, "after", "telemetry", query.clinicId, null, { metrics: telemetry, provenance: operationalProvenance }, generatedAt);
    await snapshot(client, query.period, "after", "adoption", query.clinicId, adoption.clinics.length,
      { metrics: adoption, provenance: "Current state as of generated_at, not period transition history." }, generatedAt);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { releaseError = new Error("KPI connection rollback failed"); }
    throw error;
  } finally {
    if (locked) {
      try { await client.query("SELECT pg_advisory_unlock(761929)"); }
      catch { releaseError = new Error("KPI connection unlock failed"); }
    }
    client.release(releaseError);
  }
}
