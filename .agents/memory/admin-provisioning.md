---
name: Admin provisioning boundaries
description: Reasons for separating directory creation from account authority and for conservative network-health totals.
---

Doctor-directory creation must not implicitly create a login. Provision the
associated account explicitly, with intentional credentials and reciprocal links.

**Why:** Directory management is not authorization to grant clinical access.
Separating the two lets administrators configure clinics safely before accounts
are ready, without invented passwords or unintended access.

**How to apply:** Future admin screens should make account provisioning an
explicit action after doctor creation, not silently create a user.

Treat network-health queue totals as bounded evidence. Do not combine a device's
submitted queue mirrors with persisted conflicts, or treat an unobserved device
as reporting zero.

**Why:** A disconnected browser cannot report its current backlog; summing local
mirrors and server conflicts overcounts the same work.

**How to apply:** Future heartbeat scheduling must report only unsubmitted work;
future health screens must preserve null/coverage distinctions and show server
conflicts separately. A successful push timestamp is not evidence of a completed
full push-and-pull cycle.

Administrative audit visibility must be explicitly allowlisted, not a raw audit-log browser. Demographic or administrative authority does not grant clinical audit access.

**Why:** Audit details and action text can contain clinical material, lookup input, or credentials. Even counts and patient identifiers can disclose private activity.

**How to apply:** Review each new action before exposing it; omit patient-linked events and return only approved identifier context. Keep the doctor clinical audit endpoint separate.
