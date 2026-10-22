---
name: Scheduling coordination
description: Scheduling writes must share database coordination, including future sync/import writers.
---

All future scheduling writers, including sync/import, must join the same
database transaction lock protocol as appointment and hold mutations.

Patient time overlaps must be non-overridable, across clinics regardless of
network participation. Separate patient records also conflict when all three
canonical identity fields (name, phone and valid date of birth) match. Missing
fields or name-only similarity are not sufficient. This is scheduling safety,
not permission to merge records or share clinical information.

**Why:** On 2026-10-22 the user explicitly replaced the previous patient-warning
override policy with absolute blocking and requested all-three-field duplicate
matching. Existing appointments must not be rewritten to apply the new policy.

**How to apply:** Enforce at every authoritative scheduling write, including
import and offline synchronization; drafts are not confirmed bookings. Keep
unavailable cross-clinic evidence generic. Coordinate demographic changes with
scheduling so edits cannot introduce a new overlapping identity group.

Rejected/conflicting local proposals must not appear as appointment cards in
Today, Week or the day sheet. Keep them in the sync/conflict queue; preserve
confirmed appointments and unresolved offline work.

**Why:** The user explicitly rejected showing a refused booking on the schedule,
even when it carries a conflict badge.

**How to apply:** Separate durable queue retention from calendar projection;
never delete the proposal or a canonical appointment merely to hide a failed request.

**Why:** Existing historical operational collisions must remain intact, so a
blanket exclusion constraint cannot be used. Locks must cover both doctor
occupancy and cross-clinic patient checks; separate per-process locks permit
stale concurrent validation. Coarse database serialization deliberately favors
correctness for the small clinic network over maximum write throughput.

**How to apply:** Reuse the appointment transaction service/protocol when adding
a writer. If replacing coarse locking, preserve deterministic lock ordering
across both doctor and patient identities and test multi-connection races.

Reminder scheduling must cover every new appointment writer, not only the
interactive booking service. Existing-record associations must not backfill.

**Why:** Imports have an independent transactional insertion path; adding hooks
only to interactive booking left eligible imported bookings without reminders.

**How to apply:** When adding or modifying an appointment writer, verify its
reminder effects inside the same scheduling-lock transaction and exercise that
writer directly, including rollback and replay.
