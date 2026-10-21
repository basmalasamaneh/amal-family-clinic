---
name: Authentication lock timing
description: Decisions about credential/session expiry must use time after database lock acquisition.
---

Evaluate session and PIN deadlines after acquiring the serialization lock, not
with transaction-start time or a projection evaluated while waiting for a lock.
Reuse the transaction connection for dependent authority checks.

**Why:** Concurrency tests exposed revival of expired sessions, stale PIN lock
decisions, and pool starvation when a lock owner requested another connection
while all other connections waited on that owner's lock.

**How to apply:** For future authentication/recovery changes, test expiry during
a lock wait, revocation versus rotation, and enough concurrent requests to fill
the pool. Preserve the existing account-wide lock through credential recovery.
