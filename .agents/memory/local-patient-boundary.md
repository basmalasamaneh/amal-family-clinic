---
name: Local patient boundary
description: Why demographic access and deletion retention are separate from network identity and clinical access.
---

Keep local demographic discovery separate from network lookup and verified identity.
Matching names, family phones or mutable bookings must never grant clinic access.

**Why:** The patient API is deliberately available without implementing the later
consent/network workflows; similarity is a suggestion, not authority. A guessed
remote patient ID accepted into a local booking would otherwise become a path to
reading and changing remote demographics. Access must be independent of booking.
Existing
operational DOB is required, so unknown DOB must fail explicitly rather than be invented.

**How to apply:** Future import/network services must establish their own authorized
relationships and review identity; do not derive grants from operational bookings
or history. Preserve restrictive patient references and
append-only audit retention when adding services; deleting a demographic record
must never erase its audit trail or recreate it through a replayed create request.
