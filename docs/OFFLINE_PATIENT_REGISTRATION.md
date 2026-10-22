# Offline patient registration

Reception can register a patient and queue a booking while disconnected, within an
already authorized clinic session on a trusted device. This does not enable
offline login or extend an expired authorization.

## Reception steps

1. Sign in online and allow the authorized clinic cache to load.
2. When disconnected, open patient registration from patient search or the
   no-results action in the booking drawer.
3. Enter the required name, telephone and date of birth. Guardian information is
   still required for a minor.
4. Save. The patient is saved **on this device**, not yet confirmed by the server.
5. Select the patient and complete the booking request within the available local
   scheduling window. The booking remains provisional.
6. Open Sync & conflicts to see patient registrations and appointment requests.
7. Reconnect within a valid authorized session. Registration is submitted first;
   its booking is sent only after the server confirms the canonical patient ID.
   Appointments still undergo the normal server-side conflict checks.

## Recovery and limits

- Reload preserves queued registration and booking identities. Snapshot refresh
  does not remove locally registered patients.
- A lost response is retried with the original registration operation ID and
  payload. The existing patient API handles idempotency.
- A negative local patient identity is never sent to the appointment API.
- Local request data remains distinct from the frozen canonical delivery payload.
- Pending work remains subject to the existing logout/data-removal safeguards.
  Do not clear browser storage to resolve a failed request.
- Rejected registrations require attention; they do not silently become successful
  and their dependent bookings must not be transmitted.
- Demographic equality never automatically merges patients or grants clinical
  access. Patient and doctor appointment collision checks remain enforced.
- Existing unresolved earlier booking conflicts can still hold later bookings
  under the device ordering policy. This feature does not bypass that policy.

No source seed tables or server schema changes are needed for this flow.
