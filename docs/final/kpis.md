# KPI evidence — before, after, and unavailable

Compiled 2026-10-21. No new analytics engine or synthetic “improvement” was
created. Definitions remain those in [KPI documentation](../kpis.md).

## Immutable before

Source: six immutable workbook tables, [baseline SQL](../data/exploration.sql)
and [baseline report](../data/baseline-summary.md). Initially measured 2026-10-18;
verified again by `seed:verify` on 2026-10-21. Appointment window is
2026-09-08–2026-09-13 inclusive, Asia/Hebron; full sample **102 appointments**,
all source statuses. These are verified observations, not merely expected plan
numbers.

| Measure | Before | Units / denominator / coverage |
|---|---:|---|
| Same-doctor exact-start collisions | 6 | Distinct unordered pairs, 12 appointments; not interval overlaps |
| Flagged / unflagged doctor pairs | 1 / 5 | The supplied September 9 11:00 phone/walk-in pair is the flagged pair |
| Same-patient, cross-clinic exact-start collisions | 2 | Distinct unordered pairs across different clinics |
| No-show | 22/102 = 21.5686…% | Rounded 21.6%; all source appointments denominator |
| Booking source | 48 phone / 21 walk-in / 33 calendar | 102 appointments, 100% source coverage |
| Export identity review | 24 required / 0 automatic | 24 export events; no DOB/phone in source |

Clinic attribution of a cross-clinic pair can touch two clinics; clinic counts
must not be summed as though pairs were independent. All source data remains
unchanged; timestamps are already interpreted instants and must not be converted
twice.

## Operational after

The canonical source is authenticated `/api/kpis` over operational rows,
with selected local window, generated time, units, sample count and coverage.
After counts reflect current rows, not historical snapshots of prior state.
Never compare unequal windows as equal exposure.

| Measure | Available evidence | What this establishes |
|---|---|---|
| Exact-start pairs, sources, no-shows | Current values pending authorized preview observation; see [rehearsal](rehearsal.md) | Unavailable here, not zero; do not use initial copied seed counts as an improvement |
| Lookup result-card timing | [2026-10-20 observation](../lookup-verification.md): 829 ms, median/p90 0.829 s, n=1, one clinic/day | One foreground result-card render, not answering the full Reem clinical question |
| Query through selected timeline | [2026-10-20 lab checks](../frontend/network-search.md): 0.908, 0.915, 0.964, 1.063 s, n=4 locale/theme runs | Synthetic fixture/browser lab; not a current rehearsal, real patient sample or baseline improvement |
| Blocks / warnings | Existing KPI instrumentation distinguishes committed blocked attempts, warnings and overrides | Repeated previews are not prevented conflicts; a warning subsequently overridden is not prevention |
| Downtime loss | No complete accepted-ID reconciliation for this new rehearsal | Unavailable, not measured zero; queued, applied, conflict and rejected remain distinct |
| Adoption | Current recipe reports receiving clinic Lite; published-results mappings absent | No demonstrated month-one real-world opt-in; no stakeholder approval inferred |

No seed lookup-time baseline exists. Consequently there is **no measured
before/after lookup improvement**. Lab durations and operational receipt-day
telemetry have different boundaries and must not be pooled. No new aggregate
is calculated from those independent observations.

For a valid future run, preserve the API's exact before/after dates,
`generatedAt` equivalent, calculation version, sample/denominator and missing
reason alongside each sanitized aggregate. Never retain clinical payloads,
query text, actor identifiers, credentials or raw request headers as KPI evidence.
