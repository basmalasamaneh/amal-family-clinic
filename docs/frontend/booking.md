# Reception booking and deferred cancellation

## Integration boundary

The completed calendar handoff and operational appointment service are consumed
without replacing the shell, implementing other backlog services, or changing seeds.
All writes use the generated appointment client and its existing session/CSRF handling.
The wire operation identifier is `clientOpId` (the database stores `client_op_id`).

**Live end-to-end booking/search is blocked upstream:** `GET /patients`,
`GET /doctors`, and `GET /clinics` are published contracts, but are not mounted
business services in the API router. The real shell reports its clinic-read failure;
the drawer never substitutes fixture identities or creates a patient backend.
Appointment check, hold, create, and PATCH cancellation services exist.
No live write or live patient-search verification is claimed by this frontend task.

## Patient search contract handoff

The UI sends the original query to `GET /patients?q=...&limit=25`; the service must
apply Arabic/Latin normalization over its authorized roster before pagination.
Strip diacritics, unify أإآ→ا, ة→ه, ى→ي, collapse whitespace and Latin case.
Phone matching also tolerates separators and Arabic digits in development fixtures.
Names in responses remain unchanged. An incomplete page is never re-filtered as
if it were the entire roster: `nextCursor` produces a narrow-your-search notice.
The endpoint must enforce the authenticated role/clinic and return only authorized
identity fields. Every selection uses an explicit patient ID; neither names nor
search results create, link, merge, or fetch clinical records.

## Booking

New booking, walk-in and selected slots share one three-stage drawer. Calendar
context is validated against the active authorized clinic. Each clinic change
remounts the drawer and clears its patient, doctor, checks and holds.
Preview is not a reservation. Conflict codes and server-supplied alternatives are
displayed without inferring availability; atomic creation remains authoritative.
Holds are requested at confirmation and use the server's 30-second expiry.
Warnings require an explicit acknowledgement and trimmed nonblank reason;
blocking types cannot be overridden. Current service roles allowed to book are
doctor/front-desk; this reception surface is front-desk-only, and server authorization
still controls every override.

Inputs and display use Asia/Hebron through date-fns-tz. UTC API timestamps are not
reconverted as source-local timestamps. DST gaps are rejected, repeated local
times are detected and explicitly explained. The drawer disallows crossing a
local date rather than inventing an overnight clinic policy.

## Deferred cancellation

Clicking a calendar card opens a destructive confirmation. The memory-only
cancellation store lives above route/card mounts. Confirmation marks the appointment
locally **pending cancellation**, but does not write to the server.

- Undo succeeds only when `now < deadline` and no mutation has begun.
- At `now >= deadline` (10 seconds), the state transitions once to sending and
  PATCH sends `status: cancelled`, `expectedVersion` and a durable operation ID.
- Undo never performs a restore mutation. Neither physical deletion nor restore
  endpoints are introduced.
- A retry reuses the exact target, version and operation ID. The calendar is
  refreshed on both acknowledgement and failure. Only acknowledgement announces
  cancellation success. A version conflict can be dismissed, followed by reviewing
  the refreshed appointment and initiating a new cancellation.
- Normal Today/Week/other reception navigation preserves pending work and Undo.
- Logout initiation, session unmount, pagehide/full reload discard unsent work.
  Already-sent requests cannot be recalled; the next calendar read is authoritative.
  These semantics are explained in the confirmation dialog. There is no offline
  queue and no success claim after abandoning unsent cancellation.

Read-only calendar fixtures omit API versions, so their cards cannot send a real
cancellation. Contract-route browser tests provide explicit synthetic versions and
intercept PATCH; they are **not** live integration evidence.

## Development evidence

Development-only `shellDemo`, valid `calendarDemo`, or `bookingDemo=1` enable
clearly labeled patient/booking fixtures. Simulated checks, holds and creation never
write to the server; production builds do not enable these modes.

Focused tests:

- `pnpm --filter @workspace/amal-network test:booking:unit`
- `pnpm exec vitest run tests/unit/cancellation.test.ts`
- `pnpm --filter @workspace/amal-network exec playwright test calendar.spec.ts cancellation.spec.ts`
- `pnpm --filter @workspace/amal-network exec playwright test booking-acceptance.spec.ts`
- `pnpm run typecheck`

Browser checks and any remaining limitations are recorded in the task verification
report. The six seed tables and calendar-export identity review remain untouched.

### Verification results

21 booking logic tests and 6 deferred-cancellation tests pass. Workspace
typechecking passes. Calendar/cancellation browser suite: all 10 cases pass across
the initial run and targeted rerun after excluding the unrelated first-run tour.
The acceptance pass verified duplicate identities, keyboard selection, preserved
inputs, blocking conflicts and three suggestions, reason-required patient warnings,
hold expiry/recheck, simulated commit and honest acknowledgement, cancellation
failure/retry, Undo across navigation, reload discard, nested focus trapping and
restoration, and Arabic/English × light/dark at desktop/mobile.

The matrix exposed a content-box sizing issue on the mobile conflict dialog.
Explicit border-box sizing fixes the measured 46px overflow; the focused matrix
regression passes for all eight language/theme/viewport combinations and is retained. Live clinic/doctor/patient integration remains blocked
as described above; these browser results are fixture/contract-intercept evidence.
