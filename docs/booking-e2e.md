# Live booking acceptance

## Safety and prerequisites

Run only in an explicitly disposable **development** workspace/database with the
operational schema, authentication tables and restricted runtime role already
installed. Do not use a published app or a shared live demo. The suite refuses
missing opt-in and deployment/production markers; unavailable prerequisites fail,
never skip. Existing six workbook tables must exist and remain read-only.

Start the existing API and Amal web workflows. Set development
`AUTH_ALLOWED_ORIGINS` to the exact current preview origin using workspace
environment settings; do not weaken CSRF checks. No demo reset/populate or seed
migration command is part of test setup.

```sh
AMAL_BOOKING_DISPOSABLE=1 pnpm run test:booking
# Narrow a failed case without changing the matrix:
AMAL_BOOKING_DISPOSABLE=1 pnpm run test:booking --project=ar-light --grep 'cancel confirmation'
pnpm --filter @workspace/amal-network test:booking:unit
pnpm run typecheck
```

The independent config uses the existing Playwright/axe packages and shared
zero-violation axe helper (the lifecycle variant adds safe selector evidence).
Browser selection follows the existing harness:
`HARNESS_CHROMIUM_PATH` overrides the Replit wrapped Chromium path. No downloaded
unwrapped Linux browser is assumed to work on NixOS.

## Data and diagnostics

Each test creates its own synthetic clinic, doctors, same-name patients with
distinct identity evidence, receptionist and authenticated device/session.
Authorization still passes through the real session middleware. Accounts are
provisioned directly for isolation; login UI is not under test. No hard-coded
authorized clinic IDs, seed people or name-based identity linking are used.

Cleanup closes clients and deletes only this run's operational graph, including
holds, operation receipts and audit entries. Narrow audit deletion uses the
existing maintenance role; it never calls a reset. Before setup and after cleanup,
read-only count/hash comparisons cover clinics, doctors, patients, appointments,
patient_visit_history and calendar_app_export. No export row is imported or linked.

Raw traces, screenshots and videos are disabled because authenticated traces
contain credentials. Failures attach only allowlisted visible state IDs and
language/direction/theme, and axe reports IDs/impact rather than DOM content.
Runner results live in ignored `generated-artifacts/booking/`; fixtures contain
synthetic data only and tokens exist only in memory. Never attach raw network
headers or storage state to reports.

The platform-only Replit development banner is dismissed using its own persisted
dismissal preference, as it is already absent inside the normal preview iframe.
Its unlandmarked `.banner-text` produced a moderate `region` finding in a direct
top-level development tab; this is not product content. No axe rule is disabled
and no application node is excluded.

## Matrix and assertions

Six journeys run in each of Arabic/English × light/dark (24 cases). Chromium,
1280×900 desktop; mobile journey uses 390×844. Every journey checks document
language, direction and theme. Browser timezone is America/New_York throughout;
clinic inputs and API expectations use Asia/Hebron via date-fns-tz.

| Journey | Required observations |
|---|---|
| Book/edit | Keyboard explicit same-name selection, invalid cross-midnight input, duplicate activation, exactly one persisted operation, reload, self-overlapping duration edit, blocked edit leaves original unchanged |
| Cancel/Undo | Confirmation, focus restore, pending live status, no write at 9999ms, keyboard Undo, one successful write at 10000ms, persisted cancellation, exact slot rebook |
| Doctor conflict | Blocking text (not color alone), no override, no write, server alternative chosen and rechecked, persisted recovery |
| Patient conflict | Required acknowledgement and nonblank reason, blocked blank reason, real authorized override and audit reason |
| Commit race | Separate session/device cookie jars, dispatch barrier only (no mocked response), one committed booking, losing UI reports conflict and retains input |
| Mobile/timezone | Drawer/editor bounds, spring DST-gap rejection, summer UTC round trip and reload, Escape restoration |

Browser clock control applies only to the actual client-side deferred cancellation
timer after authentication; server time, outcomes and expiry checks are untouched.
Collision tests delay request dispatch, never fulfill or replace scheduling API
responses. The two race sessions belong to one authorized receptionist, allowing
the real owner-scoped hold to be shared while cookie jars remain isolated.

Full-page axe uses the harness's stricter **zero violations** gate without
exclusions or disabled rules, covering all drawer stages, invalid input, editor,
conflict/override controls, cancellation confirmation and pending Undo.
Keyboard assertions complement axe for focus trap/wrap, visible focus, keyboard
patient selection, Escape/restore and reachable Undo. Automated geometry checks
cover mobile portal bounds. Axe checks contrast in both themes where it can
compute it; these checks do not establish screen-reader announcement quality,
complete visual RTL correctness or complete WCAG conformance.

The existing booking unit suite additionally covers dynamically discovered DST
gaps/repeated hours, preserving the exact second-occurrence UTC instant, and
cross-midnight rejection. These are supplementary, not replacements for live UI
persistence assertions.

## Executed results — 2026-10-20

| Project | Live journeys | Axe gate | Seed counts/hashes after cleanup |
|---|---:|---|---|
| ar-light (RTL) | 6/6 passed | Zero violations | Unchanged |
| ar-dark (RTL) | 6/6 passed | Zero violations | Unchanged |
| en-light (LTR) | 6/6 passed | Zero violations | Unchanged |
| en-dark (LTR) | 6/6 passed | Zero violations | Unchanged |

Final matrix command: `AMAL_BOOKING_DISPOSABLE=1 pnpm run test:booking --max-failures=1`.
24 passed, no skipped cases, 3.1 minutes, wrapped Chromium on Replit/NixOS.
All projects used the desktop and narrow viewport checks described above.
Booking logic unit tests: 21 passed, including DST repeated-hour regressions.
Workspace typecheck passed, including these new browser tests.

Fixed within the booking surface:
- Drawer headers no longer incorrectly introduce additional page-banner landmarks.
- Calendar appointment cards derive their accessible names from their visible
  content, including duration and pending status, rather than an aria-label that
  omitted visible text (`label-content-name-mismatch`, serious).

No remaining product axe violations were observed in the executed states.
Live status-region presence, keyboard flow and geometry are automated evidence;
human screen-reader pronunciation/announcement timing and visual review of all
RTL content remain manual checks, not claims made by this suite.
