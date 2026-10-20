# Isolated automated harness

This is harness smoke coverage, **not product acceptance coverage**. It does not
exercise Amal, Canvas, authentication, consent enforcement, booking, PWA caching,
offline reload or synchronization. No application server, database, account or
credentials are required. Existing product-specific scripts remain separate.

## Install

Use the repository's Node/pnpm toolchain (verified with Node 24.13 and pnpm 10.26):

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

On a supported Debian/Ubuntu host install Playwright's native browser dependencies
with `pnpm exec playwright install --with-deps chromium` (administrator permission
may be needed). On Replit/NixOS do not use apt: the config automatically uses
`/repl/tools/bin/chromium`, whose wrapper supplies native libraries. A downloaded
unwrapped browser can otherwise fail with `libglib-2.0.so.0` missing. For another
managed environment explicitly set `HARNESS_CHROMIUM_PATH` to its wrapped browser.
This override is only a local test setting, never a product dependency.

The lockfile pins Playwright and axe. Browser version, OS and installed fonts
affect pixels: use the same environment as baseline creation or deliberately
review/recreate baselines for the new environment. Installing a new browser alone
does not authorize accepting visual differences.

## Commands (from the repository root)

| Purpose | Requested npm alias | Equivalent pnpm command |
|---|---|---|
| Unit tests, finite run | `npm test` | `pnpm test` |
| All isolated browser examples | `npm run e2e` | `pnpm run e2e` |
| Accessibility only | `npm run test:a11y` | `pnpm run test:a11y` |
| Screenshots only (includes RTL) | `npm run test:screenshots` | `pnpm run test:screenshots` |
| Create/update baselines intentionally | `npm run test:screenshots:update` | `pnpm run test:screenshots:update` |
| Entire workspace typecheck | — | `pnpm run typecheck` |
| Harness typecheck only | — | `pnpm run typecheck:harness` |

`npm` here only runs scripts; do **not** run npm install. The pnpm installation
guard and lockfile remain authoritative. Neither runner watches or permits an
empty suite. Vitest discovers only `tests/unit/**/*.test.ts`; Playwright discovers
only `tests/browser/**/*.spec.ts`, so neither runner consumes the other's tests.
Do not add database integration tests to either default discovery pattern.

## Browser fixture and helpers

`tests/browser/fixtures.ts` extends Playwright's isolated per-test context.
Each example gets an ephemeral loopback HTTP server on a randomly allocated
port, synthetic localized HTML, and teardown that closes the server and restores
online state. No production or development app endpoint is contacted.

The four projects combine `ar`/RTL and `en`/LTR with Light/Dark color schemes.
The document uses localized resources, semantic controls/labels, `lang`/`dir`,
CSS logical properties, and no external fonts/assets. Fixed settings include
960×640 viewport, device scale 1, Asia/Hebron timezone, reduced motion, and a
fixed Date clock. Screenshot assertions wait for fonts, disable animation and
hide the caret; pixel tolerance is zero.

`withOffline(context, callback)` uses `context.setOffline(true)` and restores
connectivity in `finally`, including when assertions throw. The smoke test checks
`navigator.onLine`, failure of a real uncached fetch, the localized offline status,
and successful fetch/status recovery. It does not mock the probe with
`route.fulfill`, which could bypass the condition being tested.

Future product suites can import `withOffline`, `expectAccessible`, and
`expectStableScreenshot`, but should have a **separate** Playwright config and
script with an explicit app base URL/webServer, authorization fixtures and
disposable data ownership. Do not replace this isolated suite with a dependency
on the running app. Offline PWA and sync acceptance require their own assertions.

`expectAccessible` runs axe against the actual document and asserts that the
violation list is empty. It reports only rule IDs/impact rather than serializing
DOM or patient data. Axe is not a complete accessibility audit: keyboard,
screen-reader behavior, understandable content, zoom and real user testing still
need manual/product-level checks.

## Screenshot review and sanitized failure artifacts

Small approved baselines live in `tests/browser/baselines/<locale>-<theme>/`.
Review all four images when creating or updating. Run the update command only
after deciding that a change is intentional; inspect `git diff` and the images,
then rerun the comparison command. Never auto-update baselines in verification.

On mismatch, Playwright saves actual/expected/diff files under
`generated-artifacts/harness/results/`; the HTML report is under
`generated-artifacts/harness/report/`. Open locally:

```sh
pnpm exec playwright show-report generated-artifacts/harness/report
```

These output directories are ignored by Git and deployment. Traces, video and
general failure screenshots are off; assertion screenshots and error context
contain only the synthetic test document. Before sharing any future product
failure report, remove/redact identifiers, names, phone numbers, dates of birth,
clinical content, tokens, cookies, URLs and request bodies. Do not enable traces
against real patient records or commit generated reports. Only sanitized,
deliberately reviewed baselines belong in Git.

## Database safety and builder usage

See [testing-builders.md](testing-builders.md) for typed in-memory recipes based
on the completed operational contracts and eight-scenario fixture manifest.
Standard harness commands never connect to or mutate a database, invoke live
demo population/reset, or import the eager database entry point at runtime.
Type-only schema imports are erased.

Future persistence tests must opt into an explicitly **disposable** operational
database/dataset and use owned fixture IDs with narrowly scoped cleanup. Never
use demo reset or broad cascading cleanup as a test fixture. The six seed tables
`clinics`, `doctors`, `patients`, `appointments`, `patient_visit_history`, and
`calendar_app_export` are permanently read-only, including in test preparation.

## Verification

Browser installation completed in the task workspace. Replit's wrapped Chromium
152.0.7977.64 was used for checked-in baselines. The four baselines were created explicitly,
then compared without update mode. `npm run e2e` executed 16 passing checks;
`npm run test:a11y` executed 4 passing scans; `npm run test:screenshots` executed
4 passing comparisons. `npm test` executed 37 passing unit tests.
`pnpm run typecheck` passed for shared libraries, all application artifacts,
scripts, and the harness. `pnpm install --frozen-lockfile` also passed.

The operational prerequisite was confirmed merged before completion; its actual
schema, recipes and manifest were used. No schema installation or demo population
was required for this task.
