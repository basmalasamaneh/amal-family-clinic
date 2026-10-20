# Patient merge reference inventory (task 21)

Only `operational` records are mutated. The six `public` seed relations, their
schema, links and rows are never changed. The tests checksum all six tables.

## Eligibility and visibility

Candidates are computed only after clinic scope, active-patient filtering and,
for doctors, independently provisioned doctor grants. All of normalized name,
date-only DOB and canonical phone must be present and exactly equal. The existing
P1-04 normalizer and phone helper are reused. Suggestions do not grant authority.

Merge additionally requires explicit source/target IDs, both current versions,
`confirmed: true`, a bounded reason and a UUID operation key. Guardian demographic
fields must agree. Created clinic and the complete clinic/doctor grant sets must
be equal; no grant is copied, unioned, deleted or inferred from appointments.
This deliberately rejects some clinically plausible duplicates rather than
broadening access to either patient's history. Administrator access is excluded.

Any consent history on either side, even `none` or withdrawn evidence, blocks the
merge. No consent evidence, guardian attribution, scope or policy is rewritten.
Consent decisions are left to the existing consent subsystem.

## References and decisions

| Relation / field | Decision |
| --- | --- |
| `patients.merged_into_id` | Source becomes retained tombstone. Existing inbound aliases on either record block a further merge; no chains/cycles or ambiguous multi-hop resolution. Source demographics remain unchanged and readable to privileged audit tooling. |
| `appointments.patient_id` | Reassign source to target; preserve clinic, doctor, time, status, source reference and operation ID; increment appointment version. Reject blocking-status patient overlaps with half-open intervals. |
| `patient_visit_history.patient_id` | Reassign; retain visit ID, clinic, doctor, original date and exact notes. |
| `visit_alerts.patient_id` and composite visit FK | Reassign along with visit; preserve alert ID, excerpt, offsets, extractor version/rule and manual evidence. Composite FK is deferred until final state. |
| `notifications.patient_id` and composite appointment FK | Reassign with appointment; preserve notification ID/status/message/clinic. Composite FK is deferred until final state. |
| `appointment_holds.patient_id` | Unexpired holds on either side block. Expired holds retain original patient IDs as historical operational metadata. |
| `patient_consents.patient_id` | Any evidence blocks, without alteration. |
| `consent_operations.result` JSON | Immutable receipt; never rewrite/reapply. Consent evidence blocks merging relevant identities. |
| `audit_log.patient_id` and detail JSON | Immutable original subject/provenance. Never rewrite. Append exactly one `patient.merged` event with actor, source, target, reason and operation key. |
| `patient_clinic_access.patient_id` | Retain both original grant sets. Require equal sets, plus identical created clinic. |
| `patient_doctor_access.patient_id` | Retain original grants. Require complete equal `(clinic, doctor)` sets; doctor caller needs grants to both identities. |
| `patient_create_receipts.patient_id` (non-FK) | Keep original ID and registration evidence. A merged source is not resurrected by registration replay. |
| `import_rows.suggested_patient_id`, `confirmed_patient_id` | Block any reference to either side; never relabel original suggestions or manual verification. |
| `import_rows.staging` JSON | Recursive `patientId` reference check, including `review.patientId`, blocks merge. Import service also revalidates demographic fingerprints and active identities at commit. |
| `import_reviews.detail` JSON | Retain original reviewer identity/action evidence; never reinterpret old review as survivor confirmation. |
| `import_batches.report` JSON | Retain immutable original report. Existing row identity links block merge. |
| `import_source_links.appointment_id` | Indirect immutable source-event provenance. Original import rows referencing the appointment's patient block merge; source links never rewritten. |
| `import_operations` | Batch/actor/idempotency references remain unchanged. |
| `patient_merge_candidates.patient_a`, `patient_b` | Legacy review evidence retained. New candidate response is derived only from scoped active rows and never trusts persisted candidate scores/status. |
| `appointment_operations.result` JSON | Retain original operation receipt; never rewrite historical responses or source identity. Appointment current state/version records the merge. |
| `sync_operations.payload` JSON | Pending/conflict operations recursively referencing `patientId`/`patient_id` block. Applied/rejected evidence is immutable provenance. This does not implement sync. |
| `patient_merge_operations.source_id`, `target_id` | Append-only runtime receipt and alias provenance; unique source prevents duplicate successful merge. No update/delete runtime grants. |
| `patient_merge_moves.source_id`, `target_id`, relation/record key | Append-only original-to-survivor provenance for every reassigned reference. Foreign key to receipt is deferred so partial journal and reassignment roll back together. |
| `clinics`, `doctors`, `users`, `devices`, `kpi_snapshots` | No patient reference to reassign; clinic/doctor IDs and metadata unchanged. |

Before a merge, the PostgreSQL FK catalog is compared with the direct-reference
allowlist. Any new/unclassified FK to patients fails closed, even if empty.
Unique/FK/check violations roll back every reference move, tombstone, version,
journal, receipt and audit. No destructive deduplication or clinical row deletion
is performed.

## Concurrency and persistence

Lock order is exclusive consent advisory lock **160005**, booking advisory lock
**761910**, read-only grant-table stabilization, actor/session/device locks,
import/sync relation stabilization, sorted patient row locks, then clinical row
locks. Existing consent readers take shared 160005, so a disclosure cannot race
the identity transition. Import and appointment mutations use the same advisory
coordination. Grant-table locks are acquired through a narrowly scoped
security-definer function: runtime still has no grant-writing privilege.

The current persisted role, clinic, doctor assignment, session validity and
device revocation are checked **after** waiting. Both scoped patients are locked
and checked again for eligibility, versions, consent and unsafe references.
Receipt replay requires the same actor, clinic and request fingerprint and
current access to both source alias and active target.

An operational patient `BEFORE UPDATE` trigger increments `version` for all
writers, including existing patient update APIs and import code. Tombstones
cannot be updated. New/reattributed appointment, visit, alert, notification and
hold references require a currently active patient under a key-share row lock;
stale writers cannot attach clinical records to the alias after commit.

All references are either transactionally moved with a durable move journal, or
explicitly retained as original identity evidence. No patient phone/DOB is
returned by duplicate detection, and failure messages contain codes/i18n keys,
not clinical history or demographics.
