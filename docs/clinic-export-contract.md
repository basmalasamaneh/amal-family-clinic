# Clinic export contract (version 1)

`buildClinicExport(client: PoolClient, clinicId: number): Promise<ClinicExport>`
is implemented in `artifacts/api-server/src/adoption/export.ts`.

## Caller obligations

The route authenticates a clinic manager, enforces CSRF and clinic scope, acquires
a client, and starts a **REPEATABLE READ** transaction before invoking the service.
The service accepts serializable isolation too, rejects read committed, and never
begins, commits, rolls back or releases the caller's transaction. Caller writes the
export audit within that same transaction, commits successfully, then sends the
JSON. On any failure it rolls back and does not send any partial document.
Connection acquisition, authentication and audit timeouts remain caller concerns.
The service uses transaction-local statement timeouts, which also remain in force
for subsequent audit insertion until commit/rollback.

Serve `application/json; charset=utf-8`, with `Cache-Control: no-store` and a safe
attachment filename. Send compact JSON (not pretty printed). The service returns
an object, not a stream or pre-serialized string.

## Envelope and portability

The top-level keys are `manifest` and `datasets`. Manifest contains:

- `format: "amal-clinic-export"`, `schemaVersion: 1`, `encoding: "UTF-8"`;
- `exportedAt`: server UTC ISO instant ending in `Z`;
- `displayTimezone: "Asia/Hebron"` (no relabeling of UTC instants);
- `clinicId`, `rowCount`, `empty`;
- `includedDatasets`: dataset name, actual exported row count, explicit field list;
- `excludedDatasets`: dataset category and exclusion reason (no cross-clinic
  counts are queried or leaked);
- `limits`: maximum rows, compact UTF-8 JSON bytes and service duration.

All arrays exist even when empty. `clinicSettings` has exactly one row. `empty`
means no exported rows beyond that settings row. IDs are numeric source identifiers,
not credentials or guarantees that another installation has the same IDs.
Date-only DOB/visit dates stay `YYYY-MM-DD`; timestamps are UTC strings, nullable
where applicable. Arrays are deterministically ordered by source identity.

## Included datasets and scope

| Dataset | Scope and field policy |
| --- | --- |
| clinicSettings | Own clinic identity, city, booking settings, opening hours/days, timezone, network mode, joined instant, and lifecycle metadata specified below. |
| doctors | Own clinic ID, doctor ID, name, specialty; no account link or email. |
| patients | Demographics only: ID, name, phone, DOB, guardian name/relation. Association must exist through own clinic/doctor access, own appointments or own visits. Creation clinic alone and shared consent alone are insufficient. No foreign linkage or merge IDs. |
| appointments | Own clinic scheduling/status/duration/conflict state/cancellation reason/version and UTC timestamps; no source refs, client operation IDs or creator account IDs. |
| visits | Own clinic/patient/doctor IDs, visit date and own diagnosis notes. Never foreign notes, including for shared patients. |
| consents | Associated patient's rows explicitly recorded by this clinic: level, given-by, guardian, evidence and consent/withdrawal instants. No inference from mutable user assignment; null/foreign attribution excluded. |
| importBatches | Own batch identity, source name, status/version and created/committed instants; no report, raw source, checksum or owner accounts. |
| importProvenance | Source name/event ID, batch/row/appointment IDs and created instant; joins require an own batch and own appointment and a matching batch/row/appointment relationship. No source hash or raw payload. |

Only literal allowlisted scalar fields are projected in SQL. There is no dynamic
table or column name from request input and no arbitrary stored JSON is exported.
The manifest enumerates exclusions: other-clinic data, unattributed consents,
unassociated patients, accounts/authentication, sync/operation receipts, raw
import/review data, audit logs, seed/fixture data, and derived/transient data.
Operational records originally adopted from seeds remain ordinary clinic records;
the export never reads public seed tables or includes fixture identifiers.

`clinicSettings` lifecycle keys are **required**, not optional, in every exported
settings row. `adoption_state` is `"trial"`, `"lite"` or `"full"`;
`membership_status` is `"active"` or `"left"`; `adoption_changed_at` is a non-null
UTC ISO timestamp. `trial_started_at`, `lite_started_at`, `full_started_at` and
`left_at` are nullable UTC ISO timestamps. `left_by` is a nullable integer
identifying the recorded leaving actor (no user/account record is exported).
Unset lifecycle metadata is represented by JSON `null`, never omitted. These
eight fields are also enumerated in the manifest's settings field allowlist.

## Resource bounds and failures

Hard limits are **10,000 total rows** (including clinic settings), **8 MiB**
compact UTF-8 JSON (including manifest), **15 seconds** service duration.
Each query selects at most remaining rows + 1 and applies a cumulative SQL byte
gate before sending JSON data to Node. Oversize data yields a sentinel; nothing
is truncated or silently skipped. Remaining wall-clock time becomes the next
transaction-local PostgreSQL statement timeout. Final serialization checks actual
UTF-8 bytes including the manifest. This is a bounded export, not a background
export job or pagination interface.

Typed `ApiError` failures:

| HTTP | Code | Translation key |
| --- | --- | --- |
| 400 | VALIDATION | validation |
| 404 | NOT_FOUND | notFound |
| 413 | EXPORT_LIMIT_EXCEEDED | exportLimitExceeded |
| 503 | EXPORT_TIMEOUT | exportTimeout |
| 503 | EXPORT_RESOURCE_UNAVAILABLE | exportResourceUnavailable |
| 500 | EXPORT_SNAPSHOT_REQUIRED | internal |

The route owns localized messages for new error keys. Unknown database errors
propagate to the application's normal error handling rather than becoming an
apparently successful empty export.

## Service tests

Run unit tests without a database:

`pnpm --filter @workspace/api-server exec tsx --test tests/adoption-export.test.ts`

The companion `tests/adoption-export-db.test.ts` uses disposable PostgreSQL tables
to verify real SQL clinic isolation, attributable provenance, consistent snapshot,
allowlists, UTC/date-only portability, and seed-read avoidance.
