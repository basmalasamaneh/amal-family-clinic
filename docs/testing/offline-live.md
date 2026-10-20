# Live offline booking E2E

Run from the workspace root against a **disposable development database** with
the existing operational, authentication, scheduling and sync migrations already
installed, the restricted API runtime role configured, and all six imported seed
tables present:

```sh
AMAL_OFFLINE_E2E=1 AMAL_BOOKING_DISPOSABLE=1 pnpm test:offline
# Repeatability check: eight journeys, fresh fixture scope for each.
AMAL_OFFLINE_E2E=1 AMAL_BOOKING_DISPOSABLE=1 pnpm test:offline --repeat-each=2
pnpm run typecheck:harness
```

Uses existing `DATABASE_URL` and runtime configuration without printing them.
Missing prerequisites fail; tests never skip or run migrations/demo resets.
Do not point this at production. Both opt-ins are required. Port 4189 must be
free; the finite command owns and stops its server. Default global timeout is
10 minutes, each case 2 minutes, no retries of failed tests.
`HARNESS_CHROMIUM_PATH` can select a compatible browser; Replit defaults to the
Nix-wrapped Chromium.

## What executes

- Reuses the P3-02 time helpers and live booking authentication/operational fixture
  harness. Fixture-generated clinic/doctor/patient IDs are discovered at setup.
- Builds the actual production PWA into `dist/pwa-verification`, then serves it
  alongside the **unmodified real Express API** in a loopback-only test host.
  No Canvas, shell fixtures, synthetic successful API responses, direct IndexedDB
  writes, or disabled service worker.
- Every Arabic RTL / English LTR × Light / Dark case completes the whole journey.
  Browser timezone is America/New_York; future slot assertions use Asia/Hebron
  through date-fns-tz, not host offsets.
- Genuine offline browser state, three bookings through the real drawer, stable
  local/operation identities, pending cards and service-worker-backed offline
  reload. An uncached request proves the network is still unavailable.
- A separate authenticated context creates the sole competitor using the real
  API while the browser remains offline. Exact fixture-scoped API sets are empty
  initially and contain only that competitor before reconnect.
- Reconnect automatically starts sync. The first push commits through
  `route.fetch()`; its response is held until independent database receipts and
  authoritative appointment reads verify the commit. It is then aborted. The
  actual runner retries automatically; the two HTTP bodies must be identical,
  including client operation identity and payload, and the canonical ID and
  payload hash remain unchanged. API interception must occur or the test fails.
  The product worker does not intercept API requests.
- The runner sends one operation at a time. Following retry, exactly two proposals
  are acknowledged and one durable conflict remains. Navigation/reload retains
  all original identities and the same conflict. The UI selects a suggested slot,
  opens “Move this appointment” confirmation and confirms it explicitly.
- Final local canonical records exactly equal the three proposals plus the
  unchanged competitor in the real API: four appointments, one retained resolved
  conflict and one resolution-history row. Reload and calendar UI agree.

## Safety and diagnostics

Only isolated `operational` records are created/deleted. Existing seed tables are
read-only throughout. Content and column-schema fingerprints of all six seed
tables are compared before/after, including failure cleanup. No calendar export
is imported or linked.

Cleanup restores networking, closes clients before scoped SQL deletion, and
removes sync receipts/conflicts/history before their parent operations. The
existing audit cleanup role is used only for this fixture's audit rows, never for
a broad reset.

Reports live under ignored `generated-artifacts/offline-live`. Traces, screenshots
and videos are off; the automatic private-DOM error context is disabled.
Failure attachments contain fixed UI state IDs, phase, network-state transitions,
counts and seed hashes, never cookies, CSRF tokens, headers or private DOM text.
Assertion diffs can contain only this suite's synthetic operational records.

Chromium can report online after a service-worker navigation while requests still
fail offline. The test verifies the failed uncached probe and reapplies CDP offline
emulation, without changing navigator or product authorization. The CDP session
is detached before context reconnect to avoid competing network emulators.

## Verification

The four locale/theme combinations passed twice each with fresh fixtures
(8/8 journeys), and `pnpm run typecheck` passed across the workspace.
The build emits existing chunk-size/dynamic-import warnings; these do not skip
any journeys.
