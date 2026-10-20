# Appointment editing verification

## Entry point and behavior

On the live day or week calendar, open a booked appointment and choose **Edit or reschedule**. The editor reloads the authoritative appointment, retains its identity, and offers date, time and duration changes. Patient, clinic, doctor and source are not editable. Fixture calendars do not permit editing.

Saving uses the existing PATCH endpoint, version check, database lock and idempotency protocol. No server route or contract was replaced. Checks and optional holds include the appointment ID. Rejected commits leave the original booking intact. Version conflicts require explicit reload and review. Unknown save outcomes lock the form and offer exact-request replay, not a new mutation.

The appointment-change event refreshes calendar and patient-upcoming views. Reload and day/week navigation read persisted values. Local times use the existing Asia/Hebron date-fns-tz helpers; exact UTC intervals remain intact until changed.

## Focused verification

- `pnpm --filter @workspace/api-server appointments:test`
  - Includes self-exclusion, no-op update, same-key replay, immutable identity, whole-row equality after rejection, edit holds, stale preview and concurrent moves with one winner.
- `pnpm --filter @workspace/amal-network test:booking:unit`
  - Includes standard/summer timezone conversion, DST gaps/repeated hours, exact UTC preservation and idempotent attempt handling.
- `AMAL_EDIT_LIVE=1 pnpm --filter @workspace/amal-network exec playwright test edit-live.spec.ts --workers=1`
  - Four real authenticated UI cases: Arabic/English × light/dark.
  - Browser timezone is America/New_York; displayed/input times remain Asia/Hebron.
  - Prefill, draft cancellation, duration-only self-exclusion, persisted identity after reload, real commit-time rejection, stale-version recovery, narrow drawer bounds, axe, and moving from a day into a different week.
  - Disposable isolated operational fixtures, scoped cleanup, and before/after hashes of all six immutable seed tables. Never run a demo reset for these tests.
  - The commit-time UI test introduces a deterministic collision after preview through its isolated fixture. Actual concurrent API transactions are tested separately by the API suite.

## Broader booking suite handoff

Reuse the edit test IDs and fixture helper in `artifacts/amal-network/tests/edit-live.spec.ts` and `tests/helpers/edit-fixture.ts`. The comprehensive booking/accessibility task still owns combined booking/edit/cancellation flows, broader keyboard coverage and full-suite integration. Offline edit queues remain outside this feature.

Development CSRF configuration must match the exact current preview origin. Do not disable origin checks to make live tests pass.
