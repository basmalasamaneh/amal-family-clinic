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
