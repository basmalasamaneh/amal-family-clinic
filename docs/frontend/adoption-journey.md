# Voluntary clinic choice

Reach `/work/adoption` through **Network choice** in the doctor or reception
navigation. This is not an automatic tour, upgrade prompt or deadline.
Server capabilities determine whether actions are offered. Reception and
nondelegated doctors see read-only explanations.

## Configuration and live demonstration

See `docs/clinic-adoption-handoff.md` for the explicit publication configuration.
`artifacts/api-server/src/adoption/scenario.json` deliberately ships unconfigured.
Select the operational identities for the scenario's Clinic 2 (trial) and
Clinics 1 and 3 (published results) explicitly; do not derive them from names,
record order or “all other clinics.” Rebuild the API after configuration.
The seven-complete-day observation window may honestly have no evidence.
Do not populate fake production measurements to make the demo look successful.

Use an isolated operational demo clinic with an explicitly delegated manager.
The existing adoption migration must have been applied. Never reset or update
the six workbook tables to prepare this story.

1. Open Network choice as that clinic's manager. Confirm Trial / active and
   local-only permissions. Reload: merely visiting must cause no adoption write.
2. Read the two published clinics' results. Explain units, sample counts,
   complete local-day window, partial coverage and calculation time. Unavailable
   is not zero; blocked commit attempts are not warnings.
3. Read “No monitoring of individual doctors,” including the distinction
   between aggregate service measurements and necessary access/security audit.
4. Choose Full once. Wait for confirmed status, then reload. No patient consent
   has been granted by this choice; clinical access still follows existing rules.
5. In a separate isolated trial scenario, choose Lite or dismiss the page.
   There is no subsequent unsolicited prompt.
6. Export independently. A browser download is not proof the user saved the
   file. A failed export must leave membership unchanged.
7. Read the adjacent exit consequences and click Leave network once. There is
   no second modal. Confirm Lite / left, retained local booking and export.
   Reload; Full must not be offered after departure.
8. Export again after leaving. Exit is not erasure or automatic rejoin.

## Failure semantics

One ref-held mutex prevents concurrent submissions. Unsent offline actions are
not queued. An uncertain lifecycle request records only its action/clinic target
in account-scoped session storage before sending. Reload never submits it:
the user deliberately retries that exact action. Definitive rejection or success
clears the marker. Server state is never optimistically upgraded.
Remote queries/selections are cancelled and cleared when lifecycle changes start
and after downgrade/departure; pending offline bookings are not deleted.

## Verification

- Workspace `pnpm run typecheck`: passed.
- `pnpm --filter @workspace/api-server adoption:test`: the 22 existing
  lifecycle/export cases and six new summary cases passed (run in focused groups).
- `pnpm test:privacy:local`: 83 passing tests in a disposable, schema-only
  PostgreSQL cluster. Covers Trial/Lite and consent/role restrictions.
- `pnpm --filter @workspace/amal-network exec tsx --test tests/adoption.unit.test.ts tests/shell.unit.test.ts`:
  11 passing tests.
- `pnpm --filter @workspace/amal-network exec playwright test --config playwright.adoption.config.ts`:
  all 16 scenarios passed across the initial pass and focused retry/offline
  rerun. AR/EN × Light/Dark, mobile overflow, axe, keyboard activation, explicit
  Full, Lite, export, leave, reload, uncertain outcomes and read-only behavior.
  Browser tests explicitly intercept synthetic API responses; they do not
  constitute evidence of real clinic performance. Backend integration tests
  separately exercise real authenticated routes and operational SQL.
- `pnpm --filter @workspace/scripts seed:verify`: all six tables and protections
  verified unchanged.

The initial offline browser expectation was corrected: without a signed offline
permit, the existing shell locks the page rather than keeping its controls
available. Neither lock nor reconnect submits a lifecycle mutation.

The account-switch regression adds four passing AR/EN × Light/Dark cases:
two managers of the same clinic retain separate pending-choice markers, returning
to the original account restores only its own explicit retry, and real doctor
identities retain the privacy link. Identity and role are passed intact from the
shell, not parsed from a colon-delimited display scope.
