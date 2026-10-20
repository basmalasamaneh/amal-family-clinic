# Reception live verification

**Run:** `AMAL_RECEPTION_LIVE=1 pnpm --filter @workspace/amal-network exec playwright test reception-live.spec.ts --workers=1`

**Result:** 2 tests passed in 14.5 s against the live development application. Synthetic operational records were created through the real APIs; the run made no seed-table changes.

Verified in this pass:

- Required-field validation; patient registration trims the name and stores the expected demographics-only response.
- Minor guardian fields appear, and changing the date of birth to an adult hides them.
- Registration does not create an appointment automatically.
- Live patient lookup and the three-tap global Walk-in happy path from Today and Patients, with typed search treated separately; each booking returned HTTP 201 for the selected patient and clinic and used `walk-in` source.
- The tested reception journey issued no requests matching the test's prohibited clinical/history/visits/alerts URL patterns.
- Uncertain registration acknowledgement retries the same operation ID without duplicating the patient; an offline unsaved draft survives the Walk-in handoff and can be resumed.

The only test-harness adjustment was scoping the walk-in search field to `drawer-booking`, because the page and open booking drawer both render `input-patient-search`.

Screenshot: `generated-artifacts/amal-ui-tests/reception-live-live-regist-c5631-alk-in-from-multiple-routes/live-patients.png`

The initial two-test run did not cover the presentation matrix and stacked-dialog
cases; the remaining checks in the same browser pass are recorded below.

## Follow-up: handoff, responsive preferences, and intercepted responses

This follow-up completed the previously untested items in the same authenticated browser session. It did **not** rerun the live registration/Walk-in spec or create an appointment.

- **Phone drawer → Walk-in:** Opened the phone booking drawer for the existing synthetic patient 151, selected Dr. Amal Khoury, then used the drawer's Walk-in handoff. The stacked Walk-in drawer showed that same patient and marked Amal Khoury as the selected doctor. Escape closed only the top drawer and restored focus to the original `button-drawer-walkin` in the phone drawer.
- **Stacked-dialog keyboard focus:** Tab and Shift+Tab stayed in the top Walk-in dialog; Shift+Tab from its first close control wrapped to the last action, and Tab wrapped back. In the nested conflict dialog, Tab and Shift+Tab also remained in the top dialog. Escape closed only the conflict dialog and restored focus to the underlying `button-review-conflicts`.
- **390px mobile:** At 390×844, the phone drawer measured 390×844, document scroll width equaled client width (390px), and its Walk-in/close actions were 44px high with Back/Next at 48px. The account/display dialog was inset 12px and 366px wide with no horizontal overflow; all visible preference, close, Walk-in, and sign-out controls were at least 44px high.
- **Desktop and mobile locale/theme matrix:** Visually switched the UI through Arabic/English and light/dark using account/display controls. At 1280×900, all four combinations had no document-level horizontal overflow and all nine visible dialog controls were 44px high; the preference dialog was 480px wide and centered. At 390×844, English/LTR and Arabic/RTL both rendered in light and dark themes without document-level horizontal overflow; the dialog controls were 44px high. The onboarding tour was dismissed through its visible UI before these screenshots. Source inspection confirms the application identity is `account:<id>`; the earlier harness key used only the numeric ID, which explains why its screenshot still showed the tour.
- **Intercepted no-slot case (not live availability):** A page-local fetch interception returned `{items: [], durationMinutes: 30, checkedAt: ...}` for `GET /api/appointments/availability`. The UI showed “لا يوجد وقت متاح ضمن نطاق البحث” for both doctors. Intercept counters: availability 1, check 0, create 0.
- **Intercepted stale-slot case (not a live conflict):** The same page-local interceptor returned a blocking `slot-held` preview for `POST /api/appointments/check`. The UI showed a blocked time, then the conflict dialog reported another staff member holding the time, hid conflict details, showed no nearby slots, and disallowed override. Intercept counters after review: availability 1, check 1, create 0. No appointment was submitted.

**Follow-up screenshot evidence (Stagehand capture IDs):** phone drawer `rhvv25`; patient/doctor carried into Walk-in `bthjm4` and keyboard focus `rwlebe`; 390px Arabic/light drawer `28vz2j`; mobile preference states Arabic/light `q4d25z`, English/light `o8ye9k`, English/dark `pdrbyr`, Arabic/dark `om18gy`; desktop preference states Arabic/dark `wf2l2t`, English/dark `zl7mv8`, English/light `0xb5c7`, Arabic/light `jubzs4`; intercepted no-slot `u7emb9`; intercepted blocking conflict `88330n`; conflict-dialog focus `4p4v43`.

The mobile page/document had expected vertical scrolling in the booking drawer; no horizontal overflow was measured in the tested states.

**Product issue found and fixed:** Arabic age rendering lacked the zero/two/few/many
plural forms and showed a literal translation key. All Arabic forms are now supplied.
A focused i18next regression covers ages 0, 1, 2, 3, 11, 36 and 100 and English
singular/plural. This small translation fix is verified without repeating browser tests.
The live test's onboarding dismissal key also now uses the actual `account:<id>`
identity rather than the numeric ID.

After the intercepted checks, the authenticated page was reloaded to clear the temporary in-page fetch wrapper. It returned to Today in Arabic/Light with zero tour dialogs and zero booking dialogs; no appointment was created.
