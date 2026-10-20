# Lookup duration instrumentation

`POST /api/kpis/lookup-duration` (`recordLookupDuration`) accepts only
`{"durationMs": <finite nonnegative safe integer>}` and returns 204. The upper
bound is JavaScript's exact integer limit, not a clipped search-time limit.
Doctor session, CSRF and a valid doctor/user/current-clinic linkage are required.
The clinic is never accepted from the payload. Read-only authentication avoids
updating session activity from measurements; this route adds no access audit.
Clinical network-access auditing remains separate.

Receipt time is captured before authentication and body parsing. `date-fns-tz`
attributes it to the Asia/Hebron date (not client time or database session time).
One `operational.kpi_snapshots` row per clinic/day uses metric
`lookup_duration_ms`, source `after`, calculation version `lookup-ms-frequency-1`.
Evidence contains exactly `sampleCount` and `frequencies`, mapping integer-ms
strings to counts. A single `INSERT ... ON CONFLICT ... DO UPDATE` increments
both from the locked row, so concurrent updates cannot overwrite increments.
There are no event rows, event clocks, actor IDs or query fields. `generated_at`
is UTC snapshot-creation metadata and is not updated per measurement.
Existing KPI refresh uses other metric/version keys and cannot overwrite this
distribution. No seed schema or data changes are needed.

Selected-range distributions are merged before calculating the exact median
(mean of the middle pair for even counts) and nearest-rank p90. Seconds are
presentation units only; no millisecond quantization occurs before aggregation.
Empty distributions return sampleCount 0, null percentiles and
`NO_LOOKUP_SAMPLES`. The contract includes units, storageUnits, exact,
percentileMethod, measurementBoundaries, attribution and coverage.

Coverage is successfully received foreground matching successful result cards
only, from first query-changing input or fallback submission through visible
render. It excludes hidden-tab completion, errors/empty results, cancellation,
superseded responses and failed transmissions. No retry or offline queue means
delivery gaps are expected. Browser elapsed values are self-reported and are not
proof of server latency or exhaustive search coverage.

Automatic HTTP logging is excluded for case-insensitive and trailing-slash/query
variants of this route. No telemetry identifiers or payloads are added to logs,
audits or tracing. Deployment proxy/access-log policies remain outside the API
process and should likewise avoid identity-bearing telemetry associations.

Reproduce backend evidence with `pnpm --filter @workspace/api-server kpis:test`.
The tests cover strict validation, exact ranks, unequal daily sample counts,
concurrent increments during refresh, clinic scope, receipt midnight, session
timezone independence, unchanged generated_at, aggregate-only evidence and
audit counts, HTTP auth/CSRF and case/trailing-slash variants. Existing KPI SQL
tests fingerprint all six seed tables before/after their rollback fixtures.

# KPI endpoint and evidence

`GET /api/kpis?range=day|week|month&date=YYYY-MM-DD&clinicId=<id>`
requires an authenticated **administrator**. `date` and `clinicId` are optional.
Doctors and reception are denied; no doctor filter, ranking, patient IDs, audit
actors, raw search terms, event IDs or clinical records are returned. Unknown
parameters, duplicate parameters, invalid dates and nonexistent clinic filters
return the existing `error.validation` envelope.

## Periods and definitions

- Date is an Asia/Hebron anchor (2000-01-01 through 2100-12-31); default is
  today's local date. Day is that local day, week Monday–Sunday, month the
  calendar month. Periods are half-open `[start,end)` at local midnight, converted
  using date-fns-tz; DST days can be 23 or 25 hours. SQL explicitly uses
  `AT TIME ZONE 'Asia/Hebron'`, never the database session timezone.
- **Before** is always 2026-09-08 through 2026-09-13 inclusive, queried from
  immutable public workbook tables. Stored seed instants are not reinterpreted
  as local timestamps. A clinic filter scopes both windows but never changes
  the baseline dates.
- **After** uses current operational rows in the selected scheduled-at window.
  It is not a historical reconstruction of how rows looked at that time.
  Counts are not exposure-adjusted. The response keeps both periods, local-day
  exposures, provenance and comparison caveats together. Equal day counts alone
  would not establish equivalent coverage or weekday mix.
- Exact-start collisions count each unordered appointment pair once, across
  **all statuses**, matching independent baseline SQL. Three appointments at the
  same doctor/start produce three pairs. Patient pairs require different clinics.
  Interval-overlap prevention is a different metric. Clinic attribution counts
  every pair touching that clinic; clinic pair totals are **not additive**.
- No-show numerator is `status='no_show'`; denominator is all appointments,
  including cancelled. Return numerator, denominator, unrounded ratio and
  one-decimal percentage; empty denominator returns null. Breakdowns cover
  clinics and all seven Asia/Hebron weekdays (0 Sunday).
- Source normalization is trim/lowercase: phone; walk_in/walk-in/walk in;
  calendar_app/calendar-app/calendar app/calendar; and
  amal_network/amal-network/amal network. All other values count as `unknown`.
  No source rows are edited.

## Telemetry coverage

Conflict daily/cumulative counts use original durable operation identities,
not HTTP response counts. Actual `APPOINTMENT_CONFLICT` mutation failures count
as blocked, including failed conflict-resolution attempts retained in resolution
history (their nested failures roll back). Successful resolution wrappers are
not additional events. Retries reuse their durable IDs. Approved patient-overlap
overrides are warnings/overrides, never blocked attempts. A previously blocked
attempt remains a blocked attempt if a later, distinct resolution succeeds;
this is **not a count of appointments permanently prevented**. Cumulative series
restart at the selected window. Preview checks and version/hold/validation errors
are excluded. Warning coverage is partial, limited to persisted blocked-warning
and approved-override evidence; resolution failures do not retain warning detail.

Server-received sync creates are deduplicated using durable sync receipts.
`receivedCreates`, `synced`, `conflicted`, `rejected`, and `pending` describe
current outcomes by original receipt time. Resolved creates count as synced.
These accepted receipts are terminal, so covered pending is zero. They exclude
unreceived client work, sequence-blocked batch tails, updates, resolution wrappers
and requests rejected before receipt. They do not prove an offline origin.

Explicit unavailable metrics:

| Metric | Stable reason | Meaning |
| --- | --- | --- |
| Lookup percentiles with no received samples | `NO_LOOKUP_SAMPLES` | Median and p90 are null; sample count is zero. See duration instrumentation above. |
| Daily logical cross-clinic activity | `LOGICAL_NETWORK_LOOKUP_PRODUCER_UNAVAILABLE` | Per-patient audit rows cannot establish logical request counts or retry identity. |
| Client queued appointments | `CLIENT_QUEUE_NOT_OBSERVED` | Server receipts cannot see all local queued work. |
| Confirmed lost appointments | `CLIENT_LOSS_NOT_OBSERVED` | Pending/rejected/unreceived is not proven loss. |
| Trial and transition history | `ADOPTION_TRANSITION_HISTORY_UNAVAILABLE` | Existing operational states are Lite/Full only. |

Adoption projects actual clinic IDs, names, current state and stored joinedAt.
JoinedAt can be bootstrap evidence; it is not asserted to be a Trial or mode
transition date. No booking-volume inference is made. No offline-loss or
adoption workflows are introduced here.

## Snapshots and refresh

Migration extends the existing `operational.kpi_snapshots`, preserving legacy
rows with source/version `legacy`. Each new row retains start date, exclusive
end date, metric family, nullable clinic scope, before/after source, calculation
version, generated time, numeric value (null when inappropriate), and detailed
aggregate evidence with definitions/coverage. Separate partial unique indexes
cover clinic and null-clinic network scopes.

Each authorized read recomputes and atomically upserts appointment, telemetry
and adoption evidence. A global advisory lock is acquired **before** the
repeatable-read transaction to prevent an older waiting transaction overwriting
newer evidence. Seed and operational queries share one consistent read.
No additive accumulation occurs. Late sync is reflected when the affected range
is next requested or internally refreshed. Stored snapshots are not served as
unvalidated stale caches. Unrequested historical ranges require explicit backfill.

Development/internal commands (never reset/populate seeds):

```sh
pnpm --filter @workspace/api-server kpis:migrate
pnpm --filter @workspace/api-server kpis:refresh month 2026-09-09
# Optional final argument is a data-derived clinic ID:
pnpm --filter @workspace/api-server kpis:refresh day 2026-09-09 <clinic-id>
```

Repeat refresh for each affected day/week/month and desired clinic scope.
An automatic historical scheduler is not introduced. The script logs metadata
only. Post-merge setup applies the additive development migration. Managed
production schema changes remain the platform's responsibility.

## Reproducible verification

```sh
pnpm --filter @workspace/scripts seed:verify
pnpm --filter @workspace/api-server kpis:test
node lib/api-spec/compose-kpis.mjs
pnpm --filter @workspace/api-spec validate
pnpm --filter @workspace/api-spec codegen
pnpm run typecheck
```

Tests reconcile independent SQL with endpoint and persisted evidence; cover
concurrent network/clinic upserts, late arrival recomputation, empty data,
source normalization, all-status pair combinatorics, sync/override/resolution
deduplication, privacy, role denial, strict parameters, local midnight, DST and
session timezone independence. Six seed content hashes and seed column metadata
are checked. SQL tests use rolled-back operational fixtures only; API tests
remove their operational fixtures and refresh affected test snapshots.

Baseline expectations live in tests, not response-building code: 6 doctor/start
pairs, 2 cross-clinic patient/start pairs, 22/102 no-shows (21.6%), and source
counts 48 phone, 21 walk-in, 33 calendar. See `docs/data/exploration.sql` for
independent original baseline evidence. Lookup tests use isolated known
integer-ms distributions, not fabricated production baseline measurements.
