# Clinic adoption backend handoff

## Authority and lifecycle

Consent, operational schema, authentication, local booking and immutable seed protections were verified before implementation. Migration 0014 is additive and preserves every existing Full/Lite clinic's effective permissions; existing state start dates use the stored join instant as migration metadata, not evidence of a historical opt-in. New clinics created through the API start Trial (Lite permissions). There is no timer, billing, automatic upgrade or rejoin.

`GET /clinics/:id/adoption` exposes persisted state, membership, transition timestamps, allowed choices and actor-specific capabilities. Clinic and administrative directory DTOs additionally expose adoption metadata. `POST /clinics/:id/adoption` accepts only `{state:"lite"|"full"}`. Trial→Lite, Trial→Full, Lite→Full and Full→Lite are supported. Selecting the current state is a no-op. Each genuine change records an append-only audit event in the same transaction.

Management requires an explicitly delegated **doctor in that clinic**, not merely any doctor, receptionist or network administrator. A trusted database operator provisions `operational.clinic_managers(clinic_id,user_id)` after independently verifying clinic authority. The runtime has SELECT only. No delegation is seeded automatically; administrators cannot obtain clinical access through this permission. Delegation writes participate in database locking via a statement trigger. Session, role, scope and delegation are checked again under the lifecycle lock. Request actor/clinic fields cannot override authenticated scope.

Generic clinic settings updates reject `mode`. New-clinic administration cannot opt in to Full on a clinic's behalf. Existing admin forms receive only the minimal compatibility adjustment to stop submitting that removed field; no journey screens are included.

## Sharing and concurrency

Effective `network_mode` remains the compatibility permission boundary, constrained to Full exactly when adoption is Full and membership active. Trial/Lite/left therefore cannot publish or consume remote visits, alerts, existence counts, consent evidence, scheduling conflicts or stale sync projections. Local demographics, doctor-slot and patient-slot checks remain available. Full is only eligibility for existing role/relationship/consent rules, never a consent grant.

Lifecycle writes acquire PostgreSQL transaction locks 160005 then 761910, before authority checks and clinic row locks. Clinical readers share the first lock; scheduling/sync use the second. No process-local cached grant is used. A request already in progress completes before a downgrade can commit; subsequent requests observe current authority across instances. Deadlock, timeout or serialization conflicts have a typed retry response and no partial commit.

`POST /clinics/:id/leave` requires `{confirm:true}`. It atomically sets left membership, Lite mode, actor/time and audit. Repeated leave is a no-op. A racing Full request either commits before leave or fails once left; it never rejoins. Local booking, own data and history remain. Full upgrades after departure fail. Rejoining requires a separate future policy, not this endpoint.

## Export and retained data

`POST /clinics/:id/export` with `{}` is a separate CSRF-protected action. See [export contract](clinic-export-contract.md) for ownership allowlists, bounds and manifest. It uses a repeatable-read snapshot, validates the versioned response and returns a private no-store UTF-8 attachment only after the request audit commits. Audit says requested, not saved by the browser. Empty data is explicit in manifest/dataset counts. Oversize and timeout failures deliver no partial download and never leave the network.

Export acquires session-level lifecycle locks in a short acquisition transaction, then starts the repeatable-read transaction. This deliberately establishes the snapshot after any preceding revocation or leave commits, rather than before a blocking lock SELECT. Locks are released on success and failure; uncertain connections are destroyed rather than returned to the pool.

No leave/export operation erases operational records, audit or consent history. All six source tables remain untouched. Existing calendar rows still require manual identity review; names alone never establish identity.

## Future consumers

The existing Dr. Nabil Journey task should use capabilities/allowedTransitions rather than infer ownership from role or doctor name. Use synthetic/data-selected clinics. Display Trial separately from active/left membership, explain retained local access and require explicit leave confirmation. Do not chain download success/failure to automatic departure. Do not cache private exports, remote clinical responses or lifecycle authority offline. Future remote-read consumers must join current effective source/requester modes and participate in the lock protocol.

All instants are UTC; display timezone is Asia/Hebron. Date-only values stay dates. Backend errors use `{code,messageKey,params}` and Arabic/English keys. Later screens must retain Arabic RTL/English LTR, logical CSS, light/dark and accessible confirmation. The legacy KPI aggregate remains a legacy mode projection, not lifecycle history; the journey should use the lifecycle DTO.
