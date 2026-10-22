# Calendar import and patient merge API

These are implemented backend endpoints, not the separate wizard UI. The
published contract is `lib/api-spec/openapi.yaml`; generated Zod validators and
React Query clients are in the existing shared API packages.

## Access and safety

Only authorized doctors and front-desk users can use these patient-level
endpoints. Admin status does not grant access. Authentication, clinic/doctor
scope and CSRF protections apply; reports require current authorization too.
Never treat a name suggestion or a doctor/time match as a verified identity.

The six original workbook tables are read-only. Staging, review history,
provenance, receipts and clinical writes live in `operational`.

## Import workflow

1. `POST /api/import/upload` with `source: "seed"` and a UUID `clientOpId`
   stages the immutable export directly. Alternatively use `source: "json"`
   with bounded rows in the documented export format and a source display name.
   The upload limit is 128 KiB and 100 rows. There is no arbitrary XLSX/CSV parser
   or calendar-provider connection.
2. `GET /api/import/{id}` returns current review state, stable row IDs, batch
   version, suggestions, mapping issues and conflicts. All 24 real export rows
   initially require review; none are auto-linked.
3. `POST /api/import/{id}/map` takes `expectedVersion` and row actions.
   Each included action explicitly selects a doctor and either verifies an
   existing authorized patient using phone/DOB or stages a new patient with
   validated name, phone, date-only DOB and applicable guardian fields. Unknown
   DOB is not invented. A skip requires a reason. Replace a review to change
   identity or scheduling; do not reuse stale conflict checks.
4. Resolve all blocking errors before `POST /api/import/{id}/commit`, providing
   the current `expectedVersion` and a new UUID `clientOpId`. A timeout should
   be retried with the **identical** body and operation ID. Never generate a new
   key to resolve an uncertain outcome.
5. `GET /api/import/{id}/report?locale=ar` (or `en`) downloads UTF-8 JSON.
   JSON avoids executable spreadsheet formula interpretation. Reports preserve
   original source values while omitting phone/DOB verification input and
   unrelated clinical history. Final reports survive restarts and retries.

JSON upload and explicit rescheduling use naive `yyyy-MM-ddTHH:mm:ss`
Asia/Hebron wall time; operational appointment values are UTC instants. Repeated
or nonexistent DST wall times require correction. Display the returned local
values using the IANA zone, never a fixed offset.

### Browser-normalized CSV/XLSX/XLS/ICS rows

The server still accepts JSON only; binary upload and file parsing are not API
features. Browser adapters send the same six required fields (`event_id`,
`doctor_email`, `patient_name_typed`, `start_time`, `end_time`, `event_status`).
Legacy numeric IDs remain positive 32-bit integers and omit `event_uid`.
For external string IDs/ICS UIDs, send `event_id: 1` and `event_uid` containing
the full stable external ID. The UID is trimmed, case-sensitive, nonempty and
at most 1024 characters. Numeric strings, negative IDs, UID aliases and UID rows
with an event ID other than 1 are invalid. Malformed bounded rows remain visible
with `INVALID_COLUMNS` and must be explicitly skipped or corrected upstream.

Numeric provenance remains `(calendar_app_export, event_id)`. UID provenance is
`(calendar_app_export:uid:FULL_SHA256(trimmed_UID), 1)`, using the full 64-digit
SHA256 over UTF-8, with the full prior UID independently checked on every replay.
This bounds the PostgreSQL primary-key index even for long Unicode UIDs.
Filenames, file formats, row ordering and parser flags never enter identity.
UID and malformed staging rows use negative batch-local locators only; those
locators never enter the source payload, external provenance or source hash.
Duplicate canonical identities reject the entire batch, including whitespace
variants of the same UID. Different UIDs may all have `event_id: 1`.

All adapters must normalize times to the same Hebron wall-time contract before
submission; do not send parser timezone flags or extra format-specific fields.
Seed instants retain their existing UTC interpretation and equivalent numeric
JSON rows retain replay compatibility. Source hashes use normalized timestamps
and trimmed UIDs, never display names or internal locators. Every replay still
requires manual identity review and exact association checks. A changed payload
for an existing UID returns `IMPORT_SOURCE_CHANGED`; it never silently replaces
a booking. Scope, verification and scheduling conflicts remain unchanged.

Run the owned suite through the existing disposable snapshot wrapper (source
database is read-only; all test writes occur in its private local clone):

```sh
pnpm --filter @workspace/api-server exec tsx --test tests/import-isolated.test.ts
pnpm --filter @workspace/api-server typecheck
```

Doctor conflicts block, adjacent half-open intervals do not. Cancelled rows
do not occupy a slot. Existing-appointment overlaps, intra-export pairs and
source-event replays are separate findings. No override reason permits a
doctor collision. An explicit existing-appointment association must agree on
identity and fields. Patient overlaps also always block, within or across clinics:
the same patient ID or different IDs with all three exact normalized name, phone
and date of birth values matching. The legacy `overrideReason` schema field is
retained but ignored for overlaps; no acknowledgement or reason permits commit.
Same-day other-clinic nonoverlap remains informational and needs no reason.

## Duplicate review and merge

`GET /api/patients/duplicates` returns bounded cursor pages of eligible pairs
with record versions. Eligibility requires all three exact canonical fields:
normalized name, date-only DOB and canonical phone. The two original Samer
Khoury records are not duplicates.

`POST /api/patients/merge` requires `sourceId`, `targetId`, `sourceVersion`,
`targetVersion`, `confirmed: true`, `reason` and UUID `clientOpId`. The survivor
is the explicitly chosen target. The source remains a tombstone and its
original audit identity is retained. Retries use the identical request.

Eligibility is not permission to merge. Any consent evidence, mismatched
visibility rights, unsafe references, stale records, aliases/chains or unsafe
collisions block the operation. These cases must not be resolved by deleting
history or weakening the checks. See `patient-merge-references.md` for the
reference inventory and conservative consent policy.

## Development setup and checks

Existing operational, auth, patient, booking and consent prerequisites must
already be installed. Do not run seed resets to make these endpoints work.

```sh
pnpm --filter @workspace/api-server imports:migrate
pnpm --filter @workspace/api-server merge:migrate
pnpm --filter @workspace/api-spec compose:imports
pnpm --filter @workspace/api-spec codegen
pnpm --filter @workspace/api-spec validate
pnpm --filter @workspace/api-server exec tsx --test tests/import-isolated.test.ts
pnpm --filter @workspace/api-server merge:test
pnpm --filter @workspace/api-server test:contract
pnpm --filter @workspace/scripts seed:verify
pnpm run typecheck
```

Import/merge contract source fragments are `docs/import-contract.json` and
`docs/merge-contract.json`. Compose them before code generation when modifying
these domains; do not hand-edit generated API files.
