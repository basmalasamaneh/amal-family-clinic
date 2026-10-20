---
name: Forked development authentication origins
description: Auth origin configuration can retain the parent workspace hostname after a task fork.
---

Verify the exact development origin before diagnosing browser login failures in a task workspace.

**Why:** A task fork inherited the previous workspace's allowed origin while its preview hostname changed. Real login then correctly returned CSRF 403 even with valid credentials.

**How to apply:** Compare the development preview origin with the development-only auth allowlist and update that setting through environment tooling if necessary. Restart the API. Never solve this by allowing all origins, disabling CSRF, or changing production origins.
