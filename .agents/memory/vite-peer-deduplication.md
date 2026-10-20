---
name: Vite peer dependency identity
description: Workspace type failures after adding Workbox build tooling
---
Check duplicated Vite peer instances before changing unrelated application code when PWA dependencies introduce incompatible Plugin types.

**Why:** Workbox's terser dependency produced two nominally incompatible Vite type instances with identical Vite versions, affecting an untouched Canvas config.

**How to apply:** Keep build peers consistent and deduplicate the pnpm lockfile; do not hide the error with casts or modify Canvas to accommodate the Amal PWA.
