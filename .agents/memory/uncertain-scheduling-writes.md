---
name: Uncertain scheduling writes
description: Why a read-back cannot prove that an unconfirmed appointment write did not happen.
---
Resolve an uncertain scheduling mutation by replaying its exact payload and idempotency key. Do not allow a fresh mutation merely because a read still shows the original booking.

**Why:** The original request can still commit after the read. Matching times also do not prove which actor performed a change. A successful idempotent replay provides the definitive result without a second mutation.

**How to apply:** Keep the attempted payload stable and the editor locked while the outcome is uncertain. Preserve any submitted hold until the request has a definitive result. After a definitive version conflict, require explicit reload and review rather than automatically adopting a newer version.
