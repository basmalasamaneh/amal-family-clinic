import type { PoolClient } from "pg";
import { ApiError, fail } from "../lib/auth-errors";

export const CLINIC_EXPORT_LIMITS = Object.freeze({
  maxRows: 10_000,
  maxBytes: 8 * 1024 * 1024,
  maxDurationMs: 15_000,
});

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type ExportRow = { [key: string]: JsonValue };
type Dataset = {
  name: string;
  fields: Record<string, string>;
  from: string;
  where: string;
  order: string;
};

// A portability scope, not a grant for interactive patient reads. Existing local
// appointments/history are sufficient for export, but never pull foreign notes.
const associatedPatient = `EXISTS (SELECT 1 FROM operational.patient_clinic_access a
    WHERE a.patient_id=p.patient_id AND a.clinic_id=$1)
  OR EXISTS (SELECT 1 FROM operational.patient_doctor_access a
    WHERE a.patient_id=p.patient_id AND a.clinic_id=$1)
  OR EXISTS (SELECT 1 FROM operational.appointments a
    WHERE a.patient_id=p.patient_id AND a.clinic_id=$1)
  OR EXISTS (SELECT 1 FROM operational.patient_visit_history v
    WHERE v.patient_id=p.patient_id AND v.clinic_id=$1)`;
const utc = (column: string) => `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const columns = (alias: string, names: string[]) =>
  Object.fromEntries(names.map(name => [name, `${alias}.${name}`]));

// Every projected field is explicitly allowlisted. Never use table.* or expose
// users, device credentials, source payloads, receipts, or arbitrary JSON blobs.
const datasets: Dataset[] = [
  {
    name: "clinicSettings", from: "operational.clinics c", where: "c.clinic_id=$1", order: "c.clinic_id",
    fields: {
      ...columns("c", ["clinic_id", "clinic_name", "city", "booking_method", "slot_minutes",
        "working_days", "open_time", "close_time", "network_mode", "timezone",
        "adoption_state", "membership_status", "left_by"]),
      joined_at: utc("c.joined_at"),
      adoption_changed_at: utc("c.adoption_changed_at"),
      trial_started_at: utc("c.trial_started_at"),
      lite_started_at: utc("c.lite_started_at"),
      full_started_at: utc("c.full_started_at"),
      left_at: utc("c.left_at"),
    },
  },
  {
    name: "doctors", from: "operational.doctors d", where: "d.clinic_id=$1", order: "d.doctor_id",
    fields: columns("d", ["doctor_id", "clinic_id", "doctor_name", "specialty"]),
  },
  {
    name: "patients", from: "operational.patients p", where: `(${associatedPatient})`, order: "p.patient_id",
    fields: {
      ...columns("p", ["patient_id", "patient_name", "phone", "guardian_name", "guardian_relation"]),
      dob: "p.dob::text",
    },
  },
  {
    name: "appointments", from: "operational.appointments a", where: "a.clinic_id=$1", order: "a.appointment_id",
    fields: {
      ...columns("a", ["appointment_id", "clinic_id", "doctor_id", "patient_id", "booking_method",
        "status", "duration_minutes", "conflict_state", "cancel_reason", "version"]),
      scheduled_at: utc("a.scheduled_at"), created_at: utc("a.created_at"), updated_at: utc("a.updated_at"),
    },
  },
  {
    name: "visits", from: "operational.patient_visit_history v", where: "v.clinic_id=$1", order: "v.visit_id",
    fields: {
      ...columns("v", ["visit_id", "clinic_id", "doctor_id", "patient_id", "diagnosis_notes"]),
      visit_date: "v.visit_date::text",
    },
  },
  {
    name: "consents", from: "operational.patient_consents c JOIN operational.patients p ON p.patient_id=c.patient_id",
    where: `c.recorded_clinic_id=$1 AND (${associatedPatient})`, order: "c.id",
    fields: {
      ...columns("c", ["id", "patient_id", "recorded_clinic_id", "level", "given_by",
        "guardian_name", "guardian_relation", "evidence"]),
      given_at: utc("c.given_at"), withdrawn_at: utc("c.withdrawn_at"),
    },
  },
  {
    name: "importBatches", from: "operational.import_batches b", where: "b.clinic_id=$1", order: "b.id",
    fields: {
      ...columns("b", ["id", "clinic_id", "source_name", "status", "version"]),
      created_at: utc("b.created_at"), committed_at: utc("b.committed_at"),
    },
  },
  {
    name: "importProvenance",
    from: `operational.import_source_links l
      JOIN operational.appointments a ON a.appointment_id=l.appointment_id
      JOIN operational.import_batches b ON b.id=l.batch_id
      JOIN operational.import_rows r ON r.id=l.row_id AND r.batch_id=b.id AND r.appointment_id=a.appointment_id`,
    where: "a.clinic_id=$1 AND b.clinic_id=$1", order: "l.row_id",
    fields: {
      ...columns("l", ["batch_id", "row_id", "appointment_id", "source_name", "source_event_id"]),
      created_at: utc("l.created_at"),
    },
  },
];

const excludedDatasets = [
  { dataset: "otherClinicData", reason: "Only the exporting clinic's records; no foreign visits, notes, appointments, doctors, consents or imports." },
  { dataset: "unattributedConsents", reason: "Missing recorded_clinic_id is not inferred from current user assignment." },
  { dataset: "unassociatedPatients", reason: "Only demographics associated through local access, appointments or visits." },
  { dataset: "usersAndAuthentication", reason: "No accounts, password/PIN hashes, sessions, tokens, devices or credentials." },
  { dataset: "syncAndOperationReceipts", reason: "No raw sync payloads, conflicts, request hashes or idempotency receipts." },
  { dataset: "importRawAndReviewData", reason: "No source_payload, staging, report, source hashes, candidate identities or review detail." },
  { dataset: "auditLogs", reason: "Audit data is not a clinic portability dataset." },
  { dataset: "seedAndFixtureData", reason: "No seed tables, fixture keys or source references." },
  { dataset: "derivedAndTransientData", reason: "No alerts, KPI snapshots, notifications, holds, merge candidates or telemetry." },
] as const;

export interface ClinicExport {
  manifest: {
    format: "amal-clinic-export";
    schemaVersion: 1;
    encoding: "UTF-8";
    exportedAt: string;
    displayTimezone: "Asia/Hebron";
    clinicId: number;
    empty: boolean;
    rowCount: number;
    includedDatasets: { dataset: string; count: number; fields: string[] }[];
    excludedDatasets: { dataset: string; reason: string }[];
    limits: typeof CLINIC_EXPORT_LIMITS;
  };
  datasets: Record<string, ExportRow[]>;
}

const tooLarge = () => fail(413, "EXPORT_LIMIT_EXCEEDED", "exportLimitExceeded");
const timedOut = () => fail(503, "EXPORT_TIMEOUT", "exportTimeout");

/**
 * Contract: caller owns a REPEATABLE READ transaction, manager authorization,
 * CSRF, audit insertion and COMMIT before responding. This function never starts,
 * commits, rolls back or releases the supplied client. No partial export exists.
 * Byte ceiling applies to JSON.stringify(result) encoded as UTF-8 (no pretty print).
 */
export async function buildClinicExport(client: PoolClient, clinicId: number): Promise<ClinicExport> {
  if (!Number.isSafeInteger(clinicId) || clinicId < 1) throw fail(400, "VALIDATION", "validation");
  const started = performance.now();
  const remaining = () => {
    const ms = Math.floor(CLINIC_EXPORT_LIMITS.maxDurationMs - (performance.now() - started));
    if (ms <= 0) throw timedOut();
    return ms;
  };
  try {
    // Even the settings read is bounded; caller should also bound connection acquisition.
    await client.query("SET LOCAL statement_timeout = '15000ms'");
    const { rows: [settings] } = await client.query<{ isolation: string; exported_at: string }>(
      `SELECT current_setting('transaction_isolation') AS isolation, ${utc("clock_timestamp()")} AS exported_at`);
    if (!settings || !["repeatable read", "serializable"].includes(settings.isolation)) {
      throw fail(500, "EXPORT_SNAPSHOT_REQUIRED", "internal");
    }
    const result: ClinicExport = {
      manifest: {
        format: "amal-clinic-export", schemaVersion: 1, encoding: "UTF-8",
        exportedAt: settings.exported_at, displayTimezone: "Asia/Hebron", clinicId,
        empty: true, rowCount: 0, includedDatasets: [],
        excludedDatasets: excludedDatasets.map(item => ({ ...item })), limits: CLINIC_EXPORT_LIMITS,
      },
      datasets: {},
    };
    let transferredBytes = 0;
    for (const dataset of datasets) {
      await client.query("SELECT set_config('statement_timeout',$1,true)", [`${remaining()}ms`]);
      const projection = Object.entries(dataset.fields)
        .map(([key, expression]) => `'${key}',${expression}`).join(",");
      // Bound rows before JSON projection, and cumulative bytes in SQL before
      // sending data over the wire. Oversize rows return a sentinel, never text.
      const { rows } = await client.query<{ data: ExportRow | null; bytes: number }>(`
        WITH selected AS MATERIALIZED (
          SELECT ${dataset.order} AS sort_key, jsonb_build_object(${projection}) AS data
          FROM ${dataset.from} WHERE ${dataset.where} ORDER BY ${dataset.order} LIMIT $2
        ), sized AS (
          SELECT sort_key,data,octet_length(data::text) AS bytes FROM selected
        )
        SELECT CASE WHEN sum(bytes) OVER (ORDER BY sort_key ROWS UNBOUNDED PRECEDING) <= $3
          THEN data ELSE NULL END AS data,bytes FROM sized ORDER BY sort_key`,
      [clinicId, CLINIC_EXPORT_LIMITS.maxRows - result.manifest.rowCount + 1,
        CLINIC_EXPORT_LIMITS.maxBytes - transferredBytes]);
      remaining();
      if (result.manifest.rowCount + rows.length > CLINIC_EXPORT_LIMITS.maxRows ||
        rows.some(row => row.data === null)) throw tooLarge();
      if (dataset.name === "clinicSettings" && rows.length !== 1) throw fail(404, "NOT_FOUND", "notFound");
      result.datasets[dataset.name] = rows.map(row => row.data!);
      transferredBytes += rows.reduce((sum, row) => sum + Number(row.bytes), 0);
      result.manifest.rowCount += rows.length;
      result.manifest.includedDatasets.push({
        dataset: dataset.name, count: rows.length, fields: Object.keys(dataset.fields),
      });
    }
    result.manifest.empty = result.manifest.rowCount === 1;
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > CLINIC_EXPORT_LIMITS.maxBytes) throw tooLarge();
    remaining();
    return result;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const code = (error as { code?: string } | null)?.code;
    if (code === "57014" || code === "55P03") throw timedOut();
    if (code && ["53100", "53200", "53300", "53400", "54000"].includes(code)) {
      throw fail(503, "EXPORT_RESOURCE_UNAVAILABLE", "exportResourceUnavailable");
    }
    throw error;
  }
}
