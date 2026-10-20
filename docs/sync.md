# Operational scheduling sync

The four authenticated routes are `/api/sync/push`, `/api/sync/pull`,
`/api/sync/conflicts`, and `/api/sync/resolve`. OpenAPI and generated Zod/React
helpers are the public DTO reference. No UI, outbox, notification, or background
sync is implemented here. All six workbook tables remain immutable.

## Authorization and supported writes

Existing session, origin, CSRF, clinic, and doctor restrictions apply. Admins
cannot book. Push and resolve additionally require a trusted device bound to the
authenticated session; a request cannot select its device or user. Reception
sessions already have this binding. Ordinary doctor sessions without that binding
can pull/read their own scheduling scope but cannot push/resolve.
Sessions and device trust are checked again inside the scheduling transaction.
Only create and update appointment operations are allowed. Cancellation is update
with `status: "cancelled"` and `expectedVersion`. Arbitrary table names, extra
fields, mutation types, and identity reassignment are rejected.

An initial request:

```json
{"operations":[{"sequence":1,"type":"create","input":{"clientOpId":"UUID","clinicId":101,"doctorId":201,"patientId":301,"startsAt":"2027-01-04T08:00:00.000Z","endsAt":"2027-01-04T08:30:00.000Z","source":"phone"}}]}
```

IDs above are illustrative, not required clinic or doctor identifiers.
Update uses `{sequence,type:"update",appointmentId,input:{clientOpId,
expectedVersion,...}}`.

## Ordering, receipts, failures and recovery

* Batch size: 1–50 operations, subject to the API's existing 32 KiB body limit.
  Sequence numbers must be positive consecutive integers in submitted order.
* Stream identity is the server-authenticated **device**, shared by its users,
  not a client timestamp, session, or submitted device string. It starts at 1.
  The next sequence is the last accepted receipt plus one. Clients must preserve
  device sequence state across sign-out. A different user cannot replay another
  user's operation; the original authorized user must resolve their conflicts.
* All writers use PostgreSQL transaction lock `761910`, including direct API
  writes, holds, push, and resolution. Overlapping batches serialize across
  processes. A later request arriving first receives `SEQUENCE_GAP` and its
  expected sequence; it does not jump the missing predecessor.
* Conservative dependency policy: **every** later operation depends on the
  predecessor. There is no automatic independent-operation bypass. A conflict
  blocks new receipts until explicit successful resolution; call follow-up does
  not unblock it. Earlier accepted successes/conflicts commit together even
  when the rest of the batch is blocked. Retrying a resolved original conflict
  still returns that original durable outcome, but no longer blocks successors.
* Invalid schema/body rejects the entire request before execution. Invalid
  references/intervals, missing targets, denied authority, reused keys and
  sequence misuse are not accepted business operations and consume no sequence.
  They produce rejected outcomes and stop this batch. Correct the rejected
  request before continuing; accepted IDs must never be repurposed.
* Accepted business failures retain their request hash and outcome. Scheduling
  conflicts (including stale revisions and expired holds) are durable conflicts.
  Unexpected exceptions roll back the whole batch. Retry the **exact** batch;
  do not infer failure from a network timeout or generate replacement IDs.

## One operation ledger and transaction boundary

Direct appointment create/update and sync dispatch use the same canonical,
sorted-key request hash, target identity, UUID `clientOpId`, actor, scope,
device, status, and persisted result. UTC instants are normalized once.
Same-authority exact retries return the recorded result; changed request,
target, actor or incompatible non-null device ownership is a typed error.
Direct operations recorded without a device can be replayed by the same actor
through an authorized device. Replays add no appointment, business audit,
conflict or feed event. A device receipt can link an existing direct result.

Business work runs in a savepoint. On expected scheduling failure the savepoint
rolls back; the outer transaction records the conflict and ledger result before
committing. A transient database failure rolls everything back. Success commits
the appointment, override audit, outcome and feed entries atomically.
No expiry, purge, conflict deletion or idempotency cleanup job is installed.
Do not remove this evidence to recover a stuck queue.
The pre-existing, explicitly confirmed whole-demo reset is the sole maintenance
exception: its dedicated database role clears child sync evidence before parent
rows and deletes the old feed. Only that role's appointment deletions suppress
tombstone generation. The application login cannot assume that role; ordinary
application deletions still generate tombstones. The operational-integrity test
exercises a populated receipt/conflict/history reset inside a rolled-back
transaction, preserving existing data.

## Conflicts and explicit decisions

`GET /sync/conflicts?status=open|resolved|all&limit=25&cursor=...` defaults to
open. Pagination uses committed first-change IDs, not timestamps. Items retain
the original proposal, target/base version, safe detection-time server state,
typed reasons, permitted references, suggestions, status/version, timestamps,
and ordered resolution history. Hold capabilities and historical call phone
values are omitted from read projections. Evidence references are reauthorized
against the current role; hidden appointments remain anonymous.

Resolve requires `clientOpId`, `conflictId`, `expectedVersion`, and `action`:

* `move-self`: explicit `startsAt`/`endsAt` for the original proposal. Existing
  targets additionally require `targetExpectedVersion`.
* `move-other`: explicit `otherAppointmentId`, `otherExpectedVersion`, and
  `startsAt`/`endsAt` for the **other** appointment. The original proposal keeps
  its proposed time. Existing original targets also require
  `targetExpectedVersion`. The other appointment must be an authorized recorded
  collision that still overlaps, not an arbitrary appointment. Both writes,
  audits, operation outcomes, resolution and feed entries commit atomically.
* `call`: returns only the currently authorized patient's phone projection and
  `called:false`. This records follow-up, not a completed telephone call, and
  leaves the scheduling conflict open.

Every accepted decision increments conflict version and records immutable
history plus a redacted audit. Exact decision retries return the original
result. Stale/concurrent decisions cannot overwrite newer decisions.
Failed fresh scheduling validation rolls both move legs back and records an
open result/history. New attempts need a new operation ID and returned version.
Doctor overlaps remain blocking. Patient overrides require explicit authorized
reasons and existing atomic audit rules. Offline hold tokens are never renewed
or treated as a guarantee during resolution.

## Pull bootstrap, continuation and privacy

`GET /sync/pull` with no `since` starts at zero in an append-only, scheduling-only
change log. Migration adds initial projections of operational appointments;
subsequent direct, sync, import and merge appointment writes are captured by
database triggers. Initial synchronization replays this log rather than using a
second mutable snapshot. Consumers upsert by entity ID in delivery order.
Cancelled status is retained, and physical operational deletion emits
`deleted:true` tombstones. Conflict creation/resolution emits scoped status and
version changes; retrieve full detail through the conflicts endpoint.

Response: `{changes:[{id,kind,entityId,payload}],nextCursor,since}`. IDs are decimal
strings to avoid JavaScript bigint rounding. `nextCursor` is non-null when
another page exists. Pass it as the next `since`. After the last page, persist
the returned `since` for the next incremental request. Even an empty page
returns a usable `since`. Never persist a cursor before applying its changes.

Feed IDs are allocated while the shared transaction lock is held through commit.
Readers take that lock too; a transaction cannot allocate a lower ID and commit
after a reader advances. Rollback gaps are harmless. Equal timestamps do not
matter. A cursor advances only to the last delivered visible change, never
past an undelivered change.

Cursors are versioned opaque HMAC-signed values, not timestamps or authority.
Their actor/session/role/clinic/doctor/device fingerprint must match current
authorization; `CURSOR_SCOPE_CHANGED` requires clearing the old private cache
and bootstrapping again. Reauthentication also requires bootstrap. Invalid or
tampered cursors fail explicitly. Client-claimed cursor scope never grants
access. Responses contain no notes, credentials or unrestricted cross-clinic
records. Logs omit bodies and queries.

## Verification and migration

Apply the additive migration only after operational/auth/appointment prerequisites:

```sh
pnpm --filter @workspace/api-server sync:migrate
pnpm --filter @workspace/api-server sync:test
pnpm --filter @workspace/api-server appointments:test
pnpm --filter @workspace/api-spec codegen
pnpm run typecheck
```

The post-merge script includes this migration. Tests use isolated synthetic
operational fixtures, never seed writes, and check seed data/schema unchanged.
They cover concurrency, retries, lost-response persistence, version conflicts,
atomic decisions, revalidation failure, cursor scope, commit ordering and DST.
