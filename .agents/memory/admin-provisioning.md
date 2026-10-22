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

Do not interpret a failed post-save selector/session refresh as an uncertain clinic creation.

**Why:** Clinic creation has no idempotent replay contract. Once the create response confirms persistence, offering creation again because a later read failed risks duplicates. A fresh listing also cannot prove an earlier in-flight write failed.

**How to apply:** Keep confirmed persistence separate from refresh warnings. For transport-uncertain creation, reconcile stable returned IDs explicitly, never infer identity from a matching name, and disclose duplicate risk before any deliberate new attempt.

Network-wide reminder reporting is aggregate-only; it does not grant access to
patient message bodies or home-clinic reminder controls.

**Why:** The user asked for meaningful scheduled-message information on the
global administrator's page rather than an empty no-clinic screen. That request
does not transfer other clinics' patient-message access or management authority.

**How to apply:** Report actual clinic counts and next scheduled times. Keep
message details and settings under their existing explicit clinic authority;
never invent delivery outcomes to fill the overview.
