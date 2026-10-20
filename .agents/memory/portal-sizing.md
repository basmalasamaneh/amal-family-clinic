---
name: Portal sizing
description: Modal portals need explicit sizing rules and direct geometry checks.
---

Do not assume shell-scoped box sizing applies to body-level modal portals.
Give portaled surfaces explicit border-box sizing and check their own bounds,
not only the document's scroll width.

**Why:** A mobile dialog extended beyond both viewport edges while document
scrollWidth still equaled clientWidth. The global page overflow check missed it.

**How to apply:** When adding or changing a drawer/dialog, verify the portaled
surface bounds in RTL and LTR on mobile, including padding and borders.
