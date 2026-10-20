---
name: Clinical authority and consent ordering
description: Why clinical ownership is narrower than demographic clinic access and why consent readers coordinate with writers.
---

Clinic-wide demographic access does not establish a doctor's own-patient clinical relationship. Require independently trusted doctor and clinic relationships; mutable bookings, shared names and consent never create local clinical authority.

**Why:** The own-patient requirement must not expand to every patient visible to reception or every patient whose ID can be submitted in a booking. A local relationship must never unlock remote notes.

**How to apply:** Future verified linkage may establish explicit relationships, but clinical reads must preserve this narrower boundary. New-patient registration alone does not assign a treating doctor.

Dependent authorization metadata must remain compatible with the existing privileged demo reset and be restored from trusted identities afterward.

**Why:** Runtime immutability must not accidentally block the established administrative lifecycle or leave recreated demo patients without their clinical relationships.

**How to apply:** Check both parent-deletion order and post-recreation authority, not only whether cleanup succeeds. Keep runtime privileges restrictive; do not add audit reset exceptions.

Consent reads and transitions coordinate through database transaction locks, not in-process locks or session state.

**Why:** Withdrawal must apply to the next request across instances, while an earlier authorized read must finish its durable disclosure audit before a competing withdrawal commits.

**How to apply:** Any future sync/import/consent writer or protected clinical reader must participate in the same ordering discipline. Never select an older active grant after the newest record is withdrawn.

Patient-card revalidation deliberately reuses audited lookup rather than joining demographic reads with raw visit data.

**Why:** An otherwise convenient detail view must not create a second, unaudited authorization path. Local Clinical visibility and network sharing consent are independent, so a badge cannot infer consent from the richest disclosed visit.

**How to apply:** Keep that distinction when extending consent displays or adding a future patient-detail contract; any replacement detail projection needs equivalent filtering, withdrawal ordering and disclosure audits.

Protected pagination must revalidate previously displayed pages instead of appending fresh results to retained clinical payloads.

**Why:** A successful later-page request after withdrawal can otherwise leave earlier-page notes or alerts visible even though the new response correctly applies the downgraded policy.

**How to apply:** Clear protected results before paging and re-read a bounded set from the beginning, discarding obsolete requests. Never restore an earlier success after a failed refresh.
