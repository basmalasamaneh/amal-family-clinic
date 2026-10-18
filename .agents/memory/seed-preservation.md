---
name: Seed data preservation
description: User restriction that overrides additive changes to seed tables in the master plan.
---

The user requires the six workbook tables to retain their sheet names, column names, source-compatible types, primary IDs, and all rows, and says: “Do not modify or delete these tables later.”

**Why:** The user's direct instruction is stricter than Section 7 of the uploaded master plan, which proposes adding columns to existing tables.

**How to apply:** Do not alter seed schemas or data for app features, merges, imports, demo resets, or migrations. Resolve the discrepancy with the user before choosing an operational data model.
