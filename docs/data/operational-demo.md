# Operational data and reproducible demo

## Boundary and commands

The seed prerequisite passed `seed:verify` before implementation: every workbook
cell, timestamp round trip, protected schema and baseline metric was verified.
The six original tables remain in `public`, unchanged. All application writes
belong in `operational`; migration tracking lives in `operational_meta`.
This is data infrastructure only: no authentication endpoints, booking engine,
sync processing, extraction service, messaging, import commit, or UI is supplied.

Run from the repository root with the existing development database configured:

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/scripts seed:verify
pnpm --filter @workspace/scripts operational:migrate
pnpm --filter @workspace/scripts demo:populate --demo
pnpm --filter @workspace/scripts demo:populate --demo  # leaves existing edits intact
pnpm --filter @workspace/scripts demo:recipes         # read-only scenario inputs
pnpm --filter @workspace/scripts operational:test --demo
pnpm run typecheck
```

Migration verifies all seeds before doing anything, is advisory-locked and
transactional, and records a SQL checksum. A rerun verifies the checksum; it
does not rewrite already-applied SQL. Add new numbered migrations for future
changes and extend the runner explicitly; do not edit an applied migration.
The post-merge script applies the operational migration but **does not opt into
demo credentials or reset**. Run the explicit population command in development
when demo accounts are wanted.

Drizzle push/push-force commands are deliberately disabled. The Drizzle config
is restricted to operational models/schema for inspection/generation, but SQL
is authoritative for deferred constraints, functions, triggers and privileges.
See [operational-schema.md](operational-schema.md) for every relationship,
insert validator and constraint.

## Copy mapping and preservation

| Source → operational | Identity / fields copied without changing source values | Added values |
|---|---|---|
| public.clinics → operational.clinics | clinic_id, clinic_name, city, booking_method | 30-minute slots; all weekdays; local 08:00–17:00; Asia/Hebron; fixed joined_at; Full except onboarding fixture clinic |
| public.doctors → operational.doctors | doctor_id, doctor_name, clinic_id, specialty | unique email, reciprocal synthetic user link |
| public.patients → operational.patients | patient_id, patient_name, phone, dob | separate normalized name; minor_as_of 2026-09-08; generated is_minor; nullable guardian/merge fields |
| public.appointments → operational.appointments | appointment_id, clinic_id, doctor_id, patient_id, scheduled_at, booking_method, status | duration 30; public.appointments/ID source_ref; fixed created/updated instants; null created_by/client_op_id; flagged only for source double_booked |
| public.patient_visit_history → operational.patient_visit_history | every original column including visit_id, date and exact note | no invented clinical content |
| public.calendar_app_export → operational.import_rows | original event ID and complete JSON source row | batch provenance/checksum; suggestions only; review_required |

Seed timestamps are **already UTC instants**. SQL copies them directly without
another timezone conversion. Only synthetic local fixture time
`2026-09-08 08:00 Asia/Hebron` is converted with date-fns-tz. Birth/visit dates
stay SQL dates; opening and closing hours stay local wall times.
`is_minor` is explicitly a reproducible snapshot as of `minor_as_of`, not a
permanently correct live age. Future patient services must refresh that date
or calculate age at the relevant encounter. Consent checks independently
calculate age at given_at in Asia/Hebron, so an old snapshot cannot authorize
patient-attributed consent for a minor.

Name normalization strips combining marks, unifies Arabic variants and
collapses whitespace, without changing `patient_name`. Phone strings, including
leading zeros, are preserved.

Calendar doctor suggestions use the verified source analytical mapping described
in `baseline-summary.md`. The two source `.example` emails are assigned to the
corresponding operational doctor records; other doctors receive synthetic
`doctor.ID@amal-demo.example` addresses. **Import doctor mappings still require
confirmation**, as do every patient's identity. Authentication demo account
addresses are separately listed below and linked by user_id, not by name/email
inference.

Population and reset call the **same** `populate()` routine inside a transaction.
They share an advisory lock and acquire write-excluding operational table locks,
including during sequence allocation, so concurrent script/application writes
cannot race a reset or preserved-ID allocation. No seed table is write-locked.
Source copies insert missing primary IDs only. Existing rows are not updated.
Fixture keys (and batch/event identity) avoid duplicates without recreating
password hashes, timestamps, devices, consent history, or import decisions.
New doctor links are completed only for newly inserted doctors.
Identity sequences are advanced above preserved IDs with transactional
`ALTER SEQUENCE RESTART`, never nontransactional `setval`; reruns never move them
backward. Rolled-back ordinary inserts may still consume sequence numbers.
Fixture keys are the stable demo identity; surrogate fixture IDs can change
after reset, and external references/caches must be cleared by a future reset UI.

Historical collisions are evidence, not invalid rows: all 102 source appointments
and original statuses survive. No slot uniqueness/exclusion constraint is added.
Six doctor collision pairs and two cross-clinic patient pairs remain queryable.
Future booking logic must check overlapping durations atomically while retaining
these historical rows; it must not clean history to satisfy a unique index.

## Exact initial manifest

Counts below describe a clean population or guarded reset, not arbitrary edited
operational data. Baseline copies and additions are intentionally separate.

| Operational table | Baseline copies | Additional fixtures | Total |
|---|---:|---:|---:|
| clinics | 3 | 0 | 3 |
| doctors | 5 | 0 | 5 |
| patients | 25 | 0 | 25 |
| appointments | 102 | 0 | 102 |
| patient_visit_history | 32 | 0 | 32 |
| users | 0 | 9 | 9 |
| devices | 0 | 3 | 3 |
| patient_consents | 0 | 2 | 2 |
| visit_alerts | 0 | 1 | 1 |
| audit_log | 0 | 0 | 0 |
| sync_operations | 0 | 0 | 0 |
| import_batches | 0 | 1 | 1 |
| import_rows | 0 | 24 staged source events | 24 |
| patient_merge_candidates | 0 | 1 | 1 |
| notifications | 0 | 0 | 0 |
| kpi_snapshots | 0 | 0 | 0 |

The immutable calendar source still contains exactly **24 events**. Staged
events are not appointments. All have review_required; all confirmed identities,
chosen actions and committed appointment links are null. Three exact-name
suggestions receive confidence 0.5; all others 0. A suggestion is not permission
to link. No phone or DOB exists in this export; **zero** rows can auto-match.
The master plan's obsolete “3 auto-match” claim must not be used.

No synthetic KPI results, audit views, sent notifications or already-applied
sync operations are fabricated. Those tables start empty because their services
belong to downstream tasks.

## Synthetic credentials and stable fixture identities

These are public demo credentials, not real secrets, and must never be deployed:

| Role | Account email | Association / fixture key |
|---|---|---|
| Administrator | admin@amal-demo.example | network-wide, demo.admin |
| Doctor (one per source doctor) | doctor.ID@amal-demo.example | that doctor's actual source clinic; demo.doctor.ID |
| Receptionist (one per source clinic) | reception.ID@amal-demo.example | that clinic; demo.reception.ID |

Demo password: `Amal-Demo-Only-2026!`. Reception PIN: `2468`.
Only bcrypt hashes (cost 12, random salts) are inserted into tables, and reruns
retain existing hashes. There are no authentication endpoints yet.
Devices use `demo.device.CLINIC_ID` and label key `demo.devices.reception`.
All commands that populate, reset, or run mutation tests require `--demo` and
reject production/deployment environment markers. CLI guards are not a defense
against a trusted administrator deliberately bypassing them; never point
administrative demo tools at a production connection.

Other stable fixtures:

- `demo.reem.clinical`: patient 15 Clinical consent, patient-attributed,
  recorded by the receptionist of the source medication visit's clinic.
- `demo.reem.medication`: medication alert for the actual Amlodipine source
  visit; `demo.alerts.bloodPressureMedication` translation key and the entire
  unchanged note as provenance. No new medical advice or extraction service.
- `demo.minor.guardian`: first source minor by ID with an appointment, using
  their actual appointment clinic's receptionist; Basic consent attributed to
  `Synthetic Demo Guardian`, relationship code `parent`.
- `demo.distinctSameName`: the source pair with the same name and different
  DOB/phone, score 0, status not_a_match, reason key
  `demo.duplicates.differentDobAndPhone`. Neither person is merged.
- `demo.calendar.workbook`: one batch with the original workbook SHA-256;
  each staged event uses `(batch_id, source_event_id)` as identity.

New UI-facing labels are translation keys, not English messages. Original
source names/clinical text and explicitly synthetic guardian names are data.
Future UI must still implement Arabic RTL/English LTR, logical CSS, both themes
and Asia/Hebron display; no visual acceptance is applicable to these scripts.

## Eight scenario prerequisites (no workflows implemented here)

`demo:recipes` reads actual relationships and emits IDs/UTC payloads. It does not
change clinic settings, create appointments, enqueue operations or send messages.

1. **Collision:** use doctor-collision output to select the source
   2026-09-09 11:00 Asia/Hebron pair (appointments 99/100). Despite the master
   plan's “silent” label, this particular pair is already double_booked;
   the five other pairs are the genuinely unflagged evidence. Preserve both
   original statuses. A future booking engine must block a new conflicting
   request and suggest slots, not relabel history.
2. **Same patient, two clinics:** cross-clinic output includes patient 13 at
   2026-09-09 10:45 and patient 1 at 2026-09-12 12:45. No source row is removed.
3. **Clinical safety story:** patient 15's real source medication alert and
   Clinical consent are present. The dizziness visit determines the receiving
   doctor and clinic from data. Default receiving clinic is **Lite** for
   onboarding, so this clinical lookup must be unavailable initially.
   For this isolated scenario, an authorized demo operator must explicitly
   opt that clinic into Full (through a future adoption flow, or the SQL below).
   Both source and receiving clinics must be Full, consent not withdrawn, and
   a doctor role must be used. Do not bypass network/consent/privacy checks.
4. **Outage:** recipes produce exactly three unique `demo.outage.1/2/3`
   operation IDs for the receiving clinic's registered device: two nonoverlapping
   30-minute future requests at 10:00 and 11:00, seven days after the last
   operational appointment date, plus one request at an existing active doctor
   slot. Use an isolated demo with those times inside configured working hours;
   defaults permit all days. Queue through future offline UI: expected two
   applied, one conflict, none lost. No operations are pre-applied here.
5. **Import:** 24 review-required rows, zero confirmed links. Both doctor-email
   mappings and every patient need human confirmation. Events 22/23 contain the
   confirmed 09-13 09:00 collision. All-status export collision count is three,
   not one; see baseline evidence.
6. **Two same-name patients:** the source Samer Khourys retain different DOBs
   and phones, represented by the not_a_match candidate. No name-only merge.
7. **Minor:** the guardian-attributed Basic consent fixture has both guardian
   name and relationship, tied to an actual minor and recording receptionist.
8. **Lite → Full:** reset restores the receiving clinic to Lite and other
   clinics to Full; user choice is required for upgrade. Trial/onboarding UI,
   export and leave behavior remain future work. Run this scenario separately
   from the Clinical story rather than silently toggling modes for a lookup.

Explicit **operational-only** preparation for scenario 3, after choosing it:

```sql
UPDATE operational.clinics SET network_mode='full'
WHERE clinic_id IN (
  SELECT clinic_id FROM operational.patient_visit_history
  WHERE patient_id=15 AND diagnosis_notes ILIKE '%dizziness%'
);
```

This statement is an opt-in demo preparation recipe, never run automatically.
Patient 15 is a specified fixture identity, not a hardcoded clinic routing rule.
All clinic IDs in operational logic are derived from source relationships.

## Destructive reset

**This deletes all operational edits, consent history and audit entries.**
Only use it in an isolated demo. It never drops a schema, uses CASCADE,
truncates tables or touches the six seed tables:

```sh
pnpm --filter @workspace/scripts demo:reset --demo --confirm=RESET-OPERATIONAL-DEMO-DATA
```

Reset holds the same lock as population; deletes an explicit child-first
allowlist of all 16 operational tables; switches to the dedicated NOLOGIN
`amal_demo_reset` role for deletion only; then returns to the administrator
and calls the same population routine in the same transaction. Any failure
rolls back the deletes and copies. Seeds are fingerprinted before/after.
The role has SELECT/DELETE only on the allowlisted operational tables, no
seed rights and no membership available to `amal_app`. Ordinary application
connections authenticate as `amal_app`, not administrator + SET ROLE.
They can INSERT/SELECT audit rows but cannot UPDATE, DELETE, TRUNCATE, disable
audit triggers or assume the reset role. Audit UPDATE/TRUNCATE is always
rejected by triggers; DELETE is permitted only under the dedicated reset role.
No callable security-definer reset function or runtime reset endpoint exists.

## Verification evidence

Development checks passed on 2026-10-19:

- Original prerequisite `seed:verify`: both verification-only reruns matched
  every source cell and all Q01–Q12 metrics; all seed write/DDL denials passed.
- Operational database test: two migration runs; concurrent population;
  byte-identical row data across a further rerun, including hashes/timestamps;
  exact baseline source-column/ID equality; documented initial counts;
  consent/alert/device/user consistency and source provenance.
- Operational edits remain intact on population; generated IDs exceed copied
  source IDs; duplicate client operation IDs and invalid FKs/checks fail.
- Reset repopulates initial counts; reset rollback and deliberate failure
  restore previous rows; audit insertion works under the actual app login,
  all update/delete/truncate attempts and reset-role escalation are denied.
- Spring/autumn 2026 DST boundaries round-trip with date-fns-tz and agree with
  PostgreSQL; copied UTC instants/date-only values survive different session
  timezones. No second conversion is applied.
- Seed schema/content/ACL/owner/index/trigger fingerprint unchanged across
  migration, population, rerun, reset and failure. The test prints its database
  fingerprint (catalog OIDs make it database-specific). Workbook SHA-256 stays
  `b3249b281f503b8a6b6bc935a203dff756d431b1bc24ecf953a108c7efa610dd`.
- Full workspace `pnpm run typecheck` passed.

Mutation/reset tests are rollback-only after additive population; they restore
pre-existing operational edits. Sequence gaps are normal. Do not run tests
against a live app: they temporarily lock operational writes. Demo scripts
are administrator maintenance tools, never imports in an HTTP route.
