# Consent and visibility policy (Task 16)

## Authorization and field matrix

| Actor | Local demographics/scheduling | Local visits | Remote visits | Consent |
| --- | --- | --- | --- | --- |
| Front-desk | Existing clinic scope | Never | Never | Read scoped patient; record/withdraw with CSRF, trusted device and PIN fresher than five minutes |
| Doctor | Existing clinic scope | Full clinical projection for own patients | Full-mode requester and source, newest effective consent required | Read own-patient state/history only; no mutations |
| Admin / unknown | No new patient access | Never | Never | Never |

The existing demographics and appointment endpoints remain local-only; they do
not return clinical visit history. Network lookup uses the single centralized
`visitVisibility` and `projectVisit` policy. All other clinical read paths must
reuse that policy and the same audit/transaction discipline, not assume that
demographic or scheduling access grants clinical access.

**Own patient** requires both the independent clinic grant (local registration or
`patient_clinic_access`) and the authenticated doctor's exact triple in
`patient_doctor_access`. Migration 0005 provisions the latter solely from immutable
seed appointment/visit IDs. Names, caller-supplied clinic/doctor IDs, mutable
operational appointments, consent, and arbitrary operational visit insertion
never establish authority. New patients need an explicit independently verified
doctor relationship provisioned by a trusted administrative process; this task
adds no assignment endpoint. There is no guessed fallback. Own-patient clinical
authority applies only to visits sourced in the current clinic, regardless of
consent or Lite mode; it never unlocks remote notes.

Remote none/withdrawn means no visit or existence metadata. Basic discloses only
date, clinic and doctor IDs/names and the `basic` discriminator. Clinical adds
the original note as `complaint` and existing alert labels as `keyAlerts`; no
alerts are extracted here. Lite clinics neither consume nor publish remote
records. Local access remains available. Name-only matching is a suggestion,
not identity proof (`identityVerified: false`); duplicate names remain separate.
Network patients contain only ID, original name and permitted visits: never
phone, DOB, guardians, hidden counts, snippets or existence markers.

## Lifecycle and attribution

Current state is the highest consent ID, including none and withdrawn rows;
older grants never become current again. IDs are allocated under the global
exclusive lock. History is descending ID order and retains evidence, recording
user/clinic/time and guardian attribution in operational persistence. The public
Consent mutation contract is unchanged; GET returns `{current, history, effectiveLevel,
patient, eligibility, canWithdraw}`. `patient` is only the scoped `{id,name}`.
`eligibility` contains verified date-only `dateOfBirth` (or null), `ageStatus`
(`adult`, `minor`, `unknown`) and server Asia/Hebron `asOfDate`. Invalid, missing
or future DOB returns null/unknown; clients must not calculate age or infer adult
eligibility. `canWithdraw` is true only for front-desk with the latest nonwithdrawn
consent recorded in their current clinic; writes still reauthorize and require
CSRF/fresh PIN. Existing numeric recording attribution and timestamps remain;
no display name is guessed for reception users without a verified name source.
`current` is the newest record (possibly withdrawn), or null if no record exists.
POST record returns 201 Consent; POST withdraw returns Consent. Mutation schemas
are strict: caller attribution, clinic authority and timestamps are rejected.
Withdrawal requires the consent's recording clinic, independent patient scope,
and newest-row ownership; attempting to withdraw an older grant returns conflict.
Legacy records without attributable recording clinic cannot be withdrawn through
an inferred clinic. A scoped receptionist can record a replacement none grant.

ConsentInput includes level, signed/verbal evidence, UUID clientOpId and optional
guardian `{name, relationship}`. A guardian means guardian-attributed consent.
Under 18 uses existing completed-birthday policy on the current Asia/Hebron date;
Feb 29 birthdays complete on March 1 in non-leap years. Minor self-consent is
rejected, including none records. Grants require a valid date-only DOB; missing
or invalid age information never silently authorizes adult self-consent. Guardian
name/relationship must be nonblank. Demographic guardian fields are not evidence.
Withdrawal needs no new age assertion and preserves original guardian/evidence.
Errors use existing localized validation/forbidden/notFound/conflict keys.

Client operation receipts are clinic-scoped and bind actor, target, action and
canonical request hash. Exact retry returns the original response without
reapplying state; changed or cross-actor replay conflicts. The runtime cannot
delete/truncate or rewrite consent history: column-level privileges permit only
withdrawn_at updates, with a trigger allowing one active-to-withdrawn transition.
A new row supersedes without rewriting earlier grants.

## Ordering, audits and privacy

Every read checks authoritative operational state; no consent cache/session
claim is used. Shared global PostgreSQL transaction advisory lock 160005 covers
lookup through audit insertion and commit. Consent transitions use the exclusive
version then lock the patient row. This works across server instances. An in-flight
read ordered before withdrawal may finish returning its already-authorized
snapshot; once withdrawal commits, the next request acquires the lock and sees
the new state, including repeated queries and pagination. Responses use
`Cache-Control: private, no-store`; consumers must not retain protected caches.

Every disclosed cross-source visit is audited in the same transaction before
return, with actor, requester clinic, patient, source clinic/visit, consent level,
projection, UTC database time and server-generated correlation UUID. No-result
lookups and rejected route attempts are audited without candidate patient IDs.
No raw query, clinical text, credentials, guardian evidence or response body is
copied into audit detail. Audit failure rolls back/prevents disclosure and consent
mutations. There is no audit rewrite/delete endpoint. Existing append-only audit
triggers and runtime SELECT/INSERT-only privileges remain unchanged, as does
upstream appointment auditing. This task neither modifies nor invokes the
upstream privileged audit reset mechanism.

Existing administrative demo reset remains separate from runtime retention.
No reset exception is introduced into consent or audit triggers. Existing
administrative consent DELETE rights are unchanged; runtime DELETE/TRUNCATE and
evidence UPDATE rights are revoked. Dependent doctor-access links cascade only
with patient/doctor deletion, and replay receipts only with actor/clinic deletion, so
the existing privileged parent cleanup is not blocked by new foreign keys.
Clinical and audit foreign keys remain restrictive. This task's focused tests
retain synthetic history and audit records rather than invoking reset; the
configured operational-integrity validation exercises its pre-existing
transactional reset checks.
The existing population path restores optional clinic/doctor authorization links
from immutable source identities after its parent records exist. This is
compatibility maintenance for the new authority metadata, not a new reset path.

Matching is literal normalized name substring using the existing normalizer,
not fuzzy matching or phone matching. Query length is 2–200 (also at least two
normalized characters); limit is 1–100/default 25. Opaque keyset cursors bind the
authenticated identity/scope/query, contain only a query hash and last visible
patient ID, and confer no authorization. Visibility is rechecked before
pagination on every request; hidden rows cannot affect nextCursor or totals.
SQL filters eligible patients before fetching at most limit+1 patients. Each
patient includes at most the latest 100 visible visits (date descending, then
visit ID descending). Older visits are truncated without a total or hidden-count
indicator. Only visits actually disclosed on the returned page are audited;
lookahead patients and truncated visits are not disclosures.

Operational visit history currently stores date-only dates. Lookup interprets
their midnight as Asia/Hebron via date-fns-tz's IANA timezone conversion and
returns UTC ISO instants; it never double-converts upstream UTC appointments.
DOB remains date-only. Source names/notes remain original. Consumers handle
localized display, RTL and themes.

## Patient-requested reception-assisted access history

`POST /patients/:id/access-history` is not patient authentication or a general
reception audit feed. Every request, including each page, requires authenticated
front-desk, trusted device, CSRF, fresh PIN and the current independent clinic
patient scope (nonmerged operational patient). The strict body is
`{patientRequestConfirmed:true,limit?:number,cursor?:string}`. Confirmation is
required on every page. Limit defaults to 25 and is an integer in 1–100.

The result is `{items,nextCursor}`. Each item contains only `id`, UTC `at`,
`viewerName`, `viewerRole` (`doctor` or null), `viewerClinicName` and
`action:'patient-view'`. Only selected-patient `network.lookup` events with
`outcome:'disclosed'` and a recorded source clinic different from the requesting
clinic qualify. This reflects recorded cross-clinic disclosures, not every local
care access. There is one event per disclosed source visit, not necessarily per
screen/session. Denials, consent changes and the assisted history reads themselves
are excluded. Withdrawal does not erase past disclosures.

Viewer identity comes only from current verified doctor/user/clinic joins bound
to the audit actor's recorded clinic; missing or inconsistent links yield nulls.
No raw details, patient identity, notes, email, search terms or security metadata
are projected. Doctor-only `/audit` behavior remains unchanged.

Newest-first keyset ordering uses millisecond UTC time then ID consistently, so
submillisecond timestamp ties cannot skip rows. HMAC-signed cursors bind actor,
clinic, patient and trusted device using the existing server-only `SESSION_SECRET`
with a domain-separated signing payload. PIN reauthentication rotates session and
CSRF credentials without invalidating continuation on the same device. Cursors
confer no authority; server-secret rotation invalidates existing cursors. Each page rechecks scope,
confirmation, PIN, CSRF and current viewer joins. Successful assisted reads append
`patient.access-history.read` in the same transaction before returning, with
only correlation ID and outcome `read`; denied reads append a separate minimal
`patient.access-history.denied` without candidate patient ID. Audit failure fails
the response closed. All responses use private/no-store.

Migration writes operational structures only. All six public seed tables remain
immutable; no calendar-export linking/import/reset is performed. Run the additive
`consent:migrate` with the administrative migration connection after prerequisite
migrations, not through the restricted application pool.
