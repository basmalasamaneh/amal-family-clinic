# Administrative screens

The existing Amal shell exposes `/admin/network-health`, `/admin/users-devices`,
`/admin/clinics-doctors`, and `/admin/audit`. Shell role checks deny unknown roles
and non-administrators; each upstream endpoint independently authorizes requests.

The clinic wizard uses the operational create contract, followed by optional
doctor-directory creation. Doctor records do not create login accounts.
An uncertain create response blocks automatic retry. Administrators can reconcile
against new stable IDs in a fresh list; any deliberate resubmission requires an
explicit duplicate-risk acknowledgement. Confirmed creation is never undone or
reclassified when a subsequent selector refresh fails.
An account-scoped session-storage safety bit (no form data or credentials)
retains uncertainty across closing, navigation and reload. It is written before
dispatch and removed only after a definitive outcome; reconciliation remains
required after reopening.

Health observations retain server connectivity and queue-coverage semantics.
Unknown work is not zero. Stale observations remain visibly stale, while
authorization failures remove cached rows from the display. Audit rendering uses
only the approved administrative projection, with Hebron-local date filters
converted to UTC boundaries.

## Verification

- `pnpm --filter @workspace/amal-network test:admin:unit`
- `pnpm --filter @workspace/amal-network test:admin`
- `pnpm --filter @workspace/api-server admin:test`
- `pnpm run typecheck`
- `pnpm --filter @workspace/scripts seed:verify`

The browser suite uses synthetic API fixtures with arbitrary identities and the
real shell. It covers Arabic/English and light/dark, responsive layouts, axe
checks, permissions, stale telemetry, audit pagination/privacy, ambiguous saves,
and management errors. A separate focused case covers reception account/PIN and
device enrollment/revocation. These mocked checks do not establish DB persistence.

A live authenticated check also created one synthetic operational clinic,
confirmed its 201 response, reloaded the list, and found it in the shell selector,
health and administrative audit feed. All six original seed tables were verified
unchanged afterward. The inline wizard's cancel-focus issue found during this
check was fixed and confirmed by the targeted browser regression.
Completion-check regressions also verify closing/reopening an uncertain create
after reload, and a confirmed save followed by failed clinic-selector refresh.
