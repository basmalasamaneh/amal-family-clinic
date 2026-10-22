---
name: Online login versus device sync authority
description: Device-less doctor sessions remain valid for online clinical work.
---

Treat online clinical login and trusted-device sync permission as separate capabilities.

**Why:** A valid doctor password session can lack a trusted device. Automatically starting device-only sync then treating its expected refusal as global session revocation prevented all online lookup. The user approved separating these capabilities while preserving server device checks.

**How to apply:** Do not infer sync permission from login or an offline continuation permit; preserve pending local work and server-side sync enforcement. Re-check capabilities from online trusted identity before delivery.

Mocked online-session browser tests must also represent the absence of offline
permission explicitly rather than allowing permission requests to hit live APIs.

**Why:** A synthetic identity has no real server session. A live permission
request therefore returns 401 and correctly revokes that identity, making an
otherwise unrelated page test fail at login.

**How to apply:** Model a device-less signed-in doctor with a denied offline
permit (403), not an invalid session (401). Never change real authentication to
accommodate partial mocks.
