# Amal production-demo preparation

## Release status: BLOCKED — explicit publication approval required

The owner confirmed that the workbook is entirely synthetic and approved for
publication. This is data approval only, **not approval to publish the app**.
Do not publish, start a deployment, or overwrite an existing production target
without separate explicit owner approval.

This runbook was created because the referenced `docs/DEMO.md` was not present
in the main checkout. It records preparation and remaining gates, not evidence
that a production environment has been provisioned.

## Verified preparation status

- Deployment service reports no active deployment and no published URL.
- Production secret inspection reports `SESSION_SECRET` exists (value not read).
- All three reserved private demo credential secrets are saved; existence only
  was verified. Values were not read, tested, or used to provision accounts.
- No production database has been provisioned or populated by this work.
- No source seed rows, development accounts, sessions, or device trust changed.
- Existing guarded demo seeding permits only explicitly marked disposable
  loopback databases and refuses production. Keep those guards unchanged.
- Existing population routines can create public synthetic test credentials;
  they are **not a production account provisioning procedure**.

## Isolation and provisioning gates

Replit's managed production database is created through the first Publish flow;
schema changes are managed there. Do not add custom production migration
scripts, startup DDL, or migration commands to build hooks.

Before approving publication:

1. Review the actual production schema diff, including immutable seed
   protection, operational constraints and least-privilege roles. Do not assume
   role grants, trigger functions or runtime login provisioning transfer
   automatically. Resolve any unsupported elements before proceeding.
2. Establish a reviewed initialization path for a fresh, isolated demo target.
   Reuse the existing seed-copy and operational population logic; do not weaken
   the production refusal of development tooling or reset an unknown target.
3. Copy only the six approved seed tables once and verify exact schema/content
   fingerprints and counts: clinics 3, doctors 5, patients 25, appointments 102,
   patient_visit_history 32, calendar_app_export 24. Retain their immutable
   protections. Do not copy the entire current development database as a shortcut.
4. Populate operational data idempotently, preserving source IDs and existing
   edits. No seed writes on startup. Retain Asia/Hebron timestamp semantics and
   manual identity review for all calendar export rows.
5. Exclude all development sessions, trusted-device credentials, queued sync
   payloads, and account credentials. Do not enable accounts with public fixture
   passwords/PINs. Production runtime must authenticate directly as the restricted
   login, not administrator plus SET ROLE.
6. Provision private admin, doctor and reception credentials using an explicitly
   reviewed account bootstrap path. Resolve clinic/doctor assignments from
   verified relationships, not hard-coded IDs. Reruns must not overwrite
   credentials or duplicate accounts. This bootstrap path is **not yet implemented
   or executed** by this preparation.
7. Enroll reception devices via the existing authenticated trusted-device flow;
   never transfer development device cookies or bypass enrollment.

Actual managed production provisioning remains blocked until its supported
Publish-dependent steps can be approved and verified. A disposable rehearsal
does not count as a persistent production database.

## Private credentials

Proposed bootstrap input names (not currently consumed by application code):

| Secret | Purpose |
| --- | --- |
| `AMAL_PRODUCTION_DEMO_ADMIN_PASSWORD` | Private demo administrator password |
| `AMAL_PRODUCTION_DEMO_DOCTOR_PASSWORD` | Private demo doctor password |
| `AMAL_PRODUCTION_DEMO_RECEPTION_PIN` | Private four-digit reception PIN |

Passwords must be unique, at least 12 characters, and at most 72 UTF-8 bytes.
PIN must contain exactly four ASCII digits, as required by the current auth API.
Use the secure Secrets form only; never paste values in chat, docs, source,
logs, screenshots or demo scripts. Do not reuse public fixture credentials.
Saving these inputs does not create accounts.

Before publication, verify environment scoping in Production app secrets.
Bootstrap credentials should be available only to the reviewed one-time
provisioning process, not browser bundles or the long-running runtime.
Do not request or manually set managed DATABASE_URL/PG* variables.
Do not rotate SESSION_SECRET casually: it participates in restricted database
login derivation and must be coordinated with database-role credentials.

## Production configuration gates

- Inspect artifact-owned production build/start settings; no dev servers,
  mocks, automatic seed/reset routines or database schema push.
- Obtain the production origin through deployment metadata when available.
  Never derive it from a preview hostname or guess a replit.app address.
- Configure exact HTTPS AUTH_ALLOWED_ORIGINS and verify trusted proxy handling,
  Secure cookies, CSRF and role boundaries.
- Keep developer reset and production reset authority disabled.
- Decide deployment visibility and region with the owner before first publish.
  Private credentials do not make a publicly visible deployment private.

## Verification after the owner explicitly approves publication

- Verify liveness and database readiness separately, with bounded safe errors.
- Verify seed fingerprints and runtime privilege denial without mutating sources.
- Confirm private admin/doctor/reception logins, clinic scope, trusted-device
  enrollment and PIN re-entry; ensure public fixture logins cannot succeed.
- Check deep links, AR/RTL and EN/LTR, themes, PWA assets, and offline/sync flows.
- Verify backups, rollback procedure and the published URL from deployment status.
- Record sanitized evidence only. Do not claim these checks passed before running.

## Current blockers

- Owner has not approved publication.
- Production initialization and private account bootstrap are not yet established.
- Private credential input is complete; production-only scoping and validation
  by the future provisioning process remain unverified.
- Production schema/roles, exact origin, region/visibility and runtime verification
  remain unverified.

# Amal demo environment — preparation-only handoff

## Commands and recovery boundaries

Existing command contracts are documented in
[security-backup.md](security-backup.md) and
[operational-demo.md](data/operational-demo.md). In particular,
`demo:seed:guarded --demo --confirm=POPULATE-ISOLATED-DEMO` is a
**disposable development command**, not a production recipe.
No safe executable production migration/population sequence is verified yet.


### Liveness and database readiness

- `GET /api/healthz` (or `HEAD`) with no query or body reports process liveness
  only. It returns the existing `{"status":"ok"}` response with security headers
  and `Cache-Control: no-store`, no cookies and no database access. Exact probes
  can use internal HTTP; supplied Origin still must be allowed. Other API
  requests retain HTTPS enforcement and durable admission limits.
- After the API build, run `pnpm --filter @workspace/api-server readiness`, or
  `node artifacts/api-server/dist/readiness.mjs` from the workspace root.
  Exit 0 and `{"database":"ready"}` mean the restricted login connected and could
  read the core user/session/rate-limit schema in a read-only transaction.
  This does **not** certify all migrations, seed integrity or role journeys.
  Exit 1 and `{"database":"unavailable"}` mean readiness failed.
- The command has 1.5-second connection/query limits and a five-second overall
  deadline, emits no database diagnostics or values, and never migrates or seeds.
  Do not treat liveness success as database readiness.
- Local verification: API build and typecheck passed; deployment-health tests
  passed for production liveness without a database, denied non-health HTTP
  requests/spoofed proxy headers, and sanitized readiness failures. The current
  development database passed the separate read-only readiness check. None of
  these results constitute a production test.
- The existing isolated HTTP boundary suite passed all 11 tests after moving
  its general-rate-limit and HTTPS probes from liveness to the public OpenAPI
  document route. Limit/restart/CSRF/cookie assertions were retained, not waived.
  The suite checks copied seed fingerprints and removes its temporary database.
  The API workflow restarted and preview `/api/healthz` returned `{"status":"ok"}`.

Retain private pre-change backups and the prior deployable code revision before
authorized changes. Code rollback is not permission to roll back clinical or
operational data. The current restore drill creates a new temporary cluster and
disables restored accounts; it is not an existing-target production restore
procedure. Stop and require reviewed recovery steps if migration or integrity
checks fail. Never recover by clearing operational tables or repairing seeds.


## Unperformed deployment evidence — not part of preparation-only completion

- Verified published URL and verification date.
- Target isolation, migration ledger, source/target fingerprints and denied-write evidence.
- Role account identifiers/scopes and approved private credential delivery procedure.
- Trusted reception-device enrollment and PIN re-entry results.
- Three-role, locale/theme and restart-persistence results.
- Actual installation browser/version/platform and launch evidence.
- Deployed offline conflict/retry results and privacy checks.
- Tested access-disable, credential-rotation and rollback procedures.

All items above are **unverified**, not implicit passes.
## Historical deployment gates — outside revised scope

| Gate | Observed status / required next step |
| --- | --- |
| Approved data | Confirmed for the supplied workbook only. |
| Production target | No isolated production demo target or its identity has been verified. Never reset an unknown target. |
| Production population | Existing `scripts/src/security-demo-seed.ts` accepts only explicitly marked loopback disposable targets. Its upstream guard refuses production/published execution. There is no verified production-target allowlisting handoff. Preserve these refusals. |
| Production credentials | Existing population uses public synthetic development credentials for new fixtures. No secure production account provisioning/retrieval has been established. Never publish these fixture credentials as working access. |
| Health and ingress | Exact payload-free `/api/healthz` probes now return database-independent liveness over internal HTTP. The separate bounded readiness command checks restricted database connectivity and core auth schema reads. Local checks pass; deployed startup probes and ingress trust remain unverified. |
| Routing/build | API and frontend production builds passed locally, including service-worker generation. Deployed deep links and API routing remain unverified. Existing bundle-size warnings remain. Canvas must not ship as the product. |
| Publication | Not permitted from this task fork; separate final approval remains required in the authorized context. |
| Three-role smoke tests | Not run on a published origin. |
| Actual PWA installation | Not observed; browser/version/platform evidence unavailable. |
| Deployed offline conflict journey | Not run. Existing harness is explicitly development-only and must not be aimed at production unchanged. |
| Persistence and seed integrity | No production restart/redeploy, target fingerprint comparison or write-denial evidence available. |

Missing production-safe tooling must be resolved explicitly before provisioning;
do not replace the established population implementation or relax its global
production refusal to get past this gate.

## Status — 2026-10-21

**Not a completed deployment or verified demo runbook. Do not use this document
as authorization to publish or to run development fixtures in production.**

The user has explicitly stated that they do not want to publish the project at
all. The deliverable is therefore preparation only, not a paused publication.
Production provisioning, production account creation/secret scoping, publication,
deployed role/offline verification and actual deployed PWA installation are
excluded from the revised scope. The historical deployment gates below are
retained for accuracy, not as instructions to proceed or pending requirements
for this preparation-only deliverable. No publication follow-up is requested.

The user confirmed on 2026-10-21 that the supplied Amal workbook is entirely
synthetic and approved for a published demo. This is data-suitability approval,
not publication approval. Use only isolated demo data; never real clinical data.
The six source tables must remain unchanged.

Deployment status queried for this task workspace returned successfully:
`isDeployed=false`, `hasSuccessfulBuild=false`, and no production URL.
This does not establish the deployment status of another workspace.
No database was provisioned, copied, migrated, reset or populated by this task.
No account or device credential was created or exposed.

Publication is prohibited from this forked task workspace and is not wanted by
the user. No published role journey, installation or offline scenario is claimed
here. Saved private credential secrets are not evidence that accounts exist;
do not use them to provision production.

## Configuration inventory — names only, not verified production settings

| Name | Purpose / boundary |
| --- | --- |
| `DATABASE_URL` | Database connection supplied through managed configuration; keep privileged maintenance access separate from restricted runtime access. |
| `SESSION_SECRET` | Existing restricted-runtime credential derivation dependency; coordinate changes with database identity provisioning rather than blindly rotating one side. |
| `NODE_ENV` | Production execution must use `production`. |
| `PORT` | Service listener configured by the artifact runtime. |
| `BASE_PATH` | Frontend artifact routing base; verify manifest/start URL/scope against actual routing. |
| `AUTH_ALLOWED_ORIGINS` | Exact approved HTTPS production origin(s), never preview guesses. |
| `AUTH_TRUSTED_PROXIES` | Verified ingress IP/CIDR allowlist; do not trust arbitrary forwarded headers. |
| `AUTH_PROXY_HOPS` | Nonzero values are forbidden by current production startup validation. |
| `AMAL_DEVELOPER_TOOLS` | Must not enable unsafe debug/reset access in production. |
| `AMAL_DEMO_DATABASE_URL` | Existing disposable-demo tooling target, **not** an established production provisioning interface. |

Store values only through secure environment configuration. Do not commit
passwords, PINs, device tokens, connection strings or session material. Runtime
and population identities must not own seeds or have migration privileges.


## Reference checklist only — not authorized for execution

1. Confirm prerequisite acceptance and a fresh, explicitly approved isolated
   production target. If a target already exists, require a private backup and
   reviewed migration safeguards; never assume it is disposable.
2. Establish a reviewed production allowlisting/provisioning path reusing the
   existing transactional population logic. Do not run `demo:reset`,
   development schema push, or population on startup.
3. Copy the six seed tables exactly once using the established import/snapshot
   process. Compare approved baseline schema/content fingerprints, enforce
   immutable protection and prove denied writes using the restricted target
   identities. Keep all 24 calendar-export rows subject to manual identity review.
   Preserve Asia/Hebron interpretation, UTC instants and date-only values.
4. Provision scoped admin, doctor and front-desk identities with private
   credentials and dynamically resolved relationships. Reruns must preserve
   edited rows and credentials. Enroll reception through the existing trusted
   device flow; confirm PIN login and sensitive-action re-entry.
5. Verify production build/routing, health/readiness, ingress, HTTPS cookies,
   CSRF, durable sessions/rate limits and disabled development access.
6. Obtain explicit publication confirmation in the authorized main-app context,
   then retrieve the actual HTTPS URL from deployment status.
7. Test allowed and denied role/cross-clinic journeys and logout in Arabic RTL
   and English LTR, Light and Dark. Verify persistence after restart/redeploy
   without accidental reseeding.
8. Inspect manifest/icons/worker/start URL/scope over HTTPS, then actually install
   and launch in a supported browser/device. Record version/platform and
   sanitized observations; manifest inspection alone is not installation.
9. On approved isolated records, prime offline access, create three bookings
   offline and reload. Use a separate online actor to create one competitor.
   Reconnect: require two successes and one explicit conflict. Move/confirm the
   conflict; verify exactly three canonical client bookings plus the competitor,
   stable operation identities and no retry/reload duplicates. Check logout and
   account switching cannot reveal cached private data. Preserve production
   guards and service worker; no public test endpoints or fault injection.
10. Record sanitized results and final seed integrity. Provide account identifiers
    and scope here only after provisioning; deliver credentials privately.
    Document tested credential revocation/rotation, device revocation and
    disabling demo users before declaring completion.

## Unperformed deployment evidence — not part of preparation-only completion

- Verified published URL and verification date.
- Target isolation, migration ledger, source/target fingerprints and denied-write evidence.
- Role account identifiers/scopes and approved private credential delivery procedure.
- Trusted reception-device enrollment and PIN re-entry results.
- Three-role, locale/theme and restart-persistence results.
- Actual installation browser/version/platform and launch evidence.
- Deployed offline conflict/retry results and privacy checks.
- Tested access-disable, credential-rotation and rollback procedures.

All items above are **unverified**, not implicit passes.
## Available prerequisite evidence

The original health-only-scaffold description is outdated. The real
`artifacts/amal-network` frontend, API, operational schema, authentication,
PWA and sync implementation are present.

- [Security review](security-review.md), including its scanner limitations.
- [Bug-bash handoff](testing/bug-bash.md), including final targeted corrections,
  remaining performance misses and assistive-technology coverage limits.
- [Authentication policy](auth-security.md) and
  [HTTP boundary evidence](security-boundary-evidence.md).
- [Private backup/restore and guarded population](security-backup.md).
- [Development offline journey](testing/offline-live.md).

These are existing handoffs, not tests rerun by this deployment task. Verify
prerequisite acceptance/completion in the owning project before proceeding.
Where older auth documentation suggests production hop-count proxy trust, the
current implementation takes precedence: it rejects nonzero `AUTH_PROXY_HOPS`
in production and requires explicit trusted proxy addresses.


## Historical deployment gates — outside revised scope

| Gate | Observed status / required next step |
| --- | --- |
| Approved data | Confirmed for the supplied workbook only. |
| Production target | No isolated production demo target or its identity has been verified. Never reset an unknown target. |
| Production population | Existing `scripts/src/security-demo-seed.ts` accepts only explicitly marked loopback disposable targets. Its upstream guard refuses production/published execution. There is no verified production-target allowlisting handoff. Preserve these refusals. |
| Production credentials | Existing population uses public synthetic development credentials for new fixtures. No secure production account provisioning/retrieval has been established. Never publish these fixture credentials as working access. |
| Health and ingress | Exact payload-free `/api/healthz` probes now return database-independent liveness over internal HTTP. The separate bounded readiness command checks restricted database connectivity and core auth schema reads. Local checks pass; deployed startup probes and ingress trust remain unverified. |
| Routing/build | API and frontend production builds passed locally, including service-worker generation. Deployed deep links and API routing remain unverified. Existing bundle-size warnings remain. Canvas must not ship as the product. |
| Publication | Not permitted from this task fork; separate final approval remains required in the authorized context. |
| Three-role smoke tests | Not run on a published origin. |
| Actual PWA installation | Not observed; browser/version/platform evidence unavailable. |
| Deployed offline conflict journey | Not run. Existing harness is explicitly development-only and must not be aimed at production unchanged. |
| Persistence and seed integrity | No production restart/redeploy, target fingerprint comparison or write-denial evidence available. |

Missing production-safe tooling must be resolved explicitly before provisioning;
do not replace the established population implementation or relax its global
production refusal to get past this gate.

## Reference checklist only — not authorized for execution

1. Confirm prerequisite acceptance and a fresh, explicitly approved isolated
   production target. If a target already exists, require a private backup and
   reviewed migration safeguards; never assume it is disposable.
2. Establish a reviewed production allowlisting/provisioning path reusing the
   existing transactional population logic. Do not run `demo:reset`,
   development schema push, or population on startup.
3. Copy the six seed tables exactly once using the established import/snapshot
   process. Compare approved baseline schema/content fingerprints, enforce
   immutable protection and prove denied writes using the restricted target
   identities. Keep all 24 calendar-export rows subject to manual identity review.
   Preserve Asia/Hebron interpretation, UTC instants and date-only values.
4. Provision scoped admin, doctor and front-desk identities with private
   credentials and dynamically resolved relationships. Reruns must preserve
   edited rows and credentials. Enroll reception through the existing trusted
   device flow; confirm PIN login and sensitive-action re-entry.
5. Verify production build/routing, health/readiness, ingress, HTTPS cookies,
   CSRF, durable sessions/rate limits and disabled development access.
6. Obtain explicit publication confirmation in the authorized main-app context,
   then retrieve the actual HTTPS URL from deployment status.
7. Test allowed and denied role/cross-clinic journeys and logout in Arabic RTL
   and English LTR, Light and Dark. Verify persistence after restart/redeploy
   without accidental reseeding.
8. Inspect manifest/icons/worker/start URL/scope over HTTPS, then actually install
   and launch in a supported browser/device. Record version/platform and
   sanitized observations; manifest inspection alone is not installation.
9. On approved isolated records, prime offline access, create three bookings
   offline and reload. Use a separate online actor to create one competitor.
   Reconnect: require two successes and one explicit conflict. Move/confirm the
   conflict; verify exactly three canonical client bookings plus the competitor,
   stable operation identities and no retry/reload duplicates. Check logout and
   account switching cannot reveal cached private data. Preserve production
   guards and service worker; no public test endpoints or fault injection.
10. Record sanitized results and final seed integrity. Provide account identifiers
    and scope here only after provisioning; deliver credentials privately.
    Document tested credential revocation/rotation, device revocation and
    disabling demo users before declaring completion.


# Amal demo environment — preparation-only handoff
