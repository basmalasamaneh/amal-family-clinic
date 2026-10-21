---
name: Vite peer dependency identity
description: Workspace type failures after adding Workbox build tooling
---
Check duplicated Vite peer instances before changing unrelated application code when PWA dependencies introduce incompatible Plugin types.

**Why:** Workbox's terser dependency produced two nominally incompatible Vite type instances with identical Vite versions, affecting an untouched Canvas config.

**How to apply:** Keep build peers consistent and deduplicate the pnpm lockfile; do not hide the error with casts or modify Canvas to accommodate the Amal PWA.

Some development plugins export Vite types without declaring a Vite peer.
Resolve their imports from the plugin's location, not just from the app.

**Why:** A plugin can pick up the hoisted test runner's different Vite major even
when the app's direct Vite dependency is correct.

**How to apply:** Prefer narrowly scoped package-extension peer metadata for an
omitted peer over a global override that changes the test runner's dependencies.
Verify resolution in each consumer and run the full workspace typecheck.
