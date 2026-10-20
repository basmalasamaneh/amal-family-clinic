# Consent live-browser regression result

Focused opt-in regression (all four Arabic/English × Light/Dark projects passed;
no unrelated reception tests):

```sh
AMAL_RECEPTION_LIVE=1 pnpm --filter @workspace/amal-network exec playwright test \
  --config playwright.reception.config.ts \
  --grep "live consent capture, invalidation"
```

The regression uses isolated synthetic receptionist/doctor actors, synthetic
patients, and real APIs. It does not edit seed tables, run migrations, or change
product source.

## Completed checks

- After the CSRF-token rotation fix, adult consent writes for None → Basic →
  Clinical succeeded with fresh PIN reauthentication. A simulated lost
  acknowledgement followed by reconciliation reused the same `clientOpId`.
- Offline refusal showed the offline message and did not queue a write; the
  authoritative consent remained Clinical.
- Direct route guard behaved as expected. Cross-clinic Clinical view showed both
  the local and foreign notes, and the doctor was denied assisted history (403).
- Access history pagination now succeeds across fresh PIN rotation: page one
  returned 20; page two returned 23 visible rows. Twenty-one rows were inserted
  as synthetic fixtures, with successful cross-clinic search audits contributing
  additional entries.
- The mocked 503 history response showed the unavailable state; retry succeeded.
  Withdrawal returned 200, effective consent became None, foreign clinical data
  disappeared on the doctor's next authorized read, and local notes plus source
  visit rows remained.
- Minor consent rejected blank/whitespace guardian details and accepted trimmed
  values. Minor access history showed the empty state.
- PIN-dialog keyboard focus/Tab checks passed. At 390px viewport the document
  had no horizontal overflow.

## Accessibility correction and final verification

The initial English Light run identified reduced-opacity historical labels
below required contrast. Removing the extra opacity preserves the semantic
muted text tokens and explicit historical status. English Dark then passed;
Arabic Light, Arabic Dark, and English Light passed after correcting the test's
English-only offline-message expectation. All four projects pass the focused
journey, axe WCAG 2.1 A/AA scan, PIN keyboard checks and mobile overflow checks.

Workspace typechecks pass. Backend consent tests pass 38/38, including age/date
boundaries, unknown DOB policy, cross-patient/actor/clinic denial, cursor tampering,
PIN rotation between pages, withdrawal retention and immutable seed fingerprints.

## Artifacts and environment

The Playwright result includes a `consent-browser-screenshot` image attachment,
also exported to `generated-artifacts/reception/consent-en-light-mobile.png`
(390px viewport), and a `consent-live-result` JSON summary. The screenshot shows
the history-status labels and adjacent date/evidence text noted in the axe
finding. The run used the exact current preview origin in the development API
allowlist only; no wildcard or production origin was added. The temporary env
file used to restart the API was removed after the run. The final four-project
coverage was completed in targeted batches without rerunning unrelated journeys.
