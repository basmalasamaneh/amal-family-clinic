# Five-minute demo script — non-production

**Planned duration 5:00, not a measured passing run.** All four stakeholders are
covered using only three login roles. No deployment or production account setup
is part of this handoff. Do not use recordings as a substitute for live steps.
The owner accepted a documentation-only handoff and excluded successful rehearsal.
The instructions below are a future-use script, not remaining acceptance gates
for this handoff or authorization to repair/configure another feature.

## Preflight outside the five-minute presentation

1. Read [readiness](README.md) and [actual rehearsal record](rehearsal.md).
   Stop on missing permissions, unconfigured mappings or unsafe data.
2. Use existing development access instructions and ordinary login. Enroll
   reception devices through the authorized device flow; clinic trust alone
   does not identify a receptionist. Never put credentials/tokens in evidence.
3. Run read-only `seed:verify` before and after; retain its aggregate result.
   Run `demo:recipes` to resolve scenario identities. Its IDs are inputs, not
   application configuration. Never reset the shared database.
4. Prepare separate supported operational scenarios for the Full/Clinical
   story and Trial/Lite finale. Both source and receiving clinics must permit
   sharing for Reem. An authorized manager must deliberately opt into Full;
   Clinical patient consent must separately be active. Merely using a second
   browser session does **not** isolate clinic state. The current handoff has
   no verified simultaneous isolated setup: **this is a blocking prerequisite**.
   Do not downgrade/reset between scenes behind the audience's back, bypass
   permissions, or imply that Lite can consume clinical details.
5. Resolve trial/result mappings through the existing explicit configuration
   and delegated manager authority. Current null mappings block the finale.
   Do not select “all other clinics,” hard-code IDs or identify clinics by name.
6. Prepare a safe current-day offline fixture through existing supported tools:
   two free appointments and one race introduced by a separate authorized
   online device **after** cache priming. A conflict already cached locally
   should be blocked locally, not queued just to produce an impressive demo.
   The historical recipe is not sufficient for today's cache horizon.
   Keep a ledger of the three client-operation identities without credentials.
7. Prime the actual clinic's next-14-day cache and signed offline permission,
   and check the shell can operate offline. Use browser network-offline mode
   on only the presentation reception context; keep the competing device
   online. Never disable the API for everyone or enable public fault controls.
8. Prepare the export batch with all 24 rows still review-required and zero
   automatic links. Identify a representative row with legitimately confirmed
   synthetic phone/DOB evidence; names alone are not identity.
9. Open separate authenticated admin, doctor and reception browser profiles,
   with the relevant routes ready but no scene actions pre-executed. Check
   AR/RTL and EN/LTR in both themes before timing; record actual combinations.
   Use Asia/Hebron display and date-fns-tz conversions, not browser timezone.
10. Begin a continuous clock only after setup. Measure lookup separately from
    first input to the visible answer, not merely an API response. Do not
    subtract failed interactions or hide scene mutations outside the clock.

## Continuous presentation

| Clock | Role / exact actions | Presenter narration and expected visible outcome | Evidence |
|---|---|---|---|
| 0:00–0:20 | Admin, `/admin/kpi`: show baseline, selected after dates, coverage and missing metrics. | “Dr. Amal sees aggregate service outcomes, not doctor rankings. These are synthetic-demo observations, not adoption or clinical-effectiveness claims.” Show 6 doctor pairs, 2 cross-clinic pairs and 22/102 no-shows only where verified. | [KPI evidence](kpis.md) |
| 0:20–0:50 | Reception, `/desk/new-booking`: choose mapped phone/walk-in doctor and September 9 11:00 Asia/Hebron; submit a new conflicting request; inspect all three proposed alternatives, then dismiss without creating it. | “This supplied pair was already flagged; five other source pairs were silent. New interval conflicts are blocked, with three alternatives.” Do not relabel source history. | [Recipes](../data/operational-demo.md), [booking](../frontend/booking.md) |
| 0:50–1:10 | Reception: choose the recipe's same patient at the other clinic for September 9 10:45; show the blocking conflict and choose a nonoverlapping time. | “This time conflicts with another booking. The overlap cannot be overridden.” No matched patient identifiers or unauthorized clinical details are shown. A preview alone is not a server-recorded prevented commit. | [Appointments](../appointments.md) |
| 1:10–1:50 | Switch to authorized Full-scenario doctor, `/doctor/network-search`: start stopwatch with query input for Reem Zaid; select the identity-confirmed card; open timeline; stop on visible prior visit and alert. | “Her prior note records Amlodipine 5 mg alongside the later dizziness complaint. Confirm with the patient: this supports continuity, not diagnosis or surveillance.” Show source note/provenance only with Clinical authority. State actual elapsed time; say “under ten seconds” only if measured. | [Network evidence](../frontend/network-search.md) |
| 1:50–2:50 | Reception offline scenario: switch that browser offline; submit three prepared appointments; show three pending; reconnect; show two applied and one explicit conflict; open `/desk/sync`, select a current server-suggested move, confirm, and reconcile all three canonical records. | “Offline work remains visible. This run resolved one collision; each accepted operation now has one canonical appointment.” Claim no duplicates/losses only after ledger reconciliation. If not reconciled in time, the run fails. | [Offline evidence](../testing/offline-live.md) |
| 2:50–3:25 | Source-clinic reception, `/work/import`: show 24 review-required and no automatic linking; confirm doctor mapping; verify one representative identity by phone/DOB and save its review; show September 13 09:00 collision in conflict review. | “Names suggest; phone or DOB confirms. We reviewed one row, not all 24. The remaining queue stays visible.” Do not commit unreviewed rows or invent DOBs. | [Import](../frontend/import-duplicates.md) |
| 3:25–3:45 | Authorized reception/doctor, `/work/duplicates`: comparison tab, select both Samer Khourys; inspect distinct DOB/phone; do not merge. | “Same name does not mean same person.” Show non-match explanation. | [Identity evidence](../frontend/import-duplicates.md) |
| 3:45–4:10 | Reception, `/desk/consent`: select the prepared minor, enter synthetic guardian name and relationship, deliberately select consent level, save and show confirmation/history. | “Guardian consent follows the implemented policy. It is separate from clinic participation; we are not asserting a legal age threshold.” | [Consent/privacy](../privacy-tests.md) |
| 4:10–5:00 | Switch explicitly to isolated Trial/Lite manager scenario, `/work/adoption`: show configured results/coverage, remain-Lite choice and privacy explanation; point out independent export/exit; deliberately click Full and await server confirmation. | “This separate Lite scenario ends in a voluntary choice. Aggregate results are not individual-doctor performance monitoring; necessary security/access logs still exist. Remaining Lite is valid. Full does not grant patient consent; export and exit remain choices.” No automatic enrollment, deadline or coercion. | [Adoption](../frontend/adoption-journey.md) |

Segment budgets: 20 + 30 + 20 + 40 + 60 + 35 + 20 + 25 + 50 = **300 seconds**.
Budgets are intentionally explicit so overruns cannot be concealed.

## Fallback and acceptance

If a scene fails, stop claiming a passing run. Explain its precise blocker and
use the written upstream evidence only as background. A fallback explanation is
not an executed scene. Retain the failed record; if a future rehearsal is
separately authorized after prerequisite repair, a complete uninterrupted rerun
must fit within five minutes before it can be described as passing.

Record preview origin, release, date, browser/device/viewport, fixtures and
authority, each segment's actual start/end, lookup time, canonical reconciliation,
locale/theme coverage, errors and reruns. Verify all six seed tables afterward.
Never record credentials, cookies, PINs, device tokens or unsanitized clinical
screenshots in the handoff.
