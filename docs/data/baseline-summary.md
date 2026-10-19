# Immutable workbook baseline

Observed 2026-10-18 against development PostgreSQL. No operational tables,
patient links, application features, or source corrections were created.
All task-specific expected metrics agree with the workbook.

## Reproduce

From the repository root, with the provisioned development `DATABASE_URL` and
`SESSION_SECRET` available (never print either):

```sh
pnpm install --frozen-lockfile
uv sync --frozen
# Only an entirely absent six-table set can be initialized. Existing seeds are
# compared and protected metadata checked; discrepancies stop the transaction.
pnpm --filter @workspace/scripts seed:import --initialize
pnpm --filter @workspace/scripts baseline
pnpm --filter @workspace/scripts seed:verify
pnpm --filter @workspace/scripts typecheck
pnpm run typecheck:libs
```

`baseline` executes every labeled SELECT in `exploration.sql` in a read-only
transaction using the actual restricted application login. Its JSON contains
supporting IDs, names, local times, status flags, and match candidates.
Alternatively, execute `exploration.sql` in a PostgreSQL SQL client inside
`BEGIN READ ONLY; … COMMIT;`. No temp tables, migrations, writes, extensions,
or session-timezone assumptions are needed for those queries.

`seed:verify` asserts all figures below, all 24 manual-review flags, mapping
uniqueness, session-timezone invariance (UTC and America/Los_Angeles), two
verification-only import reruns, full source equality, and write protection.
Hard-coded *expected observations in tests* are not hard-coded clinic groupings
in analytical queries. Clinic IDs/names and calendar-clinic selection come from
source rows.

## Observed figures and definitions

| Query | Definition | Observed |
|---|---|---|
| Q01 | All immutable source rows, without filters | clinics **3**, doctors **5**, patients **25**, appointments **102**, patient_visit_history **32**, calendar_app_export **24** |
| Q02 | Appointment count by source clinic ID/name | C1 Downtown **36**; C2 Al-Bireh **33**; C3 Nablus Road **33**; overall **102** |
| Q03 | Unordered pairs (`a.id < b.id`) with equal doctor and exact start, all statuses; not duration overlaps | **6 pairs**, **12 distinct appointments** |
| Q03 | Both paired rows have `double_booked`; neither paired row has it | **1 flagged pair / 2 rows**, **5 unflagged pairs**; no partly flagged pairs |
| Q04 | Same patient, exact start, different clinics, unordered pairs | **2 pairs**: patient **1**, **2026-09-12 12:45**, C1/C3; patient **13**, **2026-09-09 10:45**, C2/C3 (Asia/Hebron) |
| Q05 | Patient + Asia/Hebron calendar date with at least two distinct booked clinics; not necessarily simultaneous | **14 patient-days** |
| Q02 | `no_show` rows / all appointment rows, including completed and double_booked, rounded to one decimal | Overall **22/102 = 21.6%**; C1 **8/36 = 22.2%**; C2 **6/33 = 18.2%**; C3 **8/33 = 24.2%** |
| Q06 | Distinct patients with actual visit-history rows; subset with visits at ≥2 distinct clinics | **16 of 25** have visits; **9** do not; **6 of those 16** have multi-clinic visits |
| Q06 | Visit count and date-only history span | **32**, **2026-01-02 → 2026-08-27** |
| Q07 | Booking source counts and local appointment span | `phone` **48**, `walk-in` **21**, `calendar_app` **33**; **2026-09-08 → 2026-09-13** |
| Q07 | Minute divisible by 15, seconds zero | **All 102** starts on the 15-minute grid |
| Q08 | Candidate doctor count per distinct export email in calendar-booking clinics | **2 emails**, **1 candidate each**, **0 unresolved** under the documented analytical assumption |
| Q09 | Distinct export events whose typed name exactly equals at least one roster name (`EXISTS`, case/whitespace unchanged) | **3/24**; suggestions only |
| Q09 | Distinct export events matching an appointment by mapped doctor + exact UTC start in the doctor's source calendar clinic (`EXISTS`) | **5/24**; does not establish patient identity |
| Q09 | Events requiring human identity confirmation | **24/24**, including all three exact-name suggestions; **0 auto-linked** |
| Q10 | Event count and `end_time-start_time = 30 minutes` | **24**, all **30 minutes** |
| Q10/Q12 | Equal email + start, unordered export pairs, all statuses | **3 pairs**; see discrepancy below |
| Q12 | Subset where both export statuses are confirmed | **1 pair**: events **22/23**, Yasmin, **2026-09-13 09:00** Asia/Hebron |
| Q11 | Approximate age cohort: DOB on/after 2008-01-01, not a legal minor determination | **6** |
| Q11 | Appointment clinic differs from doctor's home clinic | **0** |
| Q11 | Distinct source status strings | appointments: `booked`, `completed`, `double_booked`, `no_show`; export: `cancelled`, `completed`, `confirmed` |

**Discrepancy retained:** the master plan's “1 collision inside the export”
describes the confirmed pair, not every equal-start pair. Q12 also returns events
2/5 (2026-09-08 11:00, confirmed/cancelled) and 16/18 (2026-09-11 13:00,
cancelled/completed). There are three all-status pairs and one non-cancelled
pair. No seed values were changed to force the plan's unqualified count.
The source booking string is `walk-in`, not `walk_in`.

## Calendar mapping is an analytical assumption, not identity approval

The roster has no email column. Q08 independently audits the assumption that
the lowercase first given name after `Dr. ` equals the export email local-part,
restricted to doctors whose clinic has source `booking_method='calendar_app'`.
This uniquely suggests:

| Export email | Source doctor | Source home clinic |
|---|---|---|
| rula@amalclinics-nablusroad.example | 5 — Dr. Rula Masri | 3 — Amal Family Clinic - Nablus Road |
| yasmin@amalclinics-nablusroad.example | 3 — Dr. Yasmin Odeh | 3 — Amal Family Clinic - Nablus Road |

The .example domain is consistent with the source clinic name, but is not proof
of an email identity. No clinic ID, clinic name, or doctor ID is baked into the
mapping queries. Q09 uses mappings only when candidate count is exactly one;
missing/ambiguous mappings remain null and cause the automated check to fail.
No email columns or links were added to seeds. A future import wizard must ask
the user to confirm this mapping and every patient's identity using phone or DOB.
Duplicate roster names cannot inflate event counts or authorize merging.

## Provenance and storage contract

Unchanged byte copy: `docs/data/Amal_Family_Clinic_Group_data.xlsx`, checked
against the uploaded `attached_assets/Amal_Family_Clinic_Group_data_1792331449501.xlsx`.
Both SHA-256:
`b3249b281f503b8a6b6bc935a203dff756d431b1bc24ecf953a108c7efa610dd`.

Every sheet and column name is retained in `public`, in original column order.
All cells are non-null. IDs/references are integers, source text is PostgreSQL
text (including phone leading zeros), and primary IDs are not regenerated.
See `source-schema.md` for every column/type. No source text is trimmed,
normalized, translated, or corrected.

Workbook dates have Excel datetime representation. `dob` and `visit_date` are
midnight date-only values and stored as SQL `date`. `scheduled_at`, `start_time`,
and `end_time` are naive Asia/Hebron timestamps interpreted by date-fns-tz
`fromZonedTime` and stored as `timestamptz` UTC instants. This is a documented,
reversible interpretation, not a data correction. Local formatting with
`formatInTimeZone` must reproduce every source timestamp; SQL verifies local
round trips and rejects unexpected fractional seconds. The original workbook
retains the literal local values. Future operational copies must not convert
these seed instants a second time. SQL date grouping always explicitly uses
Asia/Hebron regardless of session timezone.

## Protection and verification boundary

The initial import is one advisory-locked transaction: create/load all six,
compare every cell, install protection, then commit. Missing subsets, existing
value/type differences, source checksum differences, or missing protection stop
with an error; there is no drop/truncate/upsert/repair/reset path. Existing-table
runs only verify, even when `--initialize` is present.

Seeds are owned by a separate NOLOGIN `amal_seed_owner`. The actual app pool
authenticates as non-superuser `amal_app` (not administrator plus SET ROLE),
with only SELECT on seeds and no schema CREATE. A domain-separated HMAC of the
existing SESSION_SECRET and database name supplies its password during initial
bootstrap and runtime, without storing credentials in files or printing them.
Changing SESSION_SECRET requires an administrator to rotate the database login
password consistently; verification fails closed rather than silently rotating it.
The role cannot become postgres/seed owner, disable triggers, drop tables, or
escape with RESET ROLE. Every seed also has an ALWAYS, statement-level trigger
rejecting INSERT, UPDATE, DELETE and TRUNCATE, including zero-row operations.

Tests use the actual runtime login for denied DML/DDL and role-escalation checks.
Actual successful fixture insertions and attempted mutations occur only in a
transactional temporary table with the same guard function, never on seed rows.
Two source-equality reruns prove preservation. A database administrator can
deliberately override PostgreSQL protections; administrator credentials and
migration tools must never be exposed to app queries or reset endpoints.
Future operational tables need explicit runtime grants in their own task.

Post-merge setup installs dependencies and calls the safe importer plus checks.
It intentionally does not run Drizzle push/reset against populated source tables.
UI, screenshot, AR/RTL/EN and Light/Dark checks are **inapplicable** to this
data-only task. Future UI must retain i18n, Arabic RTL/English LTR, logical CSS
properties, and both Light/Dark themes.
