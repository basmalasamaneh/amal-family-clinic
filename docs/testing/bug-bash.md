# Accessibility, performance and cross-role audit

## Status and scope

This is an **incomplete audit**, not a release approval or WCAG conformance claim.
**Latest disposition: audit evidence ready for completion validation.**
The authorized continuation recomputes alternatives from current permissions
and availability within the scheduling-lock transaction, rather than restoring
stale suggestions. All four locale/theme offline journeys now finish the move.
The approved isolated workbook initialization unblocked all six remaining
specialized files: the final run passed 120 tests across 15 files. All confirmed
critical defects have passing targeted retests. Performance budgets still fail;
this is not a WCAG conformance certification, production-performance approval
or a claim that unexecuted checks passed. See the final disposition below.
Earlier tables below preserve execution history; the continuation results below
are the latest results and supersede historical pending statuses.
The delivered visual-polish change is present in the working tree and history;
its previous results are context, not newly executed coverage.
Canvas is excluded. No migrations, population, reset or source-seed DML are
authorized by this audit.

Reference: WCAG 2.2 AA. All existing axe rules remain enabled; every violation
fails the presentation suite, including lesser impacts. Critical means
unauthorized disclosure/access, data loss/corruption, seed mutation, an impossible
core role journey (including keyboard blockers), severe hangs/unusable
performance, or any axe-critical finding. Serious findings require explicit
impact assessment, not automatic dismissal.

## Expected coverage inventory

For every row below, the expected dimensions are Arabic RTL / English LTR,
Light / Dark, mobile (360), tablet (768), desktop (1024 and 1440).
Expected states: loading, empty, populated, error/retry, validation, permission,
offline/reconnect where supported; all reachable dialogs and drawers.
An unavailable state must be recorded as blocked or not applicable with a reason,
never as a passing scan. The inventory is an expected checklist, not a claim
that the existing presentation matrix exercises every combination.

| Role | Delivered routes | Meaningful interactions to audit |
|---|---|---|
| Shared | `/`, `/login`, `/data`, `/ui-kit`, unknown route | login modes, validation, display preferences, navigation, menus, tour, expired session, logout, denied route, cleanup warning |
| Front desk | `/desk/today`, `/desk/week`, `/desk/new-booking` | date navigation, alternate date entry, doctor filter, slots, drawer stages, collision, repeat submit, edit/reschedule, cancel/Undo |
| Front desk | `/desk/patients` | query, pagination, empty/error, create/edit/delete, duplicate suggestion, walk-in |
| Front desk | `/desk/consent` | selected identity, grant/withdraw, minor guardian validation, assisted access history and confirmation |
| Front desk | `/desk/sync`, `/desk/day-sheet` | pending/failed/conflicting operations, resolution modal, unknown outcome, connection announcements, locked/authorized print |
| Doctor | `/doctor/my-day`, `/doctor/patient-card` | date range, assigned patient, no selection, local/foreign projection, denial, clinical card |
| Doctor | `/doctor/network-search`, `/doctor/privacy` | query, duplicate names, selection, consent-dependent content, visibility toggle and rollback |
| Doctor and front desk | `/work/import`, `/work/duplicates` | upload/review, every one of 24 export rows manually reviewed, collisions, merge preview/confirm/denial |
| Doctor and front desk | `/work/adoption` | manager versus read-only, trial, voluntary participation, export, leave confirmation, uncertain retry |
| Admin | `/admin/kpi`, `/admin/network-health` | period/range, loading/error/no evidence/zero, tables and non-color meanings |
| Admin | `/admin/users-devices`, `/admin/clinics-doctors` | tabs, pagination, add/edit dialogs, PIN/device, role/clinic constraints, safe errors |
| Admin | `/admin/audit`, `/admin/developer` | filters, audit projection, authorized outage/reset with generation fencing, unauthorized access |

### Execution ledger rules

The current presentation command is the existing `polish.spec.ts` matrix:

```sh
POLISH_BASE_URL=http://localhost:80 POLISH_RUN_NAME=bug-bash \
  pnpm --filter @workspace/amal-network exec playwright test \
  --config playwright.polish.config.ts --workers=4
```

It renders real React screens with synthetic API responses. It is **not** live
authentication, persistence, consent or authorization testing. Its calendar
locked states are not populated live calendar coverage. Its print guard is not
authorized printing coverage. Its 200% root-text resize is not native zoom.
The report's exact project/test names are the executed state ledger; all other
states above remain expected/unexecuted. Historical visual-polish results are
not added to this run's totals.

Keyboard checklist per role: Tab/Shift+Tab order; visible and unobscured focus;
Enter/Space; dropdown arrows; date alternatives; table scroll access; modal
trap/Escape/restoration; error recovery; toast/live announcements; no traps.
Complementary checks: label/semantic accuracy, non-color statuses, contrast,
native zoom/reflow, reduced motion, actual screen-reader speech and dynamic
announcements. Automated DOM accessibility assertions are not screen-reader
output. Results and unavailable tools must be distinguished.

## Performance protocol (declared before measurements)

No existing quantitative journey budget was located in the delivered testing
documentation. Provisional targets: LCP ≤2500 ms, CLS ≤0.1, key interaction
latency ≤200 ms. Do not relax these to pass.

Required profile: production Vite build, wrapped Chromium (record exact version),
1280×900 desktop viewport, device scale 1, 4× CPU slowdown, CDP network latency
150 ms / download 1.6 Mbps / upload 750 Kbps, no competing test workers.
Record OS, browser, commit, fixture counts and build flags with raw results.
Three independent cold contexts and three warm runs per login, calendar/booking,
patient lookup, doctor day and admin/KPI journey. Cold means fresh browser cache,
storage and no controlling service worker; warm means a repeat of the same journey
with populated cache and explicitly reported worker control state.

Retain navigation timing, observer LCP/CLS/long tasks, measured action-to-visible-
result time, API durations and transferred bytes, compressed bundle sizes, raw
runs and median/min/max. Name each selected action. Lab action timing is not
field INP; Lighthouse scores/proxies do not establish usability.
Vite development-server measurements and synthetic successful API fixtures
cannot establish these live production-journey results.

## Safety and blockers

**Update:** The user authorized extending the temporary database setup. The
existing runner now accepts `audit:booking`, `audit:offline` and
`audit:performance`, each creating a fresh schema-only PostgreSQL cluster,
generating ephemeral local credentials, and removing that cluster in `finally`.
Its browser fixture can clean up owned operational audit records through the
existing maintenance role; the API still connects as restricted `amal_app`.
No source data is copied and the six seed tables in that cluster stay empty.
Consequently any legacy test that requires the 24 real source rows is still
blocked there; an empty-table fingerprint is not source-workbook validation.

```sh
pnpm --filter @workspace/api-server exec tsx tests/privacy/local.ts audit:booking
pnpm --filter @workspace/api-server exec tsx tests/privacy/local.ts audit:offline
pnpm --filter @workspace/api-server exec tsx tests/privacy/local.ts audit:performance
```

These browser runs own their loopback API/production build through the existing
offline test host. Run them sequentially. An initial simultaneous supplemental
browser run hit Chromium `pthread_create: Resource temporarily unavailable`;
it was stopped and queued for serial execution, not treated as product failures.

- Shared development schema presence was verified read-only. It does not
  establish that the database is disposable. `AMAL_BOOKING_DISPOSABLE` was not
  configured. Do not assert that opt-in merely to bypass the live-suite guard.
- `pnpm test:privacy:local` creates and removes its own temporary PostgreSQL
  cluster using a schema-only copy. No source rows are copied or changed.
- Live booking/offline suites require a disposable database with the delivered
  schema and runtime configuration. Until that environment is established,
  destructive bug-bash journeys and authenticated live performance are blocked.
- An actual screen-reader check requires a working assistive technology tool and
  operator; accessibility-tree inspection alone cannot satisfy it.
- Read-only seed evidence: `pnpm --filter @workspace/scripts exec tsx
  src/audit-readiness.ts`. Compare before/after fingerprints; the command outputs
  no source rows and checks all 24 review flags and timezone-invariant baselines.
  This does not replace DST/browser-timezone live scheduling assertions.

## Evidence handling

Raw output stays under ignored `generated-artifacts/bug-bash/` and
`generated-artifacts/polish/bug-bash/`. The latter contains only synthetic
presentation fixtures. Never enable authenticated traces (cookies and headers
are recorded). Commit only reviewed aggregate evidence and sanitized findings.
Do not publish or reset the app to execute this audit.

## Current executed results

| Check | Result | Evidence |
|---|---|---|
| Read-only readiness and seed baseline | PASS; six expected counts, 24 review flags, timezone-invariant baseline | `generated-artifacts/bug-bash/seeds-before.json` |
| Shared unit suite (`pnpm test`) | 43 passed | `unit.log` |
| Frontend (`pnpm --filter @workspace/amal-network exec tsx --test tests/*.unit.test.ts`) | 260 passed | `frontend-unit.log` |
| Defined semantic contrast pairs (`pnpm --filter @workspace/amal-ui contrast`) | All pairs passed; not every rendered text/background combination | `contrast.log` |
| Disposable privacy (`pnpm test:privacy:local`) | 83 passed after setup corrections | `privacy-final.log` |
| Workspace (`pnpm run typecheck`) | PASS | `typecheck.log` |
| Production frontend build (`NODE_ENV=production PORT=4178 BASE_PATH=/ pnpm --filter @workspace/amal-network build`) | PASS; journey performance not measured | `build.log` |
| Presentation matrix | 620 passed, 4 timed out; no blanket pass | `polish.log`, separate JSON under `generated-artifacts/polish/bug-bash/` |
| Public keyboard journey | Executed with limitations below; focus fix regression 4/4 | `public-keyboard.log` and tester observations below |
| Existing live booking suite | 6 unsuccessful, 18 not run after interruption; not passing coverage | `booking.log`, `booking/results.json` |
| Existing live offline/reconnect suite, corrected production build | 3 failed at explicit move, 1 interrupted; see critical AUD-06 | `offline-final.log`, `generated-artifacts/offline-live/results.json` |
| Supplemental presentation inventory | Interrupted after browser thread-resource failures; not a pass | `supplement.log`; serial rerun not started after critical blocker |
| Destructive import/merge/export/leave/reset | NOT EXECUTED | Legacy source-dependent suites cannot use empty source tables; no reset or seed copy performed |
| Production journey latency, three cold/warm runs each | NOT EXECUTED; runner/suite prepared but measurements stopped at critical blocker | No timing or field-percentile claims |
| Actual screen-reader speech | NOT EXECUTED | No screen-reader conformance claim |

Log paths in the table without a prefix are relative to
`generated-artifacts/bug-bash/`. Final source-seed fingerprints match the initial
fingerprints byte-for-byte (comparison exit 0); counts are 3/5/25/102/32/24.
The complete executed/failed/blocked interaction matrix remains required.
Passing unit
and isolated API tests do not close the unexecuted browser states.

## Sanitized defect register

| ID | Severity / scope | Reproduce / expected / actual | Fix / retest |
|---|---|---|---|
| AUD-01 | High audit-tooling blocker; all roles/locales/themes | Run `pnpm test:privacy:local` against the delivered schema. Expected isolated restore; actual restore fails because grants reference absent `amal_reset_login`. | Add a NOLOGIN placeholder only inside the temporary cluster. No memberships granted. Restore now succeeds. |
| AUD-02 | High audit-tooling blocker; all roles/locales/themes | Run the same suite from a workspace with developer tools enabled. Expected ordinary privacy fixture responses; actual inherited demo admission requires absent generation state and headers, causing broad failures. | Explicitly run this ordinary authorization suite with developer tools disabled in its child process. Production code unchanged. Combined retest: 83/83. Demo generation/reset/outage coverage remains separate and unexecuted. |
| AUD-03 | Moderate keyboard focus issue; public page, both locales/themes | Open `/data`, focus a contents link, press Enter. Expected focus at destination; actual scroll/hash changes but active element becomes BODY. | Destination sections accept programmatic/native fragment focus and show a semantic focus outline. New public keyboard/axe suite passes 4/4 combinations. |
| AUD-04 | Unconfirmed button activation report; public login | Tester reported Space failed while Enter worked. Native Playwright `keyboard.press('Space')` on the same native button changes `aria-pressed` correctly. | No product change. Four public regressions verify locale/theme Space activation. Tool discrepancy retained, not counted as a confirmed product defect. |
| AUD-05 | High audit-tooling blocker; live PWA suite | Inherit `NODE_ENV=development`, run existing offline build. Vite emits a build but production-only worker registration is absent, so `navigator.serviceWorker.ready` never resolves. | Explicit `NODE_ENV=production` on the build only; API/fixtures remain development-only. First live run interrupted for teardown; corrected serial retest pending. |
| AUD-06 | **Critical core-journey blocker**; front desk, Arabic Light/Dark and English Light reproduced; English Dark interrupted | In an isolated operational fixture, create three offline bookings, create a competing online appointment, reconnect, replay the committed-but-unacknowledged request, reload, and choose Move on the retained conflict. Expected a fresh authorized alternate slot. Actual conflict has no selectable alternate; the journey times out before confirmation. | Unresolved. The API intentionally clears `suggestedSlots` when projecting stored conflict evidence; the UI derives move options only from those cleared slots. A fresh authorized suggestion path is required. Do not return stale stored slots or remove the privacy filter. |
| AUD-07 | Moderate accessibility; PWA error notice in production with worker blocked | Existing live cancellation axe check reports `landmark-unique` on `.pwa-notice`. Expected a distinguishable complementary landmark. | Added `aria-labelledby` referencing the existing localized notice text. Typechecked; affected production axe retest still required. |
| AUD-08 | High regression-suite compatibility gap; live booking | Existing collision cases wait for `/appointments/check` responses while the current local-first drawer can use a local preview. | No assertions removed or changed. Old suite did not establish collision acceptance. Reconcile its online-preview assumptions with the delivered booking mode before claiming coverage; the offline suite remains independently owned. |

Evidence history: `privacy.log` (restore failure), `privacy-retest.log` (inherited
demo-mode failures), `privacy-final.log` (passing retest). No customer record or
credential is included in this register. **Zero unresolved critical issues has
not been established**, because required coverage remains incomplete.

Additional executed checks: 33 import-validation, merge-identity and scheduling
engine unit tests passed (`domain-unit.log`). Public native Space, fragment focus,
reduced-motion preference and all-rule axe regression passed 4/4
(`public-keyboard.log`). Preference emulation is not a manual animation review.
Tester inspection covered visible focus/order on anonymous login, Enter language
and theme changes, public contents links, and 360/2560px public reflow. No actual
screen reader, authenticated keyboard-only journeys or modal trapping were
verified by that tester.

### Remaining executed-run detail

The presentation timeouts were Arabic Dark: 360px locked day sheet and doctor
day, 768px sync, 1024px admin wizard. They coincided with a separate Chromium
thread-limit failure, but their cause is not proven; mark them failed, not waived
as infrastructure. Targeted serial retests remain required.

The corrected live offline run passed far enough to reload and inspect the
durable conflict, then failed at `tests/offline/journey.spec.ts`'s alternate-slot
lookup in all three completed attempts. It did not finish the explicit move.
The existing safe-evidence attachment identifies phase `explicit-move`.
`artifacts/api-server/src/sync/reads.ts` deliberately strips suggestions when
revalidating persisted evidence, and `ConflictResolution.tsx` derives `slots`
from `conflict.reasons`. This explains the absent move control; preserving the
reauthorization boundary is mandatory. This supersedes AUD-05's pending-retest
status: the corrected production worker progressed through offline/reconnect.

All temporary cluster owners completed their cleanup; no temporary audit
PostgreSQL server remained running. The queued supplement and performance runs
were stopped before they started after the critical blocker was confirmed.
The prepared performance suite uses one English/Light Chromium profile with
service workers blocked and explicitly records that limitation. It has only
been typechecked/listed, not runtime-validated, and reports no measurements yet.

## Authorized continuation: verified results

- `audit:sync`: **30 passed**, including the new live alternate-slot regression,
  current occupancy/holds, permission changes, unchanged durable evidence and
  explicit move resolution. Evidence: `sync-final.log`.
- `audit:offline`: **4 passed**, Arabic/English × Light/Dark, actual service
  worker, outage, reload, committed-response loss, exact retry, conflict reload
  and move. Evidence: `offline-repaired.log`.
- `pnpm test:privacy:local` after the API repair: **83 passed**.
  Evidence: `privacy-after-sync.log`. No shared database writes.
- Supplemental presentation inventory: **101 passed**, including actual 200%
  browser zoom, signed synthetic offline day sheets and 48-row print pagination.
  Evidence: `supplement-completed.log`. This supersedes the earlier interrupted
  attempt; fixture rendering and cancellation checks do not prove live mutations.
- Final workspace `pnpm run typecheck`: passed (`typecheck-continuation.log`).
  Read-only seed snapshot after the continuation is byte-identical to the
  original baseline (`seeds-continuation.json` versus `seeds-before.json`).
- The four original presentation timeouts each passed serial targeted retests.
  Latest composite is **624/624**, not a single frozen-build rerun. Logs:
  `presentation-retry-{mobile,tablet,desktop}.log`; JSON reports under
  `generated-artifacts/polish/audit-retry-{mobile,tablet,desktop}/`.
- Performance: **30 successful samples**, five journeys × three cold/warm pairs,
  across the initial run and corrected targeted runs. This is a composite,
  not a single frozen-build measurement. Keep failed attempts in the history.
  Initial calendar tests assumed the obsolete direct POST flow and a date outside
  cache coverage; the final measurement uses a current covered day and measures
  local durable acknowledgement, **not server-commit latency**. Doctor fixture
  reciprocal assignments are now created atomically; no schema constraint relaxed.

### Additional defect and retest

**AUD-09 — critical sync-cursor data omission/replay risk, resolved.**
The sync feed selected numeric receipt IDs as text and ordered by the output
alias, yielding lexical ordering (for example 10 before 9). A numeric cursor could
then skip or repeat receipts. Ordering now explicitly uses the underlying bigint
column. Integration tests and a boundary regression across 9→10 and 99→100 pass.
The test oracle's identical ambiguous ordering was corrected, not removed.

The restart authentication probe also needed the request method and URL fields
now required by admission checks. The isolated fault-injection fixture needed
ownership of its disposable feed table to create/drop its test trigger. Neither
change grants application-runtime privileges or changes shared schema.

### Performance results (milliseconds)

Profile: Chromium **152.0.7977.64**, Linux container, 1280×900 / DPR 1,
4× CPU slowdown, 150ms network latency, 1.6Mbps down / 750Kbps up,
production Vite build served by the existing loopback offline host.
Per journey fixture: one synthetic clinic, two doctors, three patients and three
initial appointments; no source seed rows copied. Six distinct booking slots are
used for the calendar samples. API timings below are pooled request-duration
medians, not endpoint or population percentiles.

| Journey | Cache condition | LCP median (range) | Max CLS | Key-action range | API median |
|---|---|---:|---:|---:|---:|
| Login | cold | 9640 (9596–10592) | .0026 | 1806–2788 | 176 |
| Login | warm | 9640 (9208–9696) | .0026 | 1625–2242 | 174 |
| Calendar/booking | cold | 13100 (12696–13164) | .0062 | 300–1239 | 163 |
| Calendar/booking | warm | 12200 (12084–12492) | .1471 | 284–1168 | 165 |
| Patient lookup | cold | 10760 (10740–11280) | .0061 | 366–951 | 162 |
| Patient lookup | warm | 9628 (9492–9992) | .0009 | 314–962 | 160 |
| Doctor day | cold | 9600 (9336–9648) | .0078 | 406–455 | 161 |
| Doctor day | warm | 8664 (8620–8928) | .0078 | 349–430 | 161 |
| Admin/KPI | cold | 10084 (10000–10224) | .0021 | 586–634 | 172 |
| Admin/KPI | warm | 9384 (9316–9712) | .0021 | 558–642 | 173 |

**Targets were not met or loosened.** Warm calendar CLS also exceeds .1.
The primary JS bundle is 1,392,029 bytes (411,069 gzip estimate); the test host
serves uncompressed assets with `Cache-Control: no-store`, and service workers
are blocked. Thus “warm” retains the browser/app context but cannot demonstrate
an immutable-asset/CDN cache benefit. Large transfer plus CPU throttling is a
concrete initial-render bottleneck; API medians near the imposed network latency
do not establish slow database execution. Action timings include network,
application debounce and automation/paint overhead, not field INP. Calendar
layout shifts when retained local data renders remain an unresolved finding.
These are high-impact lab findings, not evidence of production field percentiles.
The initial batch briefly overlapped a separate DB regression during its failing
calendar phase; the composite is exploratory lab evidence, not a clean final
performance acceptance run.

Raw sanitized samples, long tasks, navigation and categorized API timings/bytes,
cache state and thresholds: `generated-artifacts/bug-bash/performance-composite.json`.
Source runs: `performance-initial/` (login, lookup, KPI), `performance-doctor/`
(doctor), and `performance/` (corrected calendar). No credentials, request
headers, DOM, patient fields or response bodies are included in that aggregate.

### Remaining prerequisite decision

AUD-08 is not repairable by changing a selector. The real production booking
drawer always selects the local-first path; it does not provide server preview,
holds or the original patient-warning/override controls. Disabling cache or
crypto blocks booking rather than restoring online preview. Restoring that path
is a product-flow change; moving server-preview assertions into API integration
coverage is a broader regression-ownership change. Neither was silently done.
Until that decision and the missing manual checks are resolved, task completion
and a zero-unresolved-critical declaration remain unsupported.

### Local-first coverage decision and execution

The user approved adapting coverage to the delivered local-first workflow,
without restoring the legacy server-preview UI. See
`docs/testing/booking-coverage.md` for the assertion-by-assertion ownership map
and explicit gaps. AUD-08's coverage-strategy decision is resolved; this does
not claim the old controls exist or that every old UI interaction was tested.

The new real UI suite produced eight offline passes initially and four online
passes on targeted retest: **12 passing cases across the two runs**, not one
fresh full-suite run. Online assertions independently check durable local
acknowledgement before any server write, then actual automatic sync commit.
The initial four failures were caused by a test gate retaining the queue lock,
not a waived product failure. Scoped fixture cleanup now uses the existing
scheduling lock so in-flight commits cannot race deletion.

`audit:appointments` executes the unchanged server-authority assertions in a
temporary schema-only database: **19 passed**. The fixture gets trigger ownership
only for disposable audit-log failure injection. The clinic projection assertion
now includes the delivered `adoption` field while retaining exact-key and scope
checks. Evidence: `appointments-authority.log`,
`booking-local-first.log`, `booking-local-first-online-retest.log`.

Still incomplete: actual screen-reader announcements, the remaining all-role
manual keyboard inventory, identified rendered edit/Undo gaps, and performance
acceptance. The passing coverage above does not waive those requirements.

## Keyboard, actual screen-reader and specialized regression continuation

This section supersedes the preceding pending statuses without deleting failed
attempts or claiming that every possible interaction was manually tested.

### Executed coverage

- **12/12 canonical lifecycle cases passed**, real disposable API, Arabic/English
  × Light/Dark. Includes canonical edit, blocked move, duplicate save, reload,
  visible focus, Escape/containment/restoration, running-timer axe/Undo and
  separately controlled 9999ms/10000ms cancellation/rebooking checks.
  Latest booking JSON contains these targeted cases only, not a fresh combined
  run of every booking test. All seed-integrity attachments are unchanged.
- **12/12 additional keyboard-only role cases passed**: doctor error retry/day/
  patient-card/back; admin tables/dropdown/validation/modal exit and restoration;
  shared skip/navigation/mobile More/account dialog. Synthetic API fixtures,
  all non-GET requests blocked. These are observed automated keyboard journeys,
  not live authorization/mutation tests or human manual certification.
  Exact coverage and exclusions: `role-keyboard.md`.
- **Real Orca 48.2 execution** on real anonymous login/data pages generated
  179 reader announcement lines over 76 recorded steps, including dynamic
  device-error/locale announcements and 10/10 TOC focus destinations.
  This is actual assistive-technology output, not an accessibility-tree proxy.
  The Nix launcher failed twice; an explicit private D-Bus/AT-SPI registry
  supplied the real accessibility service. Historical setup failures remain.
- Focused real-Orca post-fix empty-submit retest: English and Arabic email
  labels, invalid state and localized explanations were announced automatically,
  before any manual refocus. Ordinary Tab then read each password error.
  **4/4 password/PIN focus regressions passed** (trusted PIN context is explicitly
  synthetic; it is not authenticated screen-reader coverage).
- Workspace typecheck passed after specifying the form event generic; source
  seed snapshot remains byte-identical. Web workflow restarted cleanly.
  Final mobile screenshot shows intact public login; it is not evidence of
  authenticated screens.

### Defects and retests

| ID | Severity / scope | Reproduction and actual result | Fix and evidence |
|---|---|---|---|
| AUD-10 | Serious focus loss; receptionist, both locales/themes | Keyboard-activate cancellation Undo; focused control disappeared and focus did not return to its card. | Request card focus after successful Undo. All 12 canonical cases pass, including axe with running timers. |
| AUD-11 | Serious focus loss; receptionist, both locales/themes | Save canonical edit; calendar refresh unmounted the card before one-frame focus restoration. | Restore through existing ticker while loading, using the page-title fallback when no card remains. No scheduling/deadline changes. Targeted retest then all 12 canonical cases pass. |
| AUD-12 | Serious validation discoverability; anonymous login | Empty-submit with real Orca: descriptions existed but were not automatically read in either language. | Focus first invalid field after React commits localized descriptions. Real Orca announced each email error automatically in both languages; four password/PIN focus regressions pass. |
| AUD-13 | High-impact lab performance findings; English/Light | Exploratory LCP/action misses and warm-calendar CLS .1471 under the stated profile. | Investigation identifies eager route dependencies, uncompressed/no-store test host, 300ms search debounce and likely conditional calendar geometry. No budget relaxation; no claimed field percentiles. Completed journeys and bounded actions do not demonstrate sustained hangs. Product optimization and deployment-like delivery measurement remain recommendations, not fabricated fixes. |

Orca evidence: `screen-reader-evidence/` and `after-focus-fix/`. Output records
reader-generated synthesis requests, **not human listening**, audible playback,
Arabic pronunciation, authenticated-role speech or exhaustive table traversal.
The table-region heading-key probe produced no output and remains inconclusive.
These limits are not recorded as passes.

### Remaining specialized-suite blocker

Command: `pnpm --filter @workspace/api-server exec tsx tests/privacy/local.ts audit:specialized`.
Result: **50 tests passed in nine files; six files BLOCKED**, underlying exit 2
(the pnpm wrapper returns 1). No failed/skipped tests are relabeled as passed.

Passed: import-validation (2), import-merge-boundary (2), merge-identity (2),
adoption-api (14), adoption-results-api (6), adoption-export (7),
adoption-export-db (1), admin-users (8), network-health (8).

Blocked:

- `import-db`, `merge-db`: require populated prerequisite workbook/operational
  identities unavailable in the schema-only target.
- `kpis-aggregates`, `kpis-api`: require the original 102-appointment baseline
  and prerequisite operational rows. Replacing the expected values with
  synthetic totals would weaken the original baseline assertions.
- `auth`: requires prerequisite clinics and an existing doctor user.
- `admin-directory`: requires a prerequisite patient for exclusion checks.

Source seed records exist and remain unchanged; they were deliberately not
copied or inserted into the temporary databases. Tests must not run destructively
against the shared development database to circumvent this boundary.
Developer-generation mode remains outside this ordinary-auth execution.

Only fixture compatibility was corrected: adoption cancellation now cancels
its own restricted-runtime backend, rather than assuming the distinct fixture
login can signal another role. Targeted trigger/scratch-schema privileges exist
only in the owned temporary cluster. All source/disposable seed fingerprints
are unchanged; every owned cluster stopped and its directory was removed.
Logs: `specialized-specialized-summary.log`, `specialized-run.log` and the
per-file `specialized-*.log` files under the ignored evidence directory.

### Clean performance rerun status

A final uncontended same-profile production-build run was interrupted by a
workspace restart, not a test assertion. Login and calendar each completed all
six samples successfully; two lookup samples were also recorded. The run is
not reported as a five-journey pass. Its raw directory is preserved at
`performance-clean-interrupted/`, with `performance-clean-final.log`.
The remaining lookup/doctor/KPI journeys subsequently passed (3 tests, 18 samples)
without competing tests. All 30 final samples have the identical production JS
build fingerprint. The partial two-sample lookup attempt is preserved, not used
in place of its complete three-pair rerun. No test PostgreSQL processes or
temporary clusters survived the workspace restart.

Final raw evidence: `performance-clean-composite.json`, assembled from completed
login/calendar pairs in `performance-clean-interrupted/` and the complete
remaining journeys in `performance/`. This is two uncontended batches across a
workspace restart, **not one uninterrupted run**. The profile, no-store/
uncompressed host, blocked service workers, tiny fixture scale and provisional
budgets are unchanged. These measurements supersede the earlier exploratory
composite as the current same-build lab evidence.

| Journey | Condition | LCP median ms (range) | Max CLS | Key-action range ms |
|---|---|---:|---:|---:|
| Login | cold | 9392 (9312–9548) | .0032 | 1609–1708 |
| Login | warm | 8924 (8908–8956) | .0027 | 1485–1578 |
| Calendar/booking | cold | 12156 (12128–12168) | .0062 | 211–1152 |
| Calendar/booking | warm | 11756 (11708–11852) | .1472 | 207–1034 |
| Patient lookup | cold | 9928 (9856–10068) | .0009 | 334–913 |
| Patient lookup | warm | 9312 (9300–9316) | .0009 | 319–874 |
| Doctor day | cold | 8968 (8924–8996) | .0071 | 355–388 |
| Doctor day | warm | 8520 (8512–8528) | .0071 | 334–341 |
| Admin/KPI | cold | 9744 (9740–9792) | .0027 | 489–521 |
| Admin/KPI | warm | 9152 (9148–9196) | .0028 | 494–548 |

All journeys completed; **performance targets still fail**. Passing execution
must not be confused with passing the performance budgets. Earlier cause
investigation and recommendations remain applicable.

## Final baseline execution and disposition

The user approved a one-time baseline initialization inside a newly owned,
empty disposable database. Exactly six source workbook tables were read in a
repeatable-read, read-only transaction; values stayed in memory during copying.
No source operational rows, sessions or credentials were copied. Independent
SHA-256 sheet fingerprints matched; seed-owner ownership, ALWAYS mutation
guards and read-only fixture/runtime permissions were enforced before tests.
Existing population code created separate operational fixtures.

Final command:
`pnpm --filter @workspace/api-server exec tsx tests/privacy/local.ts audit:specialized`

**120 tests passed across all 15 mapped files, zero failures, skips or
cancellations.** The six previously blocked files now pass:
import-db 14; merge-db 14; kpis-aggregates 6; kpis-api 6; auth 10;
admin-directory 10. The aggregate is the authoritative final run, not the
earlier partial 50-test execution. Per-file diagnostics are sanitized; earlier
group summaries remain historical. Source/copy fingerprints and protections
were checked before, between files and after; all owned clusters/directories
were removed.

Compatibility repairs were limited to fixtures: persisted session/device
authority for imports, refreshed sessions after role changes, numeric audit-ID
ordering and complete Express request metadata for restart probes. No
authorization, collision, immutable-seed or identity-review assertion was
removed. Original baseline KPI totals and import/merge rules remain asserted.

### Reading the final evidence

- Render/axe inventory: 624 presentation cases, including four targeted timeout
  retests, plus 101 supplemental cases. These render fixture states, not live
  mutation authority.
- Live booking/sync: 12 local-first/reconnect cases across initial and targeted
  runs, plus 12 canonical lifecycle cases; 30 sync and 19 appointment API tests.
- Privacy: 83 disposable tests after the conflict-suggestion repair.
- Additional keyboard role coverage: 12 fixture-based cases; public focus
  regressions and four password/PIN validation-focus cases.
- Actual screen reader: real Orca public-page execution and focused bilingual
  validation retest, with reader output retained and limitations documented.
- Performance: 30 same-build samples from two uncontended batches; all journeys
  complete, but LCP/action targets and warm-calendar CLS remain misses.
- Read-only source verification confirms all six seeds unchanged and all
  24 calendar-export rows remain marked for manual identity review.

No confirmed critical defect remains unresolved. Noncritical findings are not
hidden: slow lab startup/action latency and calendar layout shift need further
optimization; reader heading-navigation probes were inconclusive. Human
listening/Arabic pronunciation, exhaustive assistive-technology certification,
field INP, production delivery configuration, and developer-generation reset
mode were not established by this audit. Scripted keyboard evidence is not
represented as human manual testing. These are explicit coverage limitations,
not passing results. Existing developer-tools documentation/tests retain their
own ownership; the final ordinary-auth run does not relabel them as executed.

### Completion-check correction: historical conflict and merge safety

**AUD-14 — critical queue availability defect, fixed and retested.** Refreshing
an open proposal for a patient already merged could throw a reference-validation
error and fail the entire conflict page, hiding unrelated actionable work.
Conflict reads now narrowly convert ineligible references/missing update targets
into explicit existing-contract error reasons without stale suggestions.
Unexpected failures and authorization errors still propagate; durable proposals
are not rewritten or automatically resolved.

Merge eligibility now accounts for open modern conflicts through proposal
patient IDs, target appointments and affected appointments, with the existing
scheduling lock ordering and commit-time recheck. Resolved conflicts do not
block merging. HTTP integration evidence covers a historical merged-patient
conflict followed by an actionable conflict on the same page and successful
explicit resolution of the latter. Merge tests cover sanitized preview/commit
denials, real resolution then successful merge, and concurrent writer ordering.

Latest targeted results: **33 sync tests and 20 merge tests passed**, no
failures/skips/cancellations. These supersede the earlier sync total and add
targeted merge verification after the full 120-test specialized run; they are
not represented as a new full specialized run. Workspace typecheck passed;
seed fingerprints/protections remained unchanged and temporary databases were
removed. API workflow rebuilt and restarted cleanly.
