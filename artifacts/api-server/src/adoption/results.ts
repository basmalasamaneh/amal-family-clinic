import { z } from "zod/v4";
import { formatInTimeZone } from "date-fns-tz";
import { pool } from "@workspace/db";
import scenario from "./scenario.json";
import { aggregateTelemetry, type TelemetryAggregate } from "../kpis/aggregates";
import { KPI_VERSION, period, shiftDay, ZONE } from "../kpis/period";
import { LOOKUP_VERSION } from "../kpis/lookup";

const id = z.number().int().positive().max(2147483647);
const configuration = z.object({
  trialClinicId: id,
  resultClinicIds: z.tuple([id, id]),
}).strict().refine(value => new Set([value.trialClinicId, ...value.resultClinicIds]).size === 3);

/** Configuration is publication authorization, never inferred from data or names. */
export function parseScenario(raw: unknown) {
  const parsed = configuration.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function resultsWindow(now = new Date()) {
  const end = formatInTimeZone(now, ZONE, "yyyy-MM-dd");
  return period(shiftDay(end, -7), end);
}

/** Project scalar aggregates only; do not pass through the administrator response. */
export function projectResults(telemetry: TelemetryAggregate, attemptCount: number) {
  const blocked = telemetry.conflicts.cumulative.blocked;
  const hasEvidence = attemptCount > 0 && attemptCount >= blocked;
  return {
    preventedBlocks: {
      available: hasEvidence,
      reason: hasEvidence ? null : "NO_PREVENTION_EVIDENCE",
      value: hasEvidence ? blocked : null,
      units: "blocks" as const,
      sampleCount: attemptCount,
      coverage: telemetry.conflicts.coverage,
      provenance: "Durable operational server commit decisions; sampleCount is distinct applied or APPOINTMENT_CONFLICT attempts, including failed resolution wrappers. No preview checks, warning counts, or claims about unreceived attempts.",
    },
    medianLookupSeconds: {
      available: telemetry.lookupTime.available,
      reason: telemetry.lookupTime.reason,
      value: telemetry.lookupTime.medianSeconds,
      units: "seconds" as const,
      sampleCount: telemetry.lookupTime.sampleCount,
      coverage: telemetry.lookupTime.coverage,
      provenance: `Operational aggregate lookup-duration frequency evidence (${LOOKUP_VERSION}); exact whole-window median, not an average of daily medians. Attributed by server receipt local date; browser self-reported elapsed time, not doctor performance.`,
    },
  };
}

export async function adoptionResults(now = new Date(), rawConfiguration: unknown = scenario) {
  const window = resultsWindow(now);
  const config = parseScenario(rawConfiguration);
  const base = { window, generatedAt: now.toISOString(), calculationVersion: KPI_VERSION };
  if (!config) return { ...base, available: false, reason: "SCENARIO_UNCONFIGURED", clinics: [] };
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { rows: [clock] } = await client.query<{ at: Date }>("SELECT transaction_timestamp() AS at");
    base.generatedAt = clock!.at.toISOString();
    const { rows } = await client.query<{ clinic_id: number; clinic_name: string }>(
      "SELECT clinic_id,clinic_name FROM operational.clinics WHERE clinic_id=ANY($1::int[])",
      [[config.trialClinicId, ...config.resultClinicIds]],
    );
    if (rows.length !== 3) {
      await client.query("COMMIT");
      return { ...base, available: false, reason: "SCENARIO_CLINICS_UNAVAILABLE", clinics: [] };
    }
    const clinics = [];
    for (const clinicId of config.resultClinicIds) {
      const telemetry = await aggregateTelemetry(client, window.start, window.end, clinicId);
      // Coverage evidence only: the metric calculation remains aggregateTelemetry.
      // Include applied decisions to distinguish a genuine observed zero from no
      // instrumentation, and mirror upstream logical-ID/earliest-at attribution.
      const { rows: [evidence] } = await client.query<{ count: number }>(`
        WITH decisions AS (
          SELECT client_op_id::text AS logical_id,created_at AS at
          FROM operational.appointment_operations
          WHERE clinic_id=$3 AND (status='applied' OR
            (status='conflict' AND result->>'code'='APPOINTMENT_CONFLICT'))
          UNION ALL
          SELECT h.client_op_id::text,h.created_at
          FROM operational.sync_resolution_history h
          JOIN operational.sync_conflicts c ON c.id=h.conflict_id
          WHERE c.clinic_id=$3 AND h.result->>'status'='open'
            AND h.result->'error'->>'code'='APPOINTMENT_CONFLICT'
        ), logical_decisions AS (
          SELECT logical_id,min(at) AS at FROM decisions GROUP BY logical_id
        )
        SELECT count(*)::integer AS count FROM logical_decisions
        WHERE at >= $1::timestamptz AND at < $2::timestamptz`,
      [window.start, window.end, clinicId]);
      clinics.push({
        clinicId, clinicName: rows.find(row => row.clinic_id === clinicId)!.clinic_name,
        ...projectResults(telemetry, evidence!.count),
      });
    }
    await client.query("COMMIT");
    return { ...base, available: true, reason: null, clinics };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
