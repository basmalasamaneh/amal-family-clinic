# Measured network health

`GET /network/health` requires an authenticated administrator. It enumerates **every**
operational clinic, including Lite clinics and clinics with no devices. Connectivity is
`online` only when at least one currently trusted device has a fresh server-received
heartbeat; otherwise it is `offline`. Offline does not prove a clinic has no internet:
it means there is no current measured evidence. No demo/seed connectivity is inferred.

`POST /network/heartbeat` requires an active doctor/front-desk session, its bound
trusted `amal_device` opaque cookie, and `x-csrf-token`. It does not extend session
expiry or bypass existing Origin checks. Body is strictly:

```json
{"sequence": 1, "unsubmittedOperationCount": 0}
```

Sequence is a positive safe integer, strictly greater than the device's last accepted
sequence (gaps allowed). Persist it per trusted device across tabs/restarts. A repeated
or older sequence returns `409 HEARTBEAT_REPLAY` without updating freshness. Concurrent
equal sequences have exactly one winner. There is no reset on login and no client
timestamp, clinic/device selector, patient data or operation payload in telemetry.
Count must be an integer between 0 and 1,000,000.

Success returns `deviceId`, `clinicId`, `sequence`, server-authored ISO `receivedAt`,
and `heartbeatTimeoutSeconds`. `NETWORK_HEARTBEAT_TIMEOUT_SECONDS` defaults to 120;
accepted integer range is 10–86400. Invalid configuration fails explicitly.

Health returns `generatedAt`, `heartbeatTimeoutSeconds`, and `clinics`. Each clinic
has identity/name/network mode, connectivity, last heartbeat and successful sync,
`serverOpenConflictCount`, `unsubmittedOperationCount`, `queueCoverage`, and `devices`.
Dates are ISO instants or null. Each device has ID/label, `trustStatus`
(`trusted`, `revoked`, `untrusted`), online/offline connectivity, heartbeat sequence,
last heartbeat, successful sync and local count.

## Queue evidence and coverage

- `serverOpenConflictCount` counts persisted `sync_conflicts` rows with status `open`,
  once per clinic, including conflicts from subsequently revoked devices.
- Device counts report only locally **UNSUBMITTED** operations: clients must exclude
  submitted operations, server conflicts and their local mirrors. These are
  authenticated device reports, not server-verified queue contents.
- These two populations are displayed separately, **never added**. Legacy seeded
  `sync_queue` snapshots and appointment-operation receipts are not additional queues.
- Fresh trusted device reports may contain a genuine zero. Stale, untrusted,
  revoked and never-observed device counts are null, not zero.
- Clinic local count is available only if at least one trusted device exists,
  every trusted device is fresh, and no untrusted registered devices exist.
  Otherwise it is null, not a misleading partial total.
- Coverage includes `registeredDeviceCount`, `trustedDeviceCount`, `freshDeviceCount`,
  `staleDeviceCount`, `unknownDeviceCount`, `revokedDeviceCount`, and `complete`.
  Unknown includes never-observed trusted devices and all untrusted devices.
  Fresh + stale + unknown + revoked equals registered. A clinic with zero registered
  devices has incomplete coverage even though all device counters are zero.
- Revoked devices remain visible but are excluded from the active queue denominator;
  their inaccessible local backlog is not asserted empty.

## Successful sync and concurrency

Only the **existing** push engine writes `lastSuccessfulSyncAt`, in the same database
transaction as applied operations. A push must contain a genuinely new applied
operation and every outcome must be applied. Empty/invalid, failed, conflict/blocked,
mixed-outcome, version-only/no-op updates and replay-only pushes cannot advance it. Conflict resolutions and
heartbeats do not author successful-push timestamps. This is successful push evidence,
not proof every clinic device has completed a full pull round trip.

Heartbeat and sync hold row locks on the trusted-device record through commit.
Revocation must update that same record transactionally, so a revoked device cannot
commit a later report after revocation wins. Heartbeat revalidates session expiry and
binding after acquiring locks. Health uses one repeatable-read snapshot.

## Development verification

Apply `scripts/network-health-migrate.ts` after auth/sync migrations. The runner is
development-only; managed production schema is applied through Publish. Migration
`0013_network_health.sql` only creates operational telemetry and grants runtime access;
no seed data is changed. Run `pnpm --filter @workspace/api-server admin:test`.
The network suite uses isolated real PostgreSQL tables and checks all six workbook
seed checksums, authorization/expiry, forged selectors, replay/concurrency,
revocation, freshness/coverage, queue separation and actual sync timestamps.
