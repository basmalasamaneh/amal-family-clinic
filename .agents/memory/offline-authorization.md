---
name: Offline authorization boundaries
description: Why connectivity and cached identity cannot unlock private records
---
Require verified online authorization before granting a private cache scope; reconnecting by itself must not regrant access using an old identity.

Restored offline sessions need bounded authoritative retries while connectivity
and HTTP reachability recover; a single browser online event is insufficient.

**Why:** A reconnect can happen before the first authority request succeeds.
Without another verified attempt, a valid restored session can remain offline
and hold durable work indefinitely despite an online indicator.

**How to apply:** Retry the authoritative session read with throttling and
stale-response fences. Never promote an offline permit to online authority or
extend its deadline merely because connectivity returns.

**Why:** The public offline shell is deliberately useful without proving who is at a shared clinic device. Browser connectivity and possession of IndexedDB records are not permission.

**How to apply:** Future local-first workflows must obtain scope tickets before async fetches, honor revocation, and preserve explicit pending-work acknowledgement during logout/account removal. Do not convert this foundation into offline login by persisting session tokens.

Treat session termination and device-data removal as separate outcomes. Failed deletion must remain visible with retry/removal guidance, not merely navigate to login.

**Why:** A successful server logout can coexist with IndexedDB failures leaving private records on a shared device.

**How to apply:** Unknown cleanup status must also lock startup when its persistence mechanism is unavailable. Unreadable storage is not evidence that no failed cleanup exists.
