---
name: Staff-assisted patient access history
description: Approved access-history scope without patient accounts or broad reception audit access.
---

Patient-facing access history is a staff-assisted patient-request workflow, not a patient account or general reception audit browser. The user approved adding the missing secure backend support to finish this workflow.

**Why:** Doctor audit permissions do not authorize reception to browse audit data, and possession of a patient ID is not authorization.

**How to apply:** Require authenticated clinic-scoped reception, fresh PIN and explicit confirmation of the patient's request on every history page. Return only a minimal projection of the selected patient's recorded cross-clinic disclosures. Preserve the separate doctor audit boundary.

Fresh PIN confirmation rotates session credentials. Multi-step workflows must consume the returned CSRF value, and pagination must remain valid across that rotation while still rechecking authorization on each page.

**Why:** Live browser verification exposed both rejected writes after successful PIN confirmation and rejected continuation cursors signed against the previous session.

**How to apply:** Bind continuation integrity to stable authorized actor/clinic/patient/device context using a server-only key, not a rotating session credential. Never relax CSRF or skip fresh-PIN checks to make continuation work.
