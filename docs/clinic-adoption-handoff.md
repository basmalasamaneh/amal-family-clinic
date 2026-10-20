# Clinic adoption backend handoff

## Authority and lifecycle

Consent, operational schema, authentication, local booking and immutable seed protections were verified before implementation. Migration 0014 is additive and preserves every existing Full/Lite clinic's effective permissions; existing state start dates use the stored join instant as migration metadata, not evidence of a historical opt-in. New clinics created through the API start Trial (Lite permissions). There is no timer, billing, automatic upgrade or rejoin.

`GET /clinics/:id/adoption` exposes persisted state, membership, transition timestamps, allowed choices and actor-specific capabilities. Clinic and administrative directory DTOs additionally expose adoption metadata. `POST /clinics/:id/adoption` accepts only `{state:"lite"|"full"}`. Trial→Lite, Trial→Full, Lite→Full and Full→Lite are supported. Selecting the current state is a no-op. Each genuine change records an append-only audit event in the same transaction.

Management requires an explicitly delegated **doctor in that clinic**, not merely any doctor, receptionist or network administrator. A trusted database operator provisions `operational.clinic_managers(clinic_id,user_id)` after independently verifying clinic authority. The runtime has SELECT only. No delegation is seeded automatically; administrators cannot obtain clinical access through this permission. Delegation writes participate in database locking via a statement trigger. Session, role, scope and delegation are checked again under the lifecycle lock. Request actor/clinic fields cannot override authenticated scope.

Generic clinic settings updates reject `mode`. New-clinic administration cannot opt in to Full on a clinic's behalf. Existing admin forms receive only the minimal compatibility adjustment to stop submitting that removed field; no journey screens are included.

## Sharing and concurrency

Effective `network_mode` remains the compatibility permission boundary, constrained to Full exactly when adoption is Full and membership active. Trial/Lite/left therefore cannot publish or consume remote visits, alerts, existence counts, consent evidence, scheduling conflicts or stale sync projections. Local demographics, doctor-slot and patient-slot checks remain available. Full is only eligibility for existing role/relationship/consent rules, never a consent grant.

Lifecycle writes acquire PostgreSQL transaction locks 160005 then 761910, before authority checks and clinic row locks. Clinical readers share the first lock; scheduling/sync use the second. No process-local cached grant is used. A request already in progress completes before a downgrade can commit; subsequent requests observe current authority across instances. Deadlock, timeout or serialization conflicts have a typed retry response and no partial commit.

`POST /clinics/:id/leave` requires `{confirm:true}`. It atomically sets left membership, Lite mode, actor/time and audit. Repeated leave is a no-op. A racing Full request either commits before leave or fails once left; it never rejoins. Local booking, own data and history remain. Full upgrades after departure fail. Rejoining requires a separate future policy, not this endpoint.

## Export and retained data

`POST /clinics/:id/export` with `{}` is a separate CSRF-protected action. See [export contract](clinic-export-contract.md) for ownership allowlists, bounds and manifest. It uses a repeatable-read snapshot, validates the versioned response and returns a private no-store UTF-8 attachment only after the request audit commits. Audit says requested, not saved by the browser. Empty data is explicit in manifest/dataset counts. Oversize and timeout failures deliver no partial download and never leave the network.

Export acquires session-level lifecycle locks in a short acquisition transaction, then starts the repeatable-read transaction. This deliberately establishes the snapshot after any preceding revocation or leave commits, rather than before a blocking lock SELECT. Locks are released on success and failure; uncertain connections are destroyed rather than returned to the pool.

No leave/export operation erases operational records, audit or consent history. All six source tables remain untouched. Existing calendar rows still require manual identity review; names alone never establish identity.

## Future consumers

The existing Dr. Nabil Journey task should use capabilities/allowedTransitions rather than infer ownership from role or doctor name. Use synthetic/data-selected clinics. Display Trial separately from active/left membership, explain retained local access and require explicit leave confirmation. Do not chain download success/failure to automatic departure. Do not cache private exports, remote clinical responses or lifecycle authority offline. Future remote-read consumers must join current effective source/requester modes and participate in the lock protocol.

All instants are UTC; display timezone is Asia/Hebron. Date-only values stay dates. Backend errors use `{code,messageKey,params}` and Arabic/English keys. Later screens must retain Arabic RTL/English LTR, logical CSS, light/dark and accessible confirmation. The legacy KPI aggregate remains a legacy mode projection, not lifecycle history; the journey should use the lifecycle DTO.

## Voluntary journey published results (task 35 backend)

`GET /api/adoption/results` (`getAdoptionResults`, response `AdoptionResults`)
is authenticated doctor/front-desk only, including Trial/Lite; administrator access
to `/kpis` is unchanged. Front-desk device trust remains enforced. This read uses
read-only authentication and a repeatable-read, read-only database transaction;
it does not refresh the session, write KPI snapshots, change adoption, grant
patient consent, or touch seed data. Responses are `private, no-store`.
Every query parameter is rejected with 400; no clinic enumeration, date,
doctor or arbitrary range filter exists.

### Explicit publication configuration

Edit `artifacts/api-server/src/adoption/scenario.json` only after an authorized
operator explicitly selects the operational identities. The committed defaults
are `{"trialClinicId":null,"resultClinicIds":null}`: **not configured**. Neither
the server nor tests populate operational IDs automatically. Valid configuration
has exactly one positive int32 `trialClinicId` and a two-element
`resultClinicIds` array, with all three IDs distinct and present in
`operational.clinics`. Unknown keys, strings, duplicates and extra/missing entries
are invalid. Identity is never inferred from names, seed IDs, ordering, mode or
every other clinic. Names may change or be identical without changing resolution.
No migration, seed copy or seed write is part of configuration.

**Committing these explicit IDs authorizes publication of the two clinics'
aggregate service results to authenticated doctors/front-desk.** This publication
decision is independent of clinical network-sharing consent and does not change
it. The trial identity is validated but not disclosed in the summary. Updating
configuration requires a server rebuild/redeploy because the nonsecret JSON is
bundled. No runtime API can change it. Invalid/unconfigured values yield HTTP 200
with `available:false`, `reason:SCENARIO_UNCONFIGURED`, and `clinics:[]`.
Missing operational identities yield `SCENARIO_CLINICS_UNAVAILABLE`, also with no
partial disclosure or identity echo. Database failures remain explicit HTTP 500
errors, never synthesized zero results.

### Exact response and evidence

The top-level keys are `available`, `reason`, `window`, `generatedAt`,
`calculationVersion`, `clinics`. Configuration success means exactly two clinics
in configured order; it does not imply either metric has evidence.
`window` uses the existing KPI period fields (`startDate`, `endDateExclusive`,
`start`, `end`, `days`, `timezone`): seven **complete** Asia/Hebron local days
ending at today's local midnight. DST can make this 167/169 elapsed hours;
UTC instants are half-open. `generatedAt` is the database snapshot generation
instant (or server clock for unconfigured state); it is not an event clock.

Each clinic has only `clinicId`, `clinicName`, `preventedBlocks`,
`medianLookupSeconds`. Each metric has scalar `available`, `reason`, `value`,
`units`, `sampleCount`, `coverage`, `provenance`:

- `preventedBlocks` reuses `aggregateTelemetry`'s actual deduplicated durable
  APPOINTMENT_CONFLICT blocks. Warnings, approved overrides, previews,
  version/hold/validation errors are not blocks. A supplementary coverage count
  counts distinct logical durable applied or APPOINTMENT_CONFLICT decisions
  (including failed-resolution wrappers) in the same earliest-at window;
  it does not recalculate the metric. This is the metric's `sampleCount`.
  No decisions means unavailable/null (`NO_PREVENTION_EVIDENCE`), not an
  invented zero. An observed applied decision with no blocks gives genuine zero
  in the explicitly partial server-observed scope. It does not prove all clinic
  attempts were observed or that any unrecorded conflicts were prevented.
- `medianLookupSeconds` reuses the existing exact whole-window frequency
  distribution median, never averages daily medians. Units are seconds;
  `sampleCount` is received duration measurements. No samples means
  unavailable/null (`NO_LOOKUP_SAMPLES`); actual zero-duration samples can yield
  numeric zero. Coverage excludes failed/cancelled/hidden/unreceived searches,
  and is browser-reported elapsed time, not server latency or doctor performance.
- `calculationVersion` is the existing KPI version; lookup provenance also names
  the upstream frequency evidence version. No event, patient, doctor, audit-row,
  daily drilldown, unrestricted KPI object, or doctor ranking is returned.

Generate contracts with `pnpm --filter @workspace/api-spec run codegen`.
Focused integration/security coverage is
`pnpm --filter @workspace/api-server run adoption:results:test` against a
nondeployment development/test database with existing prerequisite migrations.
Tests create and clean up only disposable operational fixtures, use generated
IDs/renamed sources, alter configuration in test-process memory only, and verify
all six immutable source-table hashes. Production defaults remain unconfigured.
Task 35 is not marked complete by this backend handoff.
