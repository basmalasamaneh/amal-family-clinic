# Private local-cache foundations

Owner: `src/offline`. This task implements persistence primitives, **not** live
refresh, offline authentication, booking workflows, replay, background sync,
conflict resolution, or API changes. Tests use synthetic fixtures only. No seed
table is read or mutated. Operational shapes follow the existing OpenAPI
`Doctor`, `PatientBasic`, `Appointment`, and appointment mutation fields, but
there is no endpoint adapter in this module.

## Integration API and authorization boundary

Import the per-tab `localCache` singleton from `src/offline/index.ts`. An injectable
`LocalCacheController` is available for tests. The singleton proactively probes
IndexedDB in browsers; it has **no** initial private context.

1. Await `setContext({ userId, clinicId, authorizedUntil })` **only** after an
   online-verified authorization establishes stable user ID, authorized numeric
   clinic ID, and an explicit authorization expiry. Never substitute a route,
   selected clinic label, a guessed expiry, a stored token, an offline identity,
   or `navigator.onLine`. The current session contract does not establish a
   cache-specific authorization lifetime: when expiry is unknown, leave context
   null and keep private records locked. An offline shell alone cannot unlock
   records. The owning shell must call `setContext(null)` immediately on offline/
   unknown authorization, 401, identity change, or lost clinic authorization.
2. Call `captureScope()` **before** starting any asynchronous operational fetch.
   Pass that exact opaque ticket to `replaceSnapshot(ticket, projection)` when
   the fetch resolves. Capturing a fresh ticket after an old fetch defeats the
   ownership boundary and is not an allowed integration pattern.
3. Use `readSnapshot(ticket)` for an atomic snapshot, not direct Dexie tables.
   Its result includes authoritative coverage, original refresh timestamp,
   current calendar window, and `fullyCovered`. Empty data alone does not prove
   a completed refresh.
4. `rollover(ticket)` prunes in one transaction. A future owning integration
   should invoke it at the next Asia/Hebron local midnight and visibility return;
   reads and refreshes also prune, including after the app was closed.
5. `enqueue`, `listOutbox`, `updateOutbox`, and `pendingCount` are basic local
   persistence only. Nothing in this task connects them to a clinical action or
   sends them to a server.

Every asynchronous public operation returns `Result<T>`:
`{ ok: true, value }` or `{ ok: false, error }`. Errors are stable codes only:
`unauthorized`, `stale-context`, `invalid-data`, `pending-outbox`,
`storage-unavailable`, `storage-quota`, `storage-blocked`, `storage-failed`.
No browser exception, server body, clinical text, token, or raw retry error is
returned to UI. UI should localize those codes and never claim a failed write
was persisted. `captureScope()` is synchronous and also returns `Result`.

`setContext()` invalidates existing tickets and aborts local active transactions
**synchronously**, before its returned promise settles, including for null or an
invalid context. Await success before acquiring a new ticket. Expiry is checked
on every operation and before commit, with an expiry timer to invalidate visible
context while the app remains open. Context listeners let the owner immediately
discard any in-memory private snapshot, not just IndexedDB data.

The controller publishes `getStorageStatus()` / `subscribeStorage(listener)`
(stable functions suitable for `useSyncExternalStore`) with states `idle`,
`checking`, `ready`, and `{ state: 'error', error }`. `probe()` performs a real
read/write transaction and can be explicitly retried. `subscribeContext(listener)`
signals revocation/expiry; it does not establish authorization. Unsubscribing
both listeners is the caller's responsibility. `close()` disposes the owning
controller without deleting records and is not logout.

## Versioned schema

Database identity is `amal-private-cache`, schema versions 1 and 2. Identity is
isolated using composite primary keys and all cache queries require both stable
user and authorized clinic. A patient ID/name is never used as a cross-clinic or
cross-account identity. Tables are private even though there is one database:

| Table | Primary key | Stored allowlisted fields |
| --- | --- | --- |
| appointments | `[userId+clinicId+id]` | scope, id, doctorId, patientId, startsAt, endsAt, status, version |
| doctors | `[userId+clinicId+id]` | scope, id, name |
| patients | `[userId+clinicId+id]` | scope, id, name, phone, dateOfBirth |
| outbox | `[userId+clinicId+operationId]` | scope, operation fields and processing metadata below |
| metadata | `[userId+clinicId]` | refreshedAt, coverageStartUtc, coverageEndUtc, windowStartUtc, windowEndUtc |
| lifecycle (v2) | `key` | global monotonic epoch, no identity, credentials or clinical content |

All private tables index `userId` for complete account cleanup. Appointments also
index `[userId+clinicId]`, `[userId+clinicId+startsAt]`, and
`[userId+clinicId+doctorId+startsAt]`. Doctors, patients, and outbox index
`[userId+clinicId]`. Outbox indexes `[userId+clinicId+status]`; v2 adds
`[userId+clinicId+status+enqueuedAt]` and `[userId+clinicId+enqueuedAt]`.

v2 only adds the lifecycle table and outbox indexes. Dexie upgrades preserve all
v1 cache rows and pending operations; there is no `deleteDatabase`, clear, or
destructive version-reset migration. Future changes must append a version,
explicitly migrate allowlisted fields when necessary, and retain pending work
and operation IDs. Do not edit published schema history. The tests create a v1
database and verify v2 records and indexes.

## Projection, retention and coverage

Server objects are never spread into storage. Writes **and reads** use explicit
allowlists; additional fields such as history, consent payloads, notes,
network-directory attributes, and credentials are not persisted or returned.
Names, phone and date-only DOB are the only patient details retained. DOB is
validated as a real `yyyy-MM-dd` date and is not timezone-shifted. All instants
require an explicit offset/Z and are normalized to UTC ISO strings.
`formatHebronInstant()` formats an instant in Asia/Hebron; it must not be used
to reinterpret date-only DOB.

Snapshot input declares its matching user/clinic and authorized source coverage.
Each row must have that clinic; duplicates, dangling appointment references,
invalid timestamps, unsupported statuses, and malformed DOB are rejected.
Doctors/patients must be the authorized **clinic** projection, not network
search results. An API adapter must supply only independently authorized data.
Storage isolation is not a substitute for server-side authorization.

The appointment interval is today's Asia/Hebron local midnight inclusive through
local midnight **14 calendar days later** exclusive, based on appointment
`startsAt` (not overlap). `date-fns-tz` resolves each midnight separately; adding
336 hours is incorrect across DST. The same window governs refresh, read, and
rollover pruning. Patient/doctor projections remain until scoped replacement or
explicit cleanup; they are not a network-wide directory. Appointment pruning
never deletes outbox entries.

Replacement of appointments, doctors, patients, and metadata is one transaction.
Rows outside the retention window are discarded, but declared source coverage
must include each input appointment. Coverage is not inferred from record count.
Pruning advances window metadata but never advances `refreshedAt` or falsely
extends source coverage. Rollover can make `fullyCovered` false until an actual
authorized refresh covers the new window.

## Outbox contract (no replay)

The caller supplies a globally unique UUID `operationId` once per intended
operation. Keep it unchanged for retries and future server idempotency mapping
to `clientOpId`. Never reuse the UUID in another clinic/account. Identical
reenqueue is idempotent; same scoped ID with different intent is rejected.

- `appointment.create`: `entityId: null`; payload only doctorId, patientId,
  startsAt, endsAt, source.
- `appointment.update`: numeric entityId; payload only startsAt, endsAt,
  expectedVersion. This is a minimal reschedule shape, not the whole server
  mutation vocabulary.
- Scope comes exclusively from the ticket, not arbitrary payload metadata.
- UTC enqueue/update times, status (`pending`, `processing`, `failed`, `conflict`,
  `succeeded`), nondecreasing attempt count, optional UTC retry time, and an
  allowlisted error code (`network`, `rate-limited`, `conflict`, `rejected`,
  `unknown`) are persisted. No raw response/error text is accepted.
- Query ordering is enqueue instant, then stable UUID for ties. Status queries
  are scoped. No timer transitions status or increments attempts.
- There is no implicit retention or deletion of pending/failed/conflict rows,
  nor automatic deletion of succeeded rows. Explicit logout cleanup is the
  current removal primitive. Future sync must define acknowledgement retention,
  server idempotency, dependencies, conflict resolution, and authorization anew.

## Shared-device cleanup and cross-tab safety

Before signout confirmation, call `pendingCount(ticket)`. This counts all
non-succeeded operations in **all clinics** belonging to the current authorized
user, not just the selected clinic. `logout()` immediately locks context/tickets
and revokes peers. If any unsent work exists it returns `pending-outbox` without
deleting data. Obtain explicit localized user confirmation before calling
`logout({ discardPending: true })`; that atomically removes all appointments,
doctors, patients, metadata, and outbox rows for that user across every clinic.
Another account's rows remain inaccessible and untouched.

Cleanup can follow `setContext(null)` because the last verified user is retained
only in controller memory for cleanup, never used to unlock reads. A controller
that has never established a verified user can receive
`logout({ userId: verifiedIdentity.id, discardPending: true })` from the session
owner. That explicit identity is a **cleanup-only** capability: it never sets
context, authorizes reads, or grants clinic access. This allows cleanup with no
authorized clinic, missing expiry, or expired authorization. The normal pending
check still applies if `discardPending` is absent. With neither a remembered nor
an explicit identity, logout returns `unauthorized` rather than claiming it
cleared unknown data. Account removal uses the same explicit cleanup path.

Refusing destructive cleanup leaves context locked; restoring it requires a
fresh verified `setContext`. Storage failure during logout must be reported as
incomplete cleanup, not successful erasure. Keep private UI locked and offer
retry/device-site-data cleanup; do not silently resume writes or discard the
failure. Auth logout should not be represented as durable private-data erasure
if IndexedDB cleanup failed.

BroadcastChannel and a localStorage opaque pulse notify other tabs to invalidate
immediately; neither carries identities or private records. A persisted global
epoch is also checked inside every private transaction, preventing older tickets
from writing even when notifications are unavailable. Epoch revocation commits
even if logout later refuses to discard pending changes. Any context change
conservatively locks other tabs, including tabs on another clinic. They must
revalidate rather than auto-unlock. All scoped transactions include the epoch
store, serialize against changes, and remain abortable through actual commit.
Already-committed transactions cannot be retroactively aborted; logout subsequently
clears the target user's rows. No client module can erase data already copied
into another tab's JS memory; integrations must honor context listeners and
avoid keeping rendered snapshots after revocation.

## Browser limitations and verification

IndexedDB is **not encrypted storage**, a credential vault, or offline login.
Browser storage can be inspected on the device, evicted, cleared, disabled, or
subject to private-mode/browser quota limitations. Client expiry uses the device
clock and does not prove current server authorization. Storage failure must leave
the public shell usable online, with localized feedback and no claim of
persistence. Blocked upgrades fail promptly and preserve existing records; close
older tabs and retry the probe rather than deleting the database. Version changes
close this controller's old connection and revoke private context.

Run focused synthetic tests:

```sh
pnpm --filter @workspace/amal-network exec tsx --test tests/local-cache.unit.test.ts
pnpm --filter @workspace/amal-network typecheck
```

Tests cover both 2026 Hebron DST changes (335/337-hour 14-day windows), date-only
DOB, UTC conversion, projections, scope isolation and fabrication rejection,
authorization expiry, half-open retention, rollover/coverage, atomic snapshot
rollback, stale asynchronous/in-flight writes, scoped outbox idempotency and
retry metadata, all-clinic logout with pending acknowledgement, unavailable/
quota/blocked storage, nondestructive schema upgrade, subscriptions, cross-tab
notification and persisted-revision rejection. They do not establish live
operational refresh, real-device storage reliability, or browser offline login.
The parent task owns shell integration, localization, and production browser
checks; this module does not change UI, service workers, or backend behavior.
