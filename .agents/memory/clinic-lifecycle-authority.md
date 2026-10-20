---
name: Clinic lifecycle authority
description: Permission and ordering decisions for adoption and departure
---
Clinic management is an explicit clinic-scoped delegation to a doctor, never inferred from a doctor/admin role.

**Why:** Voluntary opt-in/export/leave must not grant network administrators clinical access or let them opt in on a clinic's behalf.

**How to apply:** Preserve explicit delegated authority and local scope for lifecycle/export operations. New remote-data consumers must enforce both source and requester eligibility using current database state, including cached evidence. Departure retains local Lite operation and is not erasure or permission to rejoin.

Establish export snapshots only after waiting for authorization-changing operations, not before acquiring their lock.

**Why:** PostgreSQL REPEATABLE READ takes its snapshot at the first SELECT, even a SELECT that waits for an advisory lock. Starting it before the wait can preserve a revoked grant.

**How to apply:** Keep lock acquisition separate from snapshot establishment and release any session locks before returning pooled connections. Consent provenance also participates in eligibility: a hidden latest grant must deny remote disclosure, not just hide its badge; a hidden withdrawal must never resurrect an older grant.

Publishing demonstration results requires an explicit selection of the trial
clinic and result clinics. Missing configuration is not permission to infer them.

**Why:** Clinic identity and permission to publish results cannot be inferred
from names or row order; doing so could disclose another clinic's measurements.

**How to apply:** Keep publication selection independent from account role and
operational ordering; unconfigured installations must report unavailable results.

Treat a disconnect after sending a lifecycle choice as an uncertain outcome,
not as proof that nothing was sent.

**Why:** Going offline can lose the response after the server commits. A status
read can also race an in-flight commit.

**How to apply:** Preserve the exact pending target across navigation and require
a deliberate retry; never automatically replay a lifecycle choice on reconnect.
