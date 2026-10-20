---
name: Sync ordering and recovery
description: Conservative per-device dependency policy and commit-safe cursor guarantees.
---

Keep sync dependency handling conservative: later device operations wait for
explicit resolution, even if a client considers them independent. Call follow-up
is not scheduling resolution.

**Why:** The scheduling contract has no trustworthy dependency graph. Allowing
client-declared independence would let stale edits overtake unresolved bookings.

**How to apply:** Offline queue and resolution UI work must preserve device
sequences across sessions and retry exact operation IDs after uncertain outcomes.
Do not auto-skip conflicts or discard their idempotency evidence.

Any future change-feed writer must allocate its cursor ID under the shared
scheduling transaction lock and retain that lock through commit.

**Why:** Sequence allocation alone is not commit ordering; an incremental reader
can permanently skip a lower ID from a late-committing transaction.

**How to apply:** Keep trigger and reader coordination together when changing
locking or feed storage; test a delayed commit, not only equal timestamps.
