# Privacy and audit regression gate

## Commands

- `pnpm test:privacy`: focused non-watch authenticated API/database suite plus the existing consent policy tests.
- `pnpm ci`: mandatory privacy gate, existing root unit tests, and full workspace typecheck (including privacy test code). No hosted CI provider is assumed.
- `pnpm test:privacy:local` / `pnpm ci:local`: explicit disposable local PostgreSQL preparation, then the corresponding command.

The normal gate **fails** without `PRIVACY_TEST_DATABASE_URL`; it never substitutes `DATABASE_URL`, skips integration tests, or uses mocked policy results. Fixed test filenames make missing files fail. Test output must report nonzero tests and zero skipped tests.

## Safe preparation

The local commands require PostgreSQL `initdb`, `pg_ctl`, `pg_dump`, and `psql` on PATH and the completed development prerequisite schema in `DATABASE_URL`. They read **schema only** (public, operational and seed_guard), create a separate temporary local cluster, generate synthetic actors/patients/visits and fresh credentials, and destroy only that cluster afterward. They never copy patient rows, import/write seed rows, reset demo data, migrate the source, or connect to production. PostgreSQL tools must support the source server version.

For an independently provisioned test database:

1. Prepare the completed prerequisite schema in a dedicated disposable database named `amal_privacy_test_<suffix>`, not the workspace/demo database.
2. Mark that database with comment `amal:disposable:privacy-tests:v1`.
3. Configure a fixture login without superuser, create-role, create-database, bypass-RLS or membership in privileged/seed/reset roles. Grant it operational fixture DML and sequence usage, plus **SELECT only** on all six public seed tables. It must not own the seed tables.
4. Provision the existing `amal_app` restricted login and original schema grants, using the project's database-specific SESSION_SECRET password derivation. Neither tests nor runtime use an administrator session with SET ROLE.
5. Supply the fixture connection as `PRIVACY_TEST_DATABASE_URL` and matching `SESSION_SECRET` through secure environment configuration, then run `pnpm ci`.

The guard checks database identity, explicit marker, role capabilities, seed permissions and prerequisite relations before loading the app. Local preparation does not use the workspace SESSION_SECRET; it creates an ephemeral test-only secret. Credentials are not printed. Existing fixture text is synthetic; no production UI or test-only API route is added.

The suite deliberately retains consent/audit evidence in externally prepared disposable databases and revokes only its generated sessions at teardown. There is no runtime audit-delete privilege, reset exception, cascade cleanup or cleanup of unknown resources. Dispose of that dedicated database separately using its administrative owner. The local helper owns its entire temporary cluster and removes only that cluster.

## Coverage matrix and contract

| Surface | Regression evidence |
| --- | --- |
| `GET /network/lookup` | Role × missing/none/basic/clinical/withdrawn × local/foreign matrix; exact recursive projection allowlists; hidden records have empty items and no pagination metadata; crafted scope/query rejection; Full/Lite source and requester exclusion |
| `GET /doctor/patients/:id` | Exact trusted own-doctor and clinic relationship required; independent local clinical positive control; remote visits still consent-gated; detail withdrawal/downgrade and audit failure |
| `GET /doctor/day` | Trusted own-doctor scheduling only; UTC instants and Asia/Hebron day boundaries; embedded patient projections; paginated/repeated/multi-patient/multi-source audits and withdrawal/downgrade |
| `GET /patients`, `/patients/:id` | Existing consent tests plus matrix assert local demographics, foreign denial, no notes and no admin patient access |
| `GET/POST /patients/:id/consent`, `POST /consent/:id/withdraw` | Scope, role, fresh PIN/device/CSRF, latest grant, prior grants, idempotent replay, guardian attribution, immediate withdrawal |
| `GET /audit` | Doctor/source/own-patient filters, pagination, redacted actor projection; admin and front-desk denied |
| `POST /patients/:id/access-history` | Staff-assisted confirmed patient request only, fresh PIN/CSRF/device/scope; bounded projection, signed pagination, durable read audits and failure closure |

There is no other implemented general cross-clinic visit-history endpoint. Administrative aggregate endpoints are not currently implemented and do not establish patient access.

The existing consent API suite is reused, not replaced. Additional checks live in `tests/privacy/regression.ts`. HTTP requests use real session cookies, device credentials and CSRF tokens validated against the operational database; fixture setup creates synthetic sessions directly (login behavior remains covered by the auth suite).

The disclosure contract is **one durable `network.lookup` event per disclosed remote visit**, including projections used by patient-card and My Day routes. Each event identifies actor, requesting clinic, patient, source clinic/visit, effective level, projection, outcome, UTC instant and correlation. Lookup exposes its correlation header; card/day events share a server-generated correlation without a response header. Local-only reads produce no disclosure event. No-result lookup emits a null-patient event; denied paths emit their established denied event, never hidden match identity. Historical disclosure remains after withdrawal.

All complete protected payloads are checked, including envelope/pagination fields, visit fields and alert evidence. Basic permits only the existing date/source-clinic/source-doctor projection; Clinical adds notes and alert fields. Sensitive responses must be `private, no-store`. A separate OS process reuses identical sessions, URLs and old cursors immediately after real endpoint mutations; no sleeps or cache-busting are allowed. Requests already in flight follow the existing shared-reader/exclusive-writer database lock ordering; this suite does not change that policy.

Audit failure injection intercepts only fixture actor/action inserts, causes a real database NOT NULL rejection, and restores acquired clients afterward. It does not replace the authorization policy or return mocked database results. Runtime UPDATE/DELETE/TRUNCATE audit attempts fail. Setup and runtime seed privileges are checked without seed writes; before/after read-only fingerprints cover all six tables where provisioned. Schema-only local runs have empty seed tables; populated seed baselines remain the separate existing `seed:verify` workflow.

Existing root unit tests preserve all-calendar-row manual review/name-only non-linking and Asia/Hebron/UTC conversion rules. No calendar import or source data is changed.

## Recorded verification

2026-10-20:

- Focused isolated execution passed; the final CI execution reports **80 privacy/policy tests passed, zero skipped**.
- `pnpm ci:local` passed, invoking the actual root `pnpm ci` against its disposable database: privacy suite, **43 existing unit tests**, and complete workspace/harness/privacy TypeScript checks.
- `pnpm test:privacy` without isolated configuration exited nonzero with the explicit `PRIVACY_TEST_DATABASE_URL is required` setup error; passing policy unit tests cannot hide that failure.
- No production app code, UI, migrations, source rows, seed rows or privacy policy was changed.
