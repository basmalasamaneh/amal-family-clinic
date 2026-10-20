# Reception: Patients and quick Walk-in (P2-12)

## Patients (`/desk/patients`, front-desk only)
- Search reuses `PatientQuickSearch` (server-normalized Arabic/phone ranking). `paginate` adds "Load more" with the server's opaque cursor; results are de-duplicated by patient ID, stale responses are dropped (`createLatest`).
- Selection is by stable patient ID. The shell keys `<main>` and `WalkInProvider` by clinic, so a clinic/account switch remounts and discards selection, results, drafts and late responses. No React Query cache is used for patients.
- Detail shows demographics only (name, record, phone as LTR, date-only DOB, completed-years age). No clinical request exists in `src/reception`.
- Upcoming: `GET /api/appointments?clinicId&patientId&upcoming=true` (server keyset, chronological). Client keeps only `id, doctorId, startsAt, endsAt, status`, and defensively drops non-active rows and rows with `startsAt` before now (same rule as the backend). Refreshes on `amal:appointments-changed`.

## Registration
- Required trimmed name, phone (verbatim, leading zeroes kept), date-only DOB (no UTC conversion; any valid calendar date from 0001-01-01 up to today, matching the backend; leap years use Gregorian rules without Date, so years 0001-0099 are not remapped).
- Age policy: reuses the established **under 18 completed birthdays** rule (`MINOR_AGE`), counted against the current Asia/Hebron date. 29 Feb birthdays complete on 1 Mar in non-leap years.
- Minors: `guardianName` + `guardianRelation` required. When a valid DOB shows an adult, guardian values are wiped (`reconcileGuardian`) and never sent. Guardian data records no consent.
- Idempotency: the page owns a memory-only `RegSession` (never IndexedDB). An unanswered save (network/5xx/503) pins `clientOpId` + payload; close/reopen, Walk-in handoff and retry reuse it. A changed payload is blocked until the user restores the sent details (Retry same) — the original outcome must be reconciled first. Success selects the returned ID, bumps the search, and books nothing.

## Walk-in
- `WalkInProvider` (front-desk, per clinic) renders the shared `BookingDrawer` with `source=walk-in` over the current screen; the page underneath stays mounted.
- Entry points: header button (`link-walk-in`, desktop and mobile), Help, user menu, mobile More, tour card, conflict dialog, cancellation dialog, phone booking drawer and the registration dialog. Overlays that hold input stay mounted beneath the stacked walk-in drawer (registration is closed with its draft kept at page scope and a Resume banner).
- Measured existing-patient path, three action taps: (1) Walk-in, (2) select patient (search typing is separate, not counted), (3) "Book [doctor] at [time]" showing patient, clinic, doctor, date and interval. Tap 3 sets the exact server slot and runs the shared check, hold, then create (attempt keeper/clientOpId). Any blocking/warning conflict, failed check or hold stops and opens the existing conflict dialog or the confirm step. Nothing is acknowledged automatically.
- Nearest slots come from `GET /api/appointments/availability?clinicId&patientId` (generated `getAppointmentAvailability`). Single fetch with Retry; no polling, no browser free-slot maths.
- Context handoff: the phone booking drawer passes its explicitly selected patient and doctor; the calendar publishes its validated doctor filter while mounted. The provider drops context from another clinic or a patient from another clinic; the doctor is only a ranking hint, shown first with a "Selected doctor" tag when on the live roster, otherwise ignored with a note. A preselected patient still needs the explicit "Book doctor at time" tap. The original drawer stays mounted underneath with its input intact.
- New patient and conflict recovery are separate flows, not part of the three-tap count.

## Fixture
Only existing DEV fixture sessions use `createFixtureReceptionApi`; this is labelled in the UI and never sent to the server.

## Tests
`pnpm --filter @workspace/amal-network test:reception:unit` covers age boundaries, Hebron date, DOB validation, guardian clearing, payload trimming, error mapping, idempotent fixture create, upcoming projection and quick-slot ranking.
