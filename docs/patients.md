# Operational patient API

Implemented GET/POST `/api/patients`, GET/PATCH/DELETE `/api/patients/{id}`.
The existing detail union is retained, but this service always returns only
`PatientBasic` demographics, for both doctors and reception. No UI is added.

## Authorization and data

Use the existing session/device authentication, role checks, clinic guard and
mutation CSRF token. Administrators have no patient-level access. A patient is
local when registered in the authenticated clinic or has an independently trusted
clinic-access grant. The migration initializes legacy grants from immutable seed
appointment/visit relationships only, never mutable operational bookings/history.
The runtime can only read those grants, not create or modify them. Appointment
creation/check/holds require this same independent relationship, so booking a
guessed patient ID cannot establish access. Future verified linkage is a separate
authorized service. This is demographic access, not a clinical-history API.
Consent, import suggestions, shared names and shared phone numbers do not grant
access. Merged-away records are inaccessible. Remote and nonexistent IDs both
return 404; remote records never enter candidate scoring or pagination.
`clinicId` in the response is the authenticated local context, not an ownership
claim. Existing shared patients have one demographic record; authorized local
updates affect that record, not a separate clinic copy.

Create accepts only `name`, `phone`, `dateOfBirth`, `clientOpId`. PATCH accepts
only the first three and requires at least one. Unknown fields (including scope,
normalized name, merge, guardian/consent and audit fields) are rejected.
Name is required, 1–200 UTF-16 code units, nonblank after normalization. Phone is
required, at most 40 code units and must canonicalize to optional `+` and 3–20
ASCII digits. Original name and phone strings are retained. DOB is **required**
by the existing operational schema/contract: a real, nonfuture `YYYY-MM-DD` date.
Missing/unknown DOB is rejected, never fabricated. DOB never becomes an instant;
raw input is checked before generated validators can coerce dates. New timestamps
are `timestamptz` UTC instants; the internal age reference is the current UTC date.
Consumers display instants in Asia/Hebron. No workbook instants are imported here.

Create operation IDs are serialized per clinic. The same ID and payload returns
the current still-accessible patient; changed payload conflicts. After deletion,
replay returns 404 instead of recreating a patient. These receipts do not implement
offline sync. Two different operation IDs always create distinct patients even
with identical demographics.

## Search

One pure normalizer is shared with the operational seed-copy fixture builder:
NFKD decomposition, removal of Unicode combining marks, أ/إ/آ/ٱ→ا, ة→ه, ى→ي,
trim/collapse whitespace, lowercase. Existing compatibility folding and tatweel
removal are retained. NFKD also decomposes Arabic presentation forms and hamza
combining marks (thus ؤ→و and ئ→ي); this is documented decomposition, not a new
transliteration table. Other letters are not broadly substituted.
Display names and all seed values remain untouched.

The separate phone canonicalizer removes whitespace, `.`, `-`, `(` and `)`.
It preserves leading zeros and optional leading plus, rejects other characters,
and does not guess country codes or equate `00` with `+`.

`q` accepts at most 200 code units. Absent, empty or normalized-empty queries list
all local records. A single character only matches exactly. Limit is an integer
1–100, default 25; cursor is an opaque base64url offset bound to query and clinic,
at most 512 characters and at most offset 10,000,000. Invalid/reused-for-another-
query cursors fail with 400. The list has `items` and nullable `nextCursor`, no
global count. Cursors are not snapshot isolation: concurrent edits may move ranks.

All authorized candidates are selected using parameterized SQL, then ranked
**before** pagination:
1. Exact normalized name **or** exact canonical phone: score 0.
2. Literal normalized-name / canonical-phone substring, query length >=2: 100.
3. Whole-name Levenshtein: 201 or 202. Query length 4–7 allows one edit;
   8–64 allows two; candidate names must be <=64 code points and similarity
   must be >=75%. Length differences prune candidates; row bounds terminate
   edit-distance calculation early. Numeric-only queries never use fuzzy scoring.
4. Nonmatches omitted. Every tie breaks by ascending numeric patient ID.

`%`, `_`, backslash and quotes have no SQL wildcard semantics. No query/name
goes to a remote service or AI. The deliberate full authorized-candidate scan
avoids incorrect page-local ranking; revisit indexing when clinic size requires it
without limiting candidates before ranking. Exact same-name and shared-family-
phone results are suggestions, never verified identity or automatic links.
All 24 calendar-export rows still require manual review.

## Persistence and deletion

Run `pnpm --filter @workspace/api-server patients:migrate` after existing
operational/auth migrations. Post-merge setup includes this additive migration.
It adds operational registration scope, independent legacy access grants,
immutable runtime create receipts and
indexes, then locks operational patient writers while backfilling **only**
derived names using the shared normalizer. No seed data or display names change.
Create/update maintain the same derived value.

DELETE locks the scoped patient row. Seed-backed IDs are protected. All existing
foreign keys into patients are restrictive: appointments, visits, consents,
alerts, audit patient references, merge candidates/targets, import suggestions/
confirmations, holds and notifications block deletion, including under concurrent
reference insertion. PostgreSQL FK locking enforces this; no cascade or preflight
check-and-delete gap is used. Future reference migrations must preserve this rule.
Conflict returns `409 {code:"PATIENT_REFERENCED",
messageKey:"error.patientReferenced",params:{}}`, with Arabic/English translations.
Existing protected audit FKs are never removed. New mutation events store only a
numeric patient ID in append-only audit detail (no demographics), so deleting a
new unreferenced record retains its creation/update/deletion trail and receipt.
The runtime cannot update/delete audit entries or receipt rows.

## Verification

`pnpm --filter @workspace/api-server patients:test` uses real existing auth
sessions and restricted database access with isolated synthetic fixtures.
It covers Unicode/phone behavior, exact-first pagination, fuzzy thresholds,
validation, role/clinic/device/CSRF denial, projection safety, idempotency,
protected deletion, guessed-ID booking followed by GET/PATCH denial, and immutable
six-table seed snapshots. Appointment regression fixtures explicitly grant access
before exercising cross-clinic conflict checks.
