---
name: Orval date validation
description: Date formats combined with regex patterns break generated Zod validators with the current generator configuration.
---

Do not combine an OpenAPI date/date-time format with a regex pattern under the current date-coercing Orval configuration.

**Why:** The generator emits `.regex()` on `ZodDate`, which does not compile. This is a generator interaction, not a reason to hand-edit generated code.

**How to apply:** Use date/time format alone for timestamp responses. For strict date-only query strings, use a string pattern and validate real calendar dates at the API boundary, then regenerate.
