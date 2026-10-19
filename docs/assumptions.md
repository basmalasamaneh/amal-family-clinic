# Assumptions, stakeholders, and success criteria

This is a planning baseline, not evidence of implementation, completed tests, stakeholder approval, or adoption. Verification below is future work. The latest user rules take precedence over the [master plan](../attached_assets/AMAL_MASTER_PLAN_1792331418647.md), especially seed immutability and review of all calendar-export rows.

## Assumptions

| ID | Assumption / required behavior | How we verify |
|---|---|---|
| A1 | Each doctor belongs to one home clinic. | Read-only checks of doctor/clinic consistency against source data; report mismatches without changing source rows. |
| A2 | Detect doctor conflicts locally and cross-clinic patient conflicts on sync. Zero cross-clinic double-bookings is the target, not a guarantee of immediate detection while disconnected. | Exercise local interval overlaps and bookings for the same patient at multiple clinics, including disconnected devices; reconnect and confirm conflicts are surfaced for resolution. |
| A3 | Default duration is 30 minutes and start grid is 15 minutes; both are configurable per clinic. | Check defaults and independent clinic overrides; test partial overlaps, contained intervals, and adjacent non-overlapping appointments rather than only equal start times. |
| A4 | Calendar export is a one-time migration, followed by operational booking in Amal Network. All 24 export rows require manual identity review; never auto-link by name alone. | Rehearse migration and re-import without duplicate operational bookings or seed changes. Confirm all 24 rows require review using phone or DOB; name matches are suggestions only. Unmatched patients require a phone when created. |
| A5 | Each clinic has at least one reception device; internet outages may last minutes to hours. | Confirm device readiness at each site; simulate short and prolonged outages, queued booking, restart, and reconnect, checking recovery of all accepted appointments. |
| A6 | Basic consent shares visit date, clinic, and doctor. Clinical adds notes and key alerts. New patients share nothing until consent. | Check authorized network access under no consent, Basic, and Clinical; verify notes/alerts are unavailable under Basic and no history is shared without consent. |
| A7 | Minors require guardian consent, including guardian name and relationship. The applicable legal age threshold is unconfirmed. | Confirm the governing age policy before acceptance; test below/at/above its boundary, missing DOB, and missing guardian fields. Do not treat an inferred age threshold as law. |
| A8 | Doctors/admin use email/password; reception uses a four-digit PIN on a registered device. | Test each role's valid and invalid login, PIN format, and registered versus unregistered reception devices; verify role-limited access. |
| A9 | Demo accounts cover every role; all seed and demo data is synthetic. | Check account coverage for admin, doctor, and reception; review documented data provenance and confirm no real patient data is introduced. |
| A10 | Exclude full EMR, billing/insurance, prescriptions, patient-facing app, real SMS/WhatsApp (simulation only), core AI, and doctor-performance analytics. | Compare the feature inventory and demo against these exclusions; confirm reminders are simulated and no excluded capability is introduced. |

## Stakeholders → needs → features

These are planning examples, not evidence of stakeholder review or application constants.

| Stakeholder | Needs | Planned features |
|---|---|---|
| Dr. Amal | Unified oversight without forcing participation | Admin overview, network health, before/after KPI dashboard |
| Dr. Nabil | Autonomy, privacy, no personal performance tracking | Voluntary opt-in and Lite mode, privacy controls, “Your data, your decision,” export/exit; no doctor-performance analytics |
| Front-desk | Fast booking during busy mornings, continuity offline | Short booking flow, large controls, offline queue, printable day sheet |
| Patients | Conflict prevention and not repeating history unnecessarily | Conflict prevention, consent-based network history, optional simulated reminders |

## Success targets and proposed evidence

Targets are not achieved results. Measurement windows, sample sizes, and acceptance procedures still need confirmation with stakeholders.

| ID | Target | Proposed measurement / evidence |
|---|---|---|
| S1 | Zero cross-clinic double-booking incidents | Compare read-only seed baseline with operational overlapping patient bookings across distinct clinics, sync conflicts, and resolution records over a window **to be confirmed**. Count actual incidents, not merely unresolved alerts; report disconnected detection delays separately. Offline booking cannot guarantee immediate cross-clinic prevention. |
| S2 | Network-history lookup under 10 seconds | Time a doctor's lookup from search initiation to answering whether and when the patient was seen elsewhere, under permitted consent. Retain timings and accuracy evidence; confirm sample, measurement window, and connectivity conditions. No consent must not be bypassed to meet the target. |
| S3 | Zero appointments lost to internet downtime at any site | Reconcile locally accepted appointment IDs with queued, synced, or explicitly resolved records after outage/restart/reconnect scenarios at every site. Record any missing appointment; confirm outage durations and observation window. |
| S4 | Dr. Nabil's clinic voluntarily opts in within month 1 | Record a voluntary opt-in decision and date, informed by results from the other clinics. The event starting “month 1” **needs confirmation**; a demo, seeded account, or enabled feature does not prove adoption. |

## Data traps

- **Same name, different people:** the two Samer Khoury patients have different DOBs (2014 and 1967 birth years) and phones. Never merge by name; inspect DOB and phone. Every export row still needs manual identity review.
- **Sensitive free text:** clinical notes can expose medications and other health details. Keep notes and derived key alerts behind Clinical consent; do not leak them through Basic summaries, previews, or logs.
- **Missing duration:** source appointments lack duration. Apply the configurable 30-minute default only to operational data; test interval overlap, not just identical start times.
- **Whole-week scheduling:** appointments occur throughout the week, including Friday and Sunday. Working days are per-clinic settings; never hard-code weekends.

## Constraints

- **Immutable sources:** `clinics`, `doctors`, `patients`, `appointments`, `patient_visit_history`, and `calendar_app_export` retain their source names, columns, source-compatible types, IDs, and rows. Application writes use separate operational copies; migration, re-import, and demo reset must not alter the six seed tables.
- **Time:** source timestamp values remain untouched. Interpret source local times as **Asia/Hebron**, store operational timestamps as UTC, and display in Asia/Hebron using **date-fns-tz** for DST-aware conversion. Preserve date-only fields as dates and avoid converting an already interpreted instant twice.
- **Import:** manually review **all 24** calendar-export rows, including exact name matches; no name-only automatic linking.
- **Presentation:** route all application text through Arabic RTL/English i18n, use CSS logical properties, support Light/Dark themes, and load clinic identities from data. Stakeholder names here are examples, not application constants.

This document does not perform source-data checks, imports, application changes, or success tests. Device readiness, synthetic provenance, governing guardian policy, measurement details, and stakeholder review remain to be verified.
