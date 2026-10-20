# Administration API walkthrough

All paths below are relative to `/api`. Use an existing network administrator
session from `POST /auth/login`; keep its HttpOnly session cookie and send its
`csrfToken` as `X-CSRF-Token` on mutations. Send the configured allowed Origin.
Do not place credentials in URLs, logs, screenshots, or audit detail.

1. `POST /clinics` with
   `{"name":"New clinic","city":"City","bookingMethod":"phone","mode":"full","timezone":"Asia/Hebron"}`
   returns `201` with the generated clinic `id` and validated settings.
2. `GET /admin/clinics/{id}` reads those settings back. PATCH `/clinics/{id}`
   accepts a nonempty subset, for example `{"slotMinutes":20,"workingDays":[0,1,2,3,4]}`.
3. `POST /doctors` with `{"name":"New doctor","clinicId":<returned clinic id>,"specialty":"General","email":"doctor@example.test"}`
   returns the new doctor `id`, with `userId:null`. This alone grants no login.
4. If login is intended, explicitly `POST /admin/users` with canonical role
   `"doctor"`, the returned `clinicId` and `doctorId`, the same email, and a
   securely selected password (12–72 characters and at most 72 UTF-8 bytes).
   The user and reciprocal doctor association commit together. Read back
   `/admin/users/{id}` and `/admin/doctors/{id}`; neither returns credentials.
5. Create reception accounts with role `"front-desk"`, the clinic ID, and an
   exactly four-digit string `pin`. Enroll the actual shared browser with
   `POST /auth/devices` and `{clinicId,label:"device.reception"}`. The existing
   enrollment flow installs an opaque HttpOnly device cookie on that browser;
   a returned ID is not a credential. Do not copy credentials through admin UI.
6. `GET /auth/devices` lists registered devices. `DELETE /auth/devices/{id}`
   revokes trust and device sessions atomically; repeating it is safe.
7. `POST /admin/users/{id}/reset-pin` with `{pin:"<four digits>"}` clears lockout
   and revokes user sessions. It preserves device enrollment, but the user must
   sign in again. `DELETE /admin/users/{id}` deactivates rather than deletes:
   historical and audit references remain. Disabled accounts cannot log in.
   PATCH can explicitly reactivate. The last active network admin cannot be
   deactivated, demoted, or restricted to a clinic, including concurrent calls.
8. `GET /network/health` includes the new clinic immediately. Until a trusted
   device reports, it is offline, its local queue is unknown (`null`), and its
   last successful sync is `null`. See [telemetry contract](network-health.md).

User and registered-device lists use `page`/`pageSize` (default 1/25, max100).
Admin clinic/doctor discovery uses opaque `cursor`/`limit` (default25, max100).
Clinic-scoped admins cannot administer users, doctors, or devices outside their
scope or create new clinics. Network health intentionally enumerates all
operational clinics for administrator monitoring.

Every successful change inserts an append-only audit row in the same
transaction: actor, action, target ID, clinic, UTC server time, and changed
field names only. Audit failure rolls back the change. Secret values, names,
emails, sessions, and device credentials are not copied into audit detail.
Errors use `{code,messageKey,params}` with existing Arabic/English translation
keys. Human-entered names and clinical/source text are not translated.

## Time and seed boundaries

Opening/closing times remain clinic-local wall times; equal/overnight intervals
are rejected. Instants are stored in UTC. Display timestamps with
`formatInTimeZone(instant, clinic.timezone, ...)` from `date-fns-tz` (Asia/Hebron
for the workbook clinics), not a fixed offset. Asia/Hebron DST coverage is in
the seed verification and existing scheduling tests; these endpoints introduce
no workbook timestamp conversion. All six workbook tables are immutable.

Apply additive development migrations with `pnpm --filter @workspace/api-server
admin:migrate`. Run the focused suite with `pnpm --filter @workspace/api-server
admin:test`; run `pnpm --filter @workspace/scripts seed:verify` before and after.
These commands are not a production deployment or demo reset.
