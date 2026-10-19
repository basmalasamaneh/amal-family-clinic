---
name: Workbook time and matching rules
description: User clarification of timestamp conversion and mandatory calendar-export review.
---

## Workbook times
Treat naive workbook timestamps as Asia/Hebron local time. Timestamp seed storage is a reversible UTC interpretation, not a source correction; retain the unchanged workbook for provenance. Date-only birth and visit fields remain dates. Use date-fns-tz for DST handling, never hand-written offsets.

**Why:** The user confirmed the source times are local to Asia/Hebron.

**How to apply:** Verify timestamp round trips to original local values. Future operational copies must not apply a second local-to-UTC conversion to seed instants.

## Calendar import matching
Require review for every calendar-export row. Name-only matches provide a suggested patient and a “Needs review” badge, never an automatic link. The receptionist must confirm by checking phone or date of birth. Unmatched rows offer “Create new patient” with phone required.

Auto-match is allowed only when name AND (date of birth OR phone) match. This export contains neither phone nor date of birth, so none of its rows can auto-match.

**Why:** The user explicitly replaced the master plan's “3 auto, 21 review” expectation with review of all 24 rows.

**How to apply:** Use 24 review-required rows in import acceptance criteria, tests, and the demo; do not weaken identity matching to satisfy the old demo counts.
