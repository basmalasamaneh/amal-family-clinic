---
name: Import provenance and merge authority
description: Why filenames cannot define event identity and exact demographics cannot transfer consent.
---

Treat uploaded export names as display provenance, never as independent event namespaces.

**Why:** This product supports one calendar-export adapter. Renaming a file, or switching from the immutable seed reader to JSON upload, must not turn the same event into a second appointment.

**How to apply:** Keep source-event deduplication independent from filenames, demographic matching and appointment-time overlaps when extending import consumers.

Preserve opaque external event identifiers as stable identities across file
formats; never replace them with row positions, random IDs, or truncated hashes.

**Why:** Supporting calendar files alongside spreadsheet exports introduces
non-numeric event IDs. Converting those to small integers can collide or create
duplicates when the same appointment is uploaded in another format.

**How to apply:** Numeric legacy IDs retain their existing identity; opaque IDs
must remain distinguishable and repeatable regardless of filename or row order.

Exact duplicate demographics do not establish consent equivalence. Block merges involving consent evidence or differing visibility grants until there is an explicitly approved resolution policy.

**Why:** Reassigning a visit to an otherwise identical patient can expose it under the survivor's existing consent or doctor rights; preserving evidence alone does not prevent that disclosure.

**How to apply:** Future merge UI must explain these blockers, not offer a generic force-merge action. Do not remove blockers merely to increase the number of mergeable candidates.

Merge preview must not reveal which hidden clinical evidence caused a safety blocker; expose a generic restriction and actor-scoped scheduling counts, not global clinical totals.

**Why:** Authority to view two demographic records is not authority to infer their consent or clinical history. A read-only preview can still leak private information through counts and specific blocker reasons.

**How to apply:** Keep future preview fields within the requesting actor's visibility. Treat preview as advisory and independently revalidate the actual merge transaction.

Waitlist request and offer history is not transferable through demographic merging,
even after an offer has ended. Preserve the originally selected patient identity.

**Why:** Reception selected an explicit patient for a specific availability request.
Matching demographics cannot establish that another record inherits that request
or the patient's reported acceptance/decline.

**How to apply:** Classify new waitlist references in merge safety checks without
blocking unrelated patients. Keep affected merges restricted until an explicit
identity-resolution policy is approved; do not silently reassign offers.
