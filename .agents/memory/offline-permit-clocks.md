---
name: Offline permit clock boundaries
description: Browser/server subsecond skew can fail strict signed-permit verification.
---
Keep future-issued permits invalid. A single bounded delay followed by full
verification at the actual current browser time is acceptable; never shift the
signed expiry or add an acceptance tolerance.

**Why:** A real authenticated browser trailed the server by 185 milliseconds,
leaving the offline cache locked despite a correct signature and authorized scope.

**How to apply:** Diagnose time differences without logging signed payloads.
Preserve nonce, revocation epoch, signature, scope and expiry checks after any wait.
