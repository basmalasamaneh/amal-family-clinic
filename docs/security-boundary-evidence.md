# HTTP security boundary evidence — 2026-10-21

Task 39 focused automated evidence, not deployment certification or a claim that every route's business validation was tested here. Route inventory/scope evidence is maintained separately.

## Exact commands and results

```sh
pnpm --filter @workspace/api-server exec tsx --test tests/security-boundary.test.ts
pnpm --filter @workspace/api-server exec tsx --test --test-concurrency=1 tests/auth-security.test.ts tests/security-boundary.test.ts
pnpm --filter @workspace/api-server typecheck
```

Final combined result: **24 tests passed, 0 failed, 0 skipped**. Boundary suite contributes **11** (10 focused subtests and their parent); session/PIN suite contributes **13**. Both API source and existing privacy typechecks passed after the final auth connection fix.

## Isolation and secret handling

The boundary suite uses `tests/helpers/auth-isolated.ts` and dynamically imports the app after switching to a new private Unix-socket PostgreSQL cluster. It starts only ephemeral loopback **test** HTTP listeners, never a workspace workflow/server. The source database is read by `pg_dump` only. No source migrations, resets, source writes, restoration into the source, or edits to the six immutable tables occur.

The helper now passes source PostgreSQL host/user/password/database through parsed libpq **environment variables**, not a credential-bearing `--dbname` argument. It does not print that environment. Dump/cluster files are under a private `mkdtemp` directory and are removed in teardown. Copied immutable-seed fingerprints match before/after all HTTP tests. Original-source before/after fingerprint evidence remains separately owned.

## Tested defaults/configuration

The production defaults in `src/lib/security-rate.ts` are:

| Setting | Default | Key / purpose |
| --- | ---: | --- |
| `SECURITY_RATE_WINDOW_SECONDS` | 60 seconds | General and sensitive fixed windows |
| `SECURITY_RATE_GENERAL` | 1200 | `general:<normalized IP>` |
| `SECURITY_RATE_LOOKUP` | 120 | `lookup:<normalized IP>` |
| `SECURITY_RATE_EXPENSIVE` | 30 | `expensive:<normalized IP>` |
| `SECURITY_RATE_SYNC` | 240 | `sync:<normalized IP>` |
| `AUTH_RATE_WINDOW_SECONDS` | 900 seconds | Independent authentication windows |
| `AUTH_RATE_IP` | 100 | `ip:<normalized IP>` |
| `AUTH_RATE_ACCOUNT` | 20 | `account:<normalized email>` |
| `AUTH_RATE_DEVICE` | 30 | `device:<trusted device ID>` |

Database keys are SHA-256 digests. Counters are atomic PostgreSQL upserts in `operational.auth_throttles`, shared across processes/restarts. Rejected traffic saturates at `limit+1` rather than overflowing. IP normalization equates IPv4-mapped IPv6 and IPv4 and groups native IPv6 addresses by /64.

Tests explicitly reduce limits to general **80**, lookup **5**, expensive **4**, sync **4**, auth IP **15**, account **4**, device **3**, preserving the 60s/900s windows. This exercises configured thresholds quickly; it is not a load/capacity benchmark or a claim that default 1200/minute is appropriate for every production clinic.

## Executed subtests

1. **Helmet success/errors, no-store, CORS allowlist, login origin CSRF and JSON.** Real health, missing-route and origin-denied responses carry nosniff, DENY, COOP, no-referrer, restrictive CSP and no-store, with no `X-Powered-By`. Development does not emit HSTS. Missing/opaque/disallowed login origins and a disallowed PIN origin fail. Allowed JSON password login succeeds; credentialed CORS names only the allowed origin; session cookies are HttpOnly/SameSite=Strict.
2. **Malformed/oversize/unsupported media/encoding inputs.** Malformed JSON, unknown login fields, default body >32KiB, text/plain, form encoding, unsupported charset and unsupported content encoding return the established `{code,messageKey,params}` VALIDATION envelope, not stack/SQL output.
3. **Route-specific upload/map/sync parser budgets.** Bodies of 100KiB upload, 500KiB mapping and 1MiB sync pass parsing and reach authentication (401 without credentials). Bodies exceeding **128KiB**, **1MiB** and **2MiB** respectively receive 400 VALIDATION. This is parser-budget evidence, not valid business-import/sync fixture evidence.
4. **Cookie mutation CSRF/logout.** A valid cookie cannot logout with missing/forged token or a disallowed origin. Correct origin/token logout returns 204; the same session immediately returns 401 on `/me`.
5. **Shared clinic/general budget.** Forty concurrent requests using a legitimate trusted reception session from one clinic/IP all succeed. Ninety concurrent health requests admit exactly 80 and reject 10. A spoofed forwarded address cannot obtain a new budget with default proxy trust. Rejected attempts saturate at 81. A fresh OS process remains limited; aging only the copied test counter past 60s starts a new window at attempt one.
6. **Lookup/expensive/sync buckets.** Concurrent anonymous HTTP requests to `/patients`, `/network/health` and `/sync/state` reach authentication exactly up to each configured category budget, then receive 429. Each exhausted category survives a new OS process and renews after its own persisted window is aged in the disposable database.
7. **Sensitive actual paths/encoding.** Category assertions cover `/network/health`, `/admin/developer/reset`, `/audit`, `/admin/audit`, import commits, patient merge and clinic export. An encoded `/api/%70atients` request cannot escape an already-exhausted lookup bucket. Invalid percent encoding returns 400.
8. **Authentication account/IP/device budgets.** Eight concurrent incorrect passwords yield exactly four 401s and four 429s; account exhaustion survives restart and renews after its window. Exhausted IP state rejects changing selectors and spoofed forwarded addresses, then renews. A trusted device admits only three incorrect PIN verifications; its independent exhaustion survives a fresh process after account/IP buckets are removed **only in the disposable copy**. Aging the device window admits the correct PIN. Normalized mapped IPv4 and IPv6-/64 behavior are asserted.
9. **Production HTTPS/proxy/cookies in child processes.** HTTP plus spoofed forwarded HTTPS is denied when no proxy is trusted, and HSTS is present on that error. With explicitly trusted loopback `/32` acting as a test reverse proxy, forwarded HTTPS login succeeds and emits Secure/HttpOnly/SameSite=Strict cookies. Startup refuses production hop-count trust, HTTP or missing production origin allowlists, `/0` proxy trust and IPv4-mapped IPv6 proxy declarations.
10. **Immutable-copy seed fingerprints.** All HTTP traffic/fixture work leaves the six copied source tables unchanged.

Every exercised 429 asserts an integer `Retry-After` from 1 through its configured window, equal to `params.retryAfterSeconds`.

## Demonstrated correction

The new forty-request trusted-reception test initially timed out: session authentication held one database connection/row lock and attempted another pool checkout for device verification while queued requests occupied all remaining connections. The auth helper now uses its current transaction connection for device lookup. The exact previously failing HTTP scenario and both complete focused suites now pass. No rate-policy or app-boundary implementation was changed by this test worker.

## Limitations and deployment requirements

- New OS processes sharing one disposable database demonstrate durable shared counters; these are not production multi-host/edge load tests.
- Production HTTPS is simulated by explicit trusted loopback proxy metadata, not an actual TLS terminator. Deployment must prevent bypassing the trusted edge and configure only its actual IPs/CIDRs. `AUTH_PROXY_HOPS` must stay zero in production.
- Shared-clinic testing is 40 requests on one real reception session/IP, not 40 distinct staff/browser sessions. Budgets aggregate shared-NAT traffic. Production capacity and clinic sizes still require operational sizing.
- Fixed-window boundary bursts remain possible and are not presented as sliding-window protection. Edge volumetric protection and account-enumeration timing assessment are outside this focused evidence.
- Bodies below parser limits only prove they reach authentication; route-specific schema/scope/import/sync business tests are separately owned.
- This file does not claim all mutation routes' CSRF guards, every route's error envelope, browser UI behavior, log-stream capture/redaction verification or production penetration testing. Source inspection/inventory and route-worker tests supplement these checks.
