# Amal Network — owner self-test guide

**Purpose:** a practical acceptance checklist, not a report of completed tests. Every result below is an **expected result to check**, not a claim that it passed. Use only the private testing workspace; do not publish it.

**Printable copy:** open `SELF_TEST_GUIDE.html` in a browser and use its **Print / Save PDF** button or the browser Print command. The HTML works on its own, without an internet connection. Printing this guide is separate from printing the app's day sheet.

## 1. Before touching any records

- Open the private app already provided to you and the **separate setup manifest**, `docs/SELF_TEST_DATA.json`, for prepared patient/appointment IDs, dates and clinic assignments. Start with the account table below; these accounts and practice records already exist. This guide contains no passwords, PIN values or device credentials. Do not guess a patient identity.
- The app contains **existing owner-controlled operational data plus additive synthetic practice records**. It is **not assumed disposable or safe to reset**. Keep existing records intact and confine changes to your selected practice records. Use realistic names without “demo” or “test” in patient names; never contact a real patient.
- Reception at all three locations, a network administrator, three clinic administrators, five doctors, future booked appointments, ten waitlist entries, consent/history examples and an exact duplicate pair are already prepared. Do not recreate them. The original import export has **24 rows**; use its actual identity facts, not guesses.
- Only special cases not explicitly supplied still need preparation: a minor/guardian example, two genuinely different same-name people, merge blockers, a Reem lookup case, and a safely linked cross-location patient. Create appropriate synthetic cases through the existing UI where supported; where authorization cannot be established through UI, record Blocked and obtain owner/developer assistance. Do not manufacture access with guessed IDs.
- Use **two separate browser profiles**, or two different browsers, for simultaneous people. Two ordinary tabs share sign-in cookies: signing in or out in one can change the other. Use a third profile if a doctor and two reception users must work simultaneously. Private windows may share one private cookie jar and can discard offline storage; do not use them for persistence tests.
- Name your profiles in your notes (A: first reception location; B: second reception location/doctor; C: administrator when needed). Device enrollment belongs to the exact profile on the actual reception computer.
- Keep all dates/times in **Asia/Hebron (Palestine time)**. Do not substitute the computer's timezone. Calendar weeks start Saturday; KPI reporting weeks start Monday.
- Do not clear cookies/site storage, uninstall the app, reset data, merge patients or leave the network during the first session. They can destroy evidence or device trust. Do not run scripts, migrations or database commands.
- Some older project notes describe features as future work. This checklist follows current route/component source, including reminders and waitlist. A missing/disabled feature is **Blocked**, not a pass.

### Your paper record

For each check mark **Pass / Fail / Blocked / Not run** and record: check ID, role/profile, clinic, date/time, patient or appointment ID, steps taken, expected result, actual result, screenshot filename and follow-up owner. Use only synthetic details in screenshots. Never capture passwords, PIN entry, account setup secrets, cookies or downloaded private contents.

**Stop immediately** for wrong-person data, another role's clinical notes, a booking silently disappearing, a duplicate accepted after a retry, or an unsafe merge. Preserve the profile and report it; do not “fix” evidence with a reset.

### Prepared practice data and account identifiers

The manifest was prepared for **21 October 2026, Asia/Hebron**, with **12 practice accounts** below. Use the **password you already saved** for administrator/doctor accounts, and your **saved four-digit reception PIN** for reception accounts. The three `manager.*` clinic-administrator accounts use your **same saved administrator password**. Actual sign-in fields are simply **Email**, **Password** or **Four-digit PIN**; there is no “demo login” field.

| Account email | Role / person | Assigned clinic and initial network mode |
|---|---|---|
| `admin@amal.example` | Administrator | Network-wide; no assigned home clinic |
| `manager.1@amal.example` | Retired — sign-in disabled; audit history retained | 1 — Amal Family Clinic - Downtown — Full |
| `manager.2@amal.example` | Retired — sign-in disabled; audit history retained | 2 — Amal Family Clinic - Al-Bireh — Lite |
| `manager.3@amal.example` | Retired — sign-in disabled; audit history retained | 3 — Amal Family Clinic - Nablus Road — Full |
| `doctor.1@amal.example` | Dr. Amal Khoury | 1 — Amal Family Clinic - Downtown — Full |
| `doctor.2@amal.example` | Dr. Nabil Sabbah | 2 — Amal Family Clinic - Al-Bireh — Lite |
| `doctor.3@amal.example` | Dr. Yasmin Odeh | 3 — Amal Family Clinic - Nablus Road — Full |
| `doctor.4@amal.example` | Dr. Hassan Tamimi | 1 — Amal Family Clinic - Downtown — Full |
| `doctor.5@amal.example` | Dr. Rula Masri | 3 — Amal Family Clinic - Nablus Road — Full |
| `reception.1@amal.example` | Reception, Downtown | 1 — Amal Family Clinic - Downtown — Full |
| `reception.2@amal.example` | Reception, Al-Bireh | 2 — Amal Family Clinic - Al-Bireh — Lite |
| `reception.3@amal.example` | Reception, Nablus Road | 3 — Amal Family Clinic - Nablus Road — Full |

- Additive setup supplied **32 new synthetic patients** (30 roster entries plus duplicate IDs **145 and 146**, both **إياد نصار**), **220 appointments**, **10 waiting-list entries**, **10 visits** (two per doctor), and **10 Basic/Clinical consent records**. These are setup counts, not feature-test outcomes; original seed counts remain unchanged.
- Prepared appointments run **18–28 October 2026**: three days before the setup date, the setup date, and seven future days. **21 October entries include Completed/No-show**, so use a future **Booked** appointment for rescheduling/cancellation. For example, Downtown/Dr. Amal has **ليان منصور**, patient **115**, booked **22 October at 08:30** (appointment **127**); verify its current state in the manifest/app before editing. It may have changed during an earlier check.
- For orientation: Downtown/Dr. Amal patient **ليان منصور (115)**; Al-Bireh/Dr. Nabil patient **نور إبراهيم (121)**; Nablus Road/Dr. Yasmin patient **رنا قاسم (127)**; Downtown/Dr. Hassan patient **سلمى رشيد (133)**; Nablus Road/Dr. Rula patient **جنى بشير (139)**. Search the Arabic name as written or use the manifest's phone. Patient IDs and appointment IDs are different kinds of record even when numbers coincide.
- Lite/Full memberships were **not changed** by setup. Nabil starts Lite; the adoption scenario designates **clinic 2 as Trial** and **clinics 1 and 3 as results clinics** without changing network membership modes. **Dr. Amal (doctor 1), Dr. Nabil (doctor 2), and Dr. Yasmin (doctor 3)** have explicit clinic-manager grants; Dr. Hassan and Dr. Rula do not. Clinic-administrator `manager.*` accounts are for clinic administration/reminders, not a substitute for these physician adoption grants. Do not opt Nabil into Full just to make an early clinical lookup work.
- The exact duplicate pair is a comparison candidate, not proof that every safety check allows a merge. Blocker examples, a guardian/minor example, cross-location independently authorized patient linkage, and Reem's lookup scene may still need explicit setup confirmation. Never manufacture access by booking a guessed remote patient ID.
- Simulated reminders are **enabled for all three practice clinics**. Pending/cancelled notification entries were created through the actual lifecycle, and source-grounded alerts extracted from the ten added visits. Setup does not fabricate delivered reminders, sync conflicts or health telemetry: those outcomes must arise through real simulator/actions. The network-wide administrator's **Messages log** shows aggregate clinic counts and the next scheduled time, not message bodies or patient details. This overview covers all authorized clinics rather than the shell's selected clinic. The three extra manager accounts are retired. Use the explicitly delegated home-clinic doctor (Dr. Amal, Dr. Nabil or Dr. Yasmin) for clinic reminder controls; the clinic selector and network-coordinator capability do not expand that scope.
- Use these dates for the prepared session. If testing later, select the prepared date for read checks and ask the setup owner for approved future slots for write checks; do not change the computer clock.

## 2. First session — do these in order

Allow an unhurried session; this is an order of work, not a time guarantee. Stop at a blocker and ask for setup help rather than inventing data.

1. **Open the private address online.** At `/login`, use **Email and password** for the administrator. Confirm the account and role under **Account and display**. Set English for this first run.
2. **Prepare reception profile A.** On that profile, as administrator, open **Users & devices → Devices → Enroll this browser**. Select the manifest clinic and enter an allowed **Device label**, such as `reception-desk`. Complete enrollment, then **Sign out**. This signs out the administrator without removing the trusted-device cookie.
3. **Reception sign-in.** Select **Reception PIN**. Check **Trusted device for** shows the correct clinic, enter the assigned **Email** and **Four-digit PIN**, then **Sign in**. No clinic chooser should let you impersonate another clinic. Repeat enrollment/sign-in separately for profile B if it will act as reception.
4. **Orient yourself.** Open **Help → Replay the guided tour**; try **Next**, **Back**, **Skip tour**, then replay and **Finish**. Open **Your data**. There is **no patient login or patient portal**. The public information page is not a patient account.
5. **Check the schedule.** In **Today**, choose **22 October 2026** using **Choose a date** for future booked examples, inspect **Doctor / All doctors**, then switch **Day / Week** and back. Also inspect **21 October** for the prepared Completed/No-show examples. Confirm the expected clinic and times; an empty current day is not proof setup failed on a different date.
6. **Find a patient.** In Downtown reception, open **Patient lookup**, search **ليان منصور**, and select **patient 115** after matching the manifest's date of birth and phone. Use **Phone booking**, or **New booking** from the calendar. Choose **Dr. Amal Khoury**, **22 October 2026**, and an available time after the prepared morning appointments (try **11:30**, but proceed only if availability/policy allows it). Complete **Patient → Doctor and time → Review and confirm**. Read the source and time before the final action.
7. **Save and verify one booking.** If the final action is **Save locally · wait for sync**, it is provisional: open **Sync & conflicts**, wait for **Confirmed by server**, then revisit/reload the calendar. If **Confirm booking** appears, still verify the saved appointment after reload. Record its ID. A toast alone is not proof.
8. **Edit without making a second booking.** Click that appointment card. The initial dialog is titled **Cancel this appointment?**; choose **Edit or reschedule**, not cancellation. Change the time and select **Save changes**. Verify the same appointment ID moved; the old slot is free and patient/doctor/clinic/source stayed fixed.
9. **Check cancellation Undo safely.** Click the card → **Cancel appointment**, then **Undo** within the visible 10-second countdown. Confirm the booking remains after reload. Do not reload during the countdown for this check.
10. **Cross-location scene.** Keep profile A at one clinic and B at the other. Try a manifest patient/time that conflicts across locations. Open **Review conflicts**. Capture the privacy-safe blocking conflict, choose a safe time and verify the intended booking without an accidental second one. Patient overlaps cannot be overridden; same-day nonoverlap is informational.
11. **Doctor scene.** In a separate profile sign in as the assigned doctor. Open **Network search**, enter the authorized synthetic patient name, select **Search**, then open the correct record. Time the lookup as in N4; inspect the consent-limited card, not just a name match.
12. **Paper and evidence.** As reception, open **Print day sheet** for the same date. Review coverage and provisional labels, then **Print day sheet** and cancel the print dialog or save a synthetic-only PDF. As administrator, save the current **KPI dashboard** window/calculation information. Do not claim improvement yet.

Finish the first session by recording blockers and confirmed appointment IDs. Continue with the comprehensive checks below before doing destructive end-of-session checks.

## 3. Where each role can go

On desktop use the side navigation. On a phone, use bottom navigation and **More** for the remaining destinations. Use the **Clinic** selector only if the account has multiple authorized clinics; a single-clinic account shows its clinic as text. The address paths below can also identify a page when translating labels.

| Role | Exact English destination → address |
|---|---|
| Reception | **Today** → `/desk/today`; **Week** → `/desk/week`; **New booking** → `/desk/new-booking`; **Patient lookup** → `/desk/patients` |
| Reception | **Sync & conflicts** → `/desk/sync`; **Waitlist** → `/desk/waitlist`; **Print day sheet** → `/desk/day-sheet` |
| Reception, selected patient only | **Sharing consent** from Patient lookup → `/desk/consent`. A typed address alone must not select a patient. |
| Doctor | **My day** → `/doctor/my-day`; **Network search** → `/doctor/network-search`; **Patient card** → `/doctor/patient-card`; **Privacy settings** → `/doctor/privacy` |
| Reception and doctor | **Import wizard** → `/work/import`; **Duplicate patients** → `/work/duplicates`; **Network choice** → `/work/adoption` |
| Reception and administrator | **Messages log** → `/messages` (assigned-clinic detail; network administrator without a home clinic gets a read-only aggregate overview) |
| Administrator | **KPI dashboard** → `/admin/kpi`; **Network health** → `/admin/network-health`; **Users & devices** → `/admin/users-devices`; **Clinics & doctors** → `/admin/clinics-doctors`; **Audit log** → `/admin/audit`; **Developer tools** → `/admin/developer` |
| Public information / visual reference | `/data` → **Your data, your decision**; `/ui-kit` → **UI kit**. The UI kit is a component showcase, not live patient or booking data. |

The top-bar general search is a shell placeholder, **not** patient/network search. Use **Patient lookup** or **Network search** inside its proper page.

## 4. Authentication, device trust and role boundaries

| ID | Action | Expected result / failure to watch for |
|---|---|---|
| A1 | Administrator and doctor: **Email and password → Sign in**; verify account identity, clinic and landing page. Use **Show password / Hide password** only without a screenshot. | Administrator lands on KPI dashboard; doctor on My day. Roles are assigned, never selected at sign-in. |
| A2 | On a fresh, unenrolled profile choose **Reception PIN**. | “This device is not registered for reception”; no reception access. **Check again** retries the device check, not enrollment. |
| A3 | Complete the enrollment flow in first-session steps 2–3. Compare clinic and device in administrator **Devices** list. | A device credential is installed only in this browser profile; no copyable credential is shown. Reception must belong to the trusted device's clinic. |
| A4 | With permission, try one wrong PIN, invalid PIN length and a wrong-clinic reception account; then the correct assigned account. Try Arabic and Latin digits where available. | Clear validation/denial; leading zeros preserved. Do not repeatedly guess: repeated failures can lock the account and trigger throttling. Do not lock working accounts deliberately. |
| A5 | Reception attempts **Email and password**; doctor/reception types an administrator-only route; administrator types a doctor patient-card or reception patient route. | Unauthorized role/action denied without revealing earlier private content. Administrator status grants no clinical bypass. |
| A6 | Sign out online, press browser Back; repeat on a profile with authorized offline work using the explicit retention choice. | Private pages clear/lock. **Sign out and retain unsent changes** retains unsent work for the original account/clinic; it does not make it available to the next person. |
| A7 | Ask the setup owner for an expired-session scenario. Attempt a protected action. | Sign-in/locked state, no false success. New sign-in needs connectivity. Reception has an absolute session limit; doctor/admin idle sessions expire. Do not change system clocks to simulate this. |
| A8 | For consent/history/import/merge/export, follow any **Confirm with your PIN** prompt. Cancel once, then confirm correctly. | Cancelling does not apply the sensitive action. PIN is never printed, prefilled or exposed. Security freshness prompts may appear again. |

Device revocation, account deactivation and PIN-reset checks are at the end because they interrupt sessions.

## 5. Calendars, booking, rescheduling and cancellation

| ID | Action | Expected result / failure to watch for |
|---|---|---|
| C1 | Today/Week: **Previous day / Next day**, **Previous week / Next week**, **Today**, **Choose a date**, **Doctor / All doctors**, **Day / Week**. Open a day from Week. | Correct Palestine dates; date/doctor context carries between views. Status badges distinguish Booked, Conflict, Completed, No-show, Cancelled and waiting sync. Unknown is not silently Booked. |
| C2 | **New booking**; search with fewer than two characters, a missing name, Arabic spelling variants and same-name records. Select one, **Continue**, choose **Doctor**, **Date (Asia/Hebron)**, **Start time**, **Duration**. | No invented identity; phone/DOB distinguish people. Check clinic and source in review. Cancel/close before final save: no appointment created; any hold is released. |
| C3 | Request a doctor interval already occupied, including partial overlap, not only an identical start. In two profiles compete for the same free slot. | **The doctor already has an appointment at this time** / held-slot conflict blocks the relevant live save. Blocking conflicts cannot be overridden. A server hold is temporary, not a booking; expiry needs **Check and hold again** when offered. Local proposals can both wait, but server revalidation must not accept incompatible doctor bookings. |
| C4 | At another location request the same patient's overlapping appointment, then a nonoverlapping appointment on the same day. Open **Review conflicts**. | Patient overlap always blocks, for the same patient ID or different IDs with all three exact normalized name, phone and date of birth values matching. No acknowledgement or reason permits it. Details of matched patients remain redacted. Same-day other-clinic nonoverlap is informational and needs no reason. Prefer a safe time. Offline cross-clinic detection waits for sync. Historical warnings and approved overrides are not “prevented incidents.” |
| C5 | In **Booking conflicts**, inspect **Nearest free times from the server** and **Use [time]**. Try outside hours, invalid times/duration, crossing midnight, and a prepared clock-change date if supplied. | Suggested times recheck before save; no suggestions is explicit. The displayed policy may warn or block outside hours. Invalid/nonexistent times cannot silently shift. Booking repeated-clock time states the earlier occurrence; import rejects ambiguous times. |
| C6 | Complete review; double-click only once as an intentional retry check, not new bookings. Leave/reopen after a confirmed save. | Exactly one appointment for the accepted operation. Local action explicitly says **Save locally · wait for sync**; do not mistake a local proposal for a live reservation. If outcome is uncertain, retain the page and use its same-request retry, not a fresh booking. |
| C7 | **Walk-in** in the top bar; from Patient lookup choose **Walk-in for this patient**. Inspect **Nearest free time by doctor**, select **Book [doctor] at [time]**, or **Choose another doctor or time**. | Correct selected patient/clinic; walk-in source; nearest times are rechecked. It uses the same safety/conflict rules, not a bypass. No doctor/free time shows an honest empty state. |
| C8 | Start a **New patient** form, then **Walk-in (keeps this form)** where offered. Return via **Resume registration**. | Unsaved registration preserved, not silently saved. **Discard** intentionally discards the draft. Registration and appointment creation remain separate. |
| C9 | Click a confirmed booked card → **Edit or reschedule**. Change date/time/duration → **Save changes**. Try a conflicting destination. | Same appointment ID rescheduled, no duplicate; patient, doctor, clinic and source fixed. Only booked appointments can reschedule; other statuses/unsupported sources may be refused. Original remains unchanged on rejection. No offline reschedule save is promised. |
| C10 | Open the same editor in two separately signed-in profiles; save in one, then try the stale editor. | Stale-version message; **Reload latest version** keeps the proposed time for review and recheck, never silently overwrites. If save is uncertain, **Retry same request** resolves it; do not make a second change. |
| C11 | Click card → **Keep appointment**; next **Cancel appointment → Undo** during 10 seconds; next cancel and allow countdown to finish. | First two keep the appointment. Final confirmed cancellation persists after refresh; record remains Cancelled, not erased. Undo is only before send. Reload/account exit discards an unsent cancellation; it cannot undo an already-sent request. |
| C12 | If cancellation fails, use **Retry cancellation**, or **Dismiss message** then independently inspect the refreshed appointment. | No unsupported success claim. Retry uses the same request; dismissal alone is not proof cancellation happened. Pending local cards cannot be treated as confirmed editable/cancellable server bookings. |

**Boundary:** status badges exist, but the current calendar UI does not offer a general “mark arrived/completed/no-show” editor or drag-to-reschedule. Check displayed statuses; do not invent these controls or claim a full clinical-record editor.

## 6. Patient registration, search and CRUD boundaries

| ID | Action | Expected result / failure to watch for |
|---|---|---|
| P1 | **Patient lookup → Find a patient**. Search exact/partial name, phone with spaces/leading zero, Arabic variants; **Load more patients**, **Clear selection**. | Only authorized demographics. Same-name people/shared family phones remain separate. Selected record shows ID, phone, DOB and completed-birthday age; no clinical notes/history at reception. |
| P2 | **New patient → Register new patient**. Try blank name/phone/DOB, malformed phone, impossible/future DOB; then use manifest facts and **Save patient**. | Inline validation, no estimated DOB. Original phone formatting/leading zeros preserved. Successful registration selects patient and explicitly does not book an appointment. |
| P3 | Register an under-18 synthetic patient; omit guardian once, then provide **Guardian name / Relationship to patient**. Change draft DOB to adult. | Guardian required for minor; stale adult guardian fields cleared. Registration does not create sharing consent. Age follows birthdays in Asia/Hebron, not a rough year subtraction. |
| P4 | If registration response is uncertain, **Retry same request** or **Restore the details that were sent**. If details were changed, search first. | No duplicate created by identical retry. Do not submit a new registration to resolve an unanswered one. Offline registration is not a queued booking. |
| P5 | Selected patient → **Upcoming appointments → Open in calendar**, **Show later appointments**; **Phone booking**, **Sharing consent**. | Upcoming appointments limited to this clinic; navigation preserves intended patient/date. This is not reception access to visit history. |
| P6 | Look for demographic edit/delete controls. | **No patient edit/delete buttons are delivered in Patient lookup.** Create/read are owner UI checks. Backend PATCH/DELETE exist but need the setup owner/developer's authorized API test; mark UI edit/delete Not available, not failed or passed. |

For a separately supervised API check, expected boundaries are: only authorized local demographics may update; no administrator patient access; no scope/consent/guardian editing through demographic PATCH; no deleting seed-backed or referenced patients. Appointments, visits, consent, audit, import/merge references, holds and notifications can block deletion with **This patient has protected records and cannot be deleted.** Only an approved unreferenced synthetic record can be considered for deletion. Do not remove references to force a deletion.

## 7. Consent, who viewed, doctor lookup and privacy

| ID | Action | Expected result / failure to watch for |
|---|---|---|
| N1 | Reception selects patient → **Sharing consent**. Read **Sharing now**, then **Record a decision**: **Sharing level**, **How was it given?**, **Record decision** and PIN confirmation. Exercise None, Basic, Clinical using only authorized synthetic decisions. | None shares nothing; Basic shares visit date/clinic/doctor, not notes/flags; Clinical can add notes and source-grounded alerts. Minor decisions, including None, require guardian details. Missing/unverified DOB permits only None. Evidence and history remain visible. |
| N2 | Doctor at an authorized Full clinic searches the prepared adult at each consent level. On **Patient card** inspect **Visit timeline**, notes and flags. Try the Lite doctor too. | Full plus consent plus role/access are all required. Trial/Lite neither publishes nor consumes remote records even with Clinical consent. Reception/admin cannot see clinical history. Own-clinic care records are not erased by network restrictions. |
| N3 | **Network search → Search the network by patient name → Search**. Check too-short/no match, **Show more matches**, Arabic variants and two same-name people. Use arrow keys and Enter to open a match. | Results are **Name match, not verified**. Confirm identity before acting. No-match means no records shared with this viewer, not “patient does not exist.” Error clears previous results rather than pretending success. |
| N4 | Time three fresh foreground searches for the manifest's Reem record. Start stopwatch on first query-changing keystroke; stop when a matching result card is visibly painted. Separately record time to open/review the correct patient card. | Write actual seconds and conditions for each run. **Under 10 seconds is a target, not a guaranteed result.** Do not combine the two timing boundaries. KPI lookup telemetry measures foreground completed result-card display, not a doctor's clinical decision speed; failed/hidden/abandoned attempts are excluded. |
| N5 | Clinical card: examine medication/allergy/condition flags, **Original note excerpt**, source clinic/date. | Flags trace to shared notes and say they are not verified diagnoses/treatment advice. No flags does not mean no risks. Basic consent exposes no notes/flags. This is continuity lookup, not prescriptions or a full EMR. |
| N6 | Reception: **Withdraw consent → Yes, withdraw**; cancel once with **Keep sharing** first. Have doctor re-request/reopen the record. Also test an open card while consent is downgraded. | Withdrawal stops future remote disclosure, preserves own-clinic records/history, and does not reactivate old grants. Previously shown remote details clear when access changes; a stale card must not keep working after recheck. Offline consent changes are never queued. |
| N7 | **Who viewed my record**: tick **The patient (or guardian) is here and asked to see this. → Show views**, confirm PIN, then **Show older views / Hide views**. | Lists successful cross-clinic views since auditing began, newest first. No PIN/consent means no unauthorized history. Local views and empty searches are not in this list. An empty list is not a complete lifetime-access guarantee. |
| N8 | Doctor **My day → Open card**; inspect **Privacy settings → Who viewed my patients**. | Only this doctor's own appointments in this clinic today. Privacy is read-only; Full/Lite/effective sharing shown honestly. Recorded views are scoped/capped, not a complete access history or doctor-performance ranking. |
| N9 | Type `/doctor/patient-card` without selection, or `/desk/consent` without a reception-selected patient; change clinic/account or expire session. | Selection guard or denial; old patient's details do not bleed across role, clinic, account or session. |

If a consent change is unconfirmed, use **Check again with the same change**. Shared views should clear while the outcome is uncertain. Do not record a different decision merely to make an error disappear.

## 8. Import wizard — every one of the 24 rows

Reception or an authorized doctor opens **Import wizard**. Administrator status does not grant patient-import access. Use an owner-approved batch; import commits affect operational appointments.

1. **Source:** choose the original supplied workbook with the file picker. The built-in export shortcut has been removed. Supported uploads are **JSON, CSV, XLSX, XLS and ICS**, up to **2 MiB**, with **1–100 appointment rows** and a normalized payload of at most **128 KiB**. The six-sheet workbook selects its `calendar_app_export` sheet; if several eligible sheets require a choice, select one explicitly. Check the filename, worksheet and **24 parsed rows**, then **Stage uploaded file**. Record the batch number and version. Staging is not importing. Tabular files require `event_id`, `doctor_email`, `patient_name_typed`, `start_time`, `end_time`, `event_status` or the supported header aliases. ICS requires a stable UID, doctor organizer, patient summary, explicit timed start/end and supported status; all-day and recurring events are rejected rather than guessed. Source files are read locally; only the selected normalized appointment rows are submitted. Use only approved synthetic files.
2. **Doctor mapping:** review every source email → **Operational doctor**. A server match is a suggestion to confirm. Changing a mapping must make affected prior decisions need re-review.
3. **Patient review:** set **Show → All rows**. Open **Review** for **all 24 rows individually**, including exact-name suggestions. For an existing patient choose **Confirm an existing patient → Verify identity using → Phone number / Date of birth** and enter the separately supplied patient's stated fact, not a copied screen value. For a new patient choose **Create a new patient** with real synthetic identity facts and guardian details when required. Otherwise **Skip this row** with **Reason for skipping**. Select **Save decision**.
4. **Status mapping:** fixed backend mappings are displayed; unsupported statuses require a reasoned skip. Do not invent editable mappings or force unsupported rows through.
5. **Conflicts:** inspect **Within this export**, **With existing appointments**, **Clinic policy**, **Coincidences (information)**. Use **Resolve row [ID]**, corrected times via **Reschedule this row**, or skip. A same-doctor/start coincidence is not proof of patient identity. Doctor and patient overlaps block and cannot be overridden; same-day other-clinic nonoverlap is informational and needs no reason. **Recheck conflicts**.
6. **Commit & report:** reconcile **Source rows / Included / Reviewed / Skipped / Blocked / open**. All 24 must have a manual decision; no unresolved blocker. **24 reviewed does not mean 24 appointments created.** If acceptable, choose **Commit import**, read the irreversible confirmation, confirm PIN if requested, then **Download report** in each **Report language**. Check every per-row outcome against calendar/linked appointment IDs.

| ID | Additional check | Expected result |
|---|---|---|
| I1 | Leave/reopen with **Batch number → Open batch** or **Continue batch #[ID]**. | Saved review decisions retained. Early **Next** blocked while decisions remain. |
| I2 | Wrong identity fact, unknown DOB for new record, invalid local time, unsupported file/status or doctor outside scope. | Clear error/skip requirement; no guessed identity, hidden auto-link or partial commit. |
| I3 | Reopen a reviewed row; change doctor or relevant patient details in a prepared concurrent scenario. | Re-review/stale/version warning. No commit using stale identity verification. |
| I4 | Associate only an exactly matching existing appointment using **Associate with existing appointment**. Try a supplied mismatch. | Matching identity, doctor, time and status required; mismatch refused. A proposed new patient cannot attach to an existing appointment. |
| I5 | Commit with a blocker; then commit an approved resolved batch. | First writes nothing. Successful included rows commit atomically; report distinguishes Created, Linked, Skipped, Already imported. |
| I6 | If connection drops, preserve page and **Retry same commit**. Reimport identical source with all required review. | Same-request retry/replay does not duplicate appointments. Changed source event is rejected for review, not overwritten. If pending commit cannot persist, keep the page open until resolved. |

Record a 24-line paper ledger: row/event ID, source name, chosen patient ID or skip reason, verification method, doctor, status, time correction, final outcome/appointment ID. Never enter the verification facts into a public issue report.

## 9. Duplicate patients — comparison first, merge only near the end

- **D1:** Open **Duplicate patients → Eligible candidates → Compare**. Candidate eligibility requires matching normalized name, DOB and canonical phone; it does not itself authorize merging.
- **D2:** **Compare any two patients**, choose the two distinct Samer records from the manifest. Expect **Not a match** and visible DOB/phone differences. Keep both. Shared name or family phone alone must never enable merge.
- **D3:** For a safe candidate choose **Record to keep (survivor)**, then **Check merge impact**. Check visible appointment counts, source/survivor IDs and server blockers. Clinical references are withheld from this preview; visible counts are not global totals.
- **D4:** Ask setup to supply blocker cases: differing identity/guardian information or visibility rights; consent evidence; active holds; overlapping patient appointments; import references; already-merged/alias chains; unknown references. Expect **The server blocks this merge** or a specific safety error, not a bypass. Missing prepared cases are Blocked, not passed.
- **D5:** If another person changes a candidate after preview, expect a refreshed/stale preview and explicit re-review. If records become inaccessible, clear selection without partial details.

Do not click **Review and confirm → Merge records** yet. The final safe-pair commit is in section 16. There is no owner UI “unmerge.”

## 10. Offline bookings, persistence and security

Prepare online first on a normal persistent browser profile: sign in, load the target date, patient roster and doctor records; note cache coverage/freshness. Ask the setup owner to assist with real offline mode if unfamiliar. Switching the computer/browser offline is different from an administrator's simulated clinic API outage.

| ID | Action | Expected result / failure to watch for |
|---|---|---|
| O1 | With a verified session and cached range, disconnect only profile/device A from the network. Inspect connection notice and cached calendar. | Explicit offline/cached notice, not a claim the server is available. Local booking limited to authorized cached coverage; unavailable storage/data disables unsafe saves. |
| O2 | Create **three distinct** future bookings in cached coverage using **Save locally · wait for sync**. Write patient, doctor, time and local/sequence IDs from Queue where available. | Three local proposals, visible waiting/provisional state. No server hold claimed; remote patient conflicts cannot be checked instantly. Registration, consent, edits, admin and waitlist decisions are not promised offline queues. |
| O3 | Navigate away and back; reload while still offline only after local saves have completed. | Queue identities and three proposals survive where offline shell is supported. A locked session is a security result, not permission to bypass login. No second submissions to “recover” invisible work. |
| O4 | In separate connected profile B, book the same doctor/time as one offline proposal. Reconnect A and observe **Sync & conflicts**; no manual resubmission. | Automatic sync/revalidation; nonconflicting proposals acknowledged, competitor creates an explicit conflict. In this prepared scenario expect two confirmed plus one conflict before resolution, not three silently accepted conflicting bookings. |
| O5 | Open **Needs a decision**. Compare **Your offline proposal**, **Current server appointment**, hidden/visible conflict details; **Refresh conflicts**. | Original proposal retained, restricted remote details redacted. Unreceived, waiting, rejected and conflicted are distinct from lost. |
| O6 | **Move this appointment → Choose a new time → Confirm**. On another approved visible case examine **Keep this one and move the other**; never move a hidden/unverified appointment. | Suggested destination rechecked; version conflicts stay open for review. Moving the other requires visible/current authorized record and safe destination, not a privacy bypass. |
| O7 | **Call patient → Confirm**, then **Hide number**. If decision response is uncertain, **Retry saved decision**. | Phone only on this screen; “Follow-up recorded. Call not yet confirmed.” No actual phone call is made/verified. Exact saved decision retries without duplication. |
| O8 | Reconcile after resolution, then reload both profiles. | Every original operation accounted for exactly once in confirmed server appointments, explicit conflict/rejection or retained queue. In the prepared three-plus-competitor scenario: three resolved proposals plus unchanged competitor, no extras. Write a per-operation reconciliation; queue count alone cannot prove zero loss. |
| O9 | With one approved unsent proposal, sign out using **Sign out and retain unsent changes**; sign in as another role/account on that profile, then original account/clinic online. | Other account sees no retained private work. Original can resume/reconcile it. Do not clear site data. Cleanup errors lock private pages; close other Amal tabs and **Retry device data removal** rather than sharing the browser. |

**PWA check:** install only if the existing browser offers **Install App** or Safari **Share → Add to Home Screen**. First load online and let preparation finish. Offline shell/reload is production-build/browser-dependent; the development server does not install a service worker. If the shell cannot reload offline, record the build/browser limitation separately from queue persistence. First-ever offline sign-in is not supported. Public-shell caching is not offline authentication, a backup, or permission to cache clinical APIs. The private authorized local store is separate.

On an update notice, save/reconcile work, close **all** Amal tabs/standalone windows and reopen. **Retry offline setup / Dismiss notice** must not force an unsafe reload. Browser storage eviction/clearing can lose local data; do not test it on the only copy of unsent work.

## 11. Printable day sheet

1. Reception → **Print day sheet**. Select **Day**, **Doctor / All doctors**; use **Reload from device** after schedule changes.
2. Check clinic, selected date, generated/refreshed times, Time/Doctor/Patient/Status/Local state, summary totals, and **Provisional: not yet confirmed / Needs attention** labels. It reads this device's saved schedule, not a guaranteed fresh server list.
3. Test complete, partial and missing cached coverage. **Incomplete** or **Unavailable** must remain obvious; a missing-range empty list must not say the clinic has no appointments.
4. **Print day sheet** → browser preview. Inspect Arabic RTL and English LTR, light/dark, page breaks, long names and provisional footer. No side navigation/dialog overlays in the printed sheet; no clinical notes.
5. Sign out/expire session: sheet clears/locks and printing is unavailable until an authorized schedule loads. Securely collect printed pages/PDFs; do not leave them in a shared printer tray.

## 12. Reminders — simulator only

**No SMS, WhatsApp or other message is actually sent. “Sent (simulated)” records simulator behavior, not delivery to a person.** Do not enter real contact numbers or treat this as a messaging integration.

| ID | Action | Expected result |
|---|---|---|
| R1 | Reception opens **Messages log** and confirms the clinic is enabled. For toggle checks use its delegated doctor: **doctor.1@amal.example**, **doctor.2@amal.example**, or **doctor.3@amal.example** → **Clinic reminders**. Turn on only if off and approved. | Defaults remain off outside prepared clinics. Current-clinic delegation is required; other doctors and coordinator authority alone cannot manage reminders. Enabling affects future eligible new/moved bookings. A network administrator without a home clinic cannot choose arbitrary reminder logs. |
| R2 | Book a manifest future eligible visit; open Messages log → **Refresh**. Inspect Arabic/English content and due times. | Eligible reminders at 24 hours and 2 hours before, in Palestine time; too-late windows recorded/cancelled rather than pretending to send. Simulator processing may require setup-owner assistance/time; missing processor is a blocker. |
| R3 | **Status**, **Due from / Due until → Apply / Clear**, **Newer / Older**, **Refresh**; invalid reversed or over-92-day range. | Scoped results, honest empty/error state, validation. No doctor access to this route. |
| R4 | Reschedule/cancel an eligible appointment; select patient at reception and inspect **Appointment reminders → Record opt-out**, later **Resume reminders**. | Pending reminders cancel with reasons; moved visit gets eligible new schedule. Opt-out applies patient-wide independently of network consent; resuming affects future bookings, not old cancelled history. |
| R5 | Later, an explicitly delegated home-clinic doctor or an authorized home-clinic administrator chooses **Turn reminders off → Turn off**; first try **Keep on**. | Turning off cancels pending clinic reminders and keeps history; turning on again does not restore cancelled reminders. Do not disable the clinic before R2 evidence is saved. |

The phone preview is a separate, explicitly labelled visual simulation. Its
simulate-send action does not send to SMS/WhatsApp, contact a phone, change a
notification's stored status, or increase persisted delivery counts. Summary
cards describe the current results page, not totals for the whole clinic.

## 13. Cancellation waitlist

Reception only. Use authorized synthetic patient choices and future dates with matching doctor/day/time windows.

1. **Waitlist → Add to waitlist**, or booking **No fitting slot? Add to waitlist**. Choose existing **Patient**, **Doctor**, **Preferred days**, **From / To**, then **Add to waitlist**. Missing patient/doctor/day, bad times or reversed window must validate. Clinic comes from session.
2. Add two matching patients in a known order. Cancel an eligible confirmed appointment and let its Undo countdown finish. Inspect **Opened slots**, **Offers**, **Queue**, server clock, expiry and remaining time.
3. Expect the next matching patient in queue order. **An offer does not reserve the slot.** Notification can be simulated, suppressed, pending or cancelled; an opt-out/clinic-disabled warning must not claim a message was sent.
4. **Patient accepted: check slot** → review availability/conflicts → **Book this slot**. Patient overlaps cannot be overridden; same-day other-clinic nonoverlap is informational and needs no reason. Verify resulting appointment ID in calendar and fulfilled queue/slot.
5. Separate cases: **Patient declined** keeps their place for later cancellations; expiry advances handling without booking; no match leaves normal booking free; an externally taken slot becomes unavailable. Use profile B to take the offered slot before acceptance: no double booking may be confirmed.
6. Offers are fixed times, not editable appointments; use booking for another time. Offline adding/decisions disabled. For uncertainty **Retry the same request**; fields/decisions stay locked until resolved. Do not navigate away: unconfirmed waitlist retries are held on this screen only. Prefer **Keep open and retry** to **Close anyway, I will check the waitlist first**.

## 14. Administrator oversight and honest KPIs

### Directory, accounts, audit and health

| ID | Action | Expected result |
|---|---|---|
| M1 | **Clinics & doctors**: inspect clinic/doctor filters, pages, **Edit**. With approval **Add clinic → Details → Schedule & network → Review → Create clinic**. | Required name/city/schedule validation; closing after opening, no unsupported overnight hours. New clinic starts Trial with Lite permissions; admin cannot opt it into Full on its behalf. Created clinic appears in selectors/health. If outcome uncertain, inspect directory before retry: another Create can make another clinic. |
| M2 | **Add doctor record**, inspect **Doctor name / Specialty / Contact email**, then Edit a synthetic entry. | Directory record alone creates **no login**. An unsafe move of a linked doctor is refused. |
| M3 | **Users & devices → Users**: search/filter/page, **Add user**, role/clinic/**Linked doctor record**, **Language / Theme**, **Account active**. | Valid role assignment required; doctor needs suitable unique linked record. Reception requires PIN; doctor/admin password. Use separately supplied credentials privately; never save them in guide/evidence. |
| M4 | **Users & devices → Devices**: filter **All devices / Trusted only / Revoked only**, inspect label, clinic, registration. | Trust correctly scoped. **Enroll this browser** enrolls the browser you are using, not a remotely named computer. |
| M5 | **Audit log**: filter **Event / Outcome / Actor account ID / From date / To date (inclusive)**, **Apply filters / Clear**, page through newest first. | Corresponding sign-in/directory/account/device events, allowed/denied outcome, actor/clinic/target metadata. No PIN/password/clinical note payloads. This administrator audit is not the patient's “Who viewed” list. |
| M6 | **Network health → Refresh**, expand/inspect device details; observe clinic during an approved outage and recovery. | Heartbeat, last successful sync, Full/Lite mode, server conflicts, trusted/revoked devices, observed time. Your browser “Online” is not all clinics online. Unknown/incomplete pending-queue coverage is explicit, not a fabricated zero. Failed refresh labels stale observation. |

All administrator changes are online-only, never silently queued. Preserve primary administrator/device access; disruptive account checks are in section 16.

### KPI baseline versus after — record evidence, not a success story

1. Before controlled actions save **KPI dashboard → Range (Day / Week / Month)**, **Window containing**, **Refresh**, calculation time/version, Before/After window, scope and definitions. Repeat the **same selected operational window** after the controlled session, noting time and any unrelated activity.
2. Inspect **Double-booking collisions, before and after** with both collision types; **Conflicts actually prevented → Daily / Cumulative**; **Median patient lookup time** and clinic selector if shown; **Appointments lost while offline**; bookings by source before/after; no-show clinic bars/weekday strip; adoption and cross-clinic lookup activity.
3. Use **Show data table / Hide data table** for every applicable chart. Check values agree with summaries/graphs and Arabic direction labels. Missing dates/observations are gaps or unavailable, not invented zeroes.
4. Baseline is immutable workbook evidence, **not** the live operational roster and not a new test result. Reference `docs/data/baseline-summary.md`: 3 clinics, 5 doctors, 25 patients, 102 appointments, 32 history rows, 24 export rows; **6 same-doctor exact-start unordered pairs**, **2 same-patient exact-start cross-clinic pairs**, **14 multi-clinic patient-days**, and **22/102 no-shows (21.6%)** across the source span. Confirm displayed definitions/windows before comparing any figure.
5. Exact-start collision counts are **not interval overlaps**; all-status baseline counts are not just Booked. A pair touching two clinics appears under both, so clinic totals do not add to the network total. Unequal exposures invalidate a simple raw-total improvement claim.
6. Warnings, previews, approved overrides and a blocked local attempt are not automatically a server-recorded prevented commit. KPI changes need real recorded decisions. Some telemetry may remain **Unavailable / Not measured**; lookup samples only count received supported measurements. Do not substitute visit/result counts for logical lookups.
7. **Zero bookings lost** requires the O8 per-operation reconciliation. KPI received/synced/conflicted/rejected receipts are context, not proof of device losses. A missing loss metric is not zero. Nabil's synthetic Full click is not real month-one adoption.

Write a comparison ledger: metric/definition; baseline source/window/value; pre-session operational value/window; post-session value/window; sample count/coverage; exact controlled actions; interpretation/limitations. Leave values blank or Unavailable until observed.

## 15. Voluntary adoption and accessible everyday use

### Nabil's clinic: choice, not pressure

- Open **Network choice** as reception/doctor. Read **Where your clinic is now**, **What each choice means**, **No monitoring of individual doctors**, and **Results from participating clinics**.
- Trial/Lite must keep local booking/conflict prevention and exclude remote clinical sharing. There is no deadline, penalty or automatic upgrade; staying Lite indefinitely is valid. Security/access audit records still exist: “no doctor-performance analytics” does **not** mean “no logs.”
- A non-manager sees read-only explanation. For the prepared manager check use **doctor.2@amal.example (Dr. Nabil, clinic 2)**; Dr. Amal and Dr. Yasmin also have manager grants for their own clinics. Dr. Hassan and Dr. Rula are non-manager comparison accounts. Administrator cannot opt in on Nabil's behalf.
- Try **Not now, go back**. Expected: no state change. On an approved synthetic clinic, **Choose Full** is an explicit immediate action, not merely an informational link. Check updated status and consent-limited sharing; it never grants patient consent.
- After documenting Full, **Choose Lite** restores local-only sharing; recheck a previously visible remote card. Refresh must not silently re-upgrade. If action is uncertain, **Refresh status** or **Retry the same action**, not a different transition.
- Results are aggregate last-seven-complete-days service evidence with source, coverage and sample count. Unconfigured participating clinics or absent evidence must show unavailable, not invented zeros. Do not present this as Nabil's real consent or an adoption deadline met.
- Export/leave are in the final section. Leaving is not required to prove willingness or “pass” onboarding.

### Language, appearance, small screens and keyboard

Repeat core booking, lookup, consent, sync, print and admin-read scenes in **English LTR / Arabic RTL × Light / Dark**, including mobile-width screen (about 390 px) and desktop.

- **Account and display → Display settings**, language/theme controls, **Digits → Latin 123 / Arabic-Indic ١٢٣**. Check dates, phone numbers, long mixed Arabic/English names and numeric IDs are legible, not reversed or clipped. Account preferences must not leak to the next account.
- On phone, check bottom navigation/**More**, clinic identity, top-bar **Walk-in**, drawers/dialogs, errors and final save buttons. Scroll to controls; no overlapping sticky bars or hidden confirmations. Calendar/tables may scroll inside their own regions without losing labels.
- Keyboard: Tab/Shift+Tab through navigation, patient results, doctor/time fields, dialogs, confirmation and chart tables. Use Enter/Space to activate, arrows/Enter in supported search results, Escape/Close to leave a dialog without saving. Focus must remain visible and return to the trigger or logical appointment/page after closing/saving/Undo.
- Try zoom/enlarged text; check warning text is not color-only and dark mode preserves contrast. Record accessibility problems; this checklist is not a blanket certification.
- **Help** can replay the tour; dismissing it does not change data. **Your data** is public and explains consent/withdrawal and role limits; online patient withdrawal/download buttons are not patient self-service in this version.
- **UI kit**: inspect palette, typography, buttons, inputs, statuses, cards, toasts and empty/error examples with language/theme controls. They are visual samples only. Do not count their toasts/cards as bookings.
- Unknown page → **Page not found**; forbidden role → **Access not permitted**; use **Go to my landing screen**. Recoverable failures offer Retry rather than fabricated data.

## 16. End-only checks — irreversible or session-disrupting

**Do these only after saving all evidence and reconciling every device queue. Existing operational data is not disposable. Get explicit owner permission for each; prefer separately prepared practice records. Stop if scope is unclear.**

1. **Safe duplicate merge:** on the approved pair only, repeat fresh **Check merge impact**, choose survivor, **Review and confirm**, read **Confirm patient merge**, and **Merge records** with PIN if requested. Expect one survivor, source retained as merged tombstone, authorized references preserved and immutable audit history attached to original IDs. **Retry same merge** on uncertain response; never reverse source/target to “retry.” No UI unmerge.
2. **Account interruption:** on a spare synthetic user, **Edit → Save changes**, **Deactivate / Reactivate**, and reception **Reset PIN** using privately supplied values. Expect affected sessions to end immediately; deactivated login denied; records retained; fresh PIN works. Unsafe role/clinic/doctor assignments and last-active-admin removal must be refused. Do not use the owner's only administrator for these checks.
3. **Device revocation:** administrator **Devices → Revoke** on a spare enrolled browser. Expect reception session to end and PIN trust to stop immediately. This cannot be undone; explicitly enroll again on that browser if needed.
4. **Clinic export before leaving:** authorized clinic manager → **Network choice → Download JSON export**; fresh PIN if asked. Confirm browser Downloads contains a readable clinic-scoped file and appropriate role-limited content, without showing it publicly. This is clinic JSON export, **not** a patient-summary PDF. Download success means the browser received a file, not that a backup has been verified.
5. **Leave only on an approved disposable clinic:** read **Leave the network** carefully. **Leave network now is itself the confirmation**; there is no second confirmation dialog to rely on. Expect immediate Lite/local-only mode, remote views cleared, local bookings/data retained, export still available. Rejoining is **not offered here**. Check export again after leaving; do not leave the primary scenario clinic earlier.

### Developer tools — last of all; reset is not ordinary cleanup

Network-wide administrator → **Developer tools**. If tools are disabled or only clinic-scoped admin is available, record Blocked; do not enable/deploy them yourself.

- **Simulated clinic outage → Operational clinic → Simulate outage** affects that clinic's API, not browser internet or all clinics. Observe local continuity/queue notices in the reception profile; another clinic should remain usable. It is different from O1 genuine network-offline mode.
- **Restore clinic**, verify fresh server access and synchronization, and restore **every** simulated outage before ending. A restore toast does not prove the physical internet works.
- **Reset demo data → Reset all demo data** is a whole-workspace destructive operation, **not** a patient cleanup button. It permanently discards appointments, patients, consents, imports and administrator edits at **every clinic**, discards unsent offline changes on **every device**, and signs everyone out. This conflicts with preserving offline work; never use it to resolve a queue or hide a failure.
- Normally inspect the warning and **Cancel**, without resetting. **Do not assume this workspace is disposable.** Only if the owner separately decides to erase all existing operational data after evidence/retention needs are resolved: type the **exact confirmation phrase shown by the app** and choose **Reset everything**. Do not assume a translated or remembered phrase.
- If outcome unknown, keep the request context and use **Check again / Retry the same request**, not a new reset. Expect a confirmed reset to require fresh sign-in/device preparation and invalidate old-generation work rather than replay it. **Do not perform this check if any work must be retained.**

## 17. Evidence goals and failure checklist

The following are screenshot **scenario goals**, not screenshots proving the tests have run:

| Goal | Capture only after performing the check | What it does NOT prove |
|---|---|---|
| Cross-location conflict prevention | Two-profile clinic context; privacy-safe **Booking conflicts** severity/redaction; safe rescheduled alternative and authoritative saved booking/blocked outcome. | A warning alone is not zero incidents; allowed overrides are not prevention. |
| Doctor lookup under 10 seconds | Authorized Reem search result/card with measured run times and timing boundary in the paper record; no secrets. | A still image cannot prove elapsed time or guarantee every lookup meets target. |
| Zero bookings lost | Offline queue before reconnect, explicit conflict, resolved calendar IDs and the completed three-operation reconciliation plus unchanged competitor. | Empty queue, online badge or KPI target alone is not zero loss. |
| Nabil's voluntary opt-in | **Network choice** Lite option, no-deadline/no-ranking explanation, **Not now** unchanged state; explicit authorized synthetic Full choice if permitted. | Synthetic click is not real Nabil consent, coerced onboarding or month-one adoption evidence. |

**Before reporting a pass, ask:**

- Did the correct person/clinic/role remain selected after navigation, reload, language change and concurrent edits?
- Did a final server acknowledgement or authoritative reread confirm the save, not merely a local toast/hold?
- Did retries create exactly one operation outcome? Are stale edits, ambiguous saves and rejected operations explicit?
- Did every proposed booking survive as an accounted-for confirmed record or explicit retained conflict/rejection/queue item?
- Were cross-clinic details redacted and Basic/Lite/withdrawn consent enforced on subsequent requests?
- Were all 24 import rows manually reviewed and report totals reconciled, without mistaking skipped/linked rows for new appointments?
- Were distinct same-name patients kept apart and unsafe merges/deletions blocked?
- Were simulated messages clearly simulation-only, waitlist expiry/competition safe, and print coverage honest?
- Were missing telemetry, stale health observations and unavailable adoption evidence labelled rather than replaced by invented metrics?
- Were all simulated outages restored, all profiles/queues accounted for, downloads/printouts secured, and destructive checks left until last?

**Failure report template:** Check ID; timestamp (Asia/Hebron); browser/device/profile; role and clinic; synthetic record/operation IDs; exact navigation/actions; expected versus actual; persistence after refresh; screenshot reference; current queue state; whether work must be retained; safe next action. Do not attach credentials or private exports.

**Completion record:** First session: ____; comprehensive checks passed: ____; failed: ____; blocked/not run with reason: ____; unresolved operations: ____; evidence location: ____; owner follow-up: ____. No acceptance claim is made until the owner fills this in.

### Source basis and limits

Compiled from current `artifacts/amal-network/src/shell/routes.ts`, shell/login, calendar/booking/reception, consent/network/doctor, imports/duplicates, offline/sync/PWA, day-sheet, reminders/waitlist, administrator/KPI/adoption components and their English/Arabic strings. Boundary references: `docs/patients.md`, `docs/appointments.md`, `docs/pwa.md`, `docs/data/baseline-summary.md`, `docs/import-merge-api.md`, `docs/testing/offline-live.md`, `docs/testing/developer-tools.md`, `docs/clinic-export-contract.md`, and `docs/kpis.md`. Older feature handoffs may describe earlier limitations; actual controls and current server permission are authoritative. Missing sample data, account setup, optional developer tools, simulator timing or an installable build must be recorded as prerequisites/blockers, not silently replaced with invented successes.
