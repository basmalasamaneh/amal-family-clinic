# Administrator, doctor and shared keyboard observations

## Scope and result

**Automated keyboard observations using explicitly synthetic, read-only presentation fixtures.**
This is not a manual accessibility pass, a screen-reader session, or evidence from
real patient/admin accounts.

The one focused execution passed **12/12 tests**: three journeys in each of
Arabic/English × Light/Dark, Chromium, with no retries. No production change was
needed. The existing 624 polish cases and 101 supplement cases were not rerun.
No performance measurements were collected.

Files:

- `artifacts/amal-network/tests/audit-role-keyboard.spec.ts`
- `artifacts/amal-network/playwright.audit-role-keyboard.config.ts`

The config has no web server/startup hook and uses the already-running preview.
The focused command used was:

```sh
pnpm exec playwright test --config artifacts/amal-network/playwright.audit-role-keyboard.config.ts
```

## Observed coverage

| Journey | Keyboard assertions |
| --- | --- |
| Doctor day → patient details → day | Tab reaches API-error retry; Enter recovers to populated day; Tab reaches patient opener; Enter opens the matching synthetic patient without an identity-bearing URL; clinical note is rendered; route announcement changes; Tab reaches the back link and Enter returns; shell action remains reachable afterward. |
| Administrator users | Named table scroll region and row edit action reached with Tab; edit dialog Escape restores the row opener; create dialog native theme select changes using End/Tab; empty-form Enter produces a focused alert summary without an API write; Tab/Enter on its error link focuses email; forward/reverse traversal remains inside the open modal; keyboard Cancel restores the add opener and the next Tab reaches the table. |
| Shared shell | Tab/Enter skip link focuses main; desktop navigation activates with Enter and focuses the destination heading; at 390px, Tab/Enter opens the More dropdown; Home/End reach first/last menu items; Escape closes and restores trigger; Shift+Tab exits trigger; account dialog Escape restores opener and subsequent Tab traversal reaches navigation. |

All cases assert the requested document language, direction and theme.
Desktop journeys use 1280×900; the shared navigation journey additionally uses
390×844 in every locale/theme combination. Bounded Tab traversal fails if a target
is unreachable; it never focuses an element programmatically to manufacture
reachability. Actions do not use mouse clicks, DOM focus injection, locator focus,
fill, or selectOption. Navigation/setup and viewport changes are automation setup,
not claims of keyboard actions.

Focus observations assert keyboard `:focus-visible`, a computed outline or shadow,
and viewport intersection at representative retry, patient-open/back, table,
skip-link and mobile-menu targets. Screenshots and computed-style JSON are
attached. These are rendered-style checks, not manual judgments of focus contrast
or full non-obscuration.

Announcement checks cover the nonempty, changing polite shell route status,
doctor day/card polite live regions, API-error alert, and focused validation alert.
They verify DOM semantics, **not spoken output or screen-reader timing**.

## Fixture integrity and evidence

The existing `bootAdmin` presentation helper supplies `/api/me`, preferences and
clinic identities unchanged. Additional patient/appointment/user objects are
explicitly synthetic; their IDs derive from the returned helper clinic rather
than product/demo identities. No DB fixture helpers, seed scripts or live writes
are used. A last-registered API interceptor blocks and records every non-GET
request before any helper mutation handler; tests assert both request and helper
write lists remain empty. Unhandled GETs stay inside the helper's closed 503
router, never falling through to operational APIs.

Evidence from the completed execution:

- `generated-artifacts/role-keyboard/focused/results.json`
- `generated-artifacts/role-keyboard/focused/report/index.html`
- `generated-artifacts/role-keyboard/focused/results/` (per-case synthetic
  request-safety attachments, computed-focus observations and screenshots)

A separate unauthenticated preview screenshot showed the sign-in page rendered;
it does not verify signed-in production UI. The role journeys above were verified
only under their synthetic presentation APIs. This focused suite does not replace
manual keyboard/screen-reader review, broader functional tests, axe/render
matrices, or the main audit report.
