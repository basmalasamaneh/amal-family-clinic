# Session and PIN security evidence — 2026-10-21

Scope: Task 39, existing P1-02 authentication/session policy only. This is focused implementation/test evidence, not a penetration-test certification or a task-completion claim.

## Executed verification

```sh
pnpm --filter @workspace/api-server exec tsx --test tests/auth-security.test.ts
pnpm --filter @workspace/api-server typecheck
```

Result: **13 tests passed, 0 failed, 0 skipped** (12 focused subtests plus their parent); API source and existing privacy TypeScript checks passed. No workflow was started/restarted and no application listener was started for these tests.

`tests/helpers/auth-isolated.ts` exports `withIsolatedAuthDatabase(async (admin, pool) => { ... })`. It follows the existing `developer-reset.test.ts` disposable-cluster pattern, without running its migrations/reset. The helper:

- Reads the current prerequisite database using `pg_dump --no-owner` for public, seed_guard, operational and operational_meta schemas.
- Restores only into a new private temporary cluster reachable through its private Unix socket; TCP listening is disabled. No source migration, population/reset, repair or restore occurs.
- Sets `DATABASE_URL` before dynamically importing the restricted runtime pool; callback runtime SQL uses `amal_app`, while privileged fixture setup is confined to the copy.
- Removes its cluster, dump and temporary directory after closing connections.

Boundary tests can reuse this helper, importing app/auth/db **inside its callback**. Each caller must run in a fresh Node process because the workspace database pool is a module singleton. The helper does not start the app; HTTP test-listener ownership stays with its caller. It requires PostgreSQL CLI binaries and an existing prerequisite database, and refuses production/deployment.

The six source tables are never written by this test. Fingerprints before/after **inside the disposable copy** match; restricted DELETE permission-denial probes cover all six copied seed tables. This evidence does not substitute for the review owner's independent before/after fingerprints of the original database.

## Demonstrated defects and narrow fixes

Before remediation the isolated suite reproduced:

1. **Expired-session rotation:** a reception session expiring after middleware authentication could still be rotated using stale request authority. `createSession` now locks and rechecks the existing session's revocation, owner, device binding and role-specific expiry using the database wall clock before issuing a replacement.
2. **Queued idle-session revival:** a request queued on the session row could pass its initial expiry predicate and refresh a session after its idle deadline. Authentication now acquires the row lock before evaluating expiry and updates activity using a nondecreasing database wall-clock timestamp.
3. **Queued PIN recovery rejection:** lock expiry was evaluated before waiting on the PIN-state row, with transaction-start `now()`. PIN verification now locks first, then reads wall-clock lock state; fifth-failure deadlines are computed after waiting/verification.

All three regression cases failed before their fixes and passed afterward.

The later real-HTTP shared-clinic test also demonstrated a pool-starvation defect in the initial row-lock remediation: concurrent requests could occupy every pool slot waiting on one session row while its lock owner requested a second connection to verify device trust. Authentication now verifies that device using its already-held transaction connection. Forty concurrent trusted reception requests pass without extending the eight-hour deadline. See `security-boundary-evidence.md`.

Code review also found credential-reset routes clearing active account lockout. The exported `resetPinFailures` helper preserves active failures/deadlines and only clears expired/nonlocked state. The route review worker wired it into both administrator credential-update and PIN-reset paths. Isolated tests verify changing the actual PIN hash and applying this helper cannot unlock access, including in a fresh OS process.

## Exact test coverage

| Focused subtest | Evidence |
| --- | --- |
| doctor/admin just-inside idle, exact boundary, concurrent denial and restart | Both roles accept read-only verification just inside 30m. An exact same-transaction SQL boundary is false; middleware rejects at/after it, eight concurrent attempts cannot revive it, and a fresh OS process rejects the cookie. |
| authenticated activity refreshes idle and read-only verification never refreshes | Read-only verification leaves the stored activity timestamp unchanged; normal verification refreshes the 30m idle deadline. Fresh-process verification accepts a valid session. |
| reception 8h absolute, concurrent activity cannot extend and restart denies expired cookies | Creation is eight hours absolute. Seven hours of idle inactivity remains valid; concurrent requests do not change the absolute deadline. Expired cookies fail across processes. |
| rotation revokes stale cookies and preserves reception absolute expiry | New opaque credential differs; old cookie immediately fails; absolute deadline is unchanged. Revocation immediately rejects the new cookie and subsequent rotation. |
| concurrent reauthentication of one session has one winner; logout cannot be raced into revival | Four rotations of the same authority produce one winner and three 401s. A held row lock deterministically queues rotation behind the exact logout revocation write, preventing revival; restart rejects the logged-out cookie. |
| expiry occurring after authenticate cannot be revived by session rotation | Rotation rejects stale authenticated request authority once its database session expires. |
| queued idle requests evaluate expiry after acquiring the session row lock | A request begins inside the idle window, waits behind a real database row lock until after expiry, then receives 401. |
| sensitive PIN freshness exact five-minute boundary, missing device and leading zero | `"0123"` verifies. Clock-controlled freshness accepts 299999ms and rejects 300000ms, missing device and anonymous authority. |
| atomic fifth PIN failure, 15m account lock, selector/device/IP changes and restart | Twelve concurrent failures yield exactly four 401s and eight 423s; stored failures stop at five and the deadline is 15m. Correct PIN remains locked on two distinct trusted devices, after email selector change and in a new process. Locked requests neither reset nor extend the deadline. Expiry plus successful PIN resets state. |
| queued PIN recovery evaluates lock expiry after acquiring the PIN row lock | A correct-PIN request queued behind a real PIN-state lock succeeds after the original lock deadline elapses. |
| credential recovery preserves active PIN lock and resets only expired counters | Actual hash replacement plus recovery helper keeps the original lock/failures, including across processes; expired state can subsequently be cleared and the new leading-zero PIN works. |
| source-copy seeds remain unchanged and restricted writes are denied | Copied seed fingerprints match; runtime writes are denied for all six tables. |

The account-lock verifier has **no IP/device/email key**: its durable primary key is the authorized operational user ID. Changing IP cannot select another lock row. The selector/device coverage above tests this helper invariant, not an HTTP forwarding-header bypass scenario; proxy/rate-limit HTTP tests remain the boundary review owner's responsibility.

## Policy and route review

- Doctor and administrator idle lifetime remains **1800 seconds**; reception absolute lifetime remains **28800 seconds**, including reauthentication rotations. PIN freshness remains **300 seconds**.
- PIN lock remains the **fifth** failure and **15 minutes** by default. Existing `AUTH_PIN_LOCK_MINUTES` remains an integer from 1–1440; tests explicitly select 15.
- Sessions/device credentials remain opaque, stored as SHA-256 digests, and session revocation/lock state remain PostgreSQL-backed. Fresh-process probes reuse existing `tests/restart-probe.ts`, not in-process module reloads.
- Existing consent mutations install `requireFreshPin`. The route worker added it to import commit and patient merge. Those route additions were inspected, but this suite exercises the guard/helper rather than each business endpoint.
- Clinic export is doctor-manager-only (`adoption/service.ts` manager guard); front-desk users are denied rather than granted an export exception. No front-desk PIN guard is needed to turn an unauthorized role into an authorized exporter.
- Login/PIN login-CSRF review: existing global boundary rejects missing Origin on mutations and any nonallowlisted Origin; the allowlist is explicit with no development fallback. This review did not add a competing auth flow. Full boundary HTTP positive/negative checks are owned by the main review; this helper-only suite does **not** claim them.

## Limits

These tests verify middleware/transaction behavior directly, not rendered UI, browser cookie policy, all HTTP endpoint envelopes, or real distributed production deployment. Logout concurrency uses the route's exact SQL revocation operation, not an HTTP logout request. Sensitive business-route wiring and recovery-route HTTP behavior must be covered by route-level tests. The database snapshot contains sensitive clinical/authentication data temporarily inside a private directory and is removed, not retained as a backup. Production rate limits/proxy/origin/header checks, backup handling and source-database invariance are separately owned evidence.

Subsequent combined regression command: `pnpm --filter @workspace/api-server exec tsx --test --test-concurrency=1 tests/auth-security.test.ts tests/security-boundary.test.ts` — **24/24 passed, zero skipped**; `pnpm --filter @workspace/api-server typecheck` passed again. The boundary companion now covers actual HTTP logout, login origin protections, headers, body limits and rate/proxy behavior in the same disposable-database model.
