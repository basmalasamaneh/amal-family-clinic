# Reception calendar (P2-03)

Code: `artifacts/amal-network/src/calendar/`. Mounted by the shell's `PageContent` for
`/desk/today`, `/desk/week` and `/desk/new-booking`; routes, guards, providers unchanged.

## Read adapter (`adapter.ts`)
`SchedulingReadAdapter` = `listDoctors(clinicId)`, `listAppointments({clinicId, from, to, doctorId?})`,
`clinicHours(clinicId)`. The real adapter uses generated `listDoctors` / `listAppointments`
(GET /doctors?clinicId=, GET /appointments?clinicId&from&to&doctorId), follows cursors,
and drops rows outside the requested clinic/doctor. Errors propagate: no mock fallback.
There is no hours/settings contract yet, so `clinicHours` returns `null` and no empty
bookable slots are drawn (a notice says so). The contract has no patient name; a localized
"Name not available" is shown until a name-bearing projection exists. Replace the adapter
by implementing the same interface; the UI only consumes the normalized types.

Mock mode is explicit, DEV builds only: `?calendarDemo=standard|empty|no-doctors|error|no-hours|slow`,
or any `?shellDemo=` fixture (implies `standard`). A "Demo data" badge is shown. Fixtures are
generated per supplied clinic ID (no hard-coded clinic), deterministic per clinic+date, UTC instants,
with overlaps, all statuses, long mixed Arabic/Latin and missing names. The labeled demo
date (`DEMO_DATE`) is offered without marking it as today.

## Status mapping (`status.ts`)
Lifecycle (`booked|double_booked|completed|no_show|cancelled|unknown`), `conflict` and
`syncPending` stay separate. Display priority: sync pending -> Waiting to sync; cancelled;
completed; no_show -> No-show; double_booked or conflict flag -> Conflict; booked -> Booked.
Unknown lifecycle renders "Unknown status", never Booked. Badges reuse `@workspace/amal-ui` StatusBadge.

## Dates (`dates.ts`)
Today = current Asia/Hebron date (`formatInTimeZone`). Date arithmetic is on YYYY-MM-DD labels.
Ranges are half-open `[from, to)`: local midnight of first day to local midnight after the
last, each converted with `fromZonedTime`, so DST days are 23/25h. Week starts Saturday
(`WEEK_STARTS_ON = 6`; no prior shell convention). Display honors the digit preference.

## State and scoping
URL holds `date` (omitted when today) and `doctor`; switching Day/Week keeps both. An invalid
doctor filter is removed. The shell remounts on clinic change; `useSchedule` clears results,
aborts and discards late responses via a latest-request guard. Booking context carries `clinic`
and is discarded if it does not match the current clinic.

## Booking entry
Context includes the selected local `date` (slot date wins) and doctor filter; Walk-in and sidebar Today/Week links carry valid `date`/`doctor`/`calendarDemo` from calendar pages (`carry.ts`). Day lanes are assigned on rendered grid rows so cards never cover each other. Unknown lifecycle stays "Unknown status" even with pending sync (shown alongside). Mock scenario labels are localized; DEMO_DATE always contains all six statuses.
New booking (1 tap), empty slot (1 tap, only with configured hours), and the shell Walk-in
button (front-desk role only, in the top bar on every authenticated desk screen, all widths)
open `/desk/new-booking?clinic&source&doctor&start&end`. Until P2-04 it is an honest placeholder
showing prefilled context and the patient -> doctor/time -> confirm steps, with no save.

## Checks
- `pnpm --filter @workspace/amal-network test:calendar:unit`
- `pnpm run typecheck`
- Browser: `/desk/today?shellDemo=front-desk` (+ `&calendarDemo=<scenario>`), ar/en x light/dark,
  desktop and 390px widths.
