# Amal Network five-minute demonstration readiness preflight

**Final disposition:** the owner accepted the documentation-only handoff and
explicitly excluded a successful rehearsal. The unsuccessful preflight remains
the actual observed result; no later passing run is claimed. Publication and
production verification are excluded, not pending actions.

## Scope and timing

- **Purpose:** non-production readiness assessment for the explicitly requested
  five-minute demonstration. This is not a production assessment or a rehearsal.
- **Code revision inspected:** `df169f2` (before this documentation-only handoff).
- **Preview origin:** `https://bf3e32dc-54d0-4d6f-8c18-82dda6dba30b-00-2b6qfmcqqsbep-fceymrj3.reed.replit.dev`
  (root `/`; no query string).
- **Browser:** Chromium 155 on Linux, device scale factor 1.
- **Viewport:** 1365 × 900 CSS pixels.
- **Preflight start:** 2026-10-21T09:12:40.228Z.
- **Preflight end:** 2026-10-21T09:13:33Z.
- **Preflight elapsed:** approximately 53 seconds. This is separate from the
  requested five-minute presentation duration; no presentation was run and no
  duration is claimed.

The browser first captured a transient blank root shell, then the app rendered
its Arabic `/login` page. The DEVELOPMENT demo access instructions in
`docs/data/operational-demo.md` were used for an ordinary administrator login
attempt. Login was attempted twice, with one normal page reload after the first
explicit session-verification error. Both attempts remained at `/login` and
showed the Arabic message “فشل التحقق من الجلسة. أعد تحميل الصفحة وسجّل الدخول
مجدّدًا.” (session verification failed; reload and sign in again). This does not
establish that the documented credentials are invalid; admin authentication
could not be verified.

**Consequences:** Admin KPI and health views were not reached; no KPI response,
window, sample counts, calculation time, health metadata, or admin role was
available to inspect. Doctor login was not attempted after the repeated
authentication failure. Therefore doctor network/adoption readiness and any
trusted-device requirement remain unverified. No attempt was made to bypass a
trusted-device check. No fourth login (patient) was attempted.

Only Arabic/RTL and the light appearance were observed on the login page.
English/LTR and dark appearance controls were visible but not exercised.

## Read-only scenario and adoption readiness

The current `artifacts/api-server/src/adoption/scenario.json` is:

```json
{"trialClinicId":null,"resultClinicIds":null}
```

`docs/frontend/adoption-journey.md` documents this scenario as deliberately
unconfigured. The adoption handoff specifies that the API then returns
`available:false`, reason `SCENARIO_UNCONFIGURED`, and no clinics; it cannot
provide the two published results for a real scene. Configuration requires an
explicit identity choice and development server restart; no such change was made.
Publication is excluded, not a remedy for this blocker.

The `scripts demo:recipes` implementation was inspected to confirm it opens a
`BEGIN READ ONLY` transaction. It was run once as read-only scenario inspection;
it reported `demo.recipes.notExecuted`. Relevant data-derived mappings:

- Clinical story: visit 32 / patient 15 maps to operational clinic 2 and doctor
  2. The receiving clinic is currently `lite`, while this scene requires
  `full`; the documented consent and alert fixture keys are
  `demo.reem.clinical` and `demo.reem.medication`. Clinic routing was taken from
  the recipe's relationship output, not inferred from names.
- Onboarding output also identifies clinic 2 as initially `lite`; user choice
  is required for an upgrade. The adoption scenario file itself has no trial
  or results clinic IDs configured.
- The read-only outage recipe maps its device to clinic 2 (device ID 17) and
  doctor 2. Its emitted example request times are 2026-09-20, already past at
  this preflight date; these outputs are not a current future rehearsal payload.
- Recipe evidence retains the documented collision selection (appointments
  99/100 at clinic 1, doctor 1, local 2026-09-09 11:00; both already flagged)
  and cross-clinic examples (patient 1 at clinics 1/3; patient 13 at clinics
  2/3). The recipe's 24 calendar rows are review-required with zero automatic
  patient links. These are inputs only, not completed scenes.

The documented handoff says lifecycle management requires an explicitly
delegated doctor-manager; no delegation is seeded automatically. The
frontend guide also requires the clinical story's receiving clinic to be opted
into Full, and says the Lite/Trial onboarding story is separate. The current
recipe says clinic 2 is Lite. Consequently a Full-consented Reem scene cannot
be safely demonstrated from the observed state without an adoption change.
Following it with a distinct Trial/Lite finale is not supported by the current
unconfigured scenario or by the present Lite state; making it so would require
state changes and/or a reset. No such changes are within this preflight's
allowance. Do not represent this as a safe combined sequence on shared data.

## Readiness decision and boundaries

**Not ready for a real five-minute eight-scenario rehearsal on this journey.**
The repeated session-verification failure blocks role-based inspection; KPI and
health views and doctor/network pages remain unverified. Independently, the
adoption publication scenario is unconfigured and clinic 2 is Lite while the
Reem clinical scenario requires Full. Safe separate Trial/Lite and Full/Reem
scenes cannot be represented by the current shared state without prohibited
changes.

Only ordinary login attempts (and their necessary authentication/session
effects) and read-only inspection were performed. The recipe command was
read-only. No publishing, reset, migration, population, consent/adoption
change, seed write, or application-data preparation was performed. No fixes
were implemented.

**Unexecuted scenes:** all eight recipe scenes are unavailable as a live
rehearsal from this preflight: collision handling; same patient across two
clinics; clinical safety/Full-consented Reem; offline outage; calendar import;
same-name duplicate patients; minor/guardian consent; and Lite → Full adoption.
Their data inputs were not mutated or played through the UI. There was no
five-minute presentation.

## Integrity and document checks

Before and after this preflight, `pnpm --filter @workspace/scripts seed:verify`
passed every source cell, all Q01–Q12 metrics, verification-only reruns,
timezone invariance and runtime/trigger protections. Counts remained 3 clinics,
5 doctors, 25 patients, 102 appointments, 32 visit-history rows and 24 export
rows. No canonical offline-operation reconciliation was possible because no
booking was attempted; this is not a measured zero-loss result.

All relative Markdown links in this handoff resolved. Application code was
not changed; no application build/typecheck was rerun for documentation alone.
