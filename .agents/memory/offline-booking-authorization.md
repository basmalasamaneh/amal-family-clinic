---
name: Offline booking authorization extension
description: Approved scope for bounded offline continuation and pending-work retention
---
The user explicitly approved extending the offline-session prerequisite to finish local-first booking, including reload within an already verified session.

**Why:** The earlier foundation intentionally locked records on disconnect, which could not support the requested outage booking journey.

**How to apply:** Preserve bounded, verified continuation rather than introducing offline login. Pending bookings must survive logout and remain inaccessible to other accounts. Automatic reconnect replay and resolution remain separate work.
