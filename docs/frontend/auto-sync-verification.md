# Auto-sync no-loss browser verification

> Historical Stagehand attempt below. The offline-toggle limitation was
> subsequently covered by the passing real Playwright demo in
> [auto-sync-live.md](auto-sync-live.md): three-booking reconnect/reload, all three
> conflict actions, stale server rejection, four locale/theme combinations,
> keyboard confirmation and four zero-violation scoped axe scans.

## Status

**Live browser journey pending: the authorized cache is ready, but this Stagehand
environment cannot simulate a real browser-network outage.**

After the development origin and clock-skew fixes, the supported reception PIN
flow navigated to `/desk/sync`. After a single 1.15-second wait, the app stored
its signed permit, reported “synced with server,” and no longer showed the
private-record lock. The first profile opened the booking drawer; it showed
real cache coverage spanning the selected future date and found a synthetic
patient in the app-backed cache. A second independent profile also authenticated
and stored its permit. No booking was saved in either profile.

The earlier blocker was precisely `issuedAt <= browser Date.now()`: the server
permit was 185 ms ahead of the browser clock, while every other signature,
claim, epoch, expiry, lifetime, and WebCrypto predicate passed. In this retry,
the app's one-second wait followed by its strict verifier succeeded; no
tolerance or expiry extension was added.

Stagehand v4 exposes no supported context/network-offline toggle. I did not
fake `navigator.onLine`, intercept requests, or create online bookings in place
of an outage. Therefore the three offline proposals, server competitor,
reconnect/reload checks, and conflict resolution remain pending. No sync-feed
actor-ID behavior was exercised.

No booking, conflict, resolution, or reload-persistence steps below are
represented as completed. The real sync API was not mocked. Each synthetic
operational fixture was removed in scoped cleanup, and fingerprints of the six
public seed tables were unchanged. The booking-live disposable-database guard
was not bypassed.

## Safety requirements

- Use a development database whose isolation has been verified before setup.
  Refuse production/deployment markers. Do not use the booking-live fixture
  unless its `AMAL_BOOKING_DISPOSABLE=1` guard is legitimately satisfied.
- Never run a blanket operational reset. Use only unique, additive synthetic
  operational rows and a cleanup allowlist scoped to the generated IDs.
- Fingerprint `public.clinics`, `public.doctors`, `public.patients`,
  `public.appointments`, `public.patient_visit_history`, and
  `public.calendar_app_export` before setup and after cleanup. Require exact
  equality.
- Keep generated session, device, CSRF, and PIN values in the private test
  harness only. Do not place them in logs, screenshots, traces, demo
  instructions, or reports. Do not use real patient payloads.
- Do not fabricate API responses or mutate IndexedDB to impersonate a prepared
  cache. Use the app's signed permit and its normal cache path.

## Additive browser fixture

Use the setup pattern in `artifacts/api-server/tests/sync-api.test.ts`:

1. Generate a unique run marker and insert one synthetic operational clinic in
   `Asia/Hebron`, one doctor, four synthetic patients, patient-clinic access
   rows, one receptionist, and two distinct trusted devices.
2. Store only digests of generated device and session credentials in
   `operational.auth_devices` and `operational.auth_sessions`. Give the
   receptionist two session/device pairs so the competitor can use a separate
   authenticated browser context. Set a recent PIN-verification timestamp for
   test sessions where reauthentication is required.
3. Add only generated cookies to the matching browser profiles, or sign in
   through the registered-device PIN UI. Use the actual app origin and real
   APIs. Confirm `/api/me` identifies the synthetic front-desk role and clinic.
4. Before proceeding, require the app to retain a valid server-signed offline
   permit and show unlocked private records. Confirm complete cache coverage
   for the planned future appointment window. If login, permit verification, or
   cache authorization fails, stop before creating offline work.

The currently observed blocker is a useful stop condition: a successful API
permit response alone is insufficient if the client still says private
records are locked.

## Primary no-loss journey

Once the authorization/cache preconditions pass:

1. Choose a future date inside the prepared cache coverage. Create three
   distinct, non-overlapping local bookings at future Asia/Hebron times. Save
   the three client operation identities from safe test-harness state; do not
   log payloads or credentials.
2. Confirm all three appear as pending locally. Take the browser offline only
   after the authorized cache is ready.
3. In the separate authenticated browser context, create a real server booking
   that competes for the third local booking's doctor/time slot. Verify that
   the competitor is returned by a real API read.
4. Reconnect and wait for the app's automatic sync. Verify through the UI and
   real API that the first two operation identities were applied exactly once,
   the third is a conflict, and none disappeared.
5. Reload the app and verify the same three local operation identities remain
   represented: two canonical applied bookings and the retained conflict.
6. Record the conflict's “call patient” action. Verify it records follow-up
   only: conflict remains open, no call is claimed, and no appointment moves.
7. Choose the server-suggested “move self” slot. Verify it is rechecked against
   the real server, resolves the conflict, retains original proposal/history,
   and leaves the two already-applied bookings unchanged.

## Optional second conflict

If the primary journey passes, create a second independent collision. Use the
“move other” resolution to move both appointments. Verify through real API
reads that both legs commit atomically, or neither leg changes on an induced
second-leg failure, and that stale resolution evidence remains available.

## Presentation and accessibility checks

Repeat the relevant sync/conflict screens in Arabic/RTL and English/LTR, and in
light and dark themes. Verify keyboard focus order, visible focus indicators,
focus restoration, live status announcements for queue states, and absence of
raw errors or credential/payload leakage. Report each check as pending unless
it was observed in the browser; do not infer accessibility from screenshots
alone.

## Scoped cleanup

After closing all browser contexts, remove only rows associated with the
generated fixture IDs: resolution history, device operations, conflicts,
appointment operations/holds, audit entries, synthetic appointments and
associated change-feed rows, patient access, auth sessions/devices, synthetic
users, doctors, patients, and clinic. Use the dedicated reset role only for
its permitted audit deletion when needed. Commit cleanup transactionally, then
compare the six source-table fingerprints exactly. Never delete unrelated
operational/demo data.
