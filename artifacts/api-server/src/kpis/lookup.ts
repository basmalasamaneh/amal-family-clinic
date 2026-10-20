import { z } from "zod/v4";
import { formatInTimeZone } from "date-fns-tz";
import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import type { Auth } from "../lib/auth";
import { requireDoctor } from "../consent/service";
import { ZONE } from "./period";

export const lookupBody = z.object({
  durationMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict();
export const LOOKUP_VERSION = "lookup-ms-frequency-1";
export const LOOKUP_METRIC = "lookup_duration_ms";
/** Match Express's case-insensitive, optional-trailing-slash routing. */
export const isLookupTelemetryPath = (url: string) => /^\/api\/kpis\/lookup-duration\/?$/i.test(url.split("?")[0]!);
export const lookupMetadata = {
  units: "seconds" as const,
  storageUnits: "milliseconds" as const,
  exact: true,
  percentileMethod: "Exact range median (mean of middle pair); nearest-rank p90.",
  measurementBoundaries: "First query-changing input (including paste/IME), or submission fallback, through visible rendering of the matching successful result card; includes debounce, request and render time.",
  coverage: "Only successfully received foreground completed-card measurements. Excludes hidden-tab completions, empty/error results, cancelled or superseded attempts and failed transmissions. No retries or offline queue. Self-reported browser elapsed time; not all searches or server latency.",
  attribution: "Server receipt Asia/Hebron calendar day; selected half-open local-date range.",
};

/** Only aggregate evidence is written. Authentication context is never copied. */
export async function ingestLookup(auth: Auth, raw: unknown, receivedAt = new Date()) {
  const { durationMs } = lookupBody.parse(raw);
  const day = formatInTimeZone(receivedAt, ZONE, "yyyy-MM-dd");
  const client = await pool.connect();
  try {
    await requireDoctor(client, auth);
    // The unique daily key locks the conflicting row. Both counters use the
    // current locked row, never a read/modify/write value from the application.
    await client.query(`INSERT INTO operational.kpi_snapshots AS s
      (date,period_end,metric,clinic_id,value,source,calculation_version,evidence)
      VALUES($1::date,$1::date+1,$2,$3,NULL,'after',$4,
        jsonb_build_object('sampleCount',1,'frequencies',jsonb_build_object($5::text,1)))
      ON CONFLICT(date,period_end,metric,clinic_id,source,calculation_version) WHERE clinic_id IS NOT NULL
      DO UPDATE SET evidence=jsonb_build_object(
        'sampleCount',(s.evidence->>'sampleCount')::bigint+1,
        'frequencies',jsonb_set(s.evidence->'frequencies',ARRAY[$5::text],
          to_jsonb(coalesce((s.evidence->'frequencies'->>$5::text)::bigint,0)+1)))`,
    [day, LOOKUP_METRIC, auth.clinicId, LOOKUP_VERSION, String(durationMs)]);
    // generated_at is the UTC snapshot creation metadata, not a per-event clock.
  } finally { client.release(); }
}

export function summarizeLookup(frequencies: Iterable<readonly [number, number]>) {
  const merged = new Map<number, number>();
  for (const [ms, count] of frequencies) merged.set(ms, (merged.get(ms) ?? 0) + count);
  const sorted = [...merged].sort((a, b) => a[0] - b[0]);
  const sampleCount = sorted.reduce((sum, [, count]) => sum + count, 0);
  const rank = (n: number) => {
    let seen = 0;
    for (const [ms, count] of sorted) { seen += count; if (seen >= n) return ms; }
    throw new Error("LOOKUP_DISTRIBUTION_INVALID");
  };
  return {
    available: sampleCount > 0,
    reason: sampleCount ? null : "NO_LOOKUP_SAMPLES",
    medianSeconds: sampleCount ? (rank(Math.floor((sampleCount + 1) / 2)) / 2 + rank(Math.floor(sampleCount / 2) + 1) / 2) / 1000 : null,
    p90Seconds: sampleCount ? rank(Math.ceil(sampleCount * 0.9)) / 1000 : null,
    sampleCount,
    ...lookupMetadata,
  };
}

export async function aggregateLookup(client: PoolClient, start: string, end: string, clinicId: number | null) {
  const { rows } = await client.query<{ ms: string; count: string }>(`
    SELECT f.key AS ms,sum(f.value::bigint)::text AS count
    FROM operational.kpi_snapshots s CROSS JOIN LATERAL jsonb_each_text(s.evidence->'frequencies') f
    WHERE s.metric=$4 AND s.calculation_version=$5 AND s.source='after'
      AND s.date >= ($1::timestamptz AT TIME ZONE 'Asia/Hebron')::date
      AND s.date < ($2::timestamptz AT TIME ZONE 'Asia/Hebron')::date
      AND ($3::integer IS NULL OR s.clinic_id=$3)
    GROUP BY f.key`, [start, end, clinicId, LOOKUP_METRIC, LOOKUP_VERSION]);
  return summarizeLookup(rows.map(r => [Number(r.ms), Number(r.count)] as const));
}
