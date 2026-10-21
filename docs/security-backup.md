# Private backup and isolated demo population

Evidence date: **2026-10-21 (UTC)**. Task 39 tooling only; this is not a
production recovery service, penetration-test certification, or a task-completion
claim.

## Non-negotiable boundary

The existing database's six `public` tables remain permanently read-only:
`clinics`, `doctors`, `patients`, `appointments`, `patient_visit_history`, and
`calendar_app_export`. These commands never initialize, repair, reset, restore
into, or issue seed DML/DDL against that database. Original-source transactions
used by backup and verification are explicitly **REPEATABLE READ READ ONLY**.
Actual denied-write probes run only against restored disposable copies.

No reset command is used. No API, route, authentication, or UI behavior is
changed by this tooling.

## Backup command and scope

Prerequisites: the existing operational schema, maintenance `DATABASE_URL`
supplied through trusted environment/secrets, Node/pnpm, and PostgreSQL 16
`pg_dump`. Do not put a URL/password in command arguments, command history, or a
support transcript.

```sh
pnpm --filter @workspace/scripts security:backup
```

Optional `AMAL_BACKUP_DIRECTORY` must name an absolute **private directory
outside the workspace**. Default: `/tmp/amal-private-backups`. The directory must
belong to the executing user and have mode `0700`; symlink roots and insecure
existing directories are refused. The command emits only the completed private
backup path, table count, and consistency flag.

One backup consists of `database.dump` and `manifest.json`, each mode `0600`,
inside a mode-`0700` directory. Output is never placed in an artifact, public
asset directory, repository, or web response. Do not configure a static server
to expose these private directories.

**Scope:** all schema objects and table/sequence contents in `public`,
`seed_guard`, `operational`, and `operational_meta`; including immutable workbook
snapshots, operational clinical data, user password/PIN hashes, session/device
credential digests, audit data, migrations, functions, triggers, indexes, owners,
and grants. Unexpected application schemas cause failure rather than an
undocumented partial backup. PostgreSQL system schemas, database/cluster
configuration, global roles/passwords, application secrets, PostgreSQL large
objects, uploaded files, and external stores are **not** backed up.

The exported PostgreSQL snapshot stays open while `pg_dump --snapshot` runs.
Counts, content digests, column-schema digests, schema-object digests, foreign-key
definitions, and CHECK-constraint inventory use that same snapshot. Thus
concurrent operational commits cannot mix backup and manifest versions.
ACCESS SHARE locks prevent concurrent table removal during the dump. Source
seed fingerprints are verified again in a separate read-only snapshot afterward.

The manifest contains an archive SHA-256, ordered per-table content SHA-256
digests, counts, schema evidence, relationships, scope, time, and restore policy;
it contains no row payloads or connection credentials. The manifest remains
sensitive: metadata/counts are not suitable for public publication. Checksums
detect corruption; they are **not** an authenticated signature against an actor
able to replace both files.

Incomplete output uses a private `.partial-*` directory and is removed on
ordinary failure, dump-tool failure, or handled SIGINT/SIGTERM. Successful output
is atomically renamed only after dump and invariance checks finish. Database
driver/tool diagnostics are suppressed rather than printing SQL, source values,
URLs, or passwords. libpq credentials are passed through child-process
environment, not arguments; unrelated inherited `PG*` settings are removed.
Backup URLs permit only the optional `sslmode` query parameter; host, port,
database, user, password, service, and options query overrides are refused rather
than letting the driver and libpq silently select different targets.
Only trusted same-user/root operators may inspect process environments.

### Storage, encryption, retention, and incident handling

* Restrictive permissions are **not encryption**. This implementation does not
  provision encrypted disks, KMS, remote storage, scheduling, retention jobs, or
  managed backup hosting.
* `/tmp` is transient drill storage, not durable recovery storage. Use encrypted
  storage and organization-approved envelope encryption before persistent or
  off-host retention; keep encryption keys separate and recovery access audited.
  Never send dumps/manifests to chat, public links, source control, or CI logs.
* Limit transient verification copies to the verification window and delete them
  when no longer needed. For retained copies, an owner must explicitly approve
  retention, access, and deletion rules consistent with clinical-data policy;
  there is no automatic retention enforcement here.
* SIGKILL, machine failure, or full-filesystem failure can leave a private
  `.partial-*` directory. Treat it as a sensitive incomplete backup, inspect only
  through trusted maintenance access, and remove it after confirming no owned
  backup process is using it. Never treat it as a successful backup.
* Table-content evidence currently aggregates each table inside PostgreSQL and
  has a 120-second statement timeout. Very large installations need reviewed
  streaming evidence/resource limits; timeout is a hard failure, not a silently
  incomplete backup.

## Restore drill: no existing target can be selected

Additional prerequisites: PostgreSQL 16 `initdb`, `pg_ctl`, and `pg_restore`;
permission to start a temporary local PostgreSQL cluster. This is database
tooling only, not an application server or an application workflow.

Set `AMAL_RESTORE_BACKUP` through the environment to the private backup directory
reported above, then run:

```sh
pnpm --filter @workspace/scripts security:restore-drill \
  --demo --confirm=RESTORE-PRIVATE-BACKUP
```

The CLI takes **no target connection string**. It creates an entirely new
mode-`0700` temporary cluster on a random loopback port and a generated
`amal_demo_*` database, revokes PUBLIC CONNECT, and marks it
`AMAL_ISOLATED_DEMO_ONLY`. Only its randomly credentialed maintenance identity can
log in. Runtime/source role names are created **NOLOGIN**, with no copied
passwords. No application is started or connected to the target.

Before restore, file owner/mode/type and archive SHA-256 are checked. The archive
TOC excludes **TABLE DATA for `operational.auth_sessions` and
`operational.auth_devices`**, so active sessions and device trust are never
replayed, even temporarily. Operational device records can remain for
relationships, but do not confer trust without `auth_devices` credentials.
No `--clean`, existing-target restore, or global-role restore is exposed.

The drill checks:

* Every table's column-schema digest/count and content digest (except the two
  deliberately empty authentication tables).
* Index, trigger/enabled-state, function, and non-CHECK constraint definitions.
* Validated CHECK-constraint inventory. PostgreSQL restores their source
  definitions before data loading, so copied rows must satisfy them. Raw CHECK
  expression text is not compared byte-for-byte: PostgreSQL can normalize
  associative AND parentheses introduced by `BETWEEN` during restore.
* Every foreign key's definition/validated state, then actual relationship
  integrity by recreating all FKs inside a transaction that is rolled back.
* All restored user accounts are disabled and password hashes replaced with
  unrecoverable random disabled markers; PIN hashes are cleared before the
  verification callback returns. Session/device-trust tables remain empty.
* Seed fingerprints remain unchanged across sanitization.

The owned cluster is stopped and removed after success or ordinary failure.
The CLI reports success only after removal. Interrupted/crashed hosts require
trusted maintenance cleanup of `/tmp/amal-private-restore-*`; do not reuse these
clusters or attach the running application. Operational credential hashes in
the original private backup remain sensitive even though restored accounts are
disabled. This is an isolated recovery **drill**, not permission to restore into
the original database or make a restored service live.

## Guarded demo-only population

```sh
pnpm --filter @workspace/scripts demo:seed:guarded \
  --demo --confirm=POPULATE-ISOLATED-DEMO
```

Supply `AMAL_DEMO_DATABASE_URL` through a trusted environment, separately from the
unchanged source `DATABASE_URL`. The wrapper never defaults to the source.
It accepts only a literal loopback host (`127.0.0.1` or `::1`), a non-default port
different from the source port, and database names matching
`amal_demo_[a-z0-9_]{8,80}`. The connected database must match the URL, not be in
recovery, and carry the database comment `AMAL_ISOLATED_DEMO_ONLY`.
Only an explicitly approved, newly provisioned isolated demo database may carry
that marker; do not add it to the original database or to a live service.
The demo target must already have the approved immutable seed copy,
operational schema, and existing `amal_reset_login` population privileges.
The wrapper does not provision or migrate anything.

Missing confirmations, unknown/reset arguments, source database names, remote
targets, default/source ports, unmarked databases, `NODE_ENV=production`, and
`REPLIT_DEPLOYMENT=1` are refused. Demo URL query parameters/fragments are refused,
including query-string host overrides that could otherwise bypass loopback checks.
`REPLIT_ENVIRONMENT=production` alone is not a
published-app indicator and does not override the established policy.
These are fail-closed guards, not a substitute for trustworthy administrative
target selection or secret management.

This is composition over **the existing `populate()` in `demo-populate.ts`**,
not a second seed/reset implementation. Its existing advisory locks, transactional
sequence helper, source validation, and source fingerprint checks are reused
inside one transaction with `SET LOCAL ROLE amal_reset_login`. That role cannot
own/alter or write the immutable seed tables. The shared routine's explicit
direct-write allowlist is operational clinics, doctors, patients, appointments,
visit history, users, devices, consents, alerts, merge candidates, import batches,
import rows, and optional patient clinic/doctor access tables; existing operational
triggers can additionally maintain their audit/sync children. It never clears
tables, cascades deletes, repairs seeds, or calls reset.

Reruns retain existing IDs, operational edits, credential hashes, disabled states,
and previously reviewed import rows. Newly missing demo fixtures receive the
upstream **public synthetic demo credentials**, which is another reason this
command must never target a live service. Transaction rollback preserves all
row changes; normal PostgreSQL identity-sequence gaps after failed inserts are
not evidence of committed population.

Workbook instants are copied unchanged from existing UTC seed instants, avoiding
double conversion; the existing upstream `date-fns-tz` Asia/Hebron handling is
reused. Date-only values stay dates. All newly populated calendar-export rows
remain review-required; name-only suggestions are never confirmed links.

## Focused verification and recorded evidence

```sh
pnpm --filter @workspace/scripts typecheck
pnpm --filter @workspace/scripts security:backup:test
```

The test performs only read-only transactions/privilege inspection against the
original database, creates private backups, and performs all probes/fixtures in
new owned temporary clusters. It does **not** run `seed:import`, `seed:verify`,
any migrate/reset command, or start/restart the application.

Verified on 2026-10-21:

* Script typecheck: exit **0**.
* Backup command: exit **0**, one private consistent-snapshot archive/manifest,
  **47 tables**.
* Standalone restore drill: exit **0**, **47 table schema/count checks**,
  **97 foreign keys** revalidated, **53 validated CHECK constraints** inventoried,
  **0 active sessions**, **0 trusted devices**,
  disabled user credentials, owned cluster removed.
* Focused test: exit **0**. Includes private-file modes, failure after partial
  dump output and cleanup, refusal of insecure output directories and unsafe
  demo targets, actual missing-marker refusal, production/deployment/confirmation
  guards, and **24 denied seed-write probes on copies**.
* Source runtime privileges checked for all **six** immutable tables without
  attempting original-source writes.
* Guarded population rerun preserved the entire operational row evidence after
  an operational phone edit, including disabled user credentials. Injected
  import-row failure after earlier fixture insertion rolled back all row effects;
  removing the failure let the shared routine repopulate missing fixtures.
* A concurrent operational commit **in a disposable source only**, after
  snapshot export but before `pg_dump`, demonstrated that manifest and restored
  dump both retained the same earlier view.
* Original source seed schema/ACL/ownership/index/trigger/content fingerprint
  before and after the focused run:
  `12db341aeea93a237f92fd97691c3a42038e1f35b9381ed5b24f8325839a3cb0`.
  Equality was asserted; no source row payloads or credentials were emitted.

Scope limitations: this page verifies backup and seed tooling, not unrelated API
security controls or full-workspace regressions. No production restore,
production write test, existing-source write attempt, managed encryption,
backup scheduling, failover automation, or retention service was performed.
