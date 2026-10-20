---
name: Scheduling coordination
description: Scheduling writes must share database coordination, including future sync/import writers.
---

All future scheduling writers, including sync/import, must join the same
database transaction lock protocol as appointment and hold mutations.

**Why:** Existing historical operational collisions must remain intact, so a
blanket exclusion constraint cannot be used. Locks must cover both doctor
occupancy and cross-clinic patient checks; separate per-process locks permit
stale concurrent validation. Coarse database serialization deliberately favors
correctness for the small clinic network over maximum write throughput.

**How to apply:** Reuse the appointment transaction service/protocol when adding
a writer. If replacing coarse locking, preserve deterministic lock ordering
across both doctor and patient identities and test multi-connection races.
