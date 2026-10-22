---
name: Offline booking authorization extension
description: Approved scope for bounded offline continuation and pending-work retention
---
The user explicitly approved extending the offline-session prerequisite to finish local-first booking, including reload within an already verified session.

The user also approved registering a new patient and creating a dependent booking
while offline within that verified session. Registration must be acknowledged by
the server before its booking can be sent; saving locally is not server confirmation.

**Why:** On 2026-10-22 the user explicitly requested and approved offline patient
registration rather than the previous online-only registration restriction.

**How to apply:** Preserve required demographics and guardian validation, durable
retry identity, scoped pending-work retention, and the hard patient-overlap rule.
Never turn demographic equality into an automatic merge or clinical access grant.
Do not broaden this permission to offline login or expired/revoked sessions.

**Why:** The earlier foundation intentionally locked records on disconnect, which could not support the requested outage booking journey.

**How to apply:** Preserve bounded, verified continuation rather than introducing offline login. Pending bookings must survive logout and remain inaccessible to other accounts. Automatic reconnect replay and resolution remain separate work.

The user approved updating regression coverage for the delivered local-first
workflow rather than restoring the old online-preview booking workflow.

**Why:** Legacy UI expectations must not force an unrequested product change.

**How to apply:** Keep server collision, authorization and idempotency assertions
in real API coverage, and distinguish local durable acknowledgement from actual
server commit in UI coverage. Do not silently discard unmapped UI checks.
