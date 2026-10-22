# Doctor network coordination

The managing partner remains a **doctor**. Coordination is a separate,
explicitly scoped, read-only delegation, not an administrator role.

The approved practice setup grants Dr. Amal's existing account
`doctor.1@amal.example` coordination for Downtown, Al-Bireh and Nablus Road.
Her existing home clinic and local management delegation remain unchanged.
Other accounts, clinic participation decisions and patient consents are unchanged.

## Using the page

Sign in as Dr. Amal, refresh the page if already signed in, then open
**Network coordination / تنسيق الشبكة** at `/doctor/coordination`.

The page shows only the explicitly granted clinics:

- Participation mode and membership state.
- Aggregate prevented-conflict and median lookup-time evidence.
- The last seven complete Asia/Hebron days, sample counts and evidence coverage.
- Missing evidence as unavailable, not an invented zero.

Refresh reloads the current permission and results. This is an online-only page;
offline continuation does not grant coordination authority. Its payload is not
persisted in browser storage. Scope revocation is enforced by the API and the UI
rechecks its capability periodically and on focus.

## Boundaries

Coordination does **not** grant access to patient records, notes, individual
doctor rankings, device details, staff management, another clinic's export, or
another clinic's adoption settings. Clinical access keeps the existing
doctor/patient/consent rules. Local adoption decisions remain with the explicitly
delegated manager of that clinic.

The existing additional practice administrator accounts were not deleted or
changed. They are separate from this coordination delegation.

## Trusted operator maintenance

No public UI grants these permissions. The development-only operator command is
`scripts/src/network-coordination.ts`. It supports `migrate`, `grant`, `verify`
and `revoke`; requires `--demo`; and for permission operations requires exactly
one explicit doctor selector (`--user-id=...` or `--email=...`) and an exact
approved clinic list (`--clinics=...`).

Never infer scope from the doctor's name, grant all future clinics automatically,
or rerun broad practice-account setup to change this permission. The operator
command verifies seed integrity and preserves users, credentials, sessions and
local manager delegations. `verify` is read-only.

## Verification

The disposable adoption suite covers coordinator scope, denial, response privacy,
runtime grant restrictions, disabled/revoked authority and concurrent scope
revocation. Frontend tests cover capability gates and role routing. These tests
do not represent a real-world claim of improved performance or adoption.
