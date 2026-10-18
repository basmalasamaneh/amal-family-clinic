# AMAL NETWORK — MASTER PLAN FOR REPLIT AGENT

> Product: **Amal Network** (شبكة أمل), the shared booking + visit-summary platform for **Amal Family Clinic Group** (3 clinics).
> Team: 3 people (P1 Data & Backend, P2 Frontend & Design, P3 Offline, QA & Product).
> Languages: Arabic (default, RTL) + English. Themes: Light + Dark.

---

## 0. HOW TO USE THIS FILE (read first)

**Opening message to paste into Replit Agent (Plan mode):**

```
Read /docs/MASTER_PLAN.md fully. Do NOT write code yet.
Stay in Plan mode. Turn Section 14 (Task Backlog) into your task list, keeping the
task IDs (P1-01, P2-03, P3-02 ...) and the [P1]/[P2]/[P3] owner tags exactly as written.
Respect the dependencies and the phase order. Ask me at most 5 clarifying questions,
then wait for my approval before building.
```

**Setup steps**
1. Create the Repl, upload this file to `/docs/MASTER_PLAN.md`, upload the logo files to `/docs/brand/`, and upload the workbook `Amal_Family_Clinic_Group_data.xlsx` (or the `amal_clinic_seed.sql` from the course) to `/docs/data/`.
2. Run the seed SQL in the Repl's Postgres first (Tools → Database → SQL runner).
3. Add all 3 teammates via Multiplayer (needs a paid plan; parallel Agent tasks need Pro).
4. Each teammate only starts tasks tagged with their own owner tag. Never two people on the same task.
5. After each task: run it, test it, create a checkpoint, then start the next.

**Rules for the Agent (apply to every task)**
- Never drop, truncate, or overwrite the seed tables. Add new tables with migrations only.
- Never hard-code clinic IDs, doctor names, or clinic counts. Clinics are data (see Section 5).
- One feature per task. Small commits. If a task breaks an earlier feature, fix it before continuing.
- Use CSS logical properties only (`margin-inline-start`, never `margin-left`). Test every screen in AR/RTL and EN/LTR, and Light and Dark.
- Every user-facing string goes through i18n. No hard-coded text in components.
- All times are stored in UTC and displayed in `Asia/Hebron`.
- Use realistic **synthetic** data only. Never real patient data.

---

## 1. PROBLEM, GOAL, AND SUCCESS CRITERIA

**Problem:** three independent clinics, three booking systems (2 paper books, 1 calendar app). Patients are double-booked, appointments get lost, and a doctor cannot see what happened to a patient at another clinic. No one can mandate a system, and one doctor (Dr. Nabil) resists anything that feels like tracking.

**Goal:** a light, offline-capable, privacy-first system that earns adoption by proving value in numbers.

**Success criteria (these drive the KPI dashboard):**
| # | Criterion | Target |
|---|-----------|--------|
| S1 | Cross-clinic double-booking incidents | recurring → **0** |
| S2 | Doctor answers "has this patient been seen elsewhere in the network, and when?" | **< 10 seconds** |
| S3 | Appointments lost to internet downtime, any site | **0** |
| S4 | Dr. Nabil's clinic (Al-Bireh) opts in | **voluntarily, within month 1**, driven by results from the other two clinics |

---

## 2. WHAT THE DATA ALREADY TELLS US (baseline, computed from the provided workbook)

Use these numbers as the **"before"** values in the KPI dashboard and in the demo.

| Finding | Value |
|---|---|
| Appointments in the week of 2026-09-08 → 2026-09-13 | **102** (Clinic 1: 36 · Clinic 2: 33 · Clinic 3: 33) |
| Booking source | phone 48 · walk-in 21 · calendar app 33 |
| Same doctor, same start time (collisions) | **6 pairs = 12 appointments** |
| …of which flagged `double_booked` | only **1 pair (2 rows)**. **5 pairs are silent, unflagged conflicts** |
| Same patient, same start time, **two different clinics** | **2 cases** (patient 1 on 2026-09-12 12:45, clinics 1 & 3; patient 13 on 2026-09-09 10:45, clinics 2 & 3) |
| Patient-days with appointments at 2+ clinics | **14** (review pattern) |
| No-show rate | overall **21.6%** (22/102) · C1 22.2% · C2 18.2% · C3 24.2% |
| Patients / with visit history | 25 / 16 (9 have none) |
| Patients with visits at 2+ clinics | **6 of 16** |
| Visit history span | 2026-01-02 → 2026-08-27 (32 visits) |
| Patients who look like minors (born 2008 or later) | **~6** → guardian consent needed |
| Appointment slot grid | 15-minute starts (:00 :15 :30 :45) |
| Calendar-app export | 24 events, 30 min each, doctor identified **by email only**, patient by **typed name only**, no patient ID |
| Export names that exactly match the patient roster | **3 of 24** |
| Export events that match an existing Clinic-3 appointment (doctor + time) | **5 of 24** |
| Collision inside the export | 1 (Dr. Yasmin, 2026-09-13 09:00, two patients both `confirmed`) |
| Status vocabularies differ | appointments: `booked/completed/no_show/double_booked` · export: `confirmed/completed/cancelled` |

**Traps in the data (the system must handle these correctly):**
1. **Two different patients are both named "Samer Khoury"** (born 2014 and 1967, different phones). Matching on name alone would wrongly merge them. Duplicate detection must use name **+ date of birth + phone**.
2. **Free-text clinical notes exist.** One note shows the exact problem the project solves: a patient (Reem Zaid, patient 15) was started on blood-pressure medication at Clinic 1, then saw Dr. Nabil at Clinic 2 with dizziness and fatigue, and **he did not know she was already on that medication**. This is a patient-safety story, and the strongest argument for Dr. Nabil. It becomes the demo's centerpiece (Section 13).
3. Appointments have **no duration**, the export uses 30 minutes. Assume a default of 30 minutes, configurable per clinic.
4. Appointments exist on **every day including Friday and Sunday**. Do not hard-code weekends. Working days are a per-clinic setting.
5. Dr. Nabil works at **Clinic 2 (Al-Bireh)**, which uses paper. Dr. Amal works at Clinic 1 (Downtown, paper). Clinic 3 (Nablus Road) uses the calendar app. Every doctor belongs to exactly one clinic (verified: 0 mismatches).

---

## 3. ASSUMPTIONS (write these in the final handoff document)

| # | Assumption |
|---|---|
| A1 | Each doctor belongs to one home clinic (verified in data). |
| A2 | Doctor double-booking is detected locally; patient double-booking across clinics is detected on sync. |
| A3 | Default appointment length 30 min, 15-min grid, both configurable per clinic. |
| A4 | The export is imported once as a migration, then clinic 3 books in Amal Network. |
| A5 | Each clinic has at least one reception device. Internet can drop for minutes to hours. |
| A6 | **Two-level consent** (replaces the earlier "summary only"): **Basic** = visit date, clinic, doctor. **Clinical** = Basic + clinical notes / key alerts (medications, allergies, chronic conditions). Default for new patients: nothing shared until the patient agrees. |
| A7 | Minors: consent is recorded as given by a guardian (name + relationship). |
| A8 | Login: email + password for doctors/admin, quick 4-digit PIN for reception on a registered device. |
| A9 | Demo accounts exist for every role. Seed data is synthetic. |
| A10 | Out of scope: full EMR, billing/insurance, prescriptions, patient-facing app, real SMS/WhatsApp (simulated only). |

---

## 4. PEOPLE → NEEDS → FEATURES

| Person | Cares about | What we build for them |
|---|---|---|
| **Dr. Amal** (managing partner) | Unified view, but cannot force anyone | Admin overview, network health, KPI dashboard with before/after |
| **Dr. Nabil** (resistant) | Autonomy, privacy, no "tracking me" | **Lite mode**, opt-in, "Your data, your decision" page, zero doctor-performance analytics, trial with one-click export/exit |
| **Front-desk (one per clinic)** | Fast during a busy morning, works offline | 3-tap booking, big buttons, offline queue, printable day sheet |
| **Patients** | No double-booking, no repeating their history | Conflict prevention, consent-based visit summary, optional SMS reminder (simulated) |

---

## 5. SCOPE

### Must Have (MVP)
- Roles: Admin / Doctor / Front-desk. Login + PIN.
- Per-clinic calendar (day / week), booking by phone and walk-in, edit, cancel, mark no-show/completed.
- **Conflict prevention** (doctor-slot and patient-across-clinics) with clear explanations.
- **Network patient lookup**: "Seen elsewhere? When?" in under 10 seconds.
- **Consent management** (Basic / Clinical), withdrawable, with history.
- **Offline mode**: local-first writes, sync queue, conflict resolution screen.
- **Import wizard** for `calendar_app_export` (name matching, doctor email mapping, status mapping, review before commit).
- **KPI dashboard** with charts (before/after).
- AR/EN with full RTL, Light/Dark.

### Should Have
- Duplicate patient detection and safe merge (name + DOB + phone).
- Audit log (who viewed which cross-clinic record, when).
- Network Health screen (per-clinic online/offline, pending syncs).
- Printable day sheet (paper fallback).
- "Key alerts" strip on the patient card (medications, allergies, chronic conditions).
- Admin "Add clinic" wizard (see growth design below).

### Could Have
- Simulated SMS/WhatsApp reminders and waitlist auto-fill on cancellation.
- Keyboard shortcuts for reception, Kiosk mode.
- Arabic-aware search (ignore hamza/diacritics: أحمد = احمد, ة = ه).
- PDF export of a patient's visit summary.
- First-run onboarding tour (per role).
- "Simulate outage" demo switch (Admin → Developer tools).

### Out of scope
Full medical records, billing, insurance, prescriptions, patient app, real messaging.

### Growth design (scalability): "ready for another clinic, not built as a platform"
The scenario names exactly 3 clinics, so full multi-tenant SaaS is **not required** and would cost time. Instead:
- Clinics, doctors, working hours, slot length, booking-method are **rows and settings**, never constants.
- Admin can add a clinic and its doctors from the UI (Should Have).
- Every table that belongs to a location carries `clinic_id`.
- Any integration (calendar import, future SMS) sits behind an adapter interface.
- No tenant isolation, billing, or per-org databases. If the group grows, that is a later project.

### AI decision: **no AI in the core product**
Reasons: (1) sending patient data to an external model is a privacy risk that undermines the Dr. Nabil strategy; (2) conflict detection, matching and alerts must be deterministic and explainable; (3) cost and unpredictability in a safety-critical flow. The product still feels "smart" through deterministic logic: Arabic-aware fuzzy name matching, rule-based conflict detection, a keyword dictionary for Key Alerts (always shows the original note, never gives medical advice). *Optional stretch only, if time remains:* an off-by-default, clearly labelled assistant that explains KPI charts in plain language using **aggregated numbers only, no patient data**.

---

## 6. TECH STACK (common, so the Agent is reliable)

- **Frontend:** React + Vite + TypeScript, Tailwind CSS, shadcn/ui (Radix), TanStack Query, React Hook Form + Zod, Recharts, lucide-react.
- **i18n:** i18next + react-i18next. `dir` and `lang` set on `<html>`. Language and theme persisted per user.
- **Backend:** Node.js + Express + TypeScript, Drizzle ORM, PostgreSQL (Replit DB), Zod validation, session auth with `bcrypt`, rate limiting, `helmet`.
- **Offline:** PWA (manifest + service worker via Workbox), Dexie (IndexedDB), background sync, idempotency keys.
- **Dates:** date-fns + date-fns-tz, timezone `Asia/Hebron`.
- **Matching:** `fastest-levenshtein` or Jaro-Winkler + custom Arabic normalizer.
- **Tests:** Vitest (unit), Playwright (e2e incl. offline), axe (accessibility).
- **Contract-first:** P1 publishes `openapi.yaml` and mock responses early so P2 and P3 never wait for the backend.

**Folder structure**
```
/docs            MASTER_PLAN.md, brand/, data/, assumptions.md
/server          routes/, services/ (conflicts, sync, matching, consent), db/ (schema, migrations, seed)
/client          src/ (app, features/*, components/ui, i18n/, theme/, offline/)
/e2e             Playwright tests
```

---

## 7. DATA MODEL

**Existing tables (do not alter destructively):** `clinics`, `doctors`, `patients`, `appointments`, `patient_visit_history`, `calendar_app_export`.

**Additions via migration**
| Table / change | Key fields |
|---|---|
| `clinics` + columns | `slot_minutes` (default 30), `working_days`, `open_time`, `close_time`, `network_mode` (`full` / `lite`), `joined_at`, `timezone` |
| `doctors` + columns | `email` (unique), `user_id` |
| `users` | `id, email, password_hash, role, clinic_id, doctor_id, pin_hash, locale, theme, last_login` |
| `devices` | `id, clinic_id, label, registered_at` (for PIN login) |
| `patients` + columns | `name_normalized`, `is_minor` (derived), `guardian_name`, `guardian_relation`, `merged_into_id` |
| `appointments` + columns | `duration_minutes`, `source_ref`, `created_by`, `created_at`, `updated_at`, `client_op_id` (unique, idempotency), `conflict_state` (`none/flagged/resolved`), `cancel_reason` |
| `patient_consents` | `id, patient_id, level (none/basic/clinical), given_at, given_by (patient/guardian), guardian_name, withdrawn_at, recorded_by_user` |
| `visit_alerts` | `id, visit_id, patient_id, kind (medication/allergy/condition), label, source_note_excerpt` |
| `audit_log` | `id, user_id, clinic_id, action, patient_id, detail, at` (append-only) |
| `sync_operations` | `id, clinic_id, device_id, client_op_id, type, payload, status (pending/applied/conflict/rejected), received_at, resolved_by` |
| `import_batches` / `import_rows` | batch status, row mapping (matched patient, confidence, chosen action) |
| `patient_merge_candidates` | `patient_a, patient_b, score, reason, status` |
| `notifications` | simulated reminders |
| `kpi_snapshots` | `date, metric, clinic_id, value` (to draw before/after trends) |

**Constraints**
- Partial unique index on `appointments (doctor_id, scheduled_at)` where status not in (`cancelled`, `no_show`, `completed` historical flag as needed). Detect overlaps by duration, not only equal start time.
- `client_op_id` unique so a retried offline sync can never create a duplicate.

---

## 8. CORE LOGIC

### 8.1 Conflict engine (`server/services/conflicts.ts`)
Run before every create / move / sync:
1. **Doctor overlap:** same doctor, overlapping `[start, start+duration)`. → block with explanation and the 3 nearest free slots.
2. **Patient overlap across clinics:** same patient with another active appointment overlapping in time at any clinic. → warn, show where and when, allow override with a reason (audited).
3. **Same-day other clinic:** informational notice only (14 such patient-days exist; not always an error).
4. **Working-hours check** per clinic settings.
Return a structured result `{ok, conflicts[{type, with, severity, suggestedSlots}]}`. The UI always shows icon + text + color, never color alone.
Soft hold: while a receptionist fills the form, hold the slot for 30 seconds.

### 8.2 Offline-first sync
- On each reception device, cache (IndexedDB): this clinic's next 14 days of appointments, the doctors, and a compact patient list (name, phone, DOB, id).
- Offline booking: write locally first with `client_op_id`, status badge **"Waiting to sync"**. It is never deleted until the server confirms.
- Local doctor-conflict checking works offline (a doctor belongs to one clinic). Cross-clinic patient checks happen at sync.
- On reconnect: automatic sync in order. Outcomes per operation: `applied`, or `conflict` → goes to the **Conflict Resolution screen** with three explicit actions: *Keep this one and move the other*, *Move this appointment (suggested slots)*, *Call the patient (shows phone)*. Nothing is ever dropped silently.
- Persistent header indicator: 🟢 Online · 🟠 Offline (N waiting) · 🔴 Sync needs attention. Plus text, not only color.
- Printable day sheet always available offline.

### 8.3 Patient matching and import
Normalize Arabic and Latin names (strip diacritics, unify أإآ→ا, ة→ه, ى→ي, collapse spaces, lowercase Latin).
Score = name similarity + DOB match + phone match. Rules:
- Exact name + DOB or phone match → **auto-match**.
- Name-only match, or similar names → **needs review**, never auto-merge.
- No match → offer **create new patient** (needs phone at minimum).
Import wizard steps: (1) upload / use the existing export, (2) map doctor email → doctor, (3) match patients with confidence badges (since 21 of 24 names don't match exactly), (4) map statuses (`confirmed→booked`, `completed→completed`, `cancelled→cancelled`), (5) show conflicts found (incl. the 09-13 09:00 collision), (6) commit as one transaction with a downloadable report.

### 8.4 Consent and visibility
| Role | Sees |
|---|---|
| Front-desk | Own clinic's appointments; patient name and phone; **no** visit history. Can **record** consent. |
| Doctor | Own clinic's patients fully. Other clinics' visit info **only per consent level**: Basic → date/clinic/doctor; Clinical → + notes and Key Alerts. |
| Admin | Aggregated statistics and user/clinic management; **no** patient-level clinical data. |
- Every cross-clinic view is written to `audit_log`; the patient can request "who viewed my record".
- No doctor-performance analytics anywhere. State this on screen.
- Lite-mode clinic (Dr. Nabil's option): booking and conflict prevention only; its records are **not** shared and it cannot see others' records until it chooses to upgrade.

### 8.5 Key Alerts (rule-based)
A keyword dictionary (EN + AR) extracts alert chips from clinical notes (e.g., "blood pressure medication", "Amlodipine", "allergic", "antibiotics"). Always show the original note excerpt beside the chip. Label: "Flag from another clinic: confirm with the patient". Never recommend treatment.

---

## 9. ROLES, SECURITY, PRIVACY
- Passwords hashed with bcrypt; PIN rate-limited (lock after 5 tries); sessions expire (doctor 30 min idle, reception device 8 h but PIN re-entry for sensitive actions).
- HTTPS only, secure cookies, CSRF protection, input validation with Zod on every route.
- Principle of least data: patient lists on devices contain only what reception needs.
- Right to be forgotten / withdraw: consent withdrawal hides data immediately on the next request.
- Disclosure page **"Your data, your decision"**: what we store, who sees it, how to withdraw, how to export.

---

## 10. DESIGN SYSTEM (professional, formal, calm, medical)

### Brand
- **Name:** Amal Family Clinic Group · product: Amal Network / شبكة أمل ("Amal" means hope).
- **Logo:** `/docs/brand/amal-logo-mark.svg` (app icon, favicon, PWA icon) and `/docs/brand/amal-logo-horizontal.svg` (header, login). Concept: a white medical cross over a rising golden sun on a teal badge, meaning *care + hope*. The logo's gold is a brand accent, not a status color.
- **Feel:** trustworthy, calm, official. Not a white box. Soft teal-tinted surfaces, navy typography, generous spacing.

### Color tokens (define as CSS variables, Light / Dark)
| Token | Light | Dark | Use |
|---|---|---|---|
| `--primary` | #0E7C86 | #3CC4CF | actions, links, focus |
| `--primary-strong` | #0B5F69 | #2AA6B1 | hover / pressed |
| `--navy` | #0B2545 | #E6EEF3 | headings, sidebar |
| `--bg` | #F2F7F8 | #0B1820 | app background (tinted, not pure white) |
| `--surface` | #FFFFFF | #112530 | cards, tables |
| `--surface-2` | #E7F1F3 | #17313D | zebra rows, subtle panels |
| `--border` | #CFDDE2 | #26414D | dividers |
| `--text` | #13222B | #E9F1F4 | body |
| `--muted` | #5B6B76 | #9DB2BD | secondary text |
| `--success` | #1F9D6B | #3FCF94 | completed, online |
| `--warning` | #B96A00 | #F2A93B | offline, pending |
| `--danger` | #C93A3A | #FF7A7A | conflicts, errors |
| `--info` | #2F6FB3 | #6FA8E8 | notices |
| `--brand-gold` | #F5B544 | #F5B544 | logo, empty-state illustrations only |
All text/background pairs must meet WCAG AA (4.5:1).

### Typography
IBM Plex Sans Arabic for Arabic and Latin (single family, formal and highly legible). Scale: 12 / 14 / 16 / 18 / 20 / 24 / 30 / 38. Body 16 px minimum (reception screens: 18). Line-height 1.6. Numbers: Latin digits by default, user setting for Arabic-Indic digits.

### Shape and layout
Radius: 8 px controls, 12 px cards, 16 px dialogs. Shadows are subtle; borders carry structure. Sidebar (navy) on the inline-start side that flips in RTL. Top bar: clinic switcher, search, **connection pill**, language toggle (AR | EN), theme toggle, user menu. Mobile/tablet: sidebar collapses into a bottom bar. Touch targets ≥ 44 px.

### Status vocabulary (fixed across the whole app: icon + color + label)
Booked (clock, blue) · Completed (check, green) · No-show (user-x, grey-red) · Conflict (alert-triangle, red) · Waiting to sync (cloud-upload, amber) · Cancelled (x, grey).

### Components to build once and reuse
AppShell, ConnectionPill, StatusBadge, ConsentBadge, KeyAlertChip, SlotPicker, PatientQuickSearch, AppointmentCard, ConflictDialog, SyncQueuePanel, KpiCard, ChartCard, EmptyState (with gold illustration), ConfirmDialog (destructive actions), Toast, DataTable, DateNavigator, LanguageToggle, ThemeToggle.

### UX rules
- Reception: patient → doctor/time → confirm (**3 taps**). Walk-in is a single button on every screen.
- Errors explain what happened and the next step ("Dr. Yasmin already has a patient at 10:15. Nearest free: 10:30, 11:00, 11:15."). No vague errors, no apologies.
- Empty states invite an action. Destructive actions need confirmation. Undo on cancel for 10 s.
- Plain labels: "Waiting to sync", not "queued mutation".
- Keyboard fully usable, visible focus, `prefers-reduced-motion` respected, motion only to confirm actions.
- First-run tour per role (dismissible, replayable from Help).

---

## 11. SCREENS

**Public:** Login (logo, language and theme toggles, role-aware: email/password or clinic + PIN) · "Your data, your decision".

**Front-desk**
1. *Today* (calendar day view per doctor, big slots, Walk-in button) · Week view.
2. *New booking* (3-step drawer; patient search with Arabic-aware matching; live conflict feedback).
3. *Patient lookup* (name/phone; add new patient; record consent).
4. *Sync & conflicts* (queue list, resolve conflicts).
5. *Print day sheet*.

**Doctor**
1. *My day* (today's patients; Key Alerts on cards).
2. **Network search** (one search box at the top → result card: "Seen at Clinic X, 3 weeks ago, Dr. Y" + consent badge + Key Alerts). Target < 10 s.
3. *Patient card* (visit timeline across clinics, color per clinic; notes only if Clinical consent).
4. *Privacy settings* (my clinic's network mode, who viewed my patients).

**Admin (Dr. Amal)**
1. **KPI dashboard** (charts below).
2. *Network health* (3 clinic cards: online/offline, pending syncs, last sync, mode Full/Lite).
3. *Users & devices*, *Clinics & doctors* (add clinic wizard), *Duplicate patients*, *Audit log*, *Import wizard*, *Developer tools* (simulate outage, reset demo data).

### KPI dashboard (use real baseline from Section 2)
| Chart | Type | Shows |
|---|---|---|
| Cross-clinic conflicts: before vs after | grouped bar | baseline (6 doctor + 2 patient collisions) vs. live count, per clinic |
| Conflicts prevented over time | line | cumulative blocks/warnings |
| Patient lookup time | big number + sparkline | median seconds, target < 10 |
| Appointments lost to downtime | big number | target 0, with "queued → synced" counts |
| Bookings by source | donut | phone / walk-in / calendar / Amal Network |
| No-show rate by clinic and weekday | bar + heat strip | baseline 21.6% |
| Clinic adoption | 3-step stepper per clinic | Trial → Lite → Full, with dates, and Dr. Nabil's clinic highlighted |
| Network activity | small table | cross-clinic lookups per day (aggregated, never per doctor) |
Every chart has a text summary, accessible colors, a data table toggle, and RTL-aware axes and legends.

### Wireframe (Reception, Today)
```
┌ Logo  Clinic: Downtown ▾   [Search patient…]   🟢 Online   AR|EN  ☾  User ┐
│ Sidebar │  < Tue 8 Sep >    [ + New booking ]   [ Walk-in ]              │
│  Today  │  ┌ Dr. Amal ───────┐ ┌ Dr. Hassan (Peds) ──┐                  │
│  Week   │  │ 09:15 Manal Q.  ✓│ │ 09:45 Suha N.     ✓ │                  │
│  Patients│ │ 11:00 ⚠ Conflict │ │ 12:45 …             │                  │
│  Sync (2)│ │ 12:30 Lina K.  ⏱ │ │                      │                  │
└──────────┴──────────────────────────────────────────────────────────────┘
```

---

## 12. API CONTRACT (P1 delivers `openapi.yaml` in task P1-02; summary)
```
POST /auth/login | /auth/pin | /auth/logout        GET /me
GET  /clinics | /clinics/:id     PATCH /clinics/:id     POST /clinics
GET  /doctors?clinicId=
GET  /appointments?clinicId&from&to&doctorId        POST /appointments (with clientOpId)
PATCH /appointments/:id          POST /appointments/check   (conflict preview)
GET  /patients?q=                POST /patients     GET /patients/:id
GET  /network/lookup?q=          (audited, consent-aware)
GET/POST /patients/:id/consent   POST /consent/:id/withdraw
POST /sync/push  GET /sync/pull?since=   GET /sync/conflicts   POST /sync/resolve
POST /import/upload  POST /import/:id/map  POST /import/:id/commit
GET  /kpis?range=   GET /audit?patientId=   GET /network/health
GET  /patients/duplicates   POST /patients/merge
```
All responses typed with Zod; errors use `{code, messageKey, params}` so the UI can translate them.

---

## 13. DEMO STORY (seed scenarios to guarantee)
1. **The silent collision:** Clinic 1, Dr. Amal, 2026-09-09 11:00, phone vs walk-in → the system prevents it and suggests 3 slots.
2. **Same patient, two clinics, same time:** patient 13, 2026-09-09 10:45 → cross-clinic warning.
3. **The Dr. Nabil moment:** Reem Zaid (patient 15). Consent level = Clinical (seeded). Dr. Nabil searches her; in < 10 s he sees "Seen at Clinic 1 · Dr. Amal" with a Key Alert chip "Blood-pressure medication (Amlodipine 5 mg)" next to her dizziness complaint. Message: *this is about patient safety, not tracking.*
4. **Outage:** Admin switches Clinic 2 offline (Developer tools); reception books 3 patients; 🟠 shows "3 waiting"; reconnect → 2 apply, 1 conflict appears on the resolve screen; **0 lost**.
5. **Import:** the 24-event export; 3 auto-match, 21 need review; the 09-13 09:00 collision is surfaced.
6. **Two Samer Khourys:** the duplicate screen shows them as *not* a match (different DOB and phone).
7. **Minor patient:** consent recorded with guardian.
8. **Dr. Nabil's path:** Clinic 2 starts in Trial (Lite), sees the transparent results of Clinics 1 and 3, then opts in with one click (or exports and exits).

---

## 14. TASK BACKLOG (the Agent must keep these IDs and owner tags)

**Phases:** 0 Understand · 1 Foundation · 2 Booking core · 3 Network & consent · 4 Offline · 5 Admin & KPIs · 6 Polish & delivery.
`||` = can run in parallel (different owners, different files).

### Phase 0: Understand (all three, short)
| ID | Owner | Task | Done when |
|---|---|---|---|
| P1-00 | [P1] | Run SQL exploration; reproduce the Section 2 numbers; save queries to `/docs/data/exploration.sql` | Every number in Section 2 reproduced |
| P3-00 | [P3] | Write `/docs/assumptions.md` (Section 3) + stakeholder map (Section 4) + success criteria | Reviewed by team |
| P2-00 | [P2] | Set up design tokens, fonts, logo assets, Storybook-style `/ui-kit` page | Light/Dark + AR/EN tokens render |

### Phase 1: Foundation
| ID | Owner | Task | Depends | Done when |
|---|---|---|---|---|
| P1-01 | [P1] | Migrations for Section 7 additions; seed users/devices/consents/demo scenarios | P1-00 | Schema + seed run clean; seed tables untouched |
| P1-02 | [P1] | Auth (password + PIN), roles middleware, `openapi.yaml`, mock server | P1-01 | Contract published; role guards tested |
| P2-01 | [P2] | App shell, routing, role-based navigation, i18n (AR/EN), RTL, theme toggle, ConnectionPill (static) | P2-00 | All screens flip correctly in RTL and Dark |
| P2-02 | [P2] | Login screen + "Your data, your decision" page + first-run tour framework | P2-01, P1-02 | Login works for 3 roles |
| P3-01 | [P3] | PWA setup (manifest, icons from logo, service worker shell), Dexie schema, `useOnlineStatus` | P2-01 | Installable; app shell loads offline |
| P3-02 | [P3] | Test harness: Vitest, Playwright, axe; CI script; test data builders | P1-01 | `npm test` and `npm run e2e` run |

### Phase 2: Booking core
| ID | Owner | Task | Depends | Done when |
|---|---|---|---|---|
| P1-03 | [P1] | Appointments API + **conflict engine** (8.1) + soft-hold + suggested slots | P1-02 | Unit tests reproduce the 6 doctor and 2 patient collisions from the data |
| P2-03 | [P2] | Calendar day/week views, StatusBadge, AppointmentCard, Walk-in button | P2-01 | Matches wireframe; 3-tap flow |
| P2-04 | [P2] | New-booking drawer + ConflictDialog + patient quick search (Arabic-aware) | P2-03, P1-03 | Conflict shown with icon+text and 3 slots |
| P1-04 | [P1] | Patients API + Arabic normalizer + search | P1-02 | `احمد` finds `أحمد` |
| P3-03 | [P3] | e2e: book, edit, cancel, collide; accessibility pass on booking screens | P2-04 | Tests green |

### Phase 3: Network & consent
| ID | Owner | Task | Depends | Done when |
|---|---|---|---|---|
| P1-05 | [P1] | Consent service + visibility rules (8.4) + audit log + `/network/lookup` | P1-03 | Role/consent matrix covered by tests |
| P1-06 | [P1] | Key Alerts extractor (8.5) over seeded visit notes | P1-05 | Reem Zaid's alert generated |
| P2-05 | [P2] | **Network search** + patient card timeline + ConsentBadge + KeyAlertChip | P1-05 | Lookup demo under 10 s |
| P2-06 | [P2] | Consent capture UI for reception (incl. guardian flow) + patient "who viewed" view | P1-05 | Minor flow works |
| P1-07 | [P1] | Import wizard backend (8.3) + duplicate detection + merge | P1-04 | 3 auto, 21 review on the real export |
| P2-07 | [P2] | Import wizard UI + Duplicate patients screen | P1-07 | Samer Khoury x2 shown as "not a match" |
| P3-04 | [P3] | Privacy tests: front-desk cannot read history; admin cannot read patient data; audit entries written | P1-05 | Tests green |

### Phase 4: Offline
| ID | Owner | Task | Depends | Done when |
|---|---|---|---|---|
| P1-08 | [P1] | `/sync/push`, `/sync/pull`, idempotency by `client_op_id`, conflict records | P1-03 | Retried op never duplicates |
| P3-05 | [P3] | Local-first booking: Dexie cache, outbox, optimistic UI, "Waiting to sync" state, offline conflict check | P1-08, P2-04 | Booking works with network off |
| P3-06 | [P3] | Auto-sync on reconnect + **Conflict Resolution screen** (3 actions) + SyncQueuePanel | P3-05 | Demo scenario 4 passes |
| P2-08 | [P2] | Final ConnectionPill states, offline banners, printable day sheet | P3-05 | Works offline |
| P3-07 | [P3] | e2e offline suite (go offline, book 3, reconnect, assert 0 lost) | P3-06 | Green |

### Phase 5: Admin & KPIs
| ID | Owner | Task | Depends | Done when |
|---|---|---|---|---|
| P1-09 | [P1] | KPI endpoints + snapshots + baseline values from Section 2 | P1-03, P1-08 | Numbers match SQL |
| P2-09 | [P2] | **KPI dashboard** (all charts in Section 11) with table toggle and RTL axes | P1-09 | All charts render in AR/EN, Light/Dark |
| P2-10 | [P2] | Network Health, Users & devices, Clinics & doctors (Add-clinic wizard), Audit log screens | P1-09 | Add clinic without code changes |
| P1-10 | [P1] | Clinic adoption states (Trial / Lite / Full), export-my-data, leave-network | P1-05 | Dr. Nabil path works |
| P3-08 | [P3] | Dr. Nabil journey: Lite mode UX, transparent results page, opt-in flow | P1-10, P2-09 | Demo scenario 8 |
| P3-09 | [P3] | Developer tools: simulate outage, reset demo data | P3-06 | Demo-ready |

### Phase 6: Polish & delivery
| ID | Owner | Task | Done when |
|---|---|---|---|
| P2-11 | [P2] | Visual polish, empty states with gold illustration, microcopy review AR/EN, responsive/tablet check | Design review passes |
| P3-10 | [P3] | Full accessibility audit (axe + keyboard), performance check, bug bash | No critical issues |
| P1-11 | [P1] | Security review (rate limits, headers, validation), backup/seed script | Checklist done |
| P3-11 | [P3] | Final deliverables: assumptions doc, stakeholder map, MVP plan, KPI before/after, 5-minute demo script covering all 4 stakeholders | Rehearsed |

---

## 15. DEFINITION OF DONE (every task)
- Works in **AR/RTL and EN/LTR**, **Light and Dark**.
- Strings come from i18n files; no hard-coded text.
- Keyboard-navigable; passes axe with no critical issues.
- Has at least one automated test.
- Doesn't break earlier features (run the full suite).
- Checkpoint created; short note added to `/docs/CHANGELOG.md`.

## 16. RISKS
| Risk | Mitigation |
|---|---|
| Agent breaks earlier work | small tasks, tests after each, checkpoints |
| Offline complexity | start with write-local → sync → resolve; add polish later |
| RTL regressions | logical properties from day 1, RTL screenshots in e2e |
| Privacy mistakes | consent and audit in Phase 3, privacy tests (P3-04) |
| Scope creep | Must Have first; Should/Could only after Phase 5 |
| Merge conflicts between teammates | separate folders per owner, small PRs, contract-first API |

## 17. FINAL DELIVERABLES
1. Working app with demo data and the 8 demo scenarios.
2. `/docs/assumptions.md` (vetting) + stakeholder map.
3. MVP plan (Section 5 as delivered).
4. KPI dashboard with before/after numbers.
5. A short presentation telling the story of the four stakeholders, ending with Dr. Nabil's choice.
