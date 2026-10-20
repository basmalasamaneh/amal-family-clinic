# Auto-sync and conflict recovery

The existing Amal shell owns the runner's lifetime. Only a verified online
identity may deliver; a bounded offline permit may read/save locally but cannot
authorize a reconnect. Reconnect reloads identity before restarting delivery.

## Delivery and retention

`src/sync/runner.ts` serializes every pass and resolution under a browser Web Lock
keyed by the authenticated device. Snapshot refresh uses the same lock. A crashed
tab releases ownership; a surviving owner retries the frozen operation ID and
payload. Browsers without Web Locks report unavailable rather than racing.

Startup, enqueue, visibility return, explicit retry and periodic refresh initiate
delivery. Transient failures use exponential delays capped at 60 seconds.
Only explicit, runtime-validated per-operation acknowledgements change outcomes.
One-operation pushes deliberately avoid inferring success for an omitted batch
member. Original receipts, rejected proposals and resolution intents are retained.

The server currently treats every later device operation as dependent. Thus the
three-booking demo must introduce the conflict at sequence three. A conflict at
sequence one or two leaves successors blocked, not lost or automatically bypassed.

Pull pages and their cursors commit in one scoped IndexedDB transaction.
Tombstones survive bootstrap; a stale canonical proposal cannot resurrect a
deleted calendar card. Full conflict details reconcile explicit resolution history,
including decisions made elsewhere. Empty responses never acknowledge bookings.

Logout, expiry and context changes abort requests, invalidate asynchronous results,
and hide private snapshots. The existing prerequisite intentionally invalidates
other tabs on reauthorization, even for the same account. A new tab must verify its
own authorization before taking over; no lock or broadcast grants access.

## Decisions

`/desk/sync` keeps the queue, acknowledged evidence, unresolved proposals, reasons
and decision history visible. Move-self requires an explicit server suggestion.
Move-other reads the referenced authorized appointment, requires an explicit
Asia/Hebron destination and confirms both changes before one atomic API request.
Call is follow-up only: the returned phone is ephemeral, sanitized for an optional
tel link, never persisted in IndexedDB, and never treated as scheduling resolution.

Decisions are durably saved before sending with an ID distinct from the booking.
Unknown responses keep that exact intent for retry. Explicit validation/version
rejections retire the intent without deleting the proposal or history. New actions
are blocked while a decision has an unknown outcome.

## Reproducible demo (requires authorized synthetic reception session)

1. Use an isolated test clinic and trusted reception device, with three existing
   clinic-local patients and an authorized doctor; do not modify workbook seeds.
2. Open the calendar online and prepare its cache. Choose three separate future
   slots within coverage, in Asia/Hebron local time.
3. Disconnect the browser and create the three bookings. Record their client IDs
   from the read-only IndexedDB evidence; never rewrite the outbox.
4. From a separate authorized server session create a competing operational
   appointment for the third slot.
5. Reconnect and let identity verification and automatic delivery finish. Open
   Sync: two original IDs must be acknowledged, one must need resolution.
6. Reload. Verify the same three proposals, exactly two canonical bookings, one
   open conflict and no duplicate calendar cards.
7. Choose Call patient. Verify follow-up history, optional phone link and conflict
   still open. Dismiss/reload; the proposal must remain available.
8. Explicitly choose a suggested slot and confirm Move this appointment. Verify
   one successful resolution and one additional canonical booking.
9. For a separate conflict, choose Keep this one and move the other, enter a valid
   destination and confirm both changes. Reuse a stale version in a competing
   test session to verify a rejection retains safe refreshed conflict information.

Use Arabic/English and Light/Dark preferences; inspect keyboard focus, live
announcements and textual state labels. These are test instructions, not a claim
that the authenticated browser journey passed.

## Verification evidence

- Client storage, reconciliation, runner and UI helper suites: 70 passing tests.
  Transport cases are **mocks**, using real Dexie/fake-indexeddb, not live API proof.
- `pnpm --filter @workspace/api-server sync:test`: 19 passing **live HTTP/PostgreSQL**
  tests, synthetic operational fixtures, seed/schema preservation checked.
- `pnpm run typecheck`: passed across the workspace.
- The real Playwright demo passed against the development API: two applied/one
  conflict on reconnect, stable IDs after reload, all three conflict actions,
  stale server rejection, keyboard confirmation, Arabic/English and Light/Dark,
  and four zero-violation sync-page axe scans. See
  [auto-sync-live.md](auto-sync-live.md) for exact evidence and limitations.
  Offline enqueue uses the existing application command programmatically, not
  direct IndexedDB writes; this is not booking-form interaction coverage.

Commands:

```sh
pnpm --filter @workspace/amal-network exec tsx --test \
  tests/local-cache.unit.test.ts tests/local-booking.unit.test.ts \
  tests/local-sync.unit.test.ts tests/sync.unit.test.ts tests/sync-runner.unit.test.ts
pnpm --filter @workspace/api-server sync:test
pnpm run typecheck
```
