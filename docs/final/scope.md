# Assumptions and MVP as delivered

This reconciles [the planning baseline](../assumptions.md) with available
handoffs. “Verified” below means the cited upstream verification, not a new
complete rehearsal or stakeholder acceptance.

## Assumptions

| ID | Current evidence and unresolved limitation |
|---|---|
| A1 | Source doctor/home-clinic consistency verified by Q01–Q12 and current `seed:verify`. |
| A2 | Local overlap and reconnect resolution have live/API evidence in the [audit](../testing/bug-bash.md). Disconnected cross-clinic detection cannot be immediate. |
| A3 | Configurable 30-minute default and 15-minute grid are implemented; [appointment contract](../appointments.md) distinguishes interval overlap from exact-start baseline pairs. |
| A4 | [Import UI](../frontend/import-duplicates.md) and backend support review/reimport. All 24 export rows require identity review. The upstream UI pass skipped rows deliberately; it did not prove 24 successful imported appointments. |
| A5 | Trusted-device and offline behavior have laboratory evidence. Real-site device availability and minutes-to-hours outage coverage at every site remain unconfirmed. |
| A6 | Consent/role restrictions have [privacy evidence](../privacy-tests.md). Lite cannot consume Clinical records even with consent. New patients do not share by default. |
| A7 | Guardian name/relationship capture is implemented. The governing legal threshold remains unconfirmed; an implemented age policy is not legal advice. |
| A8 | Password and trusted-device PIN authentication implemented; [security evidence](../security-auth-evidence.md). No patient login exists. |
| A9 | Owner confirmed the workbook synthetic. Development role fixtures exist; production accounts are not provisioned or required. Credential existence does not prove a successful current login. |
| A10 | Exclusions retained: full EMR, billing, prescriptions, patient app, real messaging, core AI and individual-doctor performance analytics. Simulated reminders remain deferred. |

## Stakeholders and success criteria

| Stakeholder | Demonstration value | Limit |
|---|---|---|
| Dr. Amal | `/admin/kpi`, `/admin/network-health`: aggregate outcomes and oversight | No patient-level clinical access or doctor rankings |
| Dr. Nabil | `/doctor/network-search`, `/work/adoption`: continuity, privacy and voluntary participation | Full membership and Clinical consent are separate requirements |
| Front-desk | `/desk/today`, `/desk/sync`, `/work/import`: safe bookings, identity review, offline continuity | No clinical-history access |
| Patients | Identity safety, guardian/withdrawable consent, continuity of care | Stakeholders, not a fourth role or patient-facing app |

- **S1:** zero cross-clinic incidents remains a target. Baseline is two exact-start
  unordered pairs; warnings and overrides do not prove prevented incidents.
- **S2:** under ten seconds has narrow upstream lab observations, not a newly
  timed Reem demonstration or a real-world guarantee.
- **S3:** zero losses is an observation only after reconciling accepted operation
  identities. Pending/conflicted/rejected is not synonymous with lost.
- **S4:** voluntary month-one adoption remains unverified. The month-one start
  event and stakeholder approval are unresolved; synthetic Full opt-in is not
  real adoption.

## Original Must / Should / Could inventory

| Priority / capability | Disposition | Route / evidence and limits |
|---|---|---|
| Must: three roles, password/PIN | Verified upstream | [Auth security](../auth-security.md); current browser readiness in rehearsal record |
| Must: day/week, phone/walk-in, edit/cancel/status | Verified upstream | `/desk/today`, `/desk/week`, `/desk/new-booking`; [booking coverage](../testing/booking-coverage.md) |
| Must: doctor and cross-clinic conflict handling | Verified upstream | [Appointments](../appointments.md); interval blocking versus privacy-safe patient warning/override |
| Must: network lookup | Partial acceptance | `/doctor/network-search`; implemented and tested, but current Reem Full-scene setup absent |
| Must: Basic/Clinical/withdrawal/history | Verified upstream | `/desk/consent`; [privacy tests](../privacy-tests.md) |
| Must: local-first queue and resolution | Verified upstream | `/desk/sync`; [offline live evidence](../testing/offline-live.md); exact current three-booking rehearsal unavailable |
| Must: import review | Partial browser coverage | `/work/import`; [import evidence](../frontend/import-duplicates.md), not a claim of 24 committed imports |
| Must: KPI charts | Verified upstream, telemetry partial | `/admin/kpi`; [dashboard](../frontend/kpi-dashboard.md), [definitions](../kpis.md); null metrics stay unavailable |
| Must: AR/EN, RTL/LTR, Light/Dark | Verified upstream with limitations | [Audit](../testing/bug-bash.md); no blanket WCAG certification or full new rehearsal coverage |
| Should: safe duplicate review/merge | Implemented; partial browser coverage | `/work/duplicates`; [merge handoff](../MERGE_PREVIEW_HANDOFF.md); two Samers must remain distinct |
| Should: access audit | Verified upstream | `/admin/audit`, doctor privacy; [audit handoff](../ADMIN_AUDIT_HANDOFF.md); role-scoped, not performance monitoring |
| Should: network health | Verified upstream | `/admin/network-health`; [health definitions](../network-health.md), not an exact all-device backlog |
| Should: printable day sheet | Verified upstream | `/desk/day-sheet`; [day sheet](../frontend/day-sheet.md) |
| Should: source-grounded alerts | Verified upstream | Doctor-authorized timeline; [network search](../frontend/network-search.md); confirm with patient, no diagnosis |
| Should: add clinic/doctors | Verified upstream | `/admin/clinics-doctors`; [admin screens](../frontend/admin-screens.md) |
| Could: simulated reminders / waitlist | Deferred | Proposed work, not delivered or demonstrated |
| Could: keyboard shortcuts / kiosk | Unavailable acceptance evidence | Keyboard accessibility is not a kiosk or shortcut feature claim |
| Could: Arabic-aware search | Verified upstream | [Patient service](../patients.md); identity still requires more than name |
| Could: patient-summary PDF | Unavailable acceptance evidence | Day-sheet printing and clinic JSON export are not this feature |
| Could: role onboarding | Implemented | [Shell](../frontend/app-shell.md); not stakeholder onboarding evidence |
| Could: simulated outage controls | Implemented, restricted | `/admin/developer`; [developer tools](../testing/developer-tools.md); no public fault controls required |
| Voluntary Trial/Lite/Full, export/exit | Partial scenario readiness | `/work/adoption`; [journey](../frontend/adoption-journey.md); results mappings unconfigured, real adoption unverified |

The quality audit reports no remaining confirmed critical defects after targeted
retests, but records performance-budget misses and limited assistive-technology
coverage. It is not production-performance approval. Older scaffold/future-work
statements in foundational documents are historical, not the present inventory.
