# Amal Network security review — 2026-10-21

This is a focused code/control review with isolated automated tests, not a
certification, external penetration test or production readiness attestation.
The repository is no longer the health-only scaffold described in the original
plan: prerequisite adoption, export/leave, operational schema and authentication
are implemented and the current database has their tables. No prerequisite was
rebuilt. No production deployment or source seed repair/reset was performed.

## Evidence index

* [Every mounted route](security-route-inventory.md): 77 API method/path pairs,
  public docs, implicit HEAD and OPTIONS; actual Express-stack/spec comparison.
  No current contract-only operations; future absent handlers are **not reviewed**.
* [Session and PIN evidence](security-auth-evidence.md): expiry, row-lock timing,
  rotation/revocation, account-wide durable fifth-failure lock, recovery and devices.
* [Private backup and restore drill](security-backup.md): commands, exact scope,
  private manifest, failure cleanup, isolated restore and shared population routine.
* `tests/security-routes*.test.ts`: 15 passing route/input/scope/batch-bound tests.
* [HTTP boundary evidence](security-boundary-evidence.md): 24 passing tests in
  `auth-security.test.ts` and `security-boundary.test.ts` (13 auth, 11 boundary).
* `security-routes-isolated.test.ts`: 95 child tests passed, no failures/skips,
  covering KPI, import, merge, adoption/export and sync regression behavior.
* `pnpm run typecheck`: passed across shared libraries, all three artifacts,
  scripts and test harness. `git diff --check`: passed.
* `pnpm --filter @workspace/scripts exec tsx src/audit-readiness.ts`: before and
  after counts, content and schema digests identical for all six source tables.
* API and frontend workflows restarted successfully; unsigned Arabic login page
  rendered normally. An unauthenticated identity request returns expected 401.

## Boundary configuration

All limits use atomic PostgreSQL upserts in the existing auth-throttle table,
not process memory. Keys are SHA-256 digests; IPs normalize mapped IPv4 and group
IPv6 by /64. Failures to reach the counter database fail closed. Fixed windows
persist across instances/restarts; counts saturate at threshold + 1. Rejection
uses 429, `error.rateLimited`, and positive remaining seconds in `Retry-After`.

| Environment variable | Default | Key/window |
|---|---:|---|
| SECURITY_RATE_WINDOW_SECONDS | 60 | shared general/sensitive window seconds |
| SECURITY_RATE_GENERAL | 1200 | IP, every admitted request including public docs/health and preflight |
| SECURITY_RATE_LOOKUP | 120 | IP, network lookup, patient search/duplicates, availability |
| SECURITY_RATE_EXPENSIVE | 30 | IP, imports, merge, exports, KPIs, network health, audits, demo reset |
| SECURITY_RATE_SYNC | 240 | IP, sync routes; separate budget for shared-clinic polling |
| AUTH_RATE_WINDOW_SECONDS | 900 | all credential-entry dimensions |
| AUTH_RATE_IP | 100 | IP, login/PIN/reauth |
| AUTH_RATE_ACCOUNT | 20 | normalized account selector, independently |
| AUTH_RATE_DEVICE | 30 | verified device, additionally on PIN/reauth |
| AUTH_PIN_LOCK_MINUTES | 15 | authorized user ID, fifth failed PIN; not reset by changing IP/device/selector |

All values must be positive bounded integers (see `security-rate.ts`).
Rate keys contain no raw account strings or credentials. Operators should purge
expired throttle rows during private maintenance after the longest configured
window; deleting active windows weakens protection. This review does not install
a scheduler or distributed denial-of-service protection.

Production requires exact HTTPS `AUTH_ALLOWED_ORIGINS`. No wildcard, reflected
Origin, or implicit preview exception. `AUTH_PROXY_HOPS` defaults to zero and
nonzero values are prohibited in production. `AUTH_TRUSTED_PROXIES` accepts
explicit IP/CIDR entries; no aliases, /0, or IPv4-mapped IPv6 subnet spelling.
Only use addresses of the actual ingress, and prevent direct public access to
the origin. Forwarded headers from other peers cannot establish client IP or TLS.
Development can explicitly use hop-count trust for the preview; this must not
be copied into production. Network topology must be verified by deployment
operators; these local tests do not certify a future ingress configuration.

Helmet runs before origin/TLS errors, with deny-all API CSP, no framing,
nosniff, no-referrer and production HSTS for 31536000 seconds including subdomains.
Production rejects non-TLS requests. Session cookies are HttpOnly,
SameSite=Strict, Secure in production; only nonproduction permits HTTP.
All API success/error responses are no-store. Logs omit request bodies, cookies,
query strings and arbitrary paths; errors serialize only `{code,messageKey,params}`,
never raw SQL, connection details or stacks. Existing Arabic/English error keys
are reused; no UI or new authentication flow was introduced.

All cookie-authenticated mutations require the server session CSRF token and an
exact trusted Origin. Login/PIN are explicit bootstrap exceptions to *session*
tokens: mandatory exact Origin plus object JSON/non-simple media enforcement
protect login before a session exists. SameSite and CORS are defense in depth,
not the mutation authorization mechanism. GET handlers have no business
mutations; session last-seen and privacy audit entries are incidental exceptions.
KPI GET no longer writes metric snapshots; explicit refresh remains the writer.

## Resource and validation policy

Default JSON limit 32KiB; calendar upload 128KiB; mapped import 1MiB/100 rows;
sync push 2MiB/50 operations. The larger bounded parsers are required by actual
maximum-length Unicode/JSON-escaped inputs, not arbitrary limit increases.
No multipart upload contract exists. Route schemas reject unsupported media,
unknown fields and invalid types before business effects. Shared wire checks
reject noncanonical IDs, query arrays/unknown keys, malformed dates and security
headers; domain schemas constrain enums, pages and nested batches. Raw calendar
rows remain data for review, not implicit confirmed links.
HTTP request timeout is 30 seconds, header timeout 15 seconds, keepalive 5 seconds
and maximum header count 64. Deployment ingress must also bound connections.

## Findings and disposition

* Expired-session rotation and pre-lock expiry decisions: fixed with decisions
  after database locking; isolated concurrency/boundary/restart evidence.
  Device verification reuses that transaction connection so concurrent requests
  cannot starve the lock owner by exhausting the pool.
* Credential recovery bypassing PIN lock: fixed in both administrative recovery
  paths; existing active lock is retained.
* Missing reception fresh-PIN enforcement on commit/merge: restored.
  Export is doctor-manager-only, not a reception PIN operation.
* Scoped-admin KPI/network-health disclosure: authenticated clinic scope now
  binds queries; syntactically valid foreign clinic IDs are denied.
* Inconsistent generated Zod request errors: normalized through existing envelope.
* Missing common rate limits/Helmet, permissive production hop count, incomplete
  wire validation and undersized batch parsers: remediated as documented above.

## Scanner findings and residual limits

Initial dependency scan: 1 critical, 7 high, 5 moderate, 1 low. Compatible patches
for proxy-addr, brace-expansion, fast-uri, markdown-it, source-map-js and Vite
reduce the verified result to **0 critical, 1 high, 1 moderate**.
The remaining findings are build-only, not reachable API request parsers:
`braces@3.0.3` via mockup sandbox fast-glob (high, no published fix reported),
and `postcss-selector-parser@6.0.10` via typography (moderate, major upgrade).
Only trusted checked-in patterns/styles reach these tools. Do not expose these
build tools to arbitrary uploaded glob patterns/CSS. Replacing unrelated canvas
tooling is outside this API review; the findings are disclosed, not marked fixed.

Static analysis completed with two medium hardcoded-bcrypt reports; locations
resolve to schema/default declarations, with no real embedded account secret.
Dummy bcrypt comparisons intentionally use a noncredential constant to avoid
missing-account fast paths. The privacy/dataflow scanner failed to return a
valid result; it is **not passed**. No certification is claimed.

The original six source tables remain read-only. The initial read-only audit
confirmed counts 3/5/25/102/32/24 and 24 review-required calendar rows, and timezone
invariance. Backup evidence records before/after schema/content fingerprints
and denial probes on isolated copies. No restore writes to the existing database.
Source workbook timestamps retain Asia/Hebron interpretation; this change adds
no conversion, matching or clinical linking logic.
