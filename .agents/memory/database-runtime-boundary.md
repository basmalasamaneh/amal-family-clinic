---
name: Database runtime identity
description: Keep seed administration separate from application database authentication.
---

Authenticate runtime database connections as a restricted login, not as the
administrator followed by SET ROLE.

**Why:** SET ROLE on an administrator-authenticated session can be undone by
RESET ROLE, defeating immutable-seed permissions. PostgreSQL administrators
remain trusted maintenance actors, never application-query identities.

**How to apply:** Future operational schema work grants only needed privileges
to the runtime identity. Keep reset logic away from seeds. The runtime database
password is derived from SESSION_SECRET with database-specific domain separation;
coordinate secret rotation with administrator password rotation, never silently
rotate it during verification-only seed reruns.
