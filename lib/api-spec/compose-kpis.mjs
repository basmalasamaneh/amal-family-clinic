// Repeatable KPI-only composition. Does not regenerate unrelated contracts.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function applyKpisContract(spec) {
  const schemas = spec.components.schemas;
  const ref = name => ({ $ref: `#/components/schemas/${name}` });
  const object = (properties, description) => ({
    type: "object", additionalProperties: false, properties,
    required: Object.keys(properties), ...(description ? { description } : {}),
  });
  const text = { type: "string" };
  const count = { type: "integer", minimum: 0 };
  const clinicId = { type: ["integer", "null"], minimum: 1 };
  const instant = { type: "string", format: "date-time", description: "UTC ISO 8601 instant." };
  const date = { type: "string", format: "date" };
  const nullableInstant = { type: ["string", "null"], format: "date-time" };
  const ratio = { type: ["number", "null"], minimum: 0, maximum: 1 };
  const array = items => ({ type: "array", items });
  const unavailable = reason => object({
    available: { type: "boolean", const: false },
    reason: { type: "string", const: reason },
    value: { type: "null" },
  }, "Unavailable is not measured zero.");

  schemas.KpiPeriod = object({
    startDate: date, endDateExclusive: date, start: instant, end: instant,
    days: { type: "integer", minimum: 1 }, timezone: { type: "string", const: "Asia/Hebron" },
  }, "Half-open local-calendar exposure. UTC instants are converted from Asia/Hebron midnights; local calendar days need not be 24 hours at DST.");
  schemas.KpiSourceCounts = object({
    phone: count, "walk-in": count, calendar: count, "amal-network": count, unknown: count,
  }, "All statuses. Lowercase/trim source mapping: phone; walk_in/walk-in/walk in; calendar_app/calendar-app/calendar app/calendar; amal_network/amal-network/amal network. Other values map to unknown without changing source rows.");
  schemas.KpiNoShowRate = object({
    numerator: count, denominator: count, ratio,
    percent: { type: ["number", "null"], minimum: 0, maximum: 100 },
  }, "no_show / all appointments in the scheduled-at window, including cancelled. Ratio is unrounded; percent rounded to one decimal. Both are null for an empty denominator.");
  schemas.KpiCollisionCounts = object({
    sameDoctorSameStartPairs: count, samePatientSameStartCrossClinicPairs: count,
  }, "Distinct unordered exact-start pairs across ALL statuses, not interval-overlap enforcement. A clinic counts every pair touching it, including cross-clinic counterparts; clinic totals are not additive. Network counts each pair once.");
  schemas.KpiAppointmentDefinitions = object({
    collisions: text, clinicAttribution: text, noShow: text, sources: text, weekday: text,
  });
  schemas.KpiClinicAppointmentAggregate = object({
    clinicId: { type: "integer", minimum: 1 }, clinicName: text,
    totalAppointments: count, completed: count, collisions: ref("KpiCollisionCounts"),
    noShow: ref("KpiNoShowRate"), bookingsBySource: ref("KpiSourceCounts"),
  });
  schemas.KpiWeekdayAppointmentAggregate = object({
    weekday: { type: "integer", minimum: 0, maximum: 6 },
    noShow: ref("KpiNoShowRate"), bookingsBySource: ref("KpiSourceCounts"),
  }, "Asia/Hebron weekday: 0 Sunday through 6 Saturday. Empty weekdays retain null rates.");
  schemas.KpiAppointmentAggregate = object({
    totalAppointments: count, completed: count, collisions: ref("KpiCollisionCounts"),
    noShow: ref("KpiNoShowRate"), bookingsBySource: ref("KpiSourceCounts"),
    clinics: array(ref("KpiClinicAppointmentAggregate")),
    weekdays: { ...array(ref("KpiWeekdayAppointmentAggregate")), minItems: 7, maxItems: 7 },
    definitions: ref("KpiAppointmentDefinitions"),
  }, "Privacy-safe aggregates only: no doctor/patient/event identity, individual records, ranking or grouping. Counts use the explicit source window; fixed before exposure is never redefined by the requested after range.");
  schemas.KpiConflictTotals = object({ blocked: count, warnings: count, overrides: count });
  schemas.KpiConflictDay = object({
    date, blocked: count, warnings: count, overrides: count,
    cumulativeBlocked: count, cumulativeWarnings: count, cumulativeOverrides: count,
  }, "Asia/Hebron date. Cumulative series restart at the selected window. Warnings can accompany blocked commits; approved overrides are never blocked.");
  schemas.KpiConflicts = object({
    daily: array(ref("KpiConflictDay")), cumulative: ref("KpiConflictTotals"), coverage: text,
  }, "Durable APPOINTMENT_CONFLICT commit attempts deduplicated by logical clientOpId. Includes failed resolution wrappers whose nested failures were rolled back; successful wrappers are not extra attempts. Excludes repeated previews and version/hold/validation failures. Warning coverage is partial: blocked direct/sync warning evidence and approved patient-overlap override audit evidence only. No claim that an overridden warning prevented a booking.");
  schemas.KpiLookupTime = object({
    available: { type: "boolean", const: false },
    reason: { type: "string", const: "LOOKUP_DURATION_PRODUCER_UNAVAILABLE" },
    medianSeconds: { type: "null" }, sampleCount: { type: "null" }, measurementBoundaries: text,
  }, "No durable duration producer exists. No response-count proxy, invented sample count, or average of daily medians. A future instrumented contract must calculate the range median from actual duration samples with defined logical measurement boundaries.");
  schemas.KpiNetworkActivity = object({
    available: { type: "boolean", const: false },
    reason: { type: "string", const: "LOGICAL_NETWORK_LOOKUP_PRODUCER_UNAVAILABLE" },
    daily: { type: "null" },
  }, "No durable logical cross-clinic lookup producer exists; per-result/patient/visit/audit-row counts and retries cannot substitute. No doctor grouping.");
  schemas.KpiClientQueueUnavailable = unavailable("CLIENT_QUEUE_NOT_OBSERVED");
  schemas.KpiClientLossUnavailable = unavailable("CLIENT_LOSS_NOT_OBSERVED");
  schemas.KpiDowntime = object({
    receivedCreates: count, synced: count, conflicted: count, rejected: count, pending: count,
    queued: ref("KpiClientQueueUnavailable"), lost: ref("KpiClientLossUnavailable"), coverage: text,
  }, "Unique server-received sync create operations with durable receipts, grouped by original server receipt time, not appointment time. Synced includes applied creates and subsequently resolved conflicts. Conflicted is currently unresolved. Covered receipts have terminal outcomes, so received pending=0. Unknown unreceived client queues/losses are unavailable, not zero; unresolved/rejected is not lost. Not proof of offline origin.");
  schemas.KpiTelemetryAggregate = object({
    conflicts: ref("KpiConflicts"), lookupTime: ref("KpiLookupTime"),
    networkActivity: ref("KpiNetworkActivity"), downtime: ref("KpiDowntime"),
  });
  schemas.KpiAdoptionClinic = object({
    clinicId: { type: "integer", minimum: 1 }, clinicName: text,
    state: { type: "string", enum: ["lite", "full"] }, joinedAt: nullableInstant,
  }, "Existing operational state and stored date only. joinedAt can be a bootstrap timestamp, not evidence of Trial or of a state transition.");
  schemas.KpiAdoptionCounts = object({ trial: { type: "null" }, lite: count, full: count },
    "Trial is absent from the upstream state model, so its count is unavailable rather than an invented zero.");
  schemas.KpiAdoptionHistory = object({
    available: { type: "boolean", const: false },
    reason: { type: "string", const: "ADOPTION_TRANSITION_HISTORY_UNAVAILABLE" },
  });
  schemas.KpiAdoptionAggregate = object({
    clinics: array(ref("KpiAdoptionClinic")), counts: ref("KpiAdoptionCounts"),
    history: ref("KpiAdoptionHistory"), coverage: text,
  }, "Current clinic adoption, not selected-window history. Does not infer adoption from booking volume or fabricate Trial transitions.");
  schemas.KpiScope = object({ clinicId }, "Null means network scope; a positive clinic ID restricts the authorized administrator's aggregate view.");
  schemas.KpiComparison = object({ equalExposure: { type: "boolean" }, note: text },
    "Explicitly discloses whether exposure days match. Equal exposure does not imply identical dates or causal comparability.");
  schemas.KpiBefore = object({
    period: ref("KpiPeriod"), provenance: text, metrics: ref("KpiAppointmentAggregate"),
  }, "Immutable public seed queries over original 2026-09-08 through 2026-09-13 local dates. Never operational rows or constants.");
  schemas.KpiAfter = object({
    period: ref("KpiPeriod"), provenance: text, metrics: ref("KpiAppointmentAggregate"), telemetry: ref("KpiTelemetryAggregate"),
  }, "Selected operational scheduled-at window; telemetry uses server event/receipt time within the same explicit window.");
  schemas.KpiResult = object({
    range: { type: "string", enum: ["day", "week", "month"] },
    appointments: count, completed: count, noShowRate: ratio, periodStart: instant, periodEnd: instant,
    calculationVersion: { type: "string", minLength: 1 }, generatedAt: instant,
    scope: ref("KpiScope"), comparison: ref("KpiComparison"),
    before: ref("KpiBefore"), after: ref("KpiAfter"), adoption: ref("KpiAdoptionAggregate"),
  }, "Administrator-only aggregate evidence. Inherited appointments/completed/noShowRate/periodStart/periodEnd alias the selected after metrics/window. No raw clinical records, identities other than clinic IDs/names, lookup queries, audit actors, or individual events.");

  // This example is deliberately synthetic, not a production baseline claim.
  // The contract mock copies the response example, so it must have the complete shape.
  const sources = { phone: 0, "walk-in": 0, calendar: 0, "amal-network": 0, unknown: 0 };
  const noShow = { numerator: 0, denominator: 0, ratio: null, percent: null };
  const totals = { blocked: 0, warnings: 0, overrides: 0 };
  const metrics = {
    totalAppointments: 0, completed: 0,
    collisions: { sameDoctorSameStartPairs: 0, samePatientSameStartCrossClinicPairs: 0 },
    noShow, bookingsBySource: sources, clinics: [],
    weekdays: Array.from({ length: 7 }, (_, weekday) => ({ weekday, noShow, bookingsBySource: sources })),
    definitions: {
      collisions: "Distinct unordered exact-start pairs across all statuses; not enforcement overlaps.",
      clinicAttribution: "Pairs touch either clinic; clinic totals are not additive.",
      noShow: "no_show / all appointments; ratio and percent null for empty denominators.",
      sources: "Normalize phone, walk-in, calendar and amal-network aliases; all others unknown.",
      weekday: "Asia/Hebron weekday, Sunday=0 through Saturday=6.",
    },
  };
  const afterPeriod = {
    startDate: "2026-09-09", endDateExclusive: "2026-09-10",
    start: "2026-09-08T21:00:00Z", end: "2026-09-09T21:00:00Z", days: 1, timezone: "Asia/Hebron",
  };
  const example = {
    range: "day", appointments: 0, completed: 0, noShowRate: null,
    periodStart: afterPeriod.start, periodEnd: afterPeriod.end,
    calculationVersion: "amal-kpi-1", generatedAt: "2026-09-10T08:00:00Z",
    scope: { clinicId: null },
    comparison: { equalExposure: false, note: "Synthetic contract illustration: six-day baseline versus one selected local day; not equal exposure." },
    before: {
      period: {
        startDate: "2026-09-08", endDateExclusive: "2026-09-14",
        start: "2026-09-07T21:00:00Z", end: "2026-09-13T21:00:00Z", days: 6, timezone: "Asia/Hebron",
      },
      provenance: "Synthetic contract example only; production before values are queried from untouched public seeds.",
      metrics,
    },
    after: {
      period: afterPeriod, provenance: "Synthetic empty operational example only.", metrics,
      telemetry: {
        conflicts: {
          daily: [{ date: "2026-09-09", ...totals, cumulativeBlocked: 0, cumulativeWarnings: 0, cumulativeOverrides: 0 }],
          cumulative: totals,
          coverage: "Synthetic covered commit sample; actual warning coverage is limited to durable blocked warning evidence and approved overrides, excluding previews.",
        },
        lookupTime: {
          available: false, reason: "LOOKUP_DURATION_PRODUCER_UNAVAILABLE",
          medianSeconds: null, sampleCount: null, measurementBoundaries: "No durable logical lookup duration samples exist.",
        },
        networkActivity: { available: false, reason: "LOGICAL_NETWORK_LOOKUP_PRODUCER_UNAVAILABLE", daily: null },
        downtime: {
          receivedCreates: 0, synced: 0, conflicted: 0, rejected: 0, pending: 0,
          queued: { available: false, reason: "CLIENT_QUEUE_NOT_OBSERVED", value: null },
          lost: { available: false, reason: "CLIENT_LOSS_NOT_OBSERVED", value: null },
          coverage: "Synthetic empty server-received create receipts. Unknown client-side queued/lost work is not observed.",
        },
      },
    },
    adoption: {
      clinics: [], counts: { trial: null, lite: 0, full: 0 },
      history: { available: false, reason: "ADOPTION_TRANSITION_HISTORY_UNAVAILABLE" },
      coverage: "Synthetic empty current-state example only. Trial/history unavailable; joinedAt does not establish a transition.",
    },
  };
  schemas.KpiResult.examples = [example];
  const operation = spec.paths["/kpis"].get;
  operation.summary = "Get reproducible baseline and operational KPI aggregates";
  operation.description = "Implemented administrator-only aggregate endpoint. range is required; date defaults to today's Asia/Hebron date and must be a valid local date from 2000-01-01 through 2100-12-31. day is one local day; week is Monday through next Monday; month is the local calendar month. All UTC end instants are exclusive. Optional clinicId is a positive int32; no doctor filter/grouping/ranking. Fixed before window is 2026-09-08 through 2026-09-13 local dates, queried from untouched seeds; selected operational after exposure remains separate. Conflicts are exact-start all-status unordered pairs, not interval enforcement. Warnings/overrides and partial durable telemetry coverage are explicit; unavailable instrumentation/loss evidence is null with stable reasons, not fabricated zero. Current adoption is not historical. The response example is synthetic and does not state production baseline values.";
  operation["x-roles"] = ["admin"];
  operation["x-implementation"] = "implemented";
  operation.security = [{ sessionCookie: [] }];
  operation.parameters = [
    {
      name: "range", in: "query", required: true,
      schema: { type: "string", enum: ["day", "week", "month"] }, example: "day",
      description: "Local-calendar window containing date: day, Monday-start week, or calendar month.",
    },
    {
      name: "date", in: "query", required: false,
      schema: { type: "string", pattern: "^(?:20\\d{2}|2100)-\\d{2}-\\d{2}$" },
      example: "2026-09-09", description: "Optional Asia/Hebron anchor date, 2000-01-01 through 2100-12-31 inclusive. Defaults to today.",
    },
    {
      name: "clinicId", in: "query", required: false,
      schema: { type: "integer", minimum: 1, maximum: 2147483647 }, example: 1,
      description: "Optional clinic scope; omit for network. Cross-clinic collision pairs touching this clinic remain included.",
    },
  ];
  operation.responses["200"] = {
    description: "Versioned aggregate-only baseline, operational metrics, coverage and adoption. Synthetic example; production evidence is queried.",
    content: { "application/json": { schema: ref("KpiResult"), example } },
  };
  return spec;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = new URL("./openapi.yaml", import.meta.url);
  writeFileSync(path, `${JSON.stringify(applyKpisContract(JSON.parse(readFileSync(path, "utf8"))), null, 2)}\n`);
}
