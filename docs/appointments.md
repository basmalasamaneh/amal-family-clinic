# Operational appointments

This service implements appointment scheduling only. It does not implement sync,
network lookup, consent capture, import, patient search, or a booking UI.
The six original seed tables remain read-only. Historical operational copies
are not repaired and no blanket overlap constraint is installed.

## Contract and authorization

Canonical routes use `/api`: `GET /appointments`, `POST /appointments`,
`PATCH /appointments/{id}`, and `POST /appointments/check`.
Doctor and front-desk accounts are permitted, within their authenticated clinic;
doctors are additionally limited to their own doctor identity. Administrators
are not booking superusers. Existing session cookies, origin checks and CSRF
headers apply. Clinic, doctor and patient references are validated server-side.

Lists retain required `clinicId`, `from`, `to`, optional `doctorId`, `patientId`, `status`, and opaque
`cursor`/`limit` pagination (default 25, maximum 100).
Create uses `clientOpId`, `clinicId`, `doctorId`, `patientId`, `startsAt`, `endsAt`,
and `source`. Patch requires `clientOpId` and `expectedVersion`; time and status
can change, but clinic/doctor/patient identity is not reassigned by this endpoint.
Cancellation is PATCH with `status: "cancelled"` (optional `cancelReason`), never
physical deletion. A stale version returns a typed conflict.

API status values follow the actual operational model: `booked`, `double_booked`,
`completed`, `no_show`, `cancelled`. Only `booked` and `double_booked` reserve time.
The earlier mock-only `arrived` value is not supported by the database and is not
silently translated into a different status. Inactive-status changes release
time; historical cancellations do not require moving old conflicting intervals.
Historical source text and absent historical `clientOpId` values are returned
without inventing a source or operation key.

## Conflict semantics

Preview returns exactly:

```json
{"ok":false,"conflicts":[{"type":"doctor-overlap","with":null,"severity":"blocking","suggestedSlots":[]}]}
```

`ok` means current rules permit a write, not that availability is reserved.
Blocking conflicts always prevent a write. Patient warnings prevent a write
unless an authorized staff member supplies a nonblank `overrideReason`.
Information alone never blocks. A reason never bypasses doctor overlap, holds,
or working hours. Preview uses the same engine, with optional `appointmentId`
for self-exclusion, and writes neither appointments nor override audits.

| Type | Severity | Translation key for consumers |
| --- | --- | --- |
| `doctor-overlap` | blocking | `conflict.doctorOverlap` |
| `slot-held` | blocking | `conflict.slotHeld` |
| `outside-hours` | blocking | `conflict.outsideHours` |
| `patient-overlap` | warning | `conflict.patientOverlap` |
| `same-day-other-clinic` | info | `conflict.sameDayOtherClinic` |

No literal prose is sent in conflict results. API failures retain
`{code,messageKey,params}`; clients can rerun preview to retrieve current conflict
details. Invalid/missing settings produce `INVALID_CLINIC_SETTINGS`, not an
always-open fallback.

Intervals are half-open `[start,end)`: adjacent appointments are valid.
Doctor conflicts are detected across all clinics for that doctor. Patient
overlaps are detected across all clinics, including the same clinic.
Cross-clinic same-local-date notices are emitted only when the pair does not
already have an overlap warning. Hidden appointments still participate in
conflict detection, but `with` is null. Visible references contain only
`appointmentId` and `clinicId`; no patient identity, clinical notes or history.

## Time and suggested slots

Operational instants remain UTC. Incoming appointment instants must be valid
UTC ISO 8601 strings ending in `Z`; duration must be a whole number of minutes,
1–1440. Seed instants are never converted a second time. Clinic hours and
working days are resolved using `date-fns-tz`; Amal uses `Asia/Hebron`.
The entire interval must remain within that local day's opening window.
Overnight opening windows are not supported by the prerequisite schema.

DST gaps do not manufacture shifted opening times. Ambiguous opening boundaries
use the earliest matching UTC instant and closing boundaries use the latest;
the full interval must still fit the local clock window, including any repeated
hour. Slot candidates retain distinct UTC instants through a repeated hour.

Suggestions are the nearest three eligible free slots, or fewer only when fewer
exist within the bounded search. Search covers 30 local dates starting at
`max(today, requested local date minus 15 days)`. Only starts strictly later
than server time qualify. Candidates align to the clinic increment measured
from local opening time, fit the requested duration, and avoid active doctor
and patient bookings and other owners' live holds. Sort by absolute UTC distance
from requested start, then earlier UTC start. Availability is not fabricated.

## Holds, atomicity and retries

`POST /appointments/holds` explicitly acquires a hold. Input contains
`clientOpId`, clinic/doctor/patient IDs, `startsAt`, `endsAt`, and optional
`appointmentId`/`overrideReason`. Success is a separate `{token,expiresAt}`
response, never an extra property on the conflict result.
`DELETE /appointments/holds/{token}` takes `{clientOpId}` and releases an owned
hold with a 204 response.

Holds last 30 seconds on the server clock, belong to the authenticated user,
and bind to the exact requested doctor/clinic/interval. No renewal is exposed.
Retrying the same operation returns the original expiry and does not extend it.
Other users cannot acquire over, consume, or release an unexpired hold.
Expiration is checked at use time, not by a cleanup job. Pass `holdToken` to
create/patch for atomic consumption on success; a missing or expired hold is
never a booking guarantee, and commit always rechecks availability.

PostgreSQL transaction advisory locking serializes appointment checks and writes
across server processes, including patient overlap checks. Server time is read
after obtaining the lock. This deliberately favors correctness over scheduling
throughput for the current clinic network. Later writers must participate in
the same locking protocol; an application-level mutex is insufficient.

Durable operation records bind `clientOpId` to the actor, target and normalized
request. Identical authorized retries replay the recorded outcome without
duplicate appointment or audit writes. Different requests under the same key
return a typed conflict. Replay still checks authorization. Appointment changes,
hold consumption, operation outcome and append-only patient override audit
commit together, or roll back together. Audits identify actor, operation,
affected appointments, reason and server timestamp. Preview and hold acquisition
do not record a booking override audit.

## Baseline evidence and verification

Verified source exact-start doctor pairs (appointment IDs):
`10/12`, `42/44`, `46/50`, `57/58`, `67/72`, `99/100`.
Cross-clinic patient pairs:

- `25/31`: patient 13, September 9, 2026, 10:45 Asia/Hebron.
- `67/81`: patient 1, September 12, 2026, 12:45 Asia/Hebron.

Historical classification ignores active-status filtering. The engine tests
also report ten additional unequal-start interval overlaps using the operational
30-minute default; these are not suppressed to force the exact-start count.

Run from workspace root:

```sh
pnpm --filter @workspace/api-server appointments:migrate
node lib/api-spec/appointments-contract.mjs
pnpm --filter @workspace/api-spec validate
pnpm --filter @workspace/api-spec codegen
pnpm --filter @workspace/api-server exec tsx --test tests/appointments-engine.test.ts
pnpm --filter @workspace/api-server exec tsx --test tests/appointments-api.test.ts
pnpm --filter @workspace/api-server test:contract
pnpm run typecheck
```

The additive appointment migration runs after the existing prerequisite setup
in `scripts/post-merge.sh`. It adds only operational version/idempotency/hold
support; do not use seed initialization or demo reset to install this service.

Persistence tests use disposable operational fixtures, never seed edits.
Backend-only changes need no visual/browser test.

Verified in the task workspace: 26 engine tests, 12 API/persistence tests,
85 contract/mock checks, 37 existing workspace tests, and workspace typechecking.
The API workflow starts cleanly; health returns 200 and anonymous appointment
access returns the prerequisite 401 error envelope.
