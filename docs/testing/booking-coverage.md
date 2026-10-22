# Booking regression coverage

## Contract and commands

The supported **real production drawer is local-first**, online as well as offline.
Closing the drawer acknowledges an application-created IndexedDB proposal/outbox
transaction; it does **not** assert a server appointment exists. A matching applied
sync outcome supplies the canonical appointment. This audit does not change that
workflow to satisfy obsolete server-preview UI expectations.

The root `playwright.audit-booking.config.ts` now selects, by default:

- `artifacts/amal-network/tests/booking-live/local-first.spec.ts`: two focused
  journeys (online with delivery blocked before the real server, and genuinely
  offline), each in Arabic/English × light/dark.
- `artifacts/amal-network/tests/booking-live/local-first-lifecycle.spec.ts`:
  three canonical edit/cancellation keyboard journeys in the same four
  combinations; targeted execution passed 12/12 (see below).
- `tests/offline/journey.spec.ts`: the existing live three-booking outage,
  lost-committed-response, exact retry, conflict and explicit move journey,
  unchanged, in the same four combinations.

This is **24 planned cases**, serial on one worker, no retries, with a 15-minute
global bound. It reuses the disposable real receptionist/session/device fixtures,
production PWA build, isolated real API and read-only IndexedDB evidence helper.
Tomorrow in Asia/Hebron is inside the permitted rolling cache; no 2030 dates or
clock changes are used by the new production UI cases. Browser timezone remains
America/New_York to detect accidental browser-zone conversion.

Coordinator commands (not run as part of this implementation):

```sh
AMAL_OFFLINE_E2E=1 AMAL_BOOKING_DISPOSABLE=1 pnpm exec playwright test --config playwright.audit-booking.config.ts

# Deliberately retained legacy contract, not silently skipped or expected-failed:
AMAL_OFFLINE_E2E=1 AMAL_BOOKING_DISPOSABLE=1 AMAL_BOOKING_AUDIT_SUITE=legacy-server-preview pnpm exec playwright test --config playwright.audit-booking.config.ts
```

Both require the existing disposable development database/prerequisites.
The explicit legacy mode still runs all six original tests, unchanged, across
four combinations. It is **not expected to pass against the local-first drawer**:
it waits for direct POST/check/hold UI behavior and uses dates outside the cache.
Its separate report path and project-name prefix prevent these results being
confused with supported UI evidence. `pnpm test:booking` likewise remains the
explicit original legacy suite; no test is deleted, skipped or marked expected
failure. An invalid audit-suite selector throws an error.

## Implemented production UI checks

Both new journeys assert the real adapter and absence of fixture banners,
distinct same-name identity evidence with explicit patient selection, malformed
cross-midnight interval rejection without persistence, real local validation,
mobile drawer bounds, keyboard focus trapping in both directions, and zero axe
violations at confirmation. They assert local/no-hold messaging and absence of an
active hold.

Two same-turn confirmation activations must produce exactly one negative local
ID, operation ID, proposal, outbox entry and sequence. The provisional card is
disabled and visibly waiting to sync. Independent authorized server reads and
receipt queries must still be empty at this point. In online mode the real
`/sync/push` transport attempts are aborted **before dispatch** until assertions
finish, not fulfilled or faked. Leaving a request pending would retain the
product's shared queue/cache lock and stall online calendar refresh. Browser
connectivity remains online and normal reads continue; later automatic retry is
allowed through to the real API. In
offline mode actual browser networking is disabled. No API success or operational
write is mocked.

Offline additionally proves an overlapping draft is locally blocked without
changing the pending records, and a service-worker-served offline reload plus an
uncached failed network probe retains the exact durable records and provisional
card before delivery. On reconnection/allowing delivery, both modes require an applied
outcome, one canonical row, one real receipt, no conflicts/history, succeeded
outbox, stable operation identity, and canonical UI replacement surviving reload
without duplicate cards or rows. Remote checks, holds, availability calls and
direct appointment writes from these UI journeys are forbidden.

The reused offline live journey adds three ordered proposals, a real competing
appointment written by a second session, server commit with response loss, exact
payload retry without duplicate receipts, retained unresolved conflict after
reload, and an explicitly confirmed move with one resolution history entry.

All fixtures keep their original production/deployment refusal, real fixture
role, scoped cleanup and immutable public seed row/schema fingerprints. New
tests also assert the seed fingerprint before teardown. Scoped fixture cleanup
joins the existing appointment/sync advisory transaction lock after closing
clients, so already-executing server writes cannot race child/device deletion;
operation cleanup also explicitly includes owned devices. No new fixture records
are written directly to IndexedDB; no authorization role is fabricated.
Authenticated trace/video/screenshots remain disabled.

## Original server-preview assertion mapping (not replacement UI claims)

Paths below are relative to `artifacts/api-server/tests/`. They identify actual
existing API/engine tests, not newly claimed results. API tests require their own
coordinated run; inclusion in this table does not mean the browser audit ran them.
The original browser files remain available for explicit legacy execution.
The patient-overlap case has since been updated to the strict blocking policy:
no acknowledgement/reason controls, no booking and no new override audit.
The historical warning/override evidence below does not describe current policy,
and is not new browser verification of this change.

| Original `booking-live` test / guarantees | Actual server coverage retained | Supported UI coverage / honest limitation |
| --- | --- | --- |
| `lifecycle`: “book explicit same-name identity, repeat submission, reload, edit and reject blocked edit” — 201 create, correct UTC/patient, one operation, identity-preserving 45-minute edit, self-exclusion and non-mutating blocked move | `appointments-api.test.ts`: “simultaneous doctor-overlap commits serialize; same op retries preserve response”; “rescheduling excludes itself, preserves identity, and atomically rejects competing moves”; “moves use expectedVersion; cancellation keeps history/reason; update and cancel replay exactly”. `sync-api.test.ts`: “sequence gaps are recoverable; dependent updates/cancellation preserve declared order”; “simultaneous retries and direct/sync cross-endpoint retries share one ledger”. | New cases cover explicit same-name selection, UTC instant, duplicate activation, local acknowledgement, canonical persistence/reload. Edit drawer persistence, blocked-edit conflict DOM and focus restoration remain in the explicit legacy suite; not claimed covered by new booking cases. |
| `lifecycle`: “cancel confirmation, pending Undo without write, expiry exactly once, released slot” — no PATCH before deadline/Undo; exactly one cancellation; status retained; rebooking releases occupancy | `appointments-api.test.ts`: “moves use expectedVersion; cancellation keeps history/reason; update and cancel replay exactly”. `appointments-engine.test.ts`: “only booked and double_booked reserve time; all historical/cancelled statuses release”. `sync-api.test.ts`: ordered dependent updates/cancellation test above. Also `tests/unit/cancellation.test.ts` (root): deadline, Undo, duplicate clicks, retries, ended sessions. | New create journeys do not claim cancellation confirmation, exact ten-second boundary, Undo keyboard interaction, or UI rebooking coverage. Original assertions retained; server/unit coverage is not a substitute for rendered cancellation UI evidence. |
| `lifecycle`: “mobile RTL/LTR keyboard drawer, validation and timezone boundary states” — bounds, axe, trap, spring-gap rejection, summer UTC persistence/edit round-trip | `sync-api.test.ts`: “UTC intervals survive the Hebron DST boundary without a second timezone conversion”. `appointments-engine.test.ts`: “Asia/Hebron opening instants follow its actual seasonal offset”; “Asia/Hebron spring gap preserves elapsed duration and never suggests the skipped 02:00 hour”; “Asia/Hebron fall-back retains both repeated-hour UTC slots and full local interval limits”. | New cases retain 390px bounds, bidirectional trap, axe and interval rejection, real IANA conversion under a New York browser, all locales/themes. Historical DST-gap/summer edit UI round-trips are not driven outside the permitted cache; their original assertions stay explicit legacy coverage. |
| `collisions`: “doctor collision blocks without persistence; server alternative is rechecked and persisted” — read-only check, blocking/no override, untouched cancelled draft, nearest suggested interval persisted | `appointments-api.test.ts`: “check is exact and read-only; strict UTC, reversed intervals and malformed reference”; simultaneous doctor-overlap commits test above. `appointments-engine.test.ts`: “suggestions are nearest eligible instants; equal distances use earlier UTC”; “suggestions honor duration, doctor bookings across clinics and patient overlaps”. `sync-api.test.ts`: “reloaded conflicts recompute alternatives from current bookings, holds and network authority without changing evidence”. | New offline case checks local doctor overlap without mutation (local error, not fabricated server conflict dialog). Reused live offline journey checks actual server conflict plus explicit non-overlapping alternative and canonical persistence. No claim that the local drawer calls `/appointments/check` or displays server-preview suggestions. |
| Historical `collisions` patient-warning/override case (superseded): acknowledgement, nonblank reason and atomic override audit | Historical API/engine/sync override tests documented the former policy; existing audit evidence remains historical, not prevention telemetry. Current tests enforce strict blocking regardless of authorization/reason. | The current `collisions` case asserts blocking/no controls/no persistence and retains mobile keyboard/axe checks. It has not been rerun as part of the strict-policy frontend unit/typecheck change. No role is elevated and no server preview is fabricated in the local drawer. |
| `collisions`: “two isolated real sessions race at commit: one winner, one rejection retaining inputs” — independent credentials/devices, reusable exact-owner holds, one 201/one 409, one row and retained rejected draft | `appointments-api.test.ts`: simultaneous doctor-overlap commits test; “holds serialize, exact owner+interval required, retries do not extend and consumption is atomic”; “simultaneous hold acquisition has one committed owner and prevents an unheld booking”. `sync-api.test.ts`: durable conflict/replay tests “direct-first and sync-first conflicts replay the same durable outcome across endpoints”; “partial success persists conflict after business rollback and blocks later dependent operations”; “expired offline holds do not guarantee a slot; explicit resolution discards the stale token”. | Reused offline journey preserves independent real sessions, actual winning competitor, durable rejected proposal inputs, single rows/receipts and explicit resolution. Local acknowledgement of a losing proposal is allowed; it is not misreported as a synchronous 409 drawer rejection. Original retained-input DOM/hold assertions remain explicit legacy only. |

## Canonical edit/cancel/Undo audit extension

The new `local-first-lifecycle.spec.ts` uses the existing disposable
`audit:booking` configuration and unchanged real receptionist fixtures. Each
target is created through the supported local-first production drawer for
tomorrow in Asia/Hebron, then requires a matching **applied** proposal, succeeded
outbox, real server row and receipt before canonical actions become available.
No route interception, mocked successful writes, fixture-adapter fallback,
IndexedDB writes, skipped tests or expected failures are introduced. The approved
bounded production focus fixes are described below. Canonical edit/cancel legitimately use their existing direct PATCH
API; this is not an assertion that creation uses that contract.

| Original lifecycle guarantee | New rendered production assertion | Status / remaining gap |
| --- | --- | --- |
| Identity-preserving edit, self-exclusion, reload, blocked edit | A real UI-created second canonical booking blocks a proposed move; a self-overlapping duration extension first succeeds with one PATCH despite duplicate activation. Server version, patient/doctor/clinic/source, UTC interval and reload round-trip are checked. Blocked move leaves both server rows, proposal/outbox records and sync receipts unchanged. | Passed in all four combinations. No generalized edit authorization/race or DST-transition UI claim. |
| Keyboard drawer/conflict interaction and restoration | At 390px, bidirectional focus trap and visible focus indicator, bounds, keyboard card/edit activation, editor Escape, save and close restoration to the original card; blocked conflict dialog Escape restores its review trigger. Zero-violation axe scans run with normal timers. | Passed across Arabic/English × light/dark after the bounded edit-save focus fix. |
| Confirmation, pending Undo, no write | Separate running-timer case scans confirmation and pending cancellation, checks nonempty status announcement, keyboard Escape restores the card, and keyboard Undo removes the notice without a PATCH or durable mutation. Undo must restore focus to the original card. | Source concern confirmed by an actual rendered failure; assertion retained unchanged. Passed in all four combinations after the approved focus-only fix. |
| Exact deadline and released occupancy | A separate no-axe controlled-clock case proves zero PATCH at 9999ms, keyboard Undo winning before expiry, then a fresh cancellation with zero PATCH at 9999ms and one real 200 PATCH at 10000ms. Another 10000ms does not duplicate it. Cancelled row retains identity/interval and increments version. Reload and a fresh local-first booking applied to the exact released interval prove occupancy release. | Passed in all four combinations. Clock installed before store capture; resumed and resynchronized to wall time before reload/rebooking. Server time and outcomes are never faked. |

The earlier mapping table's edit/cancel limitations describe the previously run
create-only journeys. The additional assertions are now targeted passing evidence,
not a claim that the complete default suite was rerun. The original legacy files
remain unchanged. A focused coordinator command is:

```sh
pnpm --filter @workspace/api-server exec tsx tests/privacy/local.ts audit:booking --grep 'canonical (edit|cancellation):'
```

That selector targets 12 added cases; the default suite plans 24 total.

On coordinator authorization, the initial `--grep canonical` attempt exposed a
test-navigation mistake: closing the routed create drawer returns to today's
calendar, rather than preserving tomorrow's selection. The test now selects its
target day through the real date control, matching the existing create journey;
no production navigation was changed. That interrupted run is not passing evidence.
A bounded Arabic/light run then confirmed two real failures: Undo unmounted its
focused button without restoring focus, and successful edit reload unmounted the
card before the previous single-animation-frame restoration ran. The exact
deadline/rebooking case already passed.

After reading the React/Vite skill, the approved `CancellationProvider.tsx`
focus-only fix requests card focus after successful Undo and waits through the
existing calendar loading state when restoring edit focus, using the provider's
existing ticker. It retains the page-title fallback if the card no longer exists.
Cancellation scheduling/deadlines, payloads, server outcomes and booking semantics
are unchanged. The two failed Arabic/light cases passed on focused retest.

The final authorized command with `--grep canonical` passed **12/12 in 110 seconds**,
with zero skips, retries/flaky cases or unexpected outcomes. All 12 seed-integrity
attachments report committed scoped cleanup, closed contexts and identical
before/after fingerprints. The latest JSON report contains these 12 added cases
only, not a fresh 24-case all-green default report. Harness and frontend TypeScript
checks and `git diff --check` passed. No broader browser suite or workflow
start/restart was performed. A mobile public-preview screenshot showed the intact
sign-in page; authenticated UI verification comes from the real targeted tests,
not that screenshot. Previous discovery and online results below predate this
extension.

## Verification status and remaining gaps

Implementation passed harness TypeScript checking and standalone audit-config
TypeScript checking. Playwright discovery-only (`--list`) confirmed 12 default
cases and 24 explicit legacy cases.

The coordinator's initial browser run reported eight passing offline cases and
four online failures: holding push open also held the product's queue/cache lock,
so the calendar remained loading. The approved focused follow-up replaced that
test gate with pre-dispatch transport aborts and synchronized fixture cleanup
with existing server transactions. The disposable targeted command
`pnpm --filter @workspace/api-server exec tsx tests/privacy/local.ts audit:booking --grep ' online:'`
then passed **4/4 online cases** (56 seconds total). All four seed-integrity
attachments report committed cleanup, closed contexts and identical before/after
fingerprints. No production changes were made. The requested literal
`--grep '^online'` first selected zero tests because Playwright matches the
project/file-qualified title; the revised selector ran only the four online cases.

The eight offline cases were not rerun after this fixture change. The latest
JSON report contains only the targeted four cases; this is not a fresh 12-case
all-green report. Separately mapped appointments/sync API suites still require
their own coordinator verification. Existing mocked-API
`tests/offline-booking.spec.ts` remains supplemental integration coverage, not
evidence of live API writes.

This is deliberately bounded, not an exhaustive rescheduling/cancellation,
cross-clinic authorization, patient-warning/override or DST UI audit. See the
per-row limitations above. Legacy server-preview UI failures should be reported
as contract mismatch, not hidden as skips, rewritten into weaker checks or used
to justify production workflow changes.
