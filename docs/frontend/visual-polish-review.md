# Task 37 — visual polish browser review inventory

## Latest disposition

**Current final visual disposition: PASS for the documented presentation inventory
in Arabic/Light, Arabic/Dark, English/Light and English/Dark.**
The final print defect was corrected with a light print color scheme independent
of screen theme. The two affected dark print scenarios passed targeted recapture.
Actual Arabic empty and English populated PDF renders were inspected: white
margins, readable print-only content. Evidence: `generated-artifacts/polish/print-paper/`.
The approved existing developer setup ran without reset/repopulation and reported
an unchanged source fingerprint. `/api/demo/context` returned 200, `/api/me`
returned the expected anonymous 401, and the live login form rendered at 768px.
Workspace typechecks, shared contrast checks and 13 polish unit tests passed.
Earlier outstanding-finding descriptions below are retained as historical evidence;
the final print correction resolves the last presentation blocker.
The original **624/624 composite** is unchanged; it was not rerun. A separate
read-only synthetic presentation supplement has **101 unique latest cases:
101 passed after targeted corrections**. Its pass count is not live-runtime approval.
The ten original failures remain in the evidence history. Four day-sheet cases
passed in `generated-artifacts/polish/sheet-focus/` after making the named sheet
keyboard-focusable with visible focus. Six mobile admin cases passed in
`supplement-overflow-doctors/` and `supplement-overflow-devices/` after anchoring
offscreen `.shell-sr` labels with logical insets. All 24 captured admin layout
checkpoints now have clientWidth/scrollWidth of 360/360. No page-level clipping
or relaxed assertions were used. Frontend typecheck passed after the sheet fix.

Actual inspection of the corrected `sheet-focus` PDFs found a **black page-margin
frame in both dark-theme empty A4 PDFs**, absent in both light-theme PDFs.
Evidence: `inspection/pdf/{ar,en}-dark-360-corrected-empty.png`, rendered directly
from `sheet-focus/results/*/authorized-empty.pdf`. The content itself is correctly
print-only and readable. Resolve the dark print canvas/page background and
recapture **only the affected print cases** before approval. This is an in-scope
visual defect despite all automated checks passing.

Native 200% capture/reflow, representative full-resolution bilingual text,
below-fold content, corrected 360px dialogs and changed empty illustrations
have now been inspected; details and the exact image ledger are in
`polish-visual-inspection.md`. Native capture anomalies are resolved using actual
foreground window pixels on a sufficiently large virtual display. Do not retain
the old ten corrected findings, prior setup failure, physical-printer or
screen-reader certification as current blockers.

**Earlier execution history:** The final
English week-date separator fix was checked with the eight affected cases only:
`POLISH_BASE_URL=http://localhost:80 POLISH_RUN_NAME=week-label pnpm exec playwright test --config playwright.polish.config.ts --workers=4 --grep 'desk-week:' --project='en-*'`.
All eight passed. Evidence is in `generated-artifacts/polish/week-label/`.
Composite latest results across the initial matrix and targeted corrections:
**624 passing, 0 remaining failures**. This is not a single frozen-build full
rerun or a claim that every possible application state is covered.

The workspace typecheck and shared token contrast check passed. All 254
then-existing frontend unit tests passed; after six additional regression
contracts were added, all 13 polish-specific tests passed. The final date-span
change only adds a textual separator. Browser scans confirmed the cancelled
appointment contrast correction as well as the label and table-focus fixes.

### Remaining completion blockers

- **One:** dark-theme A4 page-margin canvas remains black in Arabic and English
  corrected empty PDFs. Print-only content and empty-state text are now verified;
  this is no longer the old screen-media fixture error.

**Resolved:** user-authorized developer-only setup was run by the owner without
reset. Owner reports `/api/demo/context` 200 and unauthenticated `/api/me` 401.
An actual fresh 360px `/login` capture shows the ready credential form, not an
identity-service error (`inspection/login-ready-current-360.jpg`). No credentials
were submitted; authenticated live UI is not claimed. Synthetic signed offline
and native PDF checks are accurately labelled below; real DB writes are neither
needed nor performed for this presentation review.

### Historical runtime prerequisite investigation — before approved setup

Read `.agents/memory/database-runtime-boundary.md`, the existing migration and
post-merge scripts, and the developer admission/auth paths. Diagnostics used
read-only database transactions and credential-free HTTP requests, not workflow
logs or `operational:test`. No server/workflow was started or restarted.

**Confirmed causes, not an inferred shared error:**

- A real connection using `runtimeConnectionString()` authenticated with both
  `current_user` and `session_user` equal to `amal_app`. Runtime connectivity and
  read access to the auth user/session tables succeeded.
- The admission boundary calls `getDemoGeneration()` before `/me`, login
  validation, and `/demo/context`. Its exact read failed with PostgreSQL `42501`,
  `permission denied for schema operational_meta`.
- Administrator catalog reads showed that `operational_meta.demo_state`,
  `operational_meta.demo_reset_receipts`, `operational.developer_outages`, and
  the `amal_reset_login` role do not exist. Only version `0001` is recorded in
  `operational_meta.migrations`; that ledger alone does not imply other feature
  schemas are absent. This is missing `0015_developer_tools.sql` setup, not a bad
  application-login password or a frontend identity adapter error. Merely
  granting schema usage cannot fix nonexistent generation/outage relations.
- `operational.clinic_managers` exists. `amal_app` already had its intended
  SELECT-only access, while `amal_demo_reset` lacked both SELECT and DELETE.
  This independently explains the previously reported cleanup permission error;
  no reset was performed to reproduce it.

**Narrow authorized privilege repair applied:**

`GRANT SELECT,DELETE ON operational.clinic_managers TO amal_demo_reset;`

This restores only that existing table/maintenance-role grant from migration
0015. A transactional catalog check confirmed both grants afterward, while
`amal_app` retained SELECT only, no table mutation privilege, and no membership
in `amal_demo_reset`. No table rows, source seeds, schema definitions, passwords,
sessions, or application code were changed.

**Remaining blocker and command review:** The existing complete setup command is
`pnpm --filter @workspace/scripts developer:migrate --demo` (requires the existing
development-only `AMAL_DEVELOPER_TOOLS=1` configuration). It was **not run**:
it creates schema objects and a login, initializes the generation row with an
INSERT, changes the derived reset-login password, and records migration 0015.
Consequently it is not a privilege-only/no-data-write repair within this
continuation's constraints. There is no sufficient GRANT-only command for the
missing relations. A trusted operator must explicitly authorize that reviewed
setup scope before using the existing command; do not substitute post-merge,
populate, reset, or operational-integrity jobs. The command itself contains no
source-seed DML or reset/copy operation, but it does perform setup writes.

**Final HTTP readiness probes:** Cookie-free GET `/api/demo/context` and
`/api/me` still returned HTTP 500 with the safe `INTERNAL` envelope. POST
`/api/auth/login` with the configured allowed Origin and an empty JSON object
also returned HTTP 500, before credential validation. The same request without
Origin returned the expected HTTP 403 `CSRF`; that is not login readiness.
No real credentials, cookies, tokens, or secrets were submitted or printed, and
no successful/signed-in login flow was verified. These results do not establish
that the missing setup is the only remaining prerequisite after installation.

## Status and scope

**Browser matrix executed; see the execution record below for failures and targeted verification. No full visual approval or accessibility compliance is claimed.** This inventory was established by reading the route registry, presentation code, existing Playwright suites and synthetic helpers.

Authoring checks: both new TypeScript files passed syntax transpilation and a focused strict `tsc --noEmit` check (including the reused admin helper). The strict check was repeated after fixture corrections.

Owned files:
- `artifacts/amal-network/tests/polish.spec.ts`
- `artifacts/amal-network/playwright.polish.config.ts`
- This inventory.
- Follow-up: six small source/formatting regression contracts appended to the existing `tests/polish.unit.test.ts`, as requested after UI corrections.

No application UI, database, workbook, or six seed datasets are changed. This is a presentation regression suite, not security, synchronization correctness, or performance certification.

## Execution and evidence

With the preview already running:

```sh
cd artifacts/amal-network
pnpm exec playwright test --config playwright.polish.config.ts
```

Optional origin: `POLISH_BASE_URL=https://your-preview.example` (otherwise the Replit dev domain, then localhost:80). Optional installed browser: `HARNESS_CHROMIUM_PATH=/path/to/chromium`. `POLISH_RUN_NAME=targeted` places a focused rerun in a separate evidence subdirectory instead of overwriting the initial matrix.

The configuration does not start or restart a server. It matches **only** `polish.spec.ts`, uses Chromium, one worker, zero retries, reduced motion and blocked service workers. It cannot accidentally select the live-write suites.

Full matrix: **Arabic / English × light / dark × 360 / 768 / 1024 / 1440 CSS-pixel widths**, height 900; 16 projects. Every declared scenario runs in every project, including state and interaction scenarios. No conditional mobile skips.

All outputs are below `generated-artifacts/polish/`:
- `results/`: uniquely scoped project/test directories containing named full-page PNG captures, failure screenshots and retained-on-failure traces.
- `report/`: HTML report with attached named screenshots and axe violations JSON.
- `results.json`: machine-readable execution results.

These are **captures, not approved pixel baselines**. No `toHaveScreenshot` tolerance or visual diff gate has been invented before a human approves the design. Captures are made before soft presentation assertions so defects can still leave evidence. A prerequisite failure may prevent a capture; use the report rather than assuming every file exists.

## Fixtures and integrity

The suite reuses `tests/helpers/admin-fixtures.ts` (`bootAdmin`, `exampleClinic`) and follows synthetic response shapes in `admin.spec.ts`, `doctor.spec.ts`, `network.spec.ts`, `kpi.spec.ts` and `adoption.spec.ts`. It also reads existing calendar, booking, shell, consent/reception and UI-kit patterns.

Every `/api/**` request is intercepted. No API handler uses `continue`, `fetch` or an API request context. The base helper's unmatched request response is 503, not a live fallback. A last-registered guard returns 405 for non-GET API requests, records them, and presentation scenarios assert no domain writes. The sole explicit exception is `POST /api/kpis/lookup-duration`: network selection automatically emits timing telemetry, which is consumed with an in-browser 204 and never forwarded to any server. Unknown services therefore cannot silently call a real server. No real login, logout, reset, outage toggle, import staging, merge, booking save, or consent save is performed.

The booking drawer and calendar presentation checks use the existing explicit, labelled DEV-only `shellDemo=front-desk` fixture. Real calendar routes are separately checked to remain locked without encrypted authority. Real booking uses an authorized encrypted local cache; the suite does not forge its signed permit. Other routes use mocked identity and real frontend adapters. Fixture account preferences/tour dismissal are set locally in isolated browser contexts. The anonymous shell deliberately starts Arabic/light; public and offline-lock scenarios select their project locale/theme through visible controls, rather than assuming it inherits an account's preferences.

Synthetic clinics, people, notes and aggregates are not production fallbacks. They exist only in the test file. No DB-writing helper (`edit-fixture`, `booking-live`, `reception-live`) is imported.

## Original-matrix inventory versus authored checks (historical baseline)

“Authored” below describes the original 624 only, not the final combined inventory.
Supplementary modal/import/signed-offline/PDF coverage and final disposition
supersede its historical missing-state statements; see the current summary and
`polish-visual-inspection.md`. Existing logical-state tests are not relabelled as
newly executed visual checks.

| Delivered route/surface | Authored coverage | Deliberate limits |
| --- | --- | --- |
| Admin `/admin/kpi` | Populated synthetic aggregate dashboard; weekday chart readiness; unavailable telemetry included | Range switching, CSV/data parity, every expanded table remain in existing KPI suite, not repeated here |
| `/admin/network-health` | Synthetic offline clinic, unknown telemetry/coverage rendering | Does not simulate real heartbeat producers |
| `/admin/users-devices` | Empty users, devices tab and their actions | No account creation/PIN reset/enrollment/revocation; populated device rows not covered |
| `/admin/clinics-doctors` | Synthetic clinic list; clinic wizard details, schedule, review; keyboard opening, discard and focus return | No submit; no doctor create/edit modal, wizard success or ambiguous-write panels |
| `/admin/audit` | Synthetic populated audit row | No pagination/filter interactions here |
| `/admin/developer` | Synthetic generation/clinic status and visible controls | Never toggles outage or resets data; destructive confirmation states not opened |
| Front desk `/desk/today` | Real calendar authority lock, plus labelled calendar presentation with all six visual status variants; separate empty and error scenarios | Sync is an independent badge, not a lifecycle class; not a real availability/overlap or mutation check |
| `/desk/week` | Real calendar authority lock and labelled seven-day calendar surface | No drag/drop or native zoom calendar exploration |
| `/desk/new-booking` | Labelled fixture drawer; patient choice, schedule stage; Tab remains inside dialog; Escape closes | No hold, conflict preview, review/commit or encrypted real-cache save |
| `/desk/patients` | Search entry and selected demographic detail; consent entry | Registration dialog, validation and long paginated lists not covered |
| `/desk/consent` | Direct-URL selection guard and form reached through actual Patients selection | Empty history/current None only; no PIN, guardian, withdrawal or access-history dialog |
| `/desk/sync` | Empty queue surface without forged device authority | Queue/conflict/acknowledgement/retry rows and durable offline outbox not exercised |
| `/desk/day-sheet` | Unauthorized/locked state and print-media guard; no printable table without authorization | **No authorized populated/empty printed sheet, PDF, pagination, browser print dialog or printer verification** |
| Doctor `/doctor/my-day` | Populated clinical patient, empty, server error and API forbidden distinguished; offline lock | All three API failure states assert absence of the other states and absence of previous patient row |
| `/doctor/network-search` | Initial search, populated results, actual selection action | Search empty/error/denied variants remain gaps in this new suite |
| `/doctor/patient-card` | Unselected guard, selected clinical timeline, reload clears selection, no patient ID in URL | Basic/None consent timeline and clinical alert variants remain existing-suite coverage |
| `/doctor/privacy` | Full mode, bilingual no-performance statement, empty audit read response | Does not exercise all trial/Lite/unavailable modes |
| Shared `/work/adoption` | Doctor trial/unavailable-results panel and front-desk read-only view | No transition/export/leave or populated published-results cards |
| `/work/import` | Upload entry in both doctor and front-desk roles | **No seed import**, file staging, mapping, conflicts, commit or report; later wizard stages remain review gaps |
| `/work/duplicates` | Empty candidates in both roles; separate server error/retry surface | No populated candidate comparison, survivor selection, preview or merge |
| Public `/login` | Signed-out presentation | No credential submission; error and MFA/PIN states not covered |
| Public privacy `/data` | Anonymous information/privacy page; also signed-in text-resize check | `/privacy` is not a public delivered route; `/doctor/privacy` is separate and protected |
| Public `/ui-kit` | Design-system sample page | Interactive loading/toast/form states remain in existing UI-kit suite |
| Cross-role denial | Doctor opening admin health route produces shell forbidden, separate from domain errors | Not an exhaustive authorization/security test |

## Common authored assertions

Each `review` checkpoint checks:
- HTML `lang`, RTL/LTR direction and explicit theme for its project.
- Document-level horizontal overflow (1px rounding allowance). An intentional internal scrollable table/calendar is allowed, not excluded from axe.
- Visible body text against known translation-key namespace patterns and unresolved interpolation. Exact API administrative event taxonomy values are allowlisted from the generated contract, rather than falsely identifying legitimate technical data as translation keys. This catches raw keys, **not semantic translation correctness**, mixed-language fixture names, or every possible unknown namespace.
- Nonempty accessible names for every visible button and link.
- Whole-page axe scan; critical and serious violations fail soft assertions. Full violation JSON is attached, including lower impacts. There are no axe rule exclusions or suppressed known failures.
- Full-page screenshot after font readiness, with animations disabled.

Additional interactions: keyboard Enter opens clinic wizard/card, a real Tab remains within booking drawer, Escape closes the drawer, and cancelling the clinic wizard returns focus to its opener. Representative doctor and public privacy pages double root text size and test overflow, action names, axe and an outline/box-shadow focus indicator.

**200% limitation:** root font-size doubling is a headless text-resize/reflow proxy. It is not native browser zoom, OS scaling, or a proof that fixed-pixel text doubled. Human review still needs native 200% zoom and 400%/320px WCAG reflow checks, including focus not obscured by sticky bars.

**Offline limitation:** no signed permit is issued by fixtures. Browser connectivity loss must remove the previous doctor's patient row and show the locked/signed-out surface, not an empty list or a forbidden list. Authorized offline continuation and populated local cache/print need a separate safe cryptographic fixture strategy; they are not claimed covered here.

## Review checklist after execution

1. Record command/origin/build, execution counts and actual failures from the generated report; keep **not run** distinct from passed, skipped or blocked.
2. Inspect captures at every width/theme/direction: text hierarchy, wrapping, mixed-script bidi, contrast, action alignment, density, sticky bars, tables and clipping. Automated screenshots do not make that judgement.
3. Resolve serious/critical axe findings and unnamed actions without loosening checks merely to pass. Evaluate moderate/minor findings separately.
4. Inspect actual Arabic/English microcopy with a fluent reviewer: useful recovery actions; unavailable vs zero, server error vs offline vs permission denial; no implied successful mutation.
5. Complete the explicit modal/populated/import/offline/print gaps above with safe fixtures before calling the comprehensive browser review complete. Check keyboard focus order/traps/return, visible focus and screen-reader announcements manually.
6. Add approved screenshot baselines only after design sign-off. Run Firefox/WebKit, real phones, native zoom, print/PDF and reduced-motion comparisons as follow-up coverage.

This document intentionally does not list fabricated passes or classify absent screenshots as acceptable designs.

## Execution record — 2026-10-20 UTC

Origin: `http://localhost:80`, already-running development preview, Chromium, four workers. No workflow was started/restarted by this review. The owner's UI fixes landed during execution; this is not an immutable-build certification.

### Initial full matrix

Command:

```sh
POLISH_BASE_URL=http://localhost:80 pnpm exec playwright test --config playwright.polish.config.ts --workers=4
```

Started **21:26:29 UTC**, duration **19.5 minutes**. Actual results: **624 executed; 502 passed, 122 failed, zero skipped, zero flaky**. Original evidence is retained in `generated-artifacts/polish/results/`, `report/`, `results.json`, `matrix.log` and `initial-failures.json`. The owner's interrupted pre-review six-case evidence was separately preserved in `prior-six/`; it is not included in the 624-case count.

Failures by scenario:

| Scenario | Initial failures |
| --- | ---: |
| Day calendar | 16 |
| Week calendar | 16 |
| Day-sheet route readiness | 2 |
| Public privacy | 16 |
| Calendar standard statuses | 16 |
| Network results/card | 16 |
| Public login | 12 |
| Offline lock | 12 |
| Doctor day | 8 |
| 200% text-resize proxy | 8 |

Fixture corrections, without changing application UI:
- Real calendar reads require encrypted local authority, not merely mocked GET responses. Day/week now assert the real locked state, then capture the labelled calendar fixture.
- Sync is a secondary badge, not `.cal-card--sync`.
- Network selection automatically produces timing telemetry; the specific endpoint is locally fulfilled with 204 instead of falsely treating it as a domain write.
- Anonymous shell preferences deliberately reset to Arabic/light. Public/offline checks now select the requested locale/theme through visible controls.
- Day-sheet route review now awaits stable lock instead of scanning its transient skeleton.
- The raw-key checker excludes exact contract-defined administrative event taxonomy, not whole namespaces.

The active runner retained its original test snapshot even after source fixture corrections were saved; later initial failures therefore still include the old assumptions. No passing result was retroactively assigned to them.

UI findings reported to the owner:
- Serious `scrollable-region-focusable` on admin audit's table wrapper in the saved pre-review run; owner made admin scroll regions named/focusable. All initial full-matrix admin audit checks passed after that fix.
- Serious `aria-prohibited-attr` on the day-sheet loading skeleton; owner added status semantics. The stable locked route and loading state are distinct.
- Serious `label-content-name-mismatch` on the public privacy brand link; owner changed its naming/description.
- Serious `label-content-name-mismatch` on `.net-hit` in populated network results.
- Serious `label-content-name-mismatch` on English `.doc-row__open`, also seen at doubled root text size.
- Targeted scans that were previously blocked by fixture prerequisites also found cancelled calendar text contrast and English week day-link label-in-name problems; details below.

### Targeted verification

Only the **122 initially failed case IDs** are selected with `--last-failed`. Their last-run manifest was copied to a separate output directory before execution:

```sh
mkdir -p ../../generated-artifacts/polish/targeted/results
cp ../../generated-artifacts/polish/results/.last-run.json ../../generated-artifacts/polish/targeted/results/.last-run.json
POLISH_BASE_URL=http://localhost:80 POLISH_RUN_NAME=targeted pnpm exec playwright test --config playwright.polish.config.ts --workers=4 --last-failed
```

Started **21:46:36 UTC**, duration **4.8 minutes**. Actual results: **122 executed; 74 passed, 48 failed, zero skipped, zero flaky**. Evidence is retained in `generated-artifacts/polish/targeted/results/`, `targeted/report/`, `targeted/results.json`, `targeted/remaining-failures.json`, and `targeted.log`. Initial evidence was not overwritten. **No second broad matrix was run.**

Combining each case's latest result across the initial matrix and targeted rerun gives **576 passing and 48 failing cases out of 624**. This is a composite latest-result inventory, **not a claimed clean full rerun or frozen-build approval**.

At the end of that targeted run, the following 48 failures were UI accessibility findings, not unresolved fixture prerequisites (see follow-up verification below for current status):

| Remaining scenario | Cases | Serious axe findings |
| --- | ---: | --- |
| Week calendar | 12 | Light AR/EN: cancelled appointment duration/doctor text has contrast **3.99:1** (`#74818b` on white, 16px; needs 4.5:1). EN light/dark: `link-week-day-*` accessible names do not include visible abbreviated date labels. Arabic/dark week checks pass. |
| Populated network results/card | 16 | `.net-hit` label-content-name-mismatch in both languages/themes. The timing POST is now safely mocked and no longer the failure. |
| Doctor day | 8 | English `.doc-row__open` accessible name does not include its visible “Open card” label. |
| Standard calendar statuses | 4 | EN/light cancelled badge `.amal-status--cancelled > span` has contrast **4.24:1** (`#69757d` on `#f0f3f5`, 14px; needs 4.5:1). |
| 200% text resize | 8 | Same English doctor open-card accessible-name defect, not a new overflow or focus-indicator failure. |

No targeted failures were for document overflow, unnamed actions or untranslated keys. No axe rules were disabled. The exact node/contrast reports remain attached in the HTML/JSON evidence.

Confirmed targeted recovery:
- All 16 corrected day calendar presentation checks pass, with the real authority lock still separately asserted.
- Public login and public privacy requested display variants pass; the owner's `/data` accessible-name fix is verified by the targeted scans.
- Previously failing day-sheet route checks pass after waiting for stable lock. This does **not** independently verify every transient loading skeleton.
- Previously failing offline-lock variants pass after selecting their anonymous display settings.
- AR standard-calendar checks pass after correctly selecting the independent sync badge.

The owner then corrected these UI findings. The following command was used to select **only those 48 failed case IDs**, preserving both prior runs:

```sh
mkdir -p ../../generated-artifacts/polish/targeted-ui/results
cp ../../generated-artifacts/polish/targeted/results/.last-run.json ../../generated-artifacts/polish/targeted-ui/results/.last-run.json
POLISH_BASE_URL=http://localhost:80 POLISH_RUN_NAME=targeted-ui pnpm exec playwright test --config playwright.polish.config.ts --workers=4 --last-failed
```

The initial and targeted reports contain **968 PNG attachments** in total (including automatic failure captures); this is evidence volume, not a count of unique approved designs. Print-media guard images are also saved directly in the test output directories. Later fixture/UI fixes do not erase initial failures.

### Follow-up UI verification — only the 48 failed IDs

`targeted-ui` started **21:54:38 UTC**, duration **3.1 minutes**: **36 passed, 12 failed, zero skipped/flaky**. Four Arabic/light week checks failed during page navigation with HTTP **502**, before UI assertions. The eight English week checks still failed serious `label-content-name-mismatch`; no other UI cases failed.

Only the four HTTP-502 cases were then rerun in `targeted-ui-recovery`:

```sh
POLISH_BASE_URL=http://localhost:80 POLISH_RUN_NAME=targeted-ui-recovery pnpm exec playwright test --config playwright.polish.config.ts --workers=4 --grep 'desk-week: matrix presentation' --project=ar-light-360 --project=ar-light-768 --project=ar-light-1024 --project=ar-light-1440
```

Recovery started **21:58:11 UTC**, duration **21.2 seconds**: **4 passed, zero failed/skipped/flaky**. The earlier 502s remain retained as infrastructure failures, not relabelled as UI passes.

**Current composite latest status: 616 passing / 8 failing of 624 cases.** No broad matrix was repeated. Confirmed fixed by browser checks: cancelled card/badge contrast, doctor open-card names (including doubled root text), network result names/descriptions, and Arabic/light week presentation.

**Remaining blocker: all eight English week cases still fail serious label-in-name.** The date formatter is now correctly `EEEE d MMM`, but the two visible JSX spans have no text separator. DOM text can concatenate as `Saturday17 Oct`, while the accessible label is `Open day view for Saturday 17 Oct`. Add an explicit text space between the visible spans, or compose the name using appropriate labelled elements. Evidence:
- `targeted-ui/results/polish-desk-week-matrix-presentation-en-light-360/error-context.md`
- `targeted-ui/results.json` contains the actual link HTML and axe node report.
- Same issue remains in all four English widths in both themes.

### Small unit regression contracts

Added six checks to the existing polish unit suite: bilingual doctor label wording, week date-part naming/separator contract, no cancelled parent opacity, inherited network naming plus described action, status-role loading skeletons, and public privacy logo name/destination relationship.

```sh
pnpm exec tsx --test tests/polish.unit.test.ts
```

Actual latest result: **12 passed / 1 failed** (13 total). The week separator check intentionally exposes the same remaining UI defect; it is not suppressed. `generated-artifacts/polish/unit-final.log` retains the failure. These are source/formatting contracts—not component rendering, CSS-computed contrast or screen-reader certification. Earlier formatting-only checks passed, which is why the explicit JSX separator guard was added after the browser failure remained.

After fixing that last UI issue, select only the eight English failed week IDs by copying `targeted-ui/results/.last-run.json` to a new output directory **and restricting projects to the eight `en-*` projects** (the manifest also retains the four recovered HTTP-502 IDs). Alternatively run `--grep 'desk-week: matrix presentation'` with exactly those eight English projects. Repeat the small unit file. Do not run another broad matrix to claim completion.

### Human image inspection

The earlier three-image subset is superseded by the concrete inspection ledger
in `polish-visual-inspection.md`. That ledger distinguishes images actually
viewed from merely generated evidence and does not grant blanket approval.

## Supplementary presentation review — evidence history

Owned additions: `tests/polish-supplement.spec.ts`,
`playwright.polish-supplement.config.ts`, and the offline-only evidence indexer
`tests/polish-contact-sheets.mjs`, plus these two review documents. Existing UI,
backend, Canvas, auth logic, original matrix tests and seed data were untouched
by this reviewer. No workflow was started or restarted.

### Safety boundary

Every API request is intercepted. Every non-GET is blocked with 405 and recorded;
all completed fixture request-safety attachments report **zero attempted API
mutations** and no unmatched private GETs. The admin helper's closed read-only
GET responses are reused. No API continuation/fetch fallback reaches a server.
No PIN, credential, seed-stage, import map/commit, patient save, enrollment,
revocation, merge, copy or reset request is sent.

The authorized cache strategy reuses the existing offline-booking suite's
**actual server `issueOfflinePermit` signing function**, with its type-only Auth
dependency. A real browser nonce is signed with the signer's process-local key;
the unchanged browser verifier and cache controller accept/reject it normally.
No signature verification bypass, manually injected ticket/identity, IDB
seeding or cache monkeypatch is used. The actual application warms its isolated
encrypted browser cache from synthetic GET projections. That entails normal
local IndexedDB cache persistence, **not operational/server database writes**.
Offline routing aborts rather than fulfilling fake HTTP connectivity.
This is mocked-API cryptographic integration, not a real authenticated deployment.

### Executed gaps and results

All four locale/themes × 360/768/1024/1440:
- Registration entry, invalid-form summary and minor guardian; consent access
  PIN opened/cancelled; clinical minor/history, withdrawal confirmation and
  withdrawal PIN opened/cancelled.
- Doctor create/edit, user create, populated devices, enrollment and revocation
  confirmation, all cancelled without mutation.
- Import existing staged batch GET; doctor mapping, patient identity existing/new
  dialog, status, blocking conflict, commit preview and pre-existing committed
  report entry. Local invalid JSON and parsed-but-not-staged file states.
  A committed batch fixture is **not** a claim that the test successfully committed.
- Actual signed cached day-sheet continuation after `context.setOffline(true)`,
  populated/empty screen states, populated print-media capture and A4 PDF.

Four 1440px locale/theme cases additionally warm 48 synthetic appointment rows
and generate offline A4 PDFs. `pdfinfo` reports four pages in each. Native zoom
has one separately configured headed Chromium case.

Evidence/results (none overwrites the original matrix):

| Run directory under `generated-artifacts/polish/` | Executed result |
| --- | --- |
| `supplement/` preliminary five | 2 pass, 3 fail (includes wrong import endpoint fixture) |
| `supplement-import-check/` corrected endpoint only | 1 pass |
| `supplement-gaps/` missing-state endpoints 360/1440 | 24 pass, 8 fail |
| `supplement-middle-widths/` missing-state 768/1024 only | 32 pass |
| `supplement-native-zoom/` expanded native zoom | 1 timeout: hidden shell display controls |
| `supplement-native-recovery/` visible settings-menu interaction | 1 pass |
| `supplement-extra-check/` English/light/360 extra states | 1 pass, 1 overflow failure |
| `supplement-extra/` other 15 cells' extra states | 29 pass, 1 overflow failure |
| `supplement-pagination/` A4-only pagination | 4 pass |

Latest unique results are **101 pass / 0 fail / 101** in
`inspection/supplement-latest.json`, after the owner's targeted corrections.
Initial fixture failures and the native
interaction timeout remain archived, not relabelled passes. No broad 624-case
suite rerun occurred. Strict focused TypeScript checking of both new TypeScript
files passed before the earlier handoff and again during the focused native
capture continuation. The corrected media reset has now run in `sheet-focus`;
four corrected empty PDFs were rendered and actually inspected. No broad suite
was rerun. The native case alone ran in separate capture-diagnosis directories.

Native mechanism: headed persistent Chromium, a disposable unpacked extension
with only `tabs` permission, `chrome.tabs.setZoom(tabId, 2)` and
`chrome.tabs.getZoom(tabId) === 2`. Measured outer width stays 1440;
`innerWidth` changes **1432→716**, DPR **1→2**, and computed root font stays
**16px**. This is not CSS zoom, root-font resizing, deviceScaleFactor or pinch
emulation. Twelve page/locale/theme checkpoints have overflow/axe and actual Tab
focus checks. Capture anomalies are now resolved by actual X11 foreground-window
captures in `supplement-native-full-display/`. The virtual display was temporarily
1920×1200 so the 1440×1000 browser fit, then restored to 800×600. All twenty
native display captures (twelve page/display tops and eight doctor/privacy
bottoms) were actually viewed. DevTools images can omit composited nav labels;
the actual window pixels show them. The native/reflow samples are acceptable.

### Exact current disposition and scope boundary

The ten original supplementary failures are resolved by the owner's UI fixes
and targeted reruns. Runtime setup is repaired with user authorization. Genuine
200% zoom and representative bilingual/below-fold/overlay review are complete
for the presentation refinements. **Only the dark PDF page-margin frame blocks
current approval.** It requires a narrow owner print-style fix and affected
PDF recapture; no operational DB writes are needed.

Unchanged queue/booking/merge/import mutation logic has existing tests, including
`sync-runner.unit.test.ts`, `local-sync.unit.test.ts`,
`local-booking-ui.unit.test.ts`, `booking-acceptance.spec.ts`,
`offline-booking.spec.ts`, `imports.unit.test.ts`, and `network.spec.ts`.
They were read for scope/provenance, not rerun or falsely counted as new visual
evidence. This review does not introduce a requirement to exhaustively re-test
unchanged state machines or use a real DB. Actual signed-in deployment behavior,
physical printers, screen-reader certification, browser/phone certification,
400% zoom and approved pixel baselines are not claimed, nor added as blockers
to this bounded visual-polish task.
