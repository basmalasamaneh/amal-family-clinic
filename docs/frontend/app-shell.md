# Amal app shell

## Integration and safety

The completed UI foundation remains in `@workspace/amal-ui` and `/ui-kit`.
The shell uses the P1-02 generated `getMe`, `listClinics` and `logout` clients.
Authentication screens, the public data disclosure, and role tours are now supplied by the login integration. Clinical workflows remain unimplemented.
All 18 destinations in master-plan Section 11 are placeholders; their route table
is the single source for navigation and direct-entry guards.

- Normal `/` loads the real session. A 401 routes to the localized real-API login screen.
  Other identity failures show an explicit retry state; unknown roles deny access.
- Clinic listing is presently a contract without a registered live handler. The
  shell preserves identity and displays clinic-unavailable/retry, never a fake clinic.
  When implemented, the paginated endpoint is consumed without assuming clinic count.
- Non-admin clinic choices are filtered against the session's assigned clinic.
  Empty clinics and failed clinic loading have different messages.
- Real logout uses the session CSRF token. Failure keeps the user signed in and
  offers retry; success clears the local session presentation.
- UI guards are not server authorization. Server endpoints remain responsible for
  access checks. Admin navigation does not allow patient-level clinical views.
- Connection status is explicitly static/demo, not measured online/offline state.
  Global search accepts text but explicitly says it did not search records.
- No seed or operational table is written by this feature.

## Explicit development previews

In a **development build only**, open:

| Query | Scenario |
|---|---|
| `/?shellDemo=front-desk` | Reception shell with one authorized clinic |
| `/?shellDemo=doctor` | Doctor shell with one authorized clinic |
| `/?shellDemo=admin` | Admin shell with synthetic clinic choices |
| `/?shellDemo=unknown` or `empty` | Denied unknown/missing role |
| `/?shellDemo=no-clinics` | No assigned clinics |
| `/?shellDemo=clinic-error` | Clinic unavailable with retry |
| `/?shellDemo=signed-out` | Session-required state |
| `/?shellDemo=error` | Identity failure |

Fixture names and IDs exist only in the isolated fixture adapter. A visible banner
identifies development mode. The query survives shell navigation and reloads;
fixture activation is not stored. Remove the query to use the real session.
Fixture logout ends only the in-memory synthetic session, not a server session.
Production builds ignore the query and exclude fixture activation.

## Display and dates

`AmalPreferencesProvider` has an account-scoped browser storage adapter. Stable
real account IDs and synthetic fixture IDs have separate namespaces. Loading and
signed-out states have isolated defaults; `/ui-kit` preserves its previous
anonymous preferences. Account changes remount preference state. Malformed or
blocked storage falls back safely; no cross-device persistence is claimed.

First use: Arabic, RTL, Light, Latin digits. Language updates document `lang` and
`dir`; theme updates document `data-theme` and the dark class. Display settings
offer Arabic-Indic digits. Only formatted presentation numbers/dates change:
identifiers, phones and stored data are never rewritten.

Shared formatters display offset-bearing instants in Asia/Hebron using
`date-fns-tz`; date-only strings are validated and formatted without zone shifts.

## Checks

- `pnpm run typecheck`
- `pnpm --filter @workspace/amal-network test:shell:unit`
- `pnpm --filter @workspace/amal-network test:shell`
- `pnpm --filter @workspace/amal-network exec playwright test`
  (shell plus retained UI-kit regression suite; requires running preview)
- `PORT=5173 BASE_PATH=/ pnpm --filter @workspace/amal-network build`
- `pnpm --filter @workspace/amal-ui contrast`

Browser checks exercise direct route permissions, browser history/refresh,
account preference isolation, clinic/search reset, keyboard dialog and More
menu behavior, and axe at desktop/tablet/mobile in all four language/theme
combinations. Mocked real-contract tests cover clinic authorization filtering,
logout failure/success and session expiry on clinic retry.
