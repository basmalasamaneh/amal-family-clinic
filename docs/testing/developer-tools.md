# Developer tools: repeatable offline/sync/reset demonstration

## Safety and setup

This feature is for a disposable development/demo environment, not production.
The server must have `AMAL_DEVELOPER_TOOLS=1`, must not have
`NODE_ENV=production`, and must not have `REPLIT_DEPLOYMENT=1`.
Without explicit enablement the developer APIs deny access. Only an authenticated
**network-wide administrator** may control outages or reset; a clinic-scoped
administrator cannot affect another clinic or reset the network.

Install the existing seed/operational prerequisites and additive migrations
through `0014_adoption.sql` first. Then, as the trusted migration operator:

```sh
AMAL_DEVELOPER_TOOLS=1 pnpm --filter @workspace/scripts developer:migrate --demo
```

The installer needs `DATABASE_URL` and `SESSION_SECRET`. It does not perform a
reset. It installs `0015_developer_tools.sql`, the persistent generation/reset
receipts, the clinic outage table, and the restricted reset login.
Never put secrets in shell history or documentation; use the environment's secret
store. The reset runtime authenticates directly as `amal_reset_login`, not as an
administrator followed by `SET ROLE`. Its existing app-role membership supplies
seed **SELECT only** without modifying seed ACLs; the reset exception does not
grant the ordinary app access to the reset role.

Use the existing documented synthetic demo accounts. Source clinic names are
data: select clinics from the current administrator directory rather than using
fixed IDs or a fixed clinic count.

## Demonstration, twice

1. Sign in as a network-wide administrator. Open **Admin → Developer tools** and
   load the current clinic list/status. In another browser/device, sign in as a
   receptionist for a selected clinic and prepare its local offline workspace.
   Keep another clinic open to observe isolation.
2. Prepare a controlled collision: before enabling the outage, create an online
   appointment for the selected doctor in a chosen half-hour slot. The prepared
   offline snapshot should not contain this newer appointment. Choose three
   authorized local patients and three slots; the first two slots are free, and
   the third overlaps the newer server appointment. Keep the conflict last, as
   the existing sync engine blocks subsequent operations after a conflict.
3. Enable **Simulate outage** for the selected clinic. Its operational calls,
   normal booking writes, sync push, and sync pull return `503 CLINIC_OUTAGE`.
   The other clinic remains operational. Auth recovery, `/me`, demo context and
   authorized developer controls remain reachable.
4. Make three local-first bookings in the prepared clinic workspace. These are
   local pending changes, not successful server writes. Preserve their original
   operation UUIDs and per-device sequence numbers.
5. Reload the administrator status or use another administrator session. The
   outage is still enabled. Restore the selected clinic; repeating restore is
   harmless. A real remaining transport/network error must still be shown as an
   error, not as successful connectivity restoration.
6. Let the existing sync runner replay the three original operations in order.
   Expect **two applied bookings and one retained conflict**. Retrying the same
   push must return the same durable outcomes, without duplicate appointments
   or duplicate conflict evidence. Pull should work again. Keep the conflict
   visible rather than resolving it for this scenario.
7. Optionally enable an outage again to demonstrate reset clearing it. Warn all
   demo participants: reset discards **all clinics' operational changes and
   pending offline demo work**, not only the selected clinic.
8. Use **Reset demo data** and its explicit confirmation. Do not navigate away
   while pending. Reset is never an offline queued operation. A successful reset
   changes the generation, clears outages, rebuilds the baseline, and deletes
   sessions/devices. Sign in again explicitly; no new access is silently granted.
9. If the response was lost, retain the same request UUID. After reauthentication,
   reconcile `GET /api/admin/developer/resets/:requestId`. A completed receipt is
   authoritative; do not create a new reset request just to discover whether the
   old request succeeded. Retrying the original request/old expected generation
   returns its existing receipt, not another reset.
10. Returning old browsers/devices must discard affected demo-local work when
    they learn of the changed generation, then reauthenticate/bootstrap. Old
    generation booking, push, and pull requests receive
    `409 DEMO_RESET_REQUIRED` before operational mutation, including when their
    old sessions have been deleted. Only confirmed reset/generation mismatch
    should trigger local data cleanup; a failed reset is not confirmation.
11. Prepare fresh devices and repeat steps 1–6 using the same logical slots.
    Expect the same two-applied/one-conflict outcome without leftover blockers,
    pending operations, or duplicate fixtures from the first run.

All 24 calendar-export rows return to `review_required`, with no confirmed patient
or doctor link. Population continues to use the existing Asia/Hebron mapping;
already-normalized source instants are not converted again. Reset does not repair
or alter the six immutable source tables.

## Automated disposable verification

Run from the workspace:

```sh
pnpm --filter @workspace/api-server exec tsx --test tests/developer-reset.test.ts
```

Prerequisites: `DATABASE_URL` points to an initialized development database to
**read**, and PostgreSQL `initdb`, `pg_ctl`, `pg_dump`, and `psql` are on `PATH`.
The test does not reset or migrate that database. It takes a read-only dump into
a temporary directory, starts a separate temporary PostgreSQL cluster on a
private Unix socket (TCP listening disabled), restores schema/data/ACLs there,
then switches the test process's database environment before importing runtime
modules. It starts a separate ephemeral Express test server using the real
application, routes, authentication, booking, sync, boundary, and reset services.
All generated operational writes and resets happen in the disposable cluster.

The suite covers:

- Seed content, schema, ACL, ownership, constraint, index and trigger fingerprint
  preservation through migration, forced reset failure, successful reset and
  repeated reset; restricted seed-write denial and app/reset-role separation.
- A late injected receipt-write failure rolls back every operational table,
  generation and receipt, retaining existing outage/session state.
- A shared ordinary-write fence blocks reset; concurrent resets serialize and
  the losing request cannot reuse a session deleted by the successful reset.
- Anonymous/receptionist reset denial, clinic-scoped administrator denial,
  CSRF enforcement, malformed/overflow/missing clinic IDs, explicit environment
  disablement and deployment disablement.
- Dynamically added operational clinics appear in status and support outage
  enable/restore without hard-coded IDs.
- Persisted outage status across separate administrator sessions, idempotent
  enable/restore, another clinic's successful sync pull, and auth recovery during
  the selected clinic's outage.
- Actual HTTP normal booking/push/pull outage rejection, then three original
  offline-shaped payloads replayed into **applied/applied/conflict**, duplicate
  push replay, successful pull, reset through HTTP, real password/PIN
  reauthentication, and the same scenario on a second fresh baseline.
- Receipt reconciliation and retry after reauthentication without another
  generation change; old-generation normal booking/push/pull reject before any
  appointment, receipt, sync-operation or audit mutation.
- Identical all-table baseline counts after repeated reset, cleared outages and
  sync operations, and all 24 calendar rows review-required/unlinked.

### Results

The disposable PostgreSQL + real Express suite passed after correcting request
validation to recognize generated-contract failures as `400 VALIDATION`, and
adding the signed 32-bit upper bound for clinic IDs. No workspace reset was used.
The suite reports the two repeated controlled sync scenarios explicitly.

This is server-side/integration evidence, **not** a claim of automated browser
Dexie, multi-tab runner, accessibility or UI verification. The three payloads are
prepared in the test process in the same shape as the existing offline outbox;
the manual/browser demonstration remains necessary to verify local storage and
visual feedback.

The subsequent signed-in browser pass verified the dynamic selector, isolation,
cross-tab/reload outage persistence, restore, English Light/Dark and Arabic RTL,
the exact confirmation phrase, Cancel focus restoration, and stale-generation
409 rejection. It restored all outages without submitting a workspace reset.
The offline-control subtest reached expired-session sign-in before inspecting the
controls; this is not claimed as a completed browser offline-booking run.
Focused client tests cover generation binding, legacy cache invalidation,
cross-controller preservation of new-generation work, late responses and fresh
reconciliation. The observed language-switch issue in the restored notice was
fixed by translating its stored message key at render time.

## Cleanup and limitations

Restore any simulated outages through the administrator controls before turning
the feature off. A successful demo reset also clears every outage, but it is
destructive to operational demo edits and requires separate confirmation.
Remove `AMAL_DEVELOPER_TOOLS=1` to disable controls; do not enable them in a
published deployment. Sign in and prepare devices again after reset.

The automated suite closes its HTTP server and boundary/database pools, stops
the temporary PostgreSQL cluster, and removes its temporary dump/data directory
in `finally` cleanup. If the process is forcibly killed, only remove the
`/tmp/amal-reset-test-*` directory belonging to that test after stopping its
temporary `pg_ctl -D <directory>/data` instance; never target the workspace
database or a production PostgreSQL directory.

“Simulate outage” is a **clinic API outage**, not loss of browser internet
connectivity. It does not modify `navigator.onLine`, break global requests, stop
the server, or guarantee that an unrelated real network failure has recovered.
Already admitted operations keep their committed outcomes; activation/reset
wait for their admission fence. Persistent receipts cover ambiguous reset
responses, not authorization: reading a receipt still requires a newly valid
network-wide administrator session.
