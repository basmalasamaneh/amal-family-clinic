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

Measure a fixed-position reference rectangle when converting target coordinates
to logical overlay offsets; do not assume innerWidth is the fixed viewport width.

**Why:** Reserved scrollbar gutters can shift an RTL highlight by a scrollbar
width even when innerWidth and document clientWidth report equal values.

**How to apply:** Verify highlight edges against actual target edges, not just
card containment, with both ordinary and stable scrollbar gutters in RTL/LTR.

Keep the measuring frame and rendered highlights in one positioning layer.
Track position changes as well as size changes while a tour is visible.

**Why:** A toolbar reflow can move a target without resizing it; ResizeObserver
alone does not detect that movement. Tests of static bounds missed this case.

**How to apply:** Include scrolled sticky headers and toolbar movement in tour
alignment checks. Compare settled target/highlight geometry, not a fixed number
of animation frames, since React may not commit the geometry update immediately.
