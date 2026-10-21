---
name: Presentation redesign boundaries
description: Standing constraints for UI redesigns and the approved checkpoint fallback.
---

UI redesigns must preserve the conflict engine and its tests, sync/offline behavior,
consent and visibility rules, authentication, test isolation, and existing API
contracts. Do not weaken tests or add skip/only/expected-failure markers. Behavioral
analytics must remain network-wide, never per doctor.

**Why:** The user explicitly established these as common rules for this and later
design requests. Visual changes must not alter clinical or scheduling authority.

**How to apply:** Keep changes presentation-only unless explicitly authorized.
Use Arabic-default i18n, logical CSS, shared tokens, and both themes. Verify
regressions and seed preservation; distinguish verification failures from passes.
An Access Log presentation must not broaden admin access to patient-access events.

The user approved proceeding with the existing Agent checkpoint as their recovery
point rather than requiring a manually created checkpoint.

**Why:** Manual Agent checkpoint creation is unavailable; the user explicitly said
they would return to the Agent checkpoint if needed.

**How to apply:** Never invent a checkpoint ID or claim a manual checkpoint was
created. Keep the project unpublished.
