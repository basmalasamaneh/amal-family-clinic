# In-memory testing builders

`tests/builders` supplies synthetic, deterministic **test-only** inputs for the
eight scenarios in `docs/data/operational-demo.md`. These are not copies of seed
people, clinics, medical notes, credentials or workbook records. They do not
populate/reset a database, execute recipes, implement authorization, apply sync
operations, confirm imports or perform booking conflict detection.

## Usage and contracts

```ts
import { createDemoBuilders, hebronInstant } from "../builders";

// Obtain these OperationalClinic records from your test's explicit context.
const builders = createDemoBuilders({ sourceClinic, receivingClinic }, {
  idStart: 5000,
  instant: "2026-09-08T05:00:00Z",
  patient: { phone: "000012345" },
});
const doctor = builders.doctor(sourceClinic, { specialty: "test.specialty" });
const patient = builders.patient({ patient_name: "Synthetic Test Patient" });
const appointment = builders.appointment(doctor, patient, {
  scheduled_at: hebronInstant("2026-09-09", "10:00"),
  duration_minutes: 30,
});
```

All entity contracts use **type-only** imports from `@workspace/db/schema`.
No runtime database module, maintenance script, pool or environment configuration
is imported. Returned entities use actual operational select types, including
`Date` instants, string SQL dates and string PostgreSQL numeric probabilities.
Password/PIN hash fields are explicitly unusable synthetic sentinels.

Supply two distinct clinic records in Asia/Hebron; IDs and names are never
inferred from workbook constants. The factory snapshots caller context/defaults.
Its private increasing ID stream is shared by entities in that factory only.
Create a new factory per test/scenario to replay IDs. Same IDs across independent
factories are intentional; do not concatenate independent graphs as one dataset.
No reset function or process-global counter is needed.

Entity overrides exclude identity/FK fields. Appointment references must belong
to the factory and match the doctor's clinic. Doctor actors have reciprocal
user links; consent recorders must be factory-created receptionists. Recipe
overrides expose deliberate scenario choices, not unrestricted row replacement.
Returned records are mutable for negative tests; mutating one does not authorize
or rewrite another graph. Builders are not a substitute for production validators.

## Scenario recipes

| Method | Output / deliberate overrides |
|---|---|
| `collision({ scheduledAt?, statuses? })` | Two appointments for one doctor at one instant; defaults retain double_booked evidence, explicit historical statuses are preserved. |
| `crossClinic({ scheduledAt?, patient? })` | One patient, two context clinics/doctors, overlapping appointments. |
| `clinicalSafety({ optIntoFull?, patient?, note? })` | Source/receiving visits, exact synthetic alert provenance, active Clinical consent, receptionist and doctor actor. Receiving clinic remains Lite unless explicitly opted into Full. |
| `outage({ lastAppointmentAt? })` | One active appointment, context-scoped registered device, exactly three unique demo.outage operation IDs, all pending; expected outcomes are metadata only. |
| `calendarImport({ sourceName? })` | One batch, 24 review-required rows, three 0.5 name-only patient suggestions, doctor suggestions and zero confirmed identities/actions/appointment links. |
| `sameName({ name? })` | Equal names with distinct phones/DOBs; score "0", not_a_match, no merge. |
| `minor({ dob? })` | Minor, actual linked appointment/receptionist and guardian-attributed Basic consent with both guardian fields. |
| `liteToFull({ explicitUpgrade? })` | Independent Lite initial state and after-choice snapshot; only explicit choice yields Full. |

Clinical and onboarding scenarios never silently alter each other's clinic
mode. Clinical source mode is preserved from context: opting the receiver into
Full does not upgrade a Lite source. `expectedLookupAvailable` describes a fixture expectation, **not** a
permission grant: real services must still enforce doctor role, both clinics'
Full modes, visibility and active consent.

For outage tests, `lastAppointmentAt` represents the last operational appointment
instant in the isolated test graph. Without it the factory's fixed as-of date is
used. Future slots are at local 10:00/11:00 seven **calendar days** later; the third
request reuses the existing active slot. Incompatible working days/hours fail
explicitly rather than modifying clinic configuration. No operations are applied.

Import source payloads deliberately contain neither phone nor DOB. Suggestions
never provide evidence for automatic identity confirmation. Synthetic events
22/23 share local 09:00; there are three collision pairs overall. These rows are
not imported appointments and are not authentic workbook event provenance.

## Time and reproducibility checks

`utcInstant` clones already-offset instants without converting them again.
`dateOnly` validates and preserves YYYY-MM-DD strings. Local wall times convert
with `date-fns-tz` in Asia/Hebron; that library owns ambiguous/nonexistent DST
wall-time semantics. Calendar-day addition avoids elapsed-24-hour DST drift.
Minor snapshots use the supplied as-of date, while consent independently checks
age at the fixed instant's Asia/Hebron date (including leap-day birthdays).

Unit discovery is `tests/unit/**/*.test.ts`. With root tooling installed, run
`pnpm exec vitest run`; to exercise host-timezone independence, also run
`TZ=America/Los_Angeles pnpm exec vitest run`. The unit suite requires no
DATABASE_URL, credentials, live app, migrations or seeds. See [testing.md](testing.md)
for browser setup, commands, safety boundaries and recorded verification.
