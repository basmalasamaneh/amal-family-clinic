---
name: Import provenance and merge authority
description: Why filenames cannot define event identity and exact demographics cannot transfer consent.
---

Treat uploaded export names as display provenance, never as independent event namespaces.

**Why:** This product supports one calendar-export adapter. Renaming a file, or switching from the immutable seed reader to JSON upload, must not turn the same event into a second appointment.

**How to apply:** Keep source-event deduplication independent from filenames, demographic matching and appointment-time overlaps when extending import consumers.

Exact duplicate demographics do not establish consent equivalence. Block merges involving consent evidence or differing visibility grants until there is an explicitly approved resolution policy.

**Why:** Reassigning a visit to an otherwise identical patient can expose it under the survivor's existing consent or doctor rights; preserving evidence alone does not prevent that disclosure.

**How to apply:** Future merge UI must explain these blockers, not offer a generic force-merge action. Do not remove blockers merely to increase the number of mergeable candidates.
