---
name: Prerequisite database availability
description: A merged database prerequisite does not establish that the current task database has its schema and fixtures.
---

Check prerequisite schema and fixture availability with read-only database queries before implementing dependent work, even when its task is merged.

**Why:** A task workspace had the merged operational code but no operational schema. After resuming, the schema was present; task state and code presence were insufficient evidence of database readiness.

**How to apply:** Verify the current database first. If a task forbids rebuilding prerequisites, stop and obtain authorization before running existing setup scripts. Never reset seed tables.
