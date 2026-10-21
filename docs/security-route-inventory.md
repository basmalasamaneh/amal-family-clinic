# Live route security inventory — 2026-10-21

This is a source review and focused regression record, **not** a penetration-test
certificate. It inventories the mounted Express implementation, not mock-server
handlers. `src` and `tests` below mean `artifacts/api-server/src` and
`artifacts/api-server/tests`. The prerequisite operational/authentication/adoption
implementation was present. No migration, reset or source-table write was
performed against the source database. The focused regression harness creates a
private disposable clone and its child tests start their own loopback HTTP
servers; no application workflow was started or restarted.

## Coverage and shared controls

There are **77 explicit API method/path pairs** under `/api` in
`src/routes/index.ts`, plus the public `/docs/openapi.yaml` route in `src/app.ts`.
All 77 OpenAPI operations in `lib/api-spec/openapi.yaml` currently have mounted
handlers; **there are no contract-only OpenAPI operations at this revision**.
The stale spec overview saying other services remain contracts/mocks is not
evidence of their implementation status. Any future spec-only operation must be
listed as **contract-only / not reviewed**, never passed by inheritance.

Express also provides implicit HEAD for each GET (same authorization/validation,
no response body). Global CORS handles OPTIONS/preflight: no business handler,
exact allowlisted credentialed origins, no authentication or mutation; no CSRF
token is needed for preflight. Unknown methods/paths reach the error envelope,
not a domain operation.

Every API row inherits `src/lib/route-validation.ts` (**W**) before the demo
boundary and handlers. W:

- Enumerates exact allowed query keys for each live method/path; rejects unknown,
  repeated/array/object query values and values over 2,048 characters. Service
  schemas further constrain text, enums, limits and opaque cursors.
- Requires canonical decimal positive path/query integers (no hexadecimal,
  exponent, fractional, whitespace, sign or leading-zero forms), at most
  2,147,483,647; pagination services impose their smaller bounds. UUID path
  parameters must be UUIDs. Numeric JSON IDs/versions/sequences are integers
  in 1–2,147,483,647, not coerced strings.
- Requires object JSON for body-bearing routes; rejects nonempty unexpected
  bodies on other routes. Empty `{}` remains accepted on bodyless operations.
  Unsupported body media types fail `400 VALIDATION`, using
  `{code,messageKey,params}`. Parser-level malformed JSON and application-mounted
  byte limits remain app controls. The separate body-bound tests below exercise
  Express's real JSON parser over in-memory streams, without starting a server.
- Recursively checks nested operation identifier bounds and real UTC
  `startsAt`/`endsAt` instants, with bounded depth. It does **not** reclassify an
  import upload's arbitrary raw rows as request-validation failures: malformed
  workbook columns remain reportable per-row errors. Local schemas strictly
  validate metadata and mapped nested objects.
- Bounds optional CSRF/demo-generation header values to a single ASCII
  token-shaped string of at most 256 characters. Empty means missing; it does
  not grant authority. CSRF middleware compares the session-bound token, and the
  demo boundary compares the current generation. Unrelated extensible HTTP
  headers are intentionally ignored, not treated as authorization inputs.
- Does not replace role/tenant authorization. Syntactically valid foreign IDs
  still require the row-level checks listed below.

**CSRF** column: `C` = server-side session token equality (`src/lib/auth.ts:csrf`)
plus app's exact Origin check for unsafe methods. All implemented
cookie-authenticated mutations, including read-like POST previews/checks,
telemetry, export, leave, sync and logout, have C. `O` = login/PIN bootstrap:
no authenticated CSRF token exists yet; mandatory exact trusted Origin protects
login CSRF independently of CORS/SameSite. Missing/disallowed Origin must be
rejected by the app before login effects. `—` = safe read, no domain mutation;
session idle maintenance and privacy/security audit writes are explicit
incidental exceptions, never appointment/consent/lifecycle mutations.

**Rate** column: `G` = common app/global limiter integration, owned by the main
security-boundary review; `T` = existing durable `auth.throttle` account/IP/device
budgets. `S` flags routes requiring a tighter lookup/expensive-operation category
in addition to G. These labels are requirements/coverage assignments, **not a
claim that a limiter absent from this route module has been tested**. Final
thresholds, keys, windows, production persistence and 429/Retry-After evidence
belong to the main security checklist and must be reconciled before task closure.

**Auth/scope**: D = doctor; F = front-desk; A = administrator; N = network-wide
administrator (`clinicId === null`); M = own-clinic doctor manager, rechecked
inside the transaction. Identity, clinic, doctor and device authority always
come from trusted server authentication. A scoped administrator is not N.

**Evidence**: `V` = `tests/security-routes-validation.test.ts` (wire boundaries,
live-method inventory equality, explicit mutation CSRF presence); `S` =
`tests/security-routes-scope.test.ts` (SQL-capture regressions; no live database).
Other test filenames below identify relevant upstream test definitions; consult
the executed-suite list below to distinguish those actually run from references
only. “Reviewed” means the actual handler/service and its checks were inspected;
only explicitly recorded commands are executed evidence.

## Every mounted method/path

All paths in this table are relative to `/api`. W applies even where an operation
has no query/body inputs. Unknown object fields are rejected by the indicated
strict local/generated input schema; import raw row columns are the documented
exception above.

| Method/path | Authentication and scope evidence | Applicable input validation evidence | CSRF | Rate | Review / regression reference |
|---|---|---|---|---|---|
| GET `/healthz` | Public; no DB/clinical data | W: no query/nonempty body; `routes/health.ts` | — | G | Reviewed; V |
| GET `/demo/context` | Public generation; optional read-only session, own clinic outage only; `routes/developer.ts` | W: no inputs | — | G | Reviewed; `developer-reset.test.ts` |
| GET `/admin/developer/status` | Tools-enabled + N middleware | W: no inputs | — | G | Reviewed; `developer-reset.test.ts` |
| PUT `/admin/developer/clinics/:clinicId/outage` | Tools-enabled + N; administration recheck after lock | W ID; strict generated boolean + expected-generation UUID | C | G,S | Reviewed; `developer-reset.test.ts`, V |
| GET `/admin/developer/resets/:requestId` | Tools-enabled + N | W UUID; strict generated params | — | G | Reviewed; `developer-reset.test.ts`, V |
| POST `/admin/developer/reset` | Tools-enabled + N; reset service rechecks session/actor | Strict request UUID, generation UUID, exact confirmation literal | C | G,S | Reviewed only; **not invoked**; `developer-reset.test.ts` |
| GET `/auth/device-context` | Trusted registered device; clinic from device, no public selector | W: no query/body; `routes/auth.ts:trustedDevice` | — | G | Reviewed; `auth.test.ts` |
| POST `/auth/login` | Public credential entry; allowed doctor/admin roles; rotates session | Strict email ≤254, password ≤72 UTF-8 bytes; no role/clinic selectors | O | G,T | Reviewed; `auth.test.ts`; auth worker verifies lifecycle |
| POST `/auth/pin` | Trusted device clinic + authorized receptionist email | Strict email and four digits, including leading zeros | O | G,T | Reviewed; `auth.test.ts`; auth worker verifies lockout |
| GET `/me` | Authenticated current identity | W: no inputs | — | G | Reviewed; `auth.test.ts` |
| GET `/auth/offline-permit` | D/F; current clinic and device authority; local-only permit | W only `nonce`; exact 64 lowercase hex nonce | — | G | Reviewed; `auth.test.ts`, V |
| POST `/auth/logout` | Authenticated current session revoked server-side | W no query/nonempty body | C | G | Reviewed; `auth.test.ts`, V |
| POST `/auth/reauth` | F + same trusted device/clinic; rotates session preserving absolute expiry | Strict four-digit PIN | C | G,T | Reviewed; auth worker verifies expiry/lockout |
| GET `/auth/devices` | A; requested clinic checked; scope forced from authenticated clinic | Strict page 1–1,000,000, pageSize 1–100, clinic ID, revoked true/false | — | G | Reviewed; `admin-users.test.ts` |
| POST `/auth/devices` | A + enforceScope + transactional administration recheck | Strict clinic integer and bounded device label | C | G | Reviewed; `admin-users.test.ts` |
| DELETE `/auth/devices/:id` | A; selected device clinic checked under transaction | W ID, no nonempty body | C | G | Reviewed; `admin-users.test.ts` |
| GET `/clinics/:id/adoption` | D/F + enforceScope; manager capability derived from own membership | W ID/no query; strict params | — | G | Reviewed; `adoption-api.test.ts`, V |
| POST `/clinics/:id/adoption` | M inside lifecycle transaction; admin/F cannot bypass manager requirement | Strict state enum lite/full and ID | C | G | Reviewed; `adoption-api.test.ts` |
| POST `/clinics/:id/leave` | M inside lifecycle transaction | Strict `{confirm:true}`, ID | C | G | Reviewed; `adoption-api.test.ts` |
| POST `/clinics/:id/export` | M inside consistent lifecycle snapshot; clinic-scoped export builder; doctors have no reception PIN, so no PIN gate applies | Strict empty object; W ID; export size/time guards in `adoption/export.ts` | C | G,S | Reviewed; `adoption-export*.test.ts`; export audit makes POST mandatory |
| GET `/adoption/results` | D/F; intentional preconfigured **aggregate** comparison, no arbitrary clinic selector or patient records | No query; validated scenario config, response schema; `adoption/results.ts` | — | G,S | Reviewed; `adoption-results-api.test.ts` |
| GET `/admin/users` | A; trusted clinic forced into SQL | Strict role/active enums, q ≤254, page/pageSize bounds | — | G | Reviewed; `admin-users.test.ts` |
| GET `/admin/users/:id` | A; returned user's clinic/null-network assignment checked | W ID; strict params | — | G | Reviewed; `admin-users.test.ts` |
| POST `/admin/users` | A; own scope; role/doctor/clinic assignment checked under administration lock | Strict typed role/assignment/preferences/credential fields; bcrypt byte bound | C | G | Reviewed; `admin-users.test.ts` |
| PATCH `/admin/users/:id` | A; both existing/new scope; final network-admin protection | Strict nonempty partial; unauthorized assignment changes fail; PIN recovery preserves active lock | C | G | Remediated PIN-reset call; `admin-users.test.ts`, auth worker tests |
| DELETE `/admin/users/:id` | A; target clinic; final network-admin protection; sessions revoked | W ID/no nonempty body | C | G | Reviewed; `admin-users.test.ts` |
| POST `/admin/users/:id/reset-pin` | A; target scope and receptionist role; user lock | Strict four digits; active PIN lock preserved via `resetPinFailures` | C | G | Remediated; auth worker owns lock-policy tests |
| GET `/admin/audit` | Read-only A; administration recheck; scoped WHERE; explicit privacy-safe action projection | Strict bounded limit/before/actor/clinic IDs, enums, offset ISO timestamps, from < to | — | G,S | Reviewed; `admin-users.test.ts`; no detail/clinical payload returned |
| GET `/clinics/:id` | D/F + enforceScope | W ID/no query | — | G | Reviewed; `admin-directory.test.ts` |
| GET `/admin/clinics` | A; scoped SQL WHERE | Strict limit 1–100, cursor ≤512 bound to actor/scope | — | G | Reviewed; `admin-directory.test.ts` |
| GET `/admin/clinics/:id` | A + enforceScope | W ID/no query | — | G | Reviewed; `admin-directory.test.ts` |
| GET `/admin/doctors` | A; filter checked then trusted clinic forced in SQL | Strict clinic ID, limit and scope-bound cursor | — | G | Reviewed; `admin-directory.test.ts` |
| GET `/admin/doctors/:id` | A; selected doctor's clinic checked | W ID/no query | — | G | Reviewed; `admin-directory.test.ts` |
| POST `/clinics` | N only; administration recheck | Strict bounded text, slot 1–1440, unique days 0–6, real HH:mm, IANA timezone, initial Lite only | C | G | Reviewed; `admin-directory.test.ts` |
| PATCH `/clinics/:id` | A own scope; administration recheck | Strict nonempty partial settings; no mode change via settings; merged open < close | C | G | Reviewed; `admin-directory.test.ts` |
| POST `/doctors` | A + enforceScope; directory only, no account provisioning | Strict bounded name/specialty/email and numeric clinic ID | C | G | Reviewed; `admin-directory.test.ts` |
| PATCH `/doctors/:id` | A; existing and new clinic checked; no historical re-scoping | Strict nonempty partial; linked user/doctor integrity checked | C | G | Reviewed; `admin-directory.test.ts` |
| GET `/network/health` | A reauthorized in repeatable-read transaction; all clinic/device/conflict queries bind actor clinic | W no query/body; `network-health/service.ts` | — | G,S | **Remediated scoped-admin network disclosure**; S; `network-health.test.ts` |
| POST `/network/heartbeat` | D/F + trusted device must equal session device and clinic | Strict sequence safe integer, unsubmitted count 0–1,000,000; receipt-time telemetry | C | G | Reviewed; `network-health.test.ts` |
| GET `/appointments` | D/F; clinic/doctor scope; local patient checks for upcoming mode | Strict clinic/doctor/patient IDs, status/upcoming enums, real UTC range, scope-bound cursor, limit 1–100 | — | G | Reviewed; `appointments-api.test.ts`, V |
| GET `/appointments/availability` | D/F; own clinic and visible patient | Strict clinic/patient IDs; bounded scheduling search in engine | — | G,S | Reviewed; `appointments-api.test.ts` |
| POST `/appointments/check` | D/F; bookingScope and referenced doctor/patient visibility | Strict interval/source/options, UUIDs, real UTC, duration 1–1440 | C | G,S | Reviewed; `appointments-api.test.ts`, V |
| POST `/appointments/holds` | D/F; currentAuth recheck, own scope and patient | Strict interval/client operation UUID; hold ownership/expiry | C | G | Reviewed; `appointments-api.test.ts`, V |
| DELETE `/appointments/holds/:token` | D/F; scoped hold owner | W UUID; strict clientOpId body | C | G | Reviewed; `appointments-api.test.ts`, V |
| POST `/appointments` | D/F; transaction currentAuth + bookingScope; patient scope | Strict interval/source/options; operation UUID/idempotency; UTC duration | C | G | Reviewed; `appointments-api.test.ts`, V |
| PATCH `/appointments/:id` | D/F; selected appointment scope rechecked under lock | W ID; strict update UUID/version, optional real UTC/status/reasons; nonempty change | C | G | Reviewed; `appointments-api.test.ts`, V |
| GET `/sync/state` | D/F; trusted session-bound device and clinic | W no query/body | — | G | Reviewed; `sync-api.test.ts` |
| POST `/sync/push` | D/F; device binding, per-item scheduling scope, durable sequential receipts | Strict 1–50 operations; discriminated create/update; nested strict appointment schemas | C | G,S | Reviewed; `sync-api.test.ts`, V |
| GET `/sync/pull` | D/F; signed cursor binds actor/clinic/doctor/device authorization | Strict since ≤2048, limit 1–100; scoped SQL/projections | — | G,S | Reviewed; `sync-api.test.ts` |
| GET `/sync/conflicts` | D/F; scoped actor/clinic/doctor/device and cursor | Strict status enum, cursor ≤2048, limit 1–100 | — | G,S | Reviewed; `sync-api.test.ts` |
| POST `/sync/resolve` | D/F; conflict owner/scope; affected appointments rechecked | Strict discriminated action/UUIDs/versions/UTC intervals/override reason ≤2000 | C | G,S | Reviewed; `sync-api.test.ts`, V |
| POST `/kpis/lookup-duration` | D; trusted clinic; receipt-time measurement only | Strict duration integer 0–MAX_SAFE_INTEGER; no search/patient payload | C | G | Reviewed; `kpis-api.test.ts` |
| GET `/kpis` | A; explicit filter enforceScope; absent filter defaults to actor clinic, not network | Strict range day/week/month, real date 2000–2100, clinic ID; pure read-only projection | — | G,S | **Remediated scoped-admin disclosure and GET snapshot writes**; S |
| GET `/patients/:id/consent` | D/F; local patient scope before consent | W ID/no query; `consent/service.ts` | — | G | Reviewed; `consent-api.test.ts` |
| POST `/patients/:id/consent` | F + fresh PIN; patient scope and guardian/minor policy | Strict level/evidence enums, bounded guardian object, operation UUID | C | G | Reviewed; `consent-api.test.ts` |
| POST `/patients/:id/access-history` | F + fresh PIN; clinic-local patient | Strict operation UUID; no supplied role/clinic authority | C | G | Reviewed; `consent-api.test.ts` |
| POST `/consent/:id/withdraw` | F + fresh PIN; consent/patient clinic checked | W ID; strict operation UUID | C | G | Reviewed; `consent-api.test.ts` |
| GET `/network/lookup` | D only; current doctor, Full mode, consent/minor/source-policy projections | Strict normalized q 2–200, limit 1–100, bound cursor ≤512 | — | G,S | Reviewed; `privacy-api.test.ts`, `consent-api.test.ts` |
| GET `/doctor/day` | D own doctor/clinic; requireDoctor; protected projection | Strict limit 1–100, scope/date-bound cursor ≤512 | — | G | Reviewed; `privacy-api.test.ts` |
| GET `/doctor/patients/:id` | D; consent/source policy; no raw patient identifier grants disclosure | W ID; strict empty query | — | G | Reviewed; `privacy-api.test.ts`, V |
| GET `/doctor/privacy` | D own clinic; manager capability from trusted membership | Strict empty query | — | G | Reviewed; `privacy-api.test.ts` |
| GET `/audit` | D own privacy-safe clinical access feed | Strict patient ID filter, limit 1–100, scope-bound cursor ≤512 | — | G,S | Reviewed; `privacy-api.test.ts` |
| POST `/import/upload` | D/F; current actor; own clinic; doctor suggestions scope checked | Strict source enum/client UUID/name; ≤100 raw rows, 128kb parser; raw bad columns staged, never trusted linkage | C | G,S | Reviewed; `import-validation.test.ts`, `import-db.test.ts`, V |
| GET `/import/:id` | D/F; batch clinic/doctor/ownership checks in `imports/service.ts` | W ID; no query | — | G | Reviewed; `import-db.test.ts` |
| POST `/import/:id/map` | D/F; batch scope and every mapped doctor/patient/appointment checked | Strict expected version, 1–100 unique rows, action/identity union, nested verification, Hebron wall time | C | G,S | Reviewed; `import-validation.test.ts`, V |
| POST `/import/:id/commit` | D/F; F requires fresh trusted-device PIN; scoped batch/mappings, current authorization and version rechecked | Strict version/client UUID; transactional receipt/idempotency | C | G,S | Remediated fresh-PIN gate; V; `import-db.test.ts`; generated errors normalized |
| GET `/import/:id/report` | D/F; same batch scope as GET | W ID; strict locale ar/en (default ar) | — | G,S | Reviewed; `import-db.test.ts`; generated errors normalized |
| POST `/patients/merge/preview` | Read-only D/F; both patients clinic/doctor-visible; DB read-only transaction | Strict positive source/target numeric IDs, no coercion | C | G,S | Reviewed; `merge-db.test.ts`; generated errors normalized |
| GET `/patients/duplicates` | D/F; both candidates clinic/doctor scope | Strict limit 1–100 and actor-bound cursor ≤512 | — | G,S | Reviewed; `merge-db.test.ts` |
| POST `/patients/merge` | D/F; F requires fresh trusted-device PIN; both patients scope; reauthorization under lock; references allowlisted | Strict source/target IDs/versions, confirmed true, reason ≤1000, operation UUID | C | G,S | Remediated fresh-PIN gate; V; `merge-db.test.ts`; generated errors normalized |
| GET `/patients` | D/F; trusted local clinic SQL, demographics only | Strict q ≤200, cursor ≤512, limit 1–100 | — | G,S | Reviewed; `patients-api.test.ts`, V |
| GET `/patients/:id` | D/F; local patientScopeSql | W ID/no query | — | G | Reviewed; `patients-api.test.ts`, V |
| POST `/patients` | D/F; created/access clinic from auth, not request | Strict bounded name/phone/real DOB/client UUID; minor guardian policy; adult guardians intentionally discarded | C | G | Reviewed; `patients-api.test.ts`, `demographics.test.ts` |
| PATCH `/patients/:id` | D/F; selected patient must be clinic-local | W ID; strict nonempty demographics-only partial, real DOB/phone | C | G | Reviewed; `patients-api.test.ts` |
| DELETE `/patients/:id` | D/F; local scope; immutable-source patients protected; restrictive FKs | W ID/no nonempty body | C | G | Reviewed; `patients-api.test.ts` |
| GET `/clinics` | D/F; own trusted clinic only, no public clinic selector | Strict cursor ≤512 bound to actor/clinic; limit 1–100 | — | G | Reviewed; `admin-directory.test.ts`, V |
| GET `/doctors` | D/F; requested clinic enforceScope; D restricted to own doctor | Strict clinic ID, limit 1–100, actor/clinic/doctor-bound cursor ≤512 | — | G | Reviewed; `admin-directory.test.ts`, V |

### Non-API mounted route

| Method/path | Auth/scope | Validation | CSRF/rate | Evidence/status |
|---|---|---|---|---|
| GET `/docs/openapi.yaml` (and implicit HEAD) | Public static specification, fixed server-side path; no arbitrary file selector | No declared inputs; rejects query keys, parsed body and declared/transferred request bytes | Read-only CSRF exemption; G | `src/app.ts:specPath/sendFile`; app-owner remediation observed in source; HTTP evidence owned by main review |

## Demonstrated findings and remediations

1. **Permissive numeric coercion / uncovered empty-input routes.** Prior
   `z.coerce.number()` path/query schemas accepted alternative numeric spellings,
   and queryless handlers silently ignored unknown fields. W rejects these
   before service effects. It also bounds nested IDs that previously reached
   PostgreSQL integer overflow, protects UUID paths and security-header types,
   and rejects unsupported body media. V covers the positive and negative
   cases, real dates and import-row preservation.
2. **Generated Zod-version error mismatch.** Import and merge routes used
   generated Zod 3 `.parse()` before strict local Zod 4 validation, while the app
   recognized Zod 4 errors. Bad generated input could become `500 INTERNAL`.
   `routes/imports.ts` and `routes/patient-merge.ts` now translate failed
   `safeParse` into the established `400 VALIDATION` envelope. No payload,
   stack, SQL or raw schema error is serialized.
3. **KPI scoped-admin leak.** `routes/kpis.ts` previously passed request query
   directly to a network-default service after checking only role. It now
   rejects a foreign clinic and forces the authenticated clinic when omitted.
   S demonstrates rejection before queries and trusted-clinic binding.
4. **Network-health scoped-admin leak.** `network-health/service.ts` previously
   queried all clinics/devices/conflicts after a role-only check. All three
   queries now bind the reauthorized actor clinic (null retains legitimate
   network-admin behavior). S verifies the actual query predicates and values.
5. **KPI GET writes.** The KPI GET previously persisted snapshot rows. Its
   existing response shape now comes from a repeatable-read **READ ONLY**
   transaction with persistence disabled; the existing refresh CLI and direct
   refresh routine retain their snapshot behavior. S verifies the GET route
   enters read-only mode and scope-checks before aggregation. The upstream
   `kpis-api.test.ts` now fingerprints all snapshot rows around GET, asserts
   invariance, then explicitly invokes `refreshKpis` before checking persisted
   evidence. This DB-backed suite subsequently passed in the disposable clone
   as recorded below.
6. **PIN recovery active-lock bypass.** `routes/admin-users.ts` previously
   unconditionally cleared PIN state during updates/reset. Both paths now call
   the auth worker's `resetPinFailures` while holding the target user lock;
   active durable lock expiration is preserved. Auth worker owns concurrent/
   restart/recovery verification. This does not remove legitimate admin PIN
   credential recovery.
7. **CSRF presence.** Every mounted authenticated mutation already had explicit
   `csrf` (including export, leave, developer controls and telemetry). V guards
   this inventory against accidental omissions. Login/PIN remain explicitly
   Origin-protected bootstrap operations, not silently exempt cookie mutations.
   This source-level test is not a substitute for the main app's forged/missing
   Origin/token HTTP tests.
8. **Sensitive import/merge PIN policy.** Import commit and patient merge now
   include `requireFreshPin`; front-desk sessions without a trusted device or
   PIN verification in the last five minutes receive `REAUTH_REQUIRED`. Doctor
   operations remain legitimate without a reception PIN. Read-like merge
   preview does not acquire a PIN requirement. V checks the actual mounted
   handlers and stale/missing/fresh PIN behavior. Export is deliberately
   doctor-manager-only, so adding a reception PIN gate there would not strengthen
   its existing authority model.

### Batch/body-bound evidence and app-owner configuration recommendation

`tests/security-routes-bounds.test.ts` exercises real Express JSON parsing over
in-memory streams, not application startup or DB business effects:

- **Sync push:** 50 schema-valid updates with both 2,000-code-unit reason fields
  exceed **256 KiB**. JSON-escaped accepted characters can use six bytes per
  code unit; the tested worst-case bounded payload is over 1 MiB but below
  **2 MiB**. Recommend a **2mb parser only for `/api/sync/push`**, preserving
  the existing 50-operation and per-field limits. A 256kb cap rejects valid
  maximum-count/maximum-string requests under the current schemas.
- **Import map:** 100 explicit mapped rows with all bounded patient/guardian/
  reason fields exceed **128 KiB** and may exceed 900,000 bytes. Recommend a
  **1mb parser only for `/api/import/:id/map`**, preserving the 100-row and strict
  nested-field limits. The current default 32kb is insufficient for this case.
- **Import upload:** 100 ordinary maximum-name-length Unicode calendar rows fit
  the existing **128 KiB** upload contract. Keep **128kb** on
  `/api/import/upload`; arbitrary raw columns are intentionally schema-valid
  staging inputs, so the documented independent byte cap remains necessary.
  Arbitrarily large raw cells cannot all be supported merely because the
  upload has at most 100 rows.
- Tests also demonstrate `entity.too.large` for payloads above each proposed
  cap. The app owner must mount the dedicated parsers **before** the default
  32kb parser and retain the standard validation envelope. Subsequent source
  review confirms `app.ts` now mounts upload 128kb, map 1mb and sync push 2mb
  before the default 32kb parser. Maximum-sized bodies were exercised with the
  real parser in memory; the isolated HTTP regressions exercise ordinary valid
  sync/import flows, not every maximum-sized business mutation.

## Executed evidence and remaining integration work

- `pnpm --filter @workspace/api-server exec tsx --test tests/security-routes-validation.test.ts`
  — **7 passed**, no skips; no HTTP server or database connection.
- `pnpm --filter @workspace/api-server exec tsc -p tsconfig.json --noEmit`
  — passed at the route-remediation revision.
- `pnpm --filter @workspace/api-server exec tsx --test --test-concurrency=1 tests/security-routes*.test.ts`
  — **15 passed**, no skips after the follow-up remediations, before the isolated
  harness was added to this filename glob. This includes
  real in-memory parser bounds, actual mounted Express stack/OpenAPI comparison,
  PIN-gate checks and the two SQL-capture scope regressions;
  an initial test-double SQL matcher failure was corrected before this passing
  rerun. Do not infer passing HTTP/database tests from these unit tests.
- `git diff --check` — passed.
- `pnpm --filter @workspace/api-server run typecheck` — passed both the main
  API source and existing privacy-test TypeScript configurations after the
  isolated regression rerun.
- `pnpm --filter @workspace/api-server exec tsx --test tests/security-routes-isolated.test.ts`
  — **95 child tests passed, zero failures/skips**, plus the passing outer
  isolation/fingerprint assertion. The wrapper reuses
  `tests/helpers/auth-isolated.ts`, which only reads source through `pg_dump`,
  restores into a fresh private Unix-socket cluster and switches `DATABASE_URL`
  before importing runtime DB code or spawning the child `tsx` test runner.
  Child suite list:
  - `kpis-api.test.ts`
  - `import-validation.test.ts`, `import-db.test.ts`,
    `import-merge-boundary.test.ts`
  - `merge-identity.test.ts`, `merge-db.test.ts`
  - `adoption-api.test.ts`
  - `sync-api.test.ts`
  - `security-routes-validation.test.ts`, `security-routes-scope.test.ts`,
    `security-routes-bounds.test.ts`
- The child has demo tools explicitly disabled, `NODE_ENV=test`, no proxy trust,
  and explicit lookup/import/adoption/sync test Origins. This functional run
  explicitly raises the disposable DB's general/lookup/expensive/sync budgets
  to 100000/10000/10000/10000; it is **not** production-default rate-limit load
  evidence. The helper removes its private cluster and snapshot afterward.
- The full cloned-source content/schema/ACL/ownership/index/trigger fingerprint
  matched before/after all 95 tests, covering the six original tables. Relevant
  upstream suites also contain their own seed-invariance checks. This is not a
  substitute for the main owner's final **source** fingerprint measurement.
- The first real child run passed 94/95: an old KPI assertion expected an
  undeclared query field to be silently ignored. The test now expects that
  unknown field to fail 400 while confirming the case/trailing-slash variant
  without the unknown query still succeeds 204. No legitimate telemetry path
  was removed. The final full isolated rerun passed 95/95.
- The wrapper removes inherited `NODE_TEST_CONTEXT`, explicitly chooses the
  child reporter and requires an executed-test count in its output; a nested
  runner's zero-output exit is not accepted as regression evidence.
- Source/spec comparison: 77 explicit mounted API operations versus 77 spec
  operations, no spec-only or implementation-only pair. V independently checks
  every route file **and the actual recursively mounted Express stack** against
  W's inventory and the OpenAPI operations. Static docs and implicit HEAD/OPTIONS
  are separately accounted for above.

App-level limiter configuration, Helmet/CORS/HTTPS/parser mounts and public docs
HTTP boundary are verified in `security-boundary-evidence.md`; session/PIN checks
are in `security-auth-evidence.md`, and final source fingerprints in `security-review.md`. Upstream suites
not in the executed list (including privacy/patients/admin suites) remain
references, not claimed passes. The isolated runs cover actual adoption/export,
import/merge and sync success/failure/concurrency flows and their existing
cross-clinic HTTP checks; the newly added KPI/network-health scope regressions
are SQL-capture unit tests, not independently claimed DB-backed HTTP tests.
No signed-in UI was verified. No source migration/reset/write or seed execution
occurred; only the helper's private clone was restored. The task must not be
marked complete solely from this inventory.
