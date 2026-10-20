# Clinic and doctor administration

These routes are mounted below `/api`. Authentication uses the existing session
cookie. Every mutation requires the existing `X-CSRF-Token` header and an allowed
Origin. Only administrators can access administration routes. Clinic-limited
administrators remain limited to their assigned clinic; only network
administrators can create clinics. All responses are non-cacheable through the
application middleware.

Requests and responses are checked against the generated API-Zod contracts,
in addition to the local strict validation and refinements. Generated Zod 3
request failures are explicitly converted to 400; invalid server responses
fail closed with 500. Generated PATCH defaults are validation-only and never
overwrite omitted settings.

## Shapes and endpoints

`AdminClinic`:

```json
{
  "id": 1,
  "name": "Clinic name",
  "city": "City",
  "bookingMethod": "phone",
  "slotMinutes": 30,
  "workingDays": [0, 1, 2, 3, 4, 5, 6],
  "openTime": "08:00",
  "closeTime": "17:00",
  "mode": "full",
  "timezone": "Asia/Hebron",
  "joinedAt": "2026-01-01T00:00:00.000Z"
}
```

`AdminDoctor` has `id`, `name`, `clinicId`, `specialty`, `email`, and nullable
`userId`. Directory administration does not expose passwords, PIN hashes,
session credentials, or credential generations.

| Endpoint | Request | Response |
| --- | --- | --- |
| `GET /admin/clinics` | Optional `limit`, `cursor` | `{items: AdminClinic[], nextCursor: string \| null}` |
| `GET /admin/clinics/:id` | Positive 32-bit ID | `AdminClinic` |
| `POST /clinics` | Required `name`, `city`, `bookingMethod`; optional settings below | `201 AdminClinic` |
| `PATCH /clinics/:id` | Nonempty subset of creation fields | `AdminClinic` |
| `GET /admin/doctors` | Optional `limit`, `cursor`, `clinicId` | `{items: AdminDoctor[], nextCursor: string \| null}` |
| `GET /admin/doctors/:id` | Positive 32-bit ID | `AdminDoctor` |
| `POST /doctors` | Required `name`, `clinicId`, `specialty`, `email` | `201 AdminDoctor` |
| `PATCH /doctors/:id` | Nonempty subset of doctor creation fields | `AdminDoctor` |

Clinic creation defaults are `slotMinutes:30`, `workingDays:[0,1,2,3,4,5,6]`,
`openTime:"08:00"`, `closeTime:"17:00"`, `mode:"full"`, and
`timezone:"Asia/Hebron"`. Slot minutes are integers from 1 through 1440.
Working days are distinct integers from 0 (Sunday) through 6 (Saturday), with
one through seven entries. Times are strict `HH:mm`; closing must follow
opening, including when only one time is patched. Overnight/equal-hour schedules
are rejected. Mode is `full` or `lite`, not the legacy directory adapter's
`network` label. Timezones must be recognized named IANA zones; numeric offsets
are not accepted. Names, city, booking method, and specialty are trimmed,
nonblank strings of at most 200 characters. Emails are valid addresses up to
254 characters and normalized to lowercase. Unknown fields are rejected.

Pagination is ascending by ID, defaults to 25 items, and permits 1–100 items.
Cursors are opaque, bounded, validated, and bound to the actor, resource and
effective clinic scope. A doctor filter cannot be changed while reusing its
cursor. A cursor confers no authorization. Unknown IDs return 404; invalid
input/cursors return 400, unauthenticated requests 401, denied scope/role/CSRF
403, and email/linkage conflicts 409, using existing localized error envelopes.

## Account and transaction policy

Creating a doctor creates a directory record only: no user, password, PIN,
session, or ability to log in is created. Account provisioning remains a
separate explicit user-administration operation.

Changing a linked doctor's email synchronizes its associated user's email in
the same transaction. Other account fields, including disabled state, role,
clinic, doctor assignment and credentials, remain unchanged. Credential
generation changes and existing session revocation use migration 0011's user
trigger; changed linked emails explicitly revoke active sessions as well.
Case-insensitive email collisions with either another doctor or an unrelated
user are rejected.

A clinic move is allowed only for an unlinked doctor without appointments or
visit history; linked doctors and history-bearing doctors return 409. This
prevents accidental reassignment of login authority or historical records.
Reciprocal doctor/user consistency is also enforced by the prerequisite
database's deferred constraints.

Every mutation uses a transaction and the common
`pg_advisory_xact_lock(31030,1)` via `lockAdministration`. Current session,
administrator role, disabled state and clinic assignment are rechecked after
acquiring that lock. Audit insertion uses `auditAdministration` in the same
transaction. Audit details contain only target IDs and changed field names,
never names, emails, raw request bodies or credentials. Failed audit insertion
rolls back the directory and associated-user changes.

## Existing directory behavior and verification

Existing `GET /clinics` and `GET /doctors` are unchanged. The scoped
doctor/front-desk `GET /clinics/:id` returns only
`{id,name,mode:"network"|"lite",timezone}`; it cannot expose another clinic or
administration settings.

No additional migration 0012 is needed. The operational core already enforces
clinic settings and reciprocal links; development administration migration
`0011_admin.sql` adds disabled users, credential invalidation and
case-insensitive doctor/user email indexes. Do not rebuild prerequisites or
change source tables. Production schema deployment uses Publish, not a startup
DDL runner.

Focused database-backed checks, after applying prerequisite development
migrations and mounting the router:

```sh
pnpm --filter @workspace/api-server exec tsx --test --test-concurrency=1 tests/admin-directory.test.ts
```

The suite creates isolated operational records, checks immutable source-table
contents, and cleans up only its own fixtures. It covers directory scoping,
settings validation, cursors, unique emails, explicit account policy, linked
session revocation, advisory-lock authorization races, concurrent duplicate
writes, safe audit details, and rollback when audit insertion fails. The
audit-failure test briefly installs a test-only trigger restricted to its own
actor and removes it in `finally`; run this suite serially.
