import type { PoolClient } from "pg";

export type SourceCounts = Record<"phone" | "walk-in" | "calendar" | "amal-network" | "unknown", number>;
export interface NoShowRate {
  numerator: number;
  denominator: number;
  ratio: number | null;
  percent: number | null;
}
export interface CollisionCounts {
  sameDoctorSameStartPairs: number;
  samePatientSameStartCrossClinicPairs: number;
}
export interface AppointmentAggregate {
  totalAppointments: number;
  completed: number;
  collisions: CollisionCounts;
  noShow: NoShowRate;
  bookingsBySource: SourceCounts;
  clinics: {
    clinicId: number;
    clinicName: string;
    totalAppointments: number;
    completed: number;
    collisions: CollisionCounts;
    noShow: NoShowRate;
    bookingsBySource: SourceCounts;
  }[];
  weekdays: { weekday: number; noShow: NoShowRate; bookingsBySource: SourceCounts }[];
  definitions: {
    collisions: string;
    clinicAttribution: string;
    noShow: string;
    sources: string;
    weekday: string;
  };
}

// These are fixed SQL expressions, never interpolated request values.
const sourceCounts = `jsonb_build_object(
  'phone',count(a.appointment_id) FILTER (WHERE a.source='phone'),
  'walk-in',count(a.appointment_id) FILTER (WHERE a.source='walk-in'),
  'calendar',count(a.appointment_id) FILTER (WHERE a.source='calendar'),
  'amal-network',count(a.appointment_id) FILTER (WHERE a.source='amal-network'),
  'unknown',count(a.appointment_id) FILTER (WHERE a.source='unknown'))`;
const noShow = `jsonb_build_object(
  'numerator',count(a.appointment_id) FILTER (WHERE a.status='no_show'),
  'denominator',count(a.appointment_id),
  'ratio',(count(a.appointment_id) FILTER (WHERE a.status='no_show'))::numeric / nullif(count(a.appointment_id),0),
  'percent',round(100.0 * (count(a.appointment_id) FILTER (WHERE a.status='no_show')) / nullif(count(a.appointment_id),0),1))`;

/**
 * Read-only, aggregate-only projection. Both sources deliberately include ALL
 * appointment statuses, including cancelled, for immutable baseline parity.
 * These exact-start pairs are NOT the interval-overlap enforcement metric.
 */
export async function aggregateAppointments(
  client: PoolClient,
  source: "before" | "after",
  start: string,
  end: string,
  clinicId: number | null,
): Promise<AppointmentAggregate> {
  const schema = source === "before" ? "public" : "operational";
  const { rows: [row] } = await client.query<{ result: AppointmentAggregate }>(`
    WITH all_appointments AS MATERIALIZED (
      SELECT appointment_id,clinic_id,doctor_id,patient_id,scheduled_at,status,
        extract(dow FROM scheduled_at AT TIME ZONE 'Asia/Hebron')::integer AS weekday,
        CASE lower(btrim(booking_method))
          WHEN 'phone' THEN 'phone'
          WHEN 'walk_in' THEN 'walk-in' WHEN 'walk-in' THEN 'walk-in' WHEN 'walk in' THEN 'walk-in'
          WHEN 'calendar_app' THEN 'calendar' WHEN 'calendar-app' THEN 'calendar' WHEN 'calendar app' THEN 'calendar'
          WHEN 'calendar' THEN 'calendar'
          WHEN 'amal_network' THEN 'amal-network' WHEN 'amal-network' THEN 'amal-network' WHEN 'amal network' THEN 'amal-network'
          ELSE 'unknown' END AS source
      FROM ${schema}.appointments WHERE scheduled_at >= $1::timestamptz AND scheduled_at < $2::timestamptz
    ), scoped AS (
      SELECT * FROM all_appointments WHERE $3::integer IS NULL OR clinic_id=$3
    ), pairs AS MATERIALIZED (
      SELECT a.clinic_id AS clinic_a,b.clinic_id AS clinic_b,
        a.doctor_id=b.doctor_id AS doctor_pair,
        a.patient_id=b.patient_id AND a.clinic_id<>b.clinic_id AS patient_pair
      FROM all_appointments a JOIN all_appointments b
        ON a.appointment_id<b.appointment_id AND a.scheduled_at=b.scheduled_at
      WHERE (a.doctor_id=b.doctor_id OR (a.patient_id=b.patient_id AND a.clinic_id<>b.clinic_id))
        AND ($3::integer IS NULL OR a.clinic_id=$3 OR b.clinic_id=$3)
    ), clinic_metrics AS (
      SELECT c.clinic_id,c.clinic_name,count(a.appointment_id) AS total,
        count(a.appointment_id) FILTER (WHERE a.status='completed') AS completed,
        ${noShow} AS no_show,${sourceCounts} AS sources
      FROM ${schema}.clinics c LEFT JOIN scoped a USING(clinic_id)
      WHERE $3::integer IS NULL OR c.clinic_id=$3 GROUP BY c.clinic_id,c.clinic_name
    ), weekday_metrics AS (
      SELECT d.weekday,${noShow} AS no_show,${sourceCounts} AS sources
      FROM generate_series(0,6) d(weekday) LEFT JOIN scoped a USING(weekday) GROUP BY d.weekday
    )
    SELECT jsonb_build_object(
      'totalAppointments',count(a.appointment_id),
      'completed',count(a.appointment_id) FILTER (WHERE a.status='completed'),
      'collisions',(SELECT jsonb_build_object(
        'sameDoctorSameStartPairs',count(*) FILTER (WHERE doctor_pair),
        'samePatientSameStartCrossClinicPairs',count(*) FILTER (WHERE patient_pair)) FROM pairs),
      'noShow',${noShow},'bookingsBySource',${sourceCounts},
      'clinics',(SELECT coalesce(jsonb_agg(jsonb_build_object(
        'clinicId',c.clinic_id,'clinicName',c.clinic_name,'totalAppointments',c.total,'completed',c.completed,
        'noShow',c.no_show,'bookingsBySource',c.sources,
        'collisions',(SELECT jsonb_build_object(
          'sameDoctorSameStartPairs',count(*) FILTER (WHERE p.doctor_pair),
          'samePatientSameStartCrossClinicPairs',count(*) FILTER (WHERE p.patient_pair))
          FROM pairs p WHERE p.clinic_a=c.clinic_id OR p.clinic_b=c.clinic_id)
      ) ORDER BY c.clinic_id),'[]'::jsonb) FROM clinic_metrics c),
      'weekdays',(SELECT jsonb_agg(jsonb_build_object(
        'weekday',weekday,'noShow',no_show,'bookingsBySource',sources) ORDER BY weekday) FROM weekday_metrics)
    ) AS result FROM scoped a`, [start, end, clinicId]);
  if (!row) throw new Error("KPI_APPOINTMENT_AGGREGATE_MISSING");
  return {
    ...row.result,
    definitions: {
      collisions: "Distinct unordered exact-start pairs across all statuses, including cancelled; not interval-overlap enforcement.",
      clinicAttribution: "A pair belongs to every clinic it touches; network counts each pair once. Clinic pair counts are not additive.",
      noShow: "no_show appointments / all appointments in the half-open scheduled-at window, across all statuses; ratio unrounded, percent rounded to one decimal; empty denominator yields null.",
      sources: "Trimmed, lowercase booking_method: phone; walk_in/walk-in/walk in => walk-in; calendar_app/calendar-app/calendar app/calendar => calendar; amal_network/amal-network/amal network => amal-network; all other values => unknown. Source rows are not modified.",
      weekday: "Asia/Hebron scheduled-at weekday; 0=Sunday through 6=Saturday, independent of database session timezone.",
    },
  };
}

export interface UnavailableCount {
  available: false;
  reason: string;
  value: null;
}
export interface ConflictTotals {
  blocked: number;
  warnings: number;
  overrides: number;
}
export interface TelemetryAggregate {
  conflicts: {
    daily: (ConflictTotals & { date: string; cumulativeBlocked: number; cumulativeWarnings: number; cumulativeOverrides: number })[];
    cumulative: ConflictTotals;
    coverage: string;
  };
  lookupTime: { available: false; reason: string; medianSeconds: null; sampleCount: null; measurementBoundaries: string };
  networkActivity: { available: false; reason: string; daily: null };
  downtime: {
    receivedCreates: number;
    synced: number;
    conflicted: number;
    rejected: number;
    pending: number;
    queued: UnavailableCount;
    lost: UnavailableCount;
    coverage: string;
  };
}

/** Durable mutation IDs are deduplicated before counting; preview checks are never events. */
export async function aggregateTelemetry(
  client: PoolClient,
  start: string,
  end: string,
  clinicId: number | null,
): Promise<TelemetryAggregate> {
  const { rows: [row] } = await client.query<{
    daily: TelemetryAggregate["conflicts"]["daily"];
    cumulative: ConflictTotals;
    downtime: Pick<TelemetryAggregate["downtime"], "receivedCreates" | "synced" | "conflicted" | "rejected" | "pending">;
  }>(`
    WITH blocked_attempts AS (
      SELECT o.client_op_id::text AS logical_id,o.created_at AS at,
        true AS blocked,
        EXISTS(SELECT 1 FROM jsonb_array_elements(c.reasons) r WHERE r->>'severity'='warning') AS warning,
        false AS override
      FROM operational.appointment_operations o
      LEFT JOIN operational.sync_conflicts c ON c.client_op_id=o.client_op_id
      WHERE o.result->>'code'='APPOINTMENT_CONFLICT'
        AND o.status='conflict' AND ($3::integer IS NULL OR o.clinic_id=$3)
    ), resolution_blocks AS (
      -- Nested failed mutations are rolled back to the resolution savepoint.
      -- The durable wrapper is therefore the sole identity of this attempt.
      SELECT h.client_op_id::text AS logical_id,h.created_at AS at,
        true AS blocked,false AS warning,false AS override
      FROM operational.sync_resolution_history h
      JOIN operational.sync_conflicts c ON c.id=h.conflict_id
      WHERE h.result->>'status'='open' AND h.result->'error'->>'code'='APPOINTMENT_CONFLICT'
        AND ($3::integer IS NULL OR c.clinic_id=$3)
    ), approved_overrides AS (
      SELECT detail->>'clientOpId' AS logical_id,min(at) AS at,
        false AS blocked,true AS warning,true AS override
      FROM operational.audit_log
      WHERE action='appointment.patient_overlap_override'
        AND nullif(detail->>'clientOpId','') IS NOT NULL
        AND ($3::integer IS NULL OR clinic_id=$3)
      GROUP BY detail->>'clientOpId'
    ), logical_events AS (
      SELECT logical_id,min(at) AS at,bool_or(blocked) AS blocked,bool_or(warning) AS warning,bool_or(override) AS override
      FROM (SELECT * FROM blocked_attempts UNION ALL SELECT * FROM resolution_blocks
        UNION ALL SELECT * FROM approved_overrides) e GROUP BY logical_id
    ), events AS (
      SELECT * FROM logical_events WHERE at >= $1::timestamptz AND at < $2::timestamptz
    ), days AS (
      SELECT d::date AS day FROM generate_series(
        ($1::timestamptz AT TIME ZONE 'Asia/Hebron')::date::timestamp,
        (($2::timestamptz - interval '1 microsecond') AT TIME ZONE 'Asia/Hebron')::date::timestamp,
        interval '1 day') d
    ), daily AS (
      SELECT d.day,count(e.logical_id) FILTER (WHERE e.blocked AND NOT e.override) AS blocked,
        count(e.logical_id) FILTER (WHERE e.warning) AS warnings,
        count(e.logical_id) FILTER (WHERE e.override) AS overrides
      FROM days d LEFT JOIN events e ON (e.at AT TIME ZONE 'Asia/Hebron')::date=d.day GROUP BY d.day
    ), received_creates AS (
      SELECT o.status,c.status AS conflict_status
      FROM operational.appointment_operations o
      LEFT JOIN operational.sync_conflicts c ON c.client_op_id=o.client_op_id
      WHERE o.request->>'target'='create'
        AND EXISTS(SELECT 1 FROM operational.sync_device_operations d WHERE d.client_op_id=o.client_op_id)
        AND o.created_at >= $1::timestamptz AND o.created_at < $2::timestamptz
        AND ($3::integer IS NULL OR o.clinic_id=$3)
    )
    SELECT
      (SELECT coalesce(jsonb_agg(v ORDER BY v->>'date'),'[]'::jsonb) FROM (
        SELECT jsonb_build_object('date',day::text,'blocked',blocked,'warnings',warnings,'overrides',overrides,
          'cumulativeBlocked',sum(blocked) OVER (ORDER BY day),
          'cumulativeWarnings',sum(warnings) OVER (ORDER BY day),
          'cumulativeOverrides',sum(overrides) OVER (ORDER BY day)) AS v FROM daily
      ) s) AS daily,
      (SELECT jsonb_build_object('blocked',count(*) FILTER (WHERE blocked AND NOT override),
        'warnings',count(*) FILTER (WHERE warning),'overrides',count(*) FILTER (WHERE override)) FROM events) AS cumulative,
      (SELECT jsonb_build_object('receivedCreates',count(*),
        'synced',count(*) FILTER (WHERE status='applied' OR (status='conflict' AND conflict_status='resolved')),
        'conflicted',count(*) FILTER (WHERE status='conflict' AND conflict_status IS DISTINCT FROM 'resolved'),
        'rejected',count(*) FILTER (WHERE status='rejected'),'pending',0) FROM received_creates) AS downtime
  `, [start, end, clinicId]);
  if (!row) throw new Error("KPI_TELEMETRY_AGGREGATE_MISSING");
  return {
    conflicts: {
      daily: row.daily,
      cumulative: row.cumulative,
      coverage: "Selected-window server commit attempts only, deduplicated by clientOpId across direct writes, sync receipts/retries, failed resolution attempts and override audit rows. Blocked means durable APPOINTMENT_CONFLICT, not version/hold/validation failures; approved overrides are never blocked. Warnings count only warning evidence on blocked direct/sync commits and approved patient-overlap overrides, not all previews/informational warnings or failed-resolution warning details. Failed resolution wrappers count once because their nested failures are rolled back; successful wrappers do not duplicate nested commits. Daily cumulative totals restart at the selected window; dates use Asia/Hebron.",
    },
    lookupTime: {
      available: false,
      reason: "LOOKUP_DURATION_PRODUCER_UNAVAILABLE",
      medianSeconds: null,
      sampleCount: null,
      measurementBoundaries: "No durable lookup start/end duration samples exist. A future producer must define logical lookup boundaries; response counts and daily medians cannot substitute for a range median.",
    },
    networkActivity: { available: false, reason: "LOGICAL_NETWORK_LOOKUP_PRODUCER_UNAVAILABLE", daily: null },
    downtime: {
      ...row.downtime,
      queued: { available: false, reason: "CLIENT_QUEUE_NOT_OBSERVED", value: null },
      lost: { available: false, reason: "CLIENT_LOSS_NOT_OBSERVED", value: null },
      coverage: "Unique server-received sync create operations with durable sync_device_operations receipts, by original server received time, not appointment time. Synced includes applied creates and subsequently resolved conflicts; conflicted is currently unresolved. Covered receipts have terminal applied/conflict/rejected outcomes, hence received pending=0. Excludes unreceipted rejected requests, sequence-blocked batch tails, updates, resolution wrappers and unknown client queues. Failed/unresolved is not lost; these are not proof of offline origin.",
    },
  };
}

export interface AdoptionAggregate {
  clinics: { clinicId: number; clinicName: string; state: "lite" | "full"; joinedAt: string | null }[];
  counts: { trial: null; lite: number; full: number };
  history: { available: false; reason: string };
  coverage: string;
}

export async function aggregateAdoption(client: PoolClient, clinicId: number | null): Promise<AdoptionAggregate> {
  const { rows: [row] } = await client.query<{
    clinics: AdoptionAggregate["clinics"];
    counts: AdoptionAggregate["counts"];
  }>(`SELECT coalesce(jsonb_agg(jsonb_build_object(
      'clinicId',clinic_id,'clinicName',clinic_name,'state',network_mode,
      'joinedAt',CASE WHEN joined_at IS NULL THEN NULL ELSE to_char(joined_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END
    ) ORDER BY clinic_id),'[]'::jsonb) AS clinics,
    jsonb_build_object('trial',NULL,'lite',count(*) FILTER (WHERE network_mode='lite'),
      'full',count(*) FILTER (WHERE network_mode='full')) AS counts
    FROM operational.clinics WHERE $1::integer IS NULL OR clinic_id=$1`, [clinicId]);
  if (!row) throw new Error("KPI_ADOPTION_AGGREGATE_MISSING");
  return {
    ...row,
    history: { available: false, reason: "ADOPTION_TRANSITION_HISTORY_UNAVAILABLE" },
    coverage: "Current operational network_mode (Lite/Full) and stored joined_at only. Trial is not represented in the upstream state model, so its count is unavailable, not zero. joinedAt may be an operational bootstrap timestamp; it is not evidence of a Trial start or of a Lite/Full transition. No historical transitions or booking-volume inference.",
  };
}
