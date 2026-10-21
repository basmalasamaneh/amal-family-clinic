# Cancellation waitlist integration contract

## API and authorization

All four routes use refreshed session/device authority inside the scheduling
transaction. Only reception (`front-desk`) may use them. Clinic is always the
refreshed actor's assigned clinic, never a request field. Responses are
`private, no-store`; unknown/cross-clinic offer IDs return the same 404. The API
does not expose a network queue or broaden doctor/administrator access.

- `GET /api/waitlist` takes **no query parameters** and returns
  `{ entries, offers, opportunities, serverNow }`.
- `POST /api/waitlist/entries` accepts
  `{ clientOpId, patientId, doctorId, weekdays, windowStart, windowEnd }`.
  An explicitly authorized patient ID and a same-clinic doctor ID are required.
  Weekdays are distinct numbers, Sunday=0. The nonempty HH:mm window is
  same-day, non-overnight. It returns an entry with status 201.
- `POST /api/waitlist/offers/:id/check` accepts `{}` and returns the existing
  conflict preview, **exactly `{ ok, conflicts }`**.
- `POST /api/waitlist/offers/:id/decision` accepts
  `{ clientOpId, decision: "accept" | "decline", overrideReason? }` and returns
  the authoritative offer. A terminal response is not necessarily an acceptance:
  clients must inspect `status` and `appointmentId`.

All wire instants are UTC ISO strings, including generated-validator responses.
Validation does not replace the wire payload with Zod-coerced `Date` objects.
Writes require the existing CSRF and online session/device checks. Do not put
offer decisions into the offline booking outbox or display offline success.
Client caches must remain clinic/session-scoped and be cleared on switching.

## Cancellation hook, ordering and decisions

`appointments/service.ts:updateAppointment` is the sole cancellation integration
point, shared by direct PATCH, sync push and conflict resolution. Only a real
`booked|double_booked -> cancelled` revision creates an opportunity. It captures
the **original** interval, source appointment, committed cancellation version and
client operation UUID. Cancel-and-move uses the original interval too. The hook
and booking receipt commit or roll back together; retries cannot issue another
opportunity. Neither migration nor worker scans historical cancelled appointments.
Deferred cancellation undo therefore creates nothing before server commitment.

The lock order is shared reset admission **761930**, then scheduling **761910**,
then rows. Normal appointment transactions, waitlist actions and workers use
this order. Actor authority and time are refreshed after acquiring the lock.
Reset uses its existing exclusive admission lock; only the actual
`amal_demo_reset` role can delete transition history. Ordinary runtime has no
delete/update permission for receipts/history, and history rejects truncate.

FIFO is server `requested_at, id`, after filtering clinic, doctor, active entry,
patient authorization, entire local weekday/window and already-attempted entries.
The matcher uses `date-fns-tz` with Asia/Hebron and inspects every elapsed minute
and the final millisecond, including DST repeated/gap boundaries. Preferences are
wall-clock recurrences, not fixed UTC offsets. Past, occupied, held or invalid
slots become unavailable; patient-specific warnings do **not** exclude a
candidate.

Each entry and opportunity can have only one active offer, enforced by partial
unique indexes. A candidate is never offered the same opportunity twice.
Declined/expired entries retain original queue age for later opportunities.
Fulfilled entries leave the queue. If matching entries are temporarily offered
elsewhere, an opportunity remains open; otherwise no candidate is `exhausted`.
New entries do not reopen already-exhausted opportunities.

Offers expire 15 elapsed minutes after their actual server creation time, or
become unavailable at appointment start. **An offer is not a reservation or a
15-minute hold.** Existing 30-second booking holds are unchanged. Acceptance
rechecks time and invokes the existing `createAppointment` with its shared
transaction context, normal engine, booking receipt, holds and reminder lifecycle.
Only a nonblank explicit `overrideReason` acknowledges a patient-overlap warning;
the existing booking audit records that override. Doctor conflicts cannot be
overridden. Accepted/declined/expired/unavailable outcomes are terminal.

Creation/decision UUIDs replay the original result for that actor/device/clinic
and exact payload. Changed payloads return `IDEMPOTENCY_CONFLICT`. A conflict
decision retains both waitlist failure identity and the normal protected
appointment/sync conflict evidence in the committed transaction before returning
409. After resolving the warning or slot issue, use a **new** client operation
UUID for a different decision payload. Terminal stale/late decisions never book.

## Durable processing and simulated messages

`startWaitlistWorker` is integrated into the API index and stopped on server close.
It reconciles immediately on startup and every 15 seconds, sequentially. Its
state is PostgreSQL opportunities/offers, not timers or browser memory. Failed
ticks log a non-sensitive unavailable code and retry; they never migrate.
List/check/decision and cancellation also reconcile current clinic state.
Multiple processes serialize through the same lock. Fresh production time is
read per opportunity and immediately before issuing each offer, so recovery
cannot emit a burst of offers with already-consumed lifetimes. The exported
`processWaitlist({ now })` clock override is for isolated tests only, never HTTP.

Exactly one `operational.notifications` row is created per offer. Delivery uses
the existing simulator, with `waitlist:<offerId>` identity and a fixed bilingual
template containing only fixed text and configuration-derived clinic/date/time.
No live provider or patient address is used. Clinic disablement and patient opt-out
produce a visible `notificationStatus: "suppressed"` with `clinic_disabled` or
`patient_opt_out`, without a fake send. Internally these rows reuse cancelled
notification status and its explicit cancellation reason, not a new enum.
Terminal outcomes cancel any still-pending notification. Simulated receipts and
offer creation commit atomically; a retry cannot create another simulated row.
Successful acceptance schedules the ordinary booking reminders exactly once.

Messages Log includes waitlist messages only for **refreshed reception**, not
administrators, even administrators assigned to that clinic. Its existing safe
projection contains no patient IDs, names, clinical text or new links.
Waitlist audit actions are not added to network administrator audit allowlists.
Operational append-only transitions and audit rows retain system/actor identity,
clinic, related IDs, timestamp and reason.

## Migration and verification

Development only:

```sh
pnpm --filter @workspace/api-server waitlist:migrate
pnpm --filter @workspace/api-server waitlist:test
pnpm --filter @workspace/db exec tsc --noEmit
pnpm --filter @workspace/api-server typecheck
```

Migration 0017 adds operational tables/notification linkage only, without any
seed-table schema/data/grant changes. The migration runner refuses deployment,
checks an immutable checksum receipt, and fingerprints all six seeds'
schema/content/protections before and after in the same transaction.

Tests clone the existing prerequisite database into a disposable private
PostgreSQL cluster, apply 0017 **there only**, and use newly inserted isolated
operational clinics/patients/doctors/sessions/devices. They cover FIFO/filtering,
original-interval cancellation, direct/sync replay and rejection, concurrency,
accept/expiry/independent booking races, patient overrides and durable evidence,
rollback/recovery, notifications/privacy, API/CSRF/clinic isolation and seed
fingerprints. They do not mutate the source database, run deployment, test UI
accessibility, or prove a physical browser's offline/undo journey.

## Development verification evidence

- Backend waitlist suite: 17 passing tests using disposable PostgreSQL fixtures,
  including races, FIFO, recovery, suppression, sync replay, merge boundaries and
  privileged reset cleanup.
- Frontend waitlist unit suite: 12 passing tests; existing booking, shell,
  reminder and polish suites also pass. Existing cancellation-store suite:
  six passing tests for deferred cancellation/Undo behavior.
- Waitlist contract examples and invalid-input checks: two passing tests via
  `node --test lib/api-spec/waitlist-contract.test.mjs`.
- OpenAPI code generation and full workspace `pnpm run typecheck` pass.
  Full `pnpm --filter @workspace/api-spec validate` remains blocked by the
  pre-existing `/reminders/log` security/role metadata mismatch; the new
  waitlist operations validate independently.
- Both development migrations verified unchanged six-table seed fingerprints.
  API and web workflows restarted successfully.
- Signed-in browser verified explicit patient selection, cancellation → simulated
  offer → conflict-free acceptance, reload persistence, ordinary reminders,
  decline with queue retention, opt-out suppression, and the booking shortcut.
  Arabic RTL/English, Light/Dark, 390px mobile layout and visible keyboard focus
  were inspected.
- Offline decision controls were checked using the browser's offline signal,
  not a disconnected transport. Shared committed sync cancellation and replay
  were exercised against the database. The physical calendar Undo journey was
  not browser-tested: synthetic appointment dates were outside the local
  calendar's coverage. No axe scan was available in that browser session.

Manual browser API mutations must include `X-Amal-Demo-Generation` from
`GET /api/demo/context` in addition to CSRF while Developer Tools is enabled,
just as the normal generated client's custom fetch does. A missing generation
header correctly returns `DEMO_RESET_REQUIRED`; it is not an instruction to
reset the database.

Only synthetic operational fixtures were added for the live browser check.
No seed rows, real communication providers, or publication were involved.
