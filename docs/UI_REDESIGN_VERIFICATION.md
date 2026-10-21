# UI redesign verification

## Main-agent verification supplement

### Final focused presentation recheck

After the broad run, the original UI-kit tests passed **4/4** and the original
shell axe matrix passed **12/12**, with zero axe violations of any severity.
Fixes were limited to heading levels, distinct Arabic landmark labels, tour
entrance opacity, and minimum control target sizes. No existing tests changed.
The eight remaining original shell failures also reproduced without the tracked
redesign changes: three role routing/navigation expectations, two clinic states,
logout, mobile More navigation, and initial skip-link focus.

The broad-run aggregate below is historical execution evidence, not the final
failure count after these focused corrections. The saved screenshot/evidence
set predates the last heading/landmark/touch-target fixes; it still records
moderate landmark findings, despite the later original test matrix passing.

- New presentation evidence: eight shell/UI-kit AR/EN × Light/Dark checks passed
  after accessible-name and avatar-contrast fixes; zero critical/serious axe
  violations. Screenshots are new evidence, not replacements for existing test
  baselines. Shell images explicitly use the existing synthetic shell fixture.
- New offline-font Playwright check passed: both IBM Plex families and all four
  requested weights rendered after a real offline reload from the service worker.
  The new test accounts for Chromium's documented post-navigation connectivity
  signal behavior and checks actual glyph fonts using their PostScript names.
- Strict authored-style scan passed across 272 files. Contrast checks passed
  for 37 supported semantic pairs in each theme, not arbitrary color combinations.
- Real administrator login passed. English/Dark/Compact preferences applied
  immediately and survived reload. The browser-control session timed out during
  sign-out; doctor and reception login were not verified. No new device was enrolled.
  Normal login/session/audit metadata and browser preferences can change during
  this check; do not interpret data preservation as zero authentication writes.
- Final read-only fingerprints match the pre-change baseline for all six seed
  tables (3/5/25/102/32/24), operational appointments (326), patients (62), visits
  (42), consents (12), clinics (3), doctors (5), and waitlist entries (10).
- Amal frontend typecheck and production build passed. Full workspace typecheck
  failed in the untouched mockup-sandbox Vite plugin types (incompatible plugin
  context metadata / missing rolldownVersion); no cast or unrelated source fix
  was used to hide it.
- No existing test assertions, test-isolation configuration, snapshot baselines,
  API contracts, conflict engine, sync/offline implementation, authentication,
  or consent/visibility logic were edited.

### Scope limitations

Access Log is a doctor-authorized view within the existing privacy page, not
a new administrator route. Change Log reuses the existing admin audit route.
Patient-side “Who viewed my record” remains unchanged.

Existing behavior-heavy feature tables retain their implementations; shared
DataTable is integrated into the public data/visibility page and UI kit.
The existing adoption autonomy sentence mentioning “monitoring” remains because
the protected existing test asserts that exact sentence.
These limitations mean the brief is not fully satisfied and must not be
reported as an unconditional completion or full regression pass.

## Disposition

**Not a full regression pass.** Existing tests were executed without modifying
their assertions, fixtures, isolation setup, or baselines. No snapshots were
regenerated. The implementation was still changing during verification; this
is not evidence from one frozen build.

Database writes were confined to the existing disposable PostgreSQL wrappers.
The development database was used only for read-only snapshots/evidence.
`audit:specialized` verified unchanged fingerprints for all six source and
disposable seed tables, immutable protections, and owned-cluster cleanup.
No migrations, population, reset, or test DML were directed at the development
database. Backend/test/contract files have no tracked modifications in the
working-tree inventory below.

Evidence directory: `generated-artifacts/redesign-verification-backend/`.
The specialized wrapper also writes sanitized evidence under
`generated-artifacts/bug-bash/specialized-*.log`.

## Completed commands and counts

P/F/S below mean **passed / failed / skipped**, not unique test identities.
Node's totals include failing parent tests as well as failing subtests.
All counted completed runs reported zero cancelled tests.

| Command / scope | P / F / S | Evidence |
|---|---:|---|
| `pnpm test` | 43 / 0 / 0 | `root-unit.log` |
| Frontend `tsx --test --test-concurrency=1 --test-reporter=tap tests/*.unit.test.ts`, after initial implementation ready | 277 / 1 / 0 | `frontend-unit-ready.log` |
| Backend pure/domain/security-validation/deployment tests, closed-port dummy DB and synthetic session secret | 65 / 0 / 0 | `backend-pure-recheck.log` |
| `pnpm test:privacy:local` | 37 / 8 / 0 | `privacy-recheck.log` |
| Existing disposable `audit:specialized` | 114 / 10 / 0 | `specialized.log`; wrapper summary |
| Existing disposable `audit:appointments` | 19 / 1 / 0 | `appointments-recheck.log` |
| Existing disposable `audit:sync` | 17 / 17 / 0 | `sync-recheck.log` |
| Existing helper: auth-security | 13 / 0 / 0 | `auth-security.log` |
| Existing helper: security-boundary | 11 / 0 / 0 | `security-boundary.log` |
| Existing helper: security-routes-isolated | 0 / 1 / 0 | `security-routes-isolated.log` |
| Existing helper: reminders-api | 10 / 0 / 0 | `reminders-api.log` |
| Existing helper: reminders-hooks | 6 / 2 / 0 | `reminders-hooks.log` |
| Existing helper: reminders-import | 5 / 0 / 0 | `reminders-import.log` |
| Existing helper: reminders-lifecycle | 1 / 0 / 0 | `reminders-lifecycle.log` |
| Existing helper: waitlist-api | 15 / 0 / 0 | `waitlist-api.log` |
| Existing disposable developer-reset test | 0 / 1 / 0 | `developer-reset.log` |
| `pnpm --filter @workspace/api-server test:contract` | 117 / 68 / 0 | `mock-contract.log` |
| `pnpm exec node --test --test-reporter=tap lib/api-spec/waitlist-contract.test.mjs` | 2 / 0 / 0 | `waitlist-contract.log` |
| `pnpm exec node --test --test-reporter=tap scripts/check-ui-1-styles.test.mjs` | 2 / 0 / 0 | `style-lint-unit.log` |
| `pnpm e2e` (isolated harness, including existing screenshot comparisons) | 16 / 0 / 0 | `harness-browser.log` |
| Existing disposable `audit:offline`, serial | **4 / 0 / 0** | **`offline.log`** |
| Existing disposable `audit:booking --workers=4` | 14 / 10 / 0 | `booking.log`; `booking-failures.json` |
| Synthetic/frontend browser batch below, `--workers=4 --fully-parallel` | 25 / 29 / 0 | `frontend-synthetic-browser.log` |

Selected completed-command aggregate: **813 passed, 148 failed, 0 skipped,
0 cancelled**. These are execution events, with overlapping coverage across
commands, not 961 distinct assertions. Additional diagnostic clone runs below
are deliberately excluded from this aggregate, as are superseded attempts.

Non-test commands: `pnpm --filter @workspace/scripts security:backup:test`
**passed**, using its owned restored clusters (`backup-isolated.log`).
`pnpm --filter @workspace/api-spec validate` **failed**:
`Missing security/roles: /reminders/log`. The read-only readiness command passed
(`seeds-before.log`); final login/seed notes are supplied by the owning agent.

### Exact invocation inventory

Disposable audit prefix:

```sh
pnpm --filter @workspace/api-server exec tsx tests/privacy/local.ts audit:specialized
pnpm --filter @workspace/api-server exec tsx tests/privacy/local.ts audit:appointments
pnpm --filter @workspace/api-server exec tsx tests/privacy/local.ts audit:sync
pnpm --filter @workspace/api-server exec tsx tests/privacy/local.ts audit:offline
pnpm --filter @workspace/api-server exec tsx tests/privacy/local.ts audit:booking --workers=4
```

Frontend unit prefix:
`pnpm --filter @workspace/amal-network exec tsx --test --test-concurrency=1 --test-reporter=tap`;
all delivered `tests/*.unit.test.ts` files were explicitly expanded.

Backend direct-test prefix:
`pnpm --filter @workspace/api-server exec tsx --test --test-concurrency=1 --test-reporter=tap`.
Pure files: `appointments-engine`, `demographics`, `patient-search`, `alerts`,
`consent-policy`, `reminders-unit`, `waitlist-matching`,
`security-routes-bounds`, `security-routes-scope`,
`security-routes-validation`, `deployment-health` (each `tests/<name>.test.ts`).
The helper-owned tests in the table used that same prefix, one file per process,
with the prerequisite source URL available only to their existing snapshot helper.
The complete expanded commands are retained in each sanitized log.

Synthetic browser command:

```sh
pnpm --filter @workspace/amal-network exec playwright test \
  --config playwright.config.ts auth-validation-focus.spec.ts shell.spec.ts \
  ui-kit.spec.ts calendar.spec.ts booking-acceptance.spec.ts \
  cancellation.spec.ts audit-public.spec.ts --workers=4 --fully-parallel
```

## Failure interpretation

- **Frontend unit:** `auth.unit.test.ts`, “return destinations are internal and
  role-authorized only”: expected `/admin/kpi`, received `/messages`.
  The earlier during-redesign run was 273 passed / 1 failed; use the ready-run
  result above, not their sum.
- **Synthetic browsers (29):** shell 20 failures (three role landing/nav
  contracts; clinic/logout/session states; mobile More navigation; skip-link
  focus; twelve axe combinations); UI kit four axe failures; cancellation three
  old card/control timeouts; calendar one missing visible status/card; booking
  acceptance one focus-restoration failure. The log records every failed title.
  These were not waived as intentional redesign differences.
- **Booking (10):** cancellation boundary/Undo four failures; running-timer
  cancellation two (one confirmed `color-contrast` axe violation, one visibility);
  online acknowledgement/reload two dark-theme failures at
  `local-first.spec.ts:117` (expected at least one retained operation);
  embedded offline journey two dark-theme failures (replay-state boolean and
  visibility). Serial standalone offline **passed all four locale/theme
  journeys**. The parallel booking failures are retained; the serial pass does
  not erase them or prove their cause. Detailed safe locations and rule IDs:
  `booking-failures.json`.
- **Privacy (8):** strict doctor-query/cache contract at
  `consent-api.test.ts:212`; two consent fixture creations and three privacy
  regressions received **429 instead of 201**; two parent tests also fail.
  The first rate-limited privacy matrix aborts before registering its full
  historical subtest matrix, so 45 reported tests is not full matrix coverage.
- **Specialized (10):** adoption-results-api 1, admin-users 4,
  admin-directory 1, kpis-api 2, auth 2. Wrapper evidence includes exact test
  titles and assertion locations. Admin PIN-reset expected failure count 0 but
  remained 5 (`admin-users:204`); subsequent tests report `PIN_LOCKED` and
  **423 instead of 200** (`:233`). Auth's device-context query fails at
  `auth:124`. Other failures are authorization/cache/KPI expectations at
  adoption-results-api:165, admin-directory:131, kpis-api:75/:91.
- **Appointments:** all functional subtests pass; the extra failure is fixture
  teardown at `appointments-api.test.ts:116`, deleting operational appointments.
  The sanitized report does not retain raw SQL diagnostics; do not infer a
  specific constraint name.
- **Sync (17):** four fresh-process probes exit 1 rather than 0 with
  `ERR_INPUT_TYPE_NOT_ALLOWED` on the existing Node/tsx invocation; ten
  no-database suggestion tests fail their scheduling-lock assertion at
  `sync-conflict-suggestions.test.ts:60`; parent/teardown failures account for
  the remainder. No test or setup patch was made.
- **Other existing backend failures:** reminders-hooks opt-out/dispatch race
  (`reminders-hooks:113`, plus parent); developer-reset's expected injected
  rollback rejection (`developer-reset:105`); nested security-routes-isolated
  child regression failure. Mock-contract has 68 failures spanning contract
  validation, role/error matrix and mock operation/generated-schema checks;
  sanitized evidence retains assertion locations, not response payloads.
  These are in unmodified backend/contract/test scope. They are **not proven
  redesign-caused**, nor claimed historically passing without a frozen baseline.

### Additional existing-helper diagnostics

Without changing `withIsolatedAuthDatabase`, each delivered file was also run in
its owned clone with before/after seed fingerprints checked:

| File | P / F / S |
|---|---:|
| patients-api | 11 / 2 / 0 |
| alerts-db | 1 / 0 / 0 |
| alerts-lifecycle | 0 / 1 / 0 |
| consent-api | 31 / 5 / 0 |
| adoption-results-api | 6 / 0 / 0 |
| admin-users | 4 / 4 / 0 |
| admin-directory | 10 / 0 / 0 |
| kpis-api | 6 / 0 / 0 |
| auth | 7 / 3 / 0 |

Diagnostic aggregate: **76 passed, 15 failed, 0 skipped**; evidence
`clone-<file>.log`. Patient deletion's protected-FK assertion fails at
`patients-api:259` (plus parent). Alerts lifecycle's existing child population
command fails at `alerts-lifecycle:13/:18`; no source reset was attempted.
Consent reproduces strict-query and 429 fixture failures. Auth additionally
receives 401 rather than 200 at idle-expiry setup (`auth:170`, plus parent).
The adoption/admin-directory/KPI clone passes show environment/baseline
dependence; they do not replace the failing specialized-workbook audit.

## Limits and remaining commands

The owning agent reports the static guard passing, eight focused axe checks
passing, and Amal typecheck passing. Workspace typecheck is blocked by the
mockup Vite-plugin `rolldownVersion` peer/type mismatch. Those owning-agent
checks are not added to the independent counts above. The final targeted font
check was still running when this report was requested.

An initial serial full booking attempt exceeded the tool's 300-second execution
window: **one interrupted attempt, no passing count claimed**. The finite
24-test booking run above completed afterward. Initial pure-test invocation
failures caused by an absent synthetic session-secret prerequisite were
superseded by the 65/65 safe recheck. No more reruns were started after the
owning agent requested this report.

Remaining full matrices were **not run**, not silently skipped: dedicated
admin/adoption/doctor/KPI/network synthetic browser configurations; role-keyboard;
624-case polish and supplement matrices; production PWA/offline-booking and
performance profiles. Existing commands remain:

- `pnpm --filter @workspace/amal-network exec playwright test --config playwright.<name>.config.ts`
  for `admin`, `adoption`, `doctor`, `kpi`, `audit-role-keyboard`, `polish`,
  `polish-supplement`, `pwa`, `offline-booking`.
- Network synthetic-only: same prefix with
  `--config playwright.network.config.ts network.spec.ts`.
- Disposable production measurement:
  `pnpm --filter @workspace/api-server exec tsx tests/privacy/local.ts audit:performance`.

Live legacy reception/network/edit/sync/auth browser suites and the standalone
operational migration/population test were not pointed at the shared preview or
development DB. No existing allowlisted wrapper maps all their required
server/credential prerequisites. They remain blocked pending coordinated
disposable execution; do not set opt-in flags merely to bypass their guards.
There is no manual screen-reader, complete visual acceptance, or performance
approval claim.

## Working-tree source/config inventory

Read-only `GIT_OPTIONAL_LOCKS=0 git status --short` snapshot at report preparation.
This inventories the whole task working tree, not authorship of this verifier.
No tracked backend, contract, or existing test changes were reported.

Modified under `artifacts/amal-network/src/`:

- `admin/common.tsx`; `calendar/cancellation.css`; `day-sheet/day-sheet.css`.
- `components/ui/accordion.tsx`, `alert-dialog.tsx`, `alert.tsx`,
  `button-group.tsx`, `calendar.tsx`, `carousel.tsx`, `chart.tsx`, `command.tsx`,
  `context-menu.tsx`, `dialog.tsx`, `drawer.tsx`, `dropdown-menu.tsx`, `field.tsx`,
  `input-group.tsx`, `input-otp.tsx`, `menubar.tsx`, `navigation-menu.tsx`,
  `pagination.tsx`, `resizable.tsx`, `scroll-area.tsx`, `select.tsx`, `sheet.tsx`,
  `sidebar.tsx`, `table.tsx`, `toast.tsx`.
- `doctor/MyDayPage.tsx`, `doctor/PrivacyPage.tsx`, `doctor/strings.ts`.
- `index.css`; `kpi/KpiPage.tsx`; `locales/ar.json`; `locales/en.json`;
  `network/NetworkSearchPage.tsx`; `pages/data/DataPage.tsx`.
- `pages/ui-kit/KitHeader.tsx`, `pages/ui-kit/Section.tsx`,
  `pages/ui-kit/UiKitPage.tsx`; `pwa/pwa.css`; `reminders/MessagesPage.tsx`.
- `shell/AppShell.tsx`, `shell/ShellRoot.tsx`, `shell/routes.ts`;
  `waitlist/WaitlistPage.tsx`.

New under `artifacts/amal-network/`:

- `src/pages/ui-kit/ComponentsGallery.tsx`; `src/shell/nav-groups.ts`.
- `playwright.ui-1-evidence.config.ts`; `playwright.ui-1-fonts.config.ts`.
- `tests/ui-1-evidence.spec.ts`; `tests/ui-1-fonts.spec.ts`.

Modified under `lib/amal-ui/`:

- `package.json`; `scripts/build-tokens.mjs`; `tokens.json`.
- `src/components/PreferenceControls.tsx`; `src/components/Segmented.tsx`;
  `src/i18n/ar.json`; `src/i18n/en.json`; `src/index.ts`.
- `src/preferences/PreferencesProvider.tsx`;
  `src/preferences/account-storage.ts`; `src/preferences/storage.ts`.
- `src/styles/base.css`; `src/styles/components.css`; `src/styles/index.css`;
  `src/styles/tokens.css`.

New under `lib/amal-ui/src/`:

- `components/Data.tsx`; `components/DensitySwitch.tsx`;
  `components/Identity.tsx`; `components/Interaction.tsx`;
  `components/Layout.tsx`; `icon-map.ts`; `icons.tsx`.

Other source/config additions: `scripts/check-ui-1-contrast.mjs`,
`scripts/check-ui-1-styles.mjs`, `scripts/check-ui-1-styles.test.mjs`.
Modified dependency lock: `pnpm-lock.yaml`.
Non-source task artifacts also present: agent memory, supplied attached prompt
assets, `docs/screenshots/`, and this verification report.
