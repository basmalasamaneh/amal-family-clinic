# Connection states and cached day sheet

The existing `/desk/day-sheet` reception route reads the authorized device cache,
not seed tables or clinical records. Prepare the schedule online once and activate
the production service worker before relying on offline navigation. An authorized
bounded continuation permit is required; this is not offline login.

## Presentation contract

- Unknown authorization, initial reads and storage errors are explicit states.
- Actionable outbox rejections/conflicts or open sync conflicts take priority.
  Connectivity and the number of unacknowledged operations remain visible.
- Pending, processing and retryable operations count as waiting. Succeeded
  evidence stays in storage but is excluded. Display code never replays or
  acknowledges operations.
- Browser connectivity is explicitly not API availability or synchronization.
  Reconnection cannot erase unresolved attention.
- Reads use controller-issued scope tickets. Dexie committed mutation events
  trigger fresh authorized reads, including other-tab changes. Context changes
  clear private state, and late reads cannot publish into another scope.

## Sheet and paper

Day boundaries use Asia/Hebron local midnights, including DST. Day selection
stays within the upstream rolling 14-day window. Coverage is determined from
metadata and snapshot integrity, not row count: only a fully covered empty day says there are no
appointments. Partial coverage warnings survive printing; missing coverage
blocks the print button.

Rows consume the upstream deduplicated operational/proposal model. Local
proposals carry separate provisional and attention labels, never confirmation.
Only doctor, patient display name, appointment time and scheduling state print.
Refresh and print-generation timestamps are distinct.

Committed Dexie changes (including other tabs) refresh the sheet using fresh
authorized reads. No-op cache reads avoid rewriting unchanged window metadata,
so observing updates does not create a refresh loop.

Print freezes scope, rows, day, doctor, clinic name, language, digits and cache
metadata. Queue changes wait until printing ends; authorization invalidation
clears the frozen snapshot immediately. Browser-menu printing uses the same
gate. Already exported PDFs or paper cannot be recalled after logout.

Paper uses A4 high-contrast styles regardless of theme, repeating headers and
non-splitting rows. Navigation/actions are excluded; screen theme is unchanged.
No authenticated responses are added to service-worker caches.

## Verification (2026-10-20)

- `pnpm run typecheck`: passed (all workspace packages and harness).
- Focused connection/day-sheet/local-cache/local-booking-UI unit suite: 31 passed,
  including full-range metadata with missing supporting records, observed-table
  selection and no-op read notification-loop prevention.
- Production PWA mocked-API scenario: real signed permit, IndexedDB, service
  worker, network disconnection, three locally saved bookings, offline reload,
  day selection, four deduplicated rows, waiting count and print invocation.
- Arabic/English × light/dark reached offline sheet and PDF generation. Axe
  exposed malformed timestamp markup, corrected to paragraphs; strict axe
  assertions restored. Targeted Arabic/English light reruns passed end to end
  after the shared fixes. The earlier dark runs verified rendering and printing;
  dark was not rerun after the markup-only fix.
- Arabic/English normal PDFs inspected separately after the print-height fix:
  one A4 page, readable Arabic/RTL and English/LTR, no trailing blank page.
- A clearly labelled DOM-only 70-row layout stress check produced six-page
  Arabic/English PDFs; continuation headers repeat and text is not clipped.
  Cloned stress-test rows are not persisted records or live-data evidence.

Commands:

```sh
pnpm --filter @workspace/amal-network exec tsx --test tests/connection.unit.test.ts tests/day-sheet.unit.test.ts tests/local-booking-ui.unit.test.ts tests/local-cache.unit.test.ts
pnpm --filter @workspace/amal-network exec playwright test --config playwright.offline-booking.config.ts --grep 'three durable' --workers=1
```

Generated PDFs/results live under ignored `generated-artifacts/offline-booking/`.
The harness uses synthetic HTTP projections, not the live backend. No seed data
was changed. Chromium sometimes reports `navigator.onLine=true` immediately
after an offline service-worker reload; failed identity/sync-state probes are
permitted but no mock response succeeds offline. Browser print-dialog UI and
physical printer margins are not automated; PDF layout was checked separately.
