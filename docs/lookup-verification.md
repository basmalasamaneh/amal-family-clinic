# Operational lookup-duration verification

Final checks: workspace typechecking and API code generation passed; 12 KPI/API
checks, 33 lookup/network/dashboard checks and 24 sync checks passed. All six
seed tables passed verification-only content/protection checks. Application
workflow logs during the successful browser lookup contained the clinical
lookup and KPI refresh requests but no duration-ingestion request or payload.
The generic API-spec example validator has an unrelated pre-existing failure
for the `/clinics` POST example; lookup code generation succeeds.

## Outcome

The previously blocked real lookup-duration flow completed after the reported
private-cache identity fix. The doctor session remained signed in at
`/doctor/network-search`. One first-input search produced one visible result
card. The card was not opened and no patient timeline was visited. Exactly one
duration-only measurement was received, and the aggregate increased from the
pre-measurement baseline of 0 to 1. No seed operation, reset, or implementation
change was performed by this test.

## Safe aggregate evidence

All dates below are Asia/Hebron calendar dates.

| Evidence | Observed value |
|---|---:|
| Server-local receipt day | 2026-10-20 |
| Pre-measurement dashboard sample count | 0 |
| Runtime snapshot rows after measurement for receipt day | 1 |
| Runtime aggregate sample count after measurement | 1 |
| Recorded duration | 829 ms |
| Daily, doctor-clinic-filtered dashboard median | 0.829 seconds |
| Daily, doctor-clinic-filtered dashboard p90 | 0.829 seconds |
| Daily, doctor-clinic-filtered dashboard sample count | 1 |
| Audit actions containing `lookup` or `duration` after measurement | 0 |

The admin report was filtered to the doctor’s clinic, day range, and
server-local receipt day. The dashboard values matched the read-only aggregate
from the restricted runtime pool.

## Request and safety boundary

The scoped in-memory browser capture observed exactly one
`POST /api/kpis/lookup-duration`; its JSON body had only the key `durationMs`,
with a finite integer value of 829, and the response was HTTP 204. The
measurement completed when the matching result card became visible. The result
list contained one card; there was no second search or measurement.

The audit-action count remained 0 after the event. Application request logging
is configured to ignore this telemetry endpoint. Raw server logs were not
inspected, to avoid collecting unrelated query data.

No patient, query, account, or session identifiers are recorded here.
