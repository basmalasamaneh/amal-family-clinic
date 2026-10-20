# Local-first booking

Real booking uses the same local command online and offline. Before an outage,
an authenticated registered device must load the calendar online. Preparation
fetches all authorized clinic doctor/patient pages, the next 14 Asia/Hebron
calendar days of appointments, and the server device sequence. Incomplete
fetches never replace coverage with a guessed range.

The approved session extension grants at most 30 minutes (never beyond server
session expiry) of offline access in the same tab, including reload. This is not
offline login. No password, PIN, cookie or CSRF token is saved in IndexedDB.
Expiry, logout, permission failure and account changes lock private views.

`LocalCacheController.saveBooking` validates identity, coverage and blocking
doctor overlaps and writes the proposal, typed outbox, local identity counter
and device sequence in one IndexedDB read/write transaction. Exact retries
reuse the operation ID and immutable payload. Changed payloads cannot reuse it.
Intervals are half-open; only booked/double_booked server statuses reserve time.
Unknown cross-clinic patient conflicts are checked by the server, not cached.

`offline/booking-bridge.ts` exposes the narrow delivery interface:

- `saveLocalBooking` commits locally and returns a provisional appointment,
  then makes at most one online delivery attempt.
- `deliverLocalBooking` is an explicit retry entry point. It sends the frozen
  create operation through the existing sync/push contract, with its original
  sequence and clientOpId. Unresolved predecessors prevent delivery.
- `acceptBookingOutcome` requires the exact operation/sequence and matching
  applied appointment fields. HTTP success, a read-back, time elapsed and
  browser connectivity cannot acknowledge work.

There is no reconnect listener, queue drain, background sync or conflict
resolution UI in this change. Retained conflicts/rejections continue to block
overlapping proposals and remain available to the subsequent resolution task.
An acknowledgement retains the original proposal and outbox evidence.
Cache replacement and pruning never delete these tables. Logout revokes
access immediately but pending work blocks device-data deletion, including the
legacy discard option. Sign in online as the original account to recover it.
Clearing browser/site storage outside the application can still destroy data.

The scheduling window and last refresh are displayed; covered cached data
is not a reservation or a guarantee of server availability. Dates outside
coverage and missing cached identities require an online refresh. DST handling
uses the existing booking time validator and date-fns-tz.

## Verification

Run the local booking/cache/UI unit tests with:

```
pnpm --filter @workspace/amal-network exec tsx --test tests/local-booking.unit.test.ts tests/local-cache.unit.test.ts tests/local-booking-ui.unit.test.ts tests/booking.unit.test.ts
pnpm run typecheck
```

Unit storage tests use fake IndexedDB and synthetic projections. Browser tests
use a real service worker and IndexedDB with mocked authenticated API responses;
they are not evidence of live database sync. No seed data is changed.
