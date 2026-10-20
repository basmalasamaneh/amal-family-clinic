---
name: Generated validation errors
description: Zod major-version boundary between generated contracts and API error handling.
---

Use safeParse and an explicit API validation error for generated request contracts.

**Why:** Generated schemas use Zod 3 while handwritten server validation uses Zod 4. An instanceof check against Zod 4 does not recognize generated Zod 3 errors, turning invalid requests into internal errors.

**How to apply:** Keep response validation failures internal, but map generated request validation failures explicitly to the established 400 response.
