# Doctor network lookup and patient card

## Integration

The existing `/doctor/network-search` and `/doctor/patient-card` shell routes
use the authenticated, audited `GET /api/network/lookup` projection. The shell
search is hidden on these routes. Search is debounced by 350ms, limited to
2–200 characters and paged at 25 candidates. Each subsequent page replaces
the previous page so earlier protected responses cannot survive a later read.

The lookup now includes `effectiveConsentLevel` for already-visible candidates,
independently of each visit's visibility. Local Clinical access does not mean
network Clinical consent. The API's existing disclosure filtering and audit
transaction are unchanged. A candidate is never identity confirmation.

The card reruns the original audited query and matches the stable patient ID.
Only the query and selected ID are retained in scoped module memory; no protected
payload enters query caches, Web Storage, Dexie, analytics or browser URLs.
Reload deliberately loses selection. The API's existing GET query contract is
unchanged; server request logging strips query strings.

Every card refresh clears the old projection before fetching. Navigation,
focus, visibility, scope changes and failures discard or revalidate data;
visible pages also refresh every 60 seconds. Future consent writers should
dispatch `document.dispatchEvent(new Event('amal:consent-changed'))` after a
successful transition. The server remains authoritative across other clients.

Visit instants display in Asia/Hebron; source-date strings are not shifted.
Legacy start-of-day instants show dates without claiming a known midnight time.
Only rich authorized alerts are rendered, with verbatim excerpt, clinic/date
attribution and disclaimers. The legacy standalone alert string array is unused.

## Repeatable checks

With existing operational/auth/consent/alert migrations and the API/web running:

```sh
pnpm run typecheck
pnpm --filter @workspace/api-server consent:test
pnpm --filter @workspace/amal-network test:network:unit
AMAL_NETWORK_DISPOSABLE=1 pnpm exec playwright test \
  --config artifacts/amal-network/playwright.network.config.ts
```

The browser suite requires a disposable **development** database. Its live
test uses real cookie sessions, Express and PostgreSQL, not API mocks. It
adds isolated synthetic operational records, retains clinical/audit history
and revokes its sessions afterward. It neither resets nor writes seed tables.
Six-table fingerprints are compared before and after every live test.
The other specs mock API responses for deterministic race and failure checks.
Artifacts are excluded from Git under `generated-artifacts/network/`.

## Verification — 2026-10-20

- Workspace typecheck passed.
- 21 API/policy tests and 13 frontend unit tests passed.
- 28 browser checks passed across Arabic/English × Light/Dark.
- Axe: zero WCAG 2 A/AA and 2.1 AA violations in the changed network region
  across all four combinations; 390px responsive layout had no page overflow.
- Live query-entry → result selection → rendered timeline:
  Arabic Light 908ms, Arabic Dark 915ms, English Light 964ms,
  English Dark 1063ms (all below 10 seconds).
- Conditions: two same-name synthetic operational candidates, two clinics,
  local and remote visits, real API/database, 350ms debounce, running timers,
  fixed Date of 2026-10-20, browser timezone America/New_York and Asia/Hebron UI.
- Downgrade/withdrawal, local-versus-cross permissions, duplicate identities,
  stale requests, empty alerts, denied roles/direct navigation, storage/URL
  privacy, return focus, audit presence and unchanged seed fingerprints passed.
- Clinic-scope clearing is covered by unit tests and keyed shell remounting;
  current real doctor accounts are authorized for one clinic only.

Development setup needed the already-existing alert-provenance migration
applied and the fork's allowed origin corrected. No schema migration was
authored, no alert extraction added and no seed writes made by this feature.
