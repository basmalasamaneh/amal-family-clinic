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
