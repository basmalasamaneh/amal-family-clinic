---
name: Seed data preservation
description: Confirmed immutable seed policy, operational copies, demo reset, and KPI sources.
---

The user requires the six workbook tables to retain their sheet names, column names, source-compatible types, primary IDs, and all rows, and says: “Do not modify or delete these tables later.”

**Why:** The user's direct instruction is stricter than Section 7 of the uploaded master plan, which proposes adding columns to existing tables.

**How to apply:**
- The six seed tables are READ-ONLY forever. The app never writes to them.
- Create separate operational tables with all Section 7 additions. Fill them from the seed tables using one idempotent script that preserves original IDs.
- Admin > Developer tools > Reset demo data wipes operational tables and re-copies from seed tables; it never changes seed tables.
- KPI “before” numbers are always computed from untouched seed tables; “after” numbers come from operational tables.
- The import wizard reads calendar_app_export directly from the seed table.

An audit may initialize a new, isolated disposable database from a read-only
copy of the six workbook tables, then enforce their immutable protections
before running tests. The user explicitly approved this bounded initialization.

**Why:** Existing regression assertions depend on the original workbook baseline;
an empty schema cannot verify them, and replacing expected totals would weaken
coverage.

**How to apply:** Never modify the existing source seeds or copy operational
sessions/credentials. Verify source and copy fingerprints, retain only sanitized
evidence, use separate operational fixtures for writes, and delete the disposable
database afterward. This is not permission to edit seeds after initialization.
- Keep the Section 12 API contract exactly as written. Operational table naming is the implementer's choice.
