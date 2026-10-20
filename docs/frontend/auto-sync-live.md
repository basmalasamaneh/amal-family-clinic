# Focused development auto-sync demo

Run against the already-running development web/API services and their development
database:

```sh
AMAL_SYNC_ADDITIVE=1 pnpm exec playwright test --config playwright.sync.config.ts
```

Requires the existing `DATABASE_URL`, an allowed development auth origin, and
Chromium (`HARNESS_CHROMIUM_PATH` optionally overrides the Nix wrapper).
The test refuses deployment/production environments. It does not start or restart
services, reset a database, change schemas, modify seeds, or bypass/change the
separate booking suite's disposable-database guard.

## What this demonstrates

1. Add an isolated synthetic operational clinic, doctor, receptionist, four
   patients, and two trusted devices with generated test sessions.
2. Open the real calendar and prepare its authorized cache through the real
   application's `prepareBookingCache` service. Wait over one second for the
   offline permit's whole-second issuance timestamp.
3. Open the real sync screen; use actual Playwright `context.setOffline(true)`.
4. **Programmatic application handoff:** submit three proposals through the
   application's `saveLocalBooking`. This is not a booking-form UI test and
   performs no direct IndexedDB writes.
5. A separate authorized cookie jar claims the **third** slot through the real
   appointments API while the main browser remains offline.
6. Reconnect without manually pressing Retry: assert two acknowledged and one
   conflicted proposal. Reload; verify the same three UI operation identities,
   three server receipts, and exactly three appointments (including the blocker).
7. Use the real conflict UI to request Call, explicitly confirm, verify the phone
   panel, and verify the conflict remains open. Clear the displayed phone.
8. Explicitly select a suggested move-self radio option, confirm the move, verify
   resolved status and exactly four appointments. Reload again and check the same
   three proposal identities, receipts, and no duplicate appointment.
9. Enqueue one additional offline proposal through the same programmatic
   application service; the second authorized session claims its slot.
10. With that conflict open, use account preferences to check Arabic/English in
    both light/dark modes: language, direction, theme, translated decision
    heading and Keep action. Run axe scoped to the sync page in each combination.
11. Explicitly enter a new date and time for the other appointment, focus Keep
    and press Enter, verify focus enters the confirmation dialog, Tab to Confirm
    and press Enter. Verify through the live appointments API that the proposal
    retained its original slot and the competitor moved to the chosen slot with
    an incremented version; exactly six appointments exist.

After the first Call, a competing session also submits the old conflict version
and must receive 409. This checks server stale-resolution rejection, not the UI's
stale-resolution recovery flow.

No API interception or mocked response is used. Broader offline-suite scenarios
remain out of scope. The keyboard check covers modal entry and explicit
confirmation, not a complete keyboard audit or post-close focus restoration.

## Integrity and privacy

Cleanup closes both contexts, then deletes only fixture-owned operational rows in
foreign-key order. The restricted audit-deletion role is used solely for the
fixture's users/patients; this is not a demo reset. Appointment tombstones are
removed after fixture appointments. All six immutable public seed-table counts
and content hashes must match their pre-test fingerprints.

Cookies and CSRF values remain in memory. Authenticated traces, video, and
screenshots are disabled. Evidence attachments contain counts/booleans, not
patient payloads, session credentials, or database fingerprints. Any automatic
Playwright failure context is local test output containing synthetic test data,
not a deliverable.

## Live evidence

The extended focused test passed on the existing development services (one test,
14.9 seconds including runner startup), including both explicit move paths,
post-resolution reload assertions, stale-version rejection, four locale/theme
checks and keyboard confirmation. All four sync-scoped WCAG 2 A/AA axe scans
reported zero violations. These are automated DOM checks, not visual screenshot
approval or a full accessibility audit. Harness TypeScript checking also passed.
Harness-only failures were corrected: CommonJS-compatible module resolution,
the queue row test-id selector, and required appointment-list time bounds. No product defect was
observed in that passing run. This is development evidence, not deployment
verification, and does not mark the project task complete.
