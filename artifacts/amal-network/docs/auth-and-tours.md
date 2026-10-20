# Login, data disclosure and tours (P2-02)

- `/login` — real API only. Password: `login({email,password})`. Reception PIN: `getReceptionContext()` (trusted-device cookie) shows the locked clinic; `loginPin({email,pin})`. PINs are normalized (Arabic-Indic to ASCII) and kept as strings; passwords are never transformed. GET /me (identity adapter) is authoritative after sign-in.
- `?next=` is honored only for internal, role-authorized shell paths (`src/auth/return-to.ts`).
- Session: any 401 from React Query reports once via `src/auth/session-events.ts`; auth failures (401/403/423/429) are never retried. A single GET /me re-check runs at `session.expiresAt`. Logout/expiry clear the query cache and CSRF token.
- `/data` — public disclosure; planned protections are labelled "Planned"; self-service withdrawal/export are disabled and labelled unavailable.
- Tours — `src/tour/*`. Key `amal.tour.v{version}:{userId}:{role}` stores only `completed|dismissed`. Help menu replays.
- Tests: `pnpm test:auth:unit`; `pnpm test:auth` (real API, env vars documented in `tests/auth.spec.ts`).

## Reproducible acceptance

From the workspace root, run `pnpm --filter @workspace/api-server auth:browser`.
This creates synthetic operational accounts in a transaction, enrolls an actual device through
the administrator API, and passes ephemeral credentials to Playwright in memory. It does not
write credentials to files or use mock authentication. Cleanup disables the actors, clears their
sessions/locks and revokes devices; audit-referenced identities remain for audit integrity.
The six workbook seed tables are never written. Use only the development database.

The API allowlist must contain the exact preview origin; forked task workspaces may have a
different hostname. Keep parent and task development origins explicit rather than permitting
arbitrary origins. Production configuration is unchanged.

Verification performed:
- Workspace typecheck and all 9 auth/shell unit tests passed.
- All 10 real authentication integration tests passed, including idle/absolute expiry.
- Real-API browser suite: 15 checks passed on the complete run; the remaining mobile
  keyboard/contrast check exposed content-box overflow, was fixed, and passed in isolation.
  Together these cover all 16 checks without skipped credential-dependent scenarios.
- Disclosure axe checks passed in Arabic/English and Light/Dark. Mobile login keyboard and
  axe checks passed in all four combinations with reduced motion.
- A separate browser journey verified doctor sign-in, tour navigation/dismiss/reload/replay,
  mobile focus, disclosure refresh and real logout. The Help overflow observed there was
  corrected by including padding in its width.

Scope extension approved by the user: add only the missing trusted-device clinic context
to the auth contract and generated client. Reception retains email plus PIN to distinguish
individual accounts on shared devices. `/clinics` remains an unimplemented authenticated
domain service; the shell reports that explicitly. No clinical workflows, consent services,
export generation, enrollment UI or doctor-performance analytics were introduced.
