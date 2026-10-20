# Public-shell PWA

## Deployment and privacy boundary

Build `@workspace/amal-network` with `PORT` and `BASE_PATH` set. `BASE_PATH` is an
absolute pathname ending in `/`, for example `/` or `/amal/`. Host the resulting
`dist/public` under exactly that path, over HTTPS (localhost is a secure-context
exception), with `sw.js` served as JavaScript and not as a document fallback.
Preserve stable manifest/worker paths and allow the worker to be updated without
an HTTP-cache delay. Do not extend its scope using `Service-Worker-Allowed`.
Serve these as public static files: never inject session/user/clinical details into
the shell HTML, chunks, icons, translations or other precached build outputs.

`src/pwa/PwaNotice.tsx` must be mounted once by the application root. It registers
only in a production build; the development server does not install a worker.
Registration errors are non-blocking, translated and dismissible with a retry
control. Unsupported browsers simply retain the ordinary online website.

Workbox injectManifest precaches **build-time public files only**: index document,
JavaScript/chunks (including bundled Arabic/English dictionaries), CSS, local
Arabic/Latin fonts, logo/install icons and both public manifests. No runtime
cache route exists. No API, authentication responses, clinical data, cookies,
tokens, mutation responses or authorization decisions are persisted by the worker.
Public code and translation strings are not confidential.

Document fallback is restricted to same-origin, in-scope, top-level document
navigations for the public shell: root, login, data, ui-kit and one-segment
desk/doctor/admin pages. API, auth, docs, Canvas/`__mockup` and asset paths are
excluded. Fetch/XHR, iframe, image and other non-document requests never receive
the fallback document. `/login` is the shell's public login UI; `/auth/*` is an
excluded integration surface. The deployment server must implement corresponding
online document routing and must not route API/auth requests to `index.html`.

After one successful online load and worker activation, the **next** navigation
can start the public shell offline. There is deliberately no `clientsClaim`.
An offline reload/deep link can display the localized locked state when the
authoritative identity request fails. Cached shell availability is not permission
to read patient data or offline authentication. First-ever offline visits cannot
work. This PWA does not implement live data refresh, API polling, replay or sync.
The separate private IndexedDB layer owns its own authorization/lifecycle rules.

## Installation and localization

The two manifests have Arabic RTL and English LTR authored text and share the
same stable relative identity, scope and start URL (`./`). Because the manifest
files live at the mount root, these resolve to the actual deployed base path.
The HTML defaults to Arabic; the mounted notice component switches the manifest
link when shared i18next language changes. Changing language does not create a
second app identity. Browsers may retain the name/language captured at installation
until their manifest-refresh cycle; do not promise immediate OS-label updates.

The icons derive from the approved Amal mark in `attached_assets`, without
redrawing it. `scripts/generate-pwa-icons.mjs` reproduces 192px, 512px, 180px Apple
and opaque 512px maskable PNGs. The maskable mark is centered at 280px: its entire
square fits within the central 80%-diameter safe circle, preserving meaningful
artwork under circular/squircle crops.

Supporting Chromium browsers expose Install App from browser UI when their
installability/engagement policies are satisfied; no automatic install prompt is
forced. Headless checks validate manifest/icon/installability signals, not an OS
installation. On iPhone/iPad, use Safari's Share → Add to Home Screen (the exact
wording and browser support vary by OS release). Desktop Safari offers Add to Dock
on supporting macOS releases. Firefox desktop generally has no built-in standalone
PWA install UI; Firefox Android and other browsers differ. Private browsing,
enterprise policies, storage pressure, device/OS restrictions or disabled service
workers may prevent installation/persistence. Offline support can be evicted at
any time; it is not a backup. Verify actual installation manually on target
devices, including Apple touch icon and maskable cropping.

## Safe updates and cache lifecycle

Workbox revisions content and removes obsolete precache entries at activation;
`cleanupOutdatedCaches` additionally removes obsolete Workbox precache formats.
Cache names are dedicated to Amal public shell and include deployment scope,
avoiding collisions with other mounts. The schema suffix is `precache-v1`; normal
asset versioning uses Workbox content revisions rather than manual version bumps.
Do not purge unrelated caches or private data during a shell update.

There is no `skipWaiting`, activation message handler, `clientsClaim` or forced
reload. A waiting worker displays an accessible localized notice: save work,
close **all** Amal tabs/standalone windows, then reopen. Reloading a single tab
while another old tab is open does not apply the update. Dismissing the notice
does not activate it. Browsers check for updates on subsequent registrations /
navigations; there is no background update poll. Close/reopen all controlled
windows to recover from a failed install; Retry handles registration failures.

Ordinary development uses a different origin from production verification.
If a developer manually serves production on the normal dev origin, its worker
can control that origin afterwards. Remove that worker and its public cache
explicitly in browser developer tools before returning to development. Never
silently unregister production users' workers on application load.

## Focused verification

From `artifacts/amal-network`:

```sh
pnpm exec tsx --test tests/pwa.unit.test.ts
pnpm typecheck
pnpm exec playwright test --config playwright.pwa.config.ts
```

The production-only Playwright config builds to `dist/pwa-verification` with
`BASE_PATH=/pwa-check/`, then starts a loopback-only static verification origin at
`http://127.0.0.1:4178`. It refuses reuse of another server, uses fresh browser
contexts, and never uses the ordinary development origin. The fixture has **no
backend** or credentials; API/auth endpoints deliberately return
503 except `/api/me`, which returns an anonymous 401. One cleanup test intercepts
identity responses with explicitly synthetic projections and inserts synthetic
IndexedDB rows; it never touches a real account or database. Run only one verification pass at a time. The update test temporarily changes
the isolated generated worker bytes and restores them in `finally`; never point it
at a deployed build. No broad test-harness or workflow changes are needed.

The focused browser checks cover localized manifest identity/scope/icons and
Chromium installability signals; activated-worker offline reload/deep links;
locked state without an API; API and non-document failures without fallback;
public-cache contents including bundled fonts; excluded document paths;
accessible registration errors in both locales/themes; waiting updates preserving
input and activation only after all controlled tabs close. Navigation-policy unit
tests exercise both `/` and a nested base, cross-origin and iframe exclusions.
The synthetic cleanup check verifies cancellation preserves data, confirmed logout
clears every clinic for that user (including pending work), and another user's
records remain isolated. It also exercises browser connectivity in both locales/themes.
Installability is checked in a fresh normal Chromium profile; ordinary test contexts
are incognito, where installation is intentionally unavailable.
These checks do not claim actual OS installation,
live API authorization, or validation of private offline data access.

## Shell integration and verification results

The existing identity owner and clinic selector control private scope. Missing
clinic/expiry, unverified identity, fixture identity, session failure, offline events,
and unmount revoke access. Reconnecting does not unlock records: a verified identity
refresh is required. Local-midnight and visibility-return pruning supplement
pruning on every snapshot read/refresh. Storage errors produce localized feedback
without crashing the shell. Explicit logout warns before discarding unsent local
changes and clears all clinic scopes for the verified user; cancellation leaves
both session and data intact. Failed deletion leaves a locked localized warning
with retry and browser site-data removal guidance. A localStorage cleanup target
(stable user ID only, never a credential) preserves the warning across reloads
without granting access. If localStorage is unavailable, startup cannot rule out
incomplete cleanup and stays locked with explicit browser site-data removal and
storage-permission guidance. It never treats unreadable storage as an empty
cleanup marker. There is no account-removal endpoint/UI yet; its future
owner must call the documented cleanup primitive.

Verified: full workspace typecheck; 19 focused storage/connectivity/navigation
unit tests; all seven production browser checks (failed checks were fixed and
rerun individually). Production build emits a non-blocking large-chunk warning.
No operational refresh, queue replay, background sync, or offline login is implemented.

The cleanup-failure browser check forces a native IndexedDB deletion exception,
checks that login/private pages remain hidden, verifies retry failure and warning
persistence across reload, then successfully retries and checks scoped removal.
The combined-failure check denies localStorage and fails IndexedDB deletion,
then reloads and verifies sign-in/private pages remain locked with removal guidance.
