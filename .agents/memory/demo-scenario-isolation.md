---
name: Demo scenario isolation
description: Why onboarding and Clinical safety-story demos must not share an implicit mode switch.
---

Default demo population favors the Lite onboarding story. Clinical sharing must
require an explicit authorized opt-in to Full for the receiving doctor’s clinic;
never silently upgrade a clinic as a lookup side effect.

**Why:** The master plan requests both a clinic that initially declines network
sharing and an impressive cross-clinic medication lookup. Those initial states
are incompatible. Consent alone does not override Lite restrictions.

**How to apply:** Run these as isolated scenarios, with an explicit operator
choice before the Clinical story and reset before replaying onboarding. Keep
both source and receiving clinic network modes in future privacy checks.
