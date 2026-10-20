---
name: Developer reset scope
description: Approved scope for the missing restricted reset capability.
---

The user approved adding the missing restricted reset capability as part of Developer Tools rather than waiting for a separate prerequisite.

**Why:** The existing reset CLI required administrator database access and could not safely be exposed to the application.

**How to apply:** Reuse the established population logic. Keep the reset connection separate from ordinary runtime authority and preserve the six source tables unchanged. This approval does not authorize production reset tooling.
