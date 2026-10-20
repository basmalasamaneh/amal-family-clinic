---
name: Booking test clocks
description: Separating axe scans from deterministic deferred-cancellation timing.
---
Scan pending cancellation accessibility before pausing browser timers; Undo that
pending operation and start a fresh one under the controlled clock for exact
deadline assertions.

**Why:** Axe itself schedules browser timers. Running it against a paused clock
can stall the audit, while advancing that clock to help axe also consumes the
product's Undo window and invalidates boundary assertions.

**How to apply:** Never fake server time or cancellation outcomes. Keep the
accessibility scan and exact client-timer boundary exercise separate in the same
real authenticated journey. Install the clock before the store captures Date.now,
but leave timers running for axe. Resume and resynchronize browser wall time before
acquiring a real server hold: otherwise accelerated browser time can make a newly
issued server hold appear already expired.
