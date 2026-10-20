# Import and duplicate review

The existing Amal shell exposes `/work/import` and `/work/duplicates` to
doctor and front-desk sessions. Administrators remain denied patient-level
access. The selected clinic and session determine available data; changing
context remounts the workflow.

## Import

The six stages are source, doctors, patients, status, conflicts, and commit/report.
Source options are the immutable export or the backend's bounded JSON row-array
format. Staging does not create appointments.

Every row requires its own reviewed identity or reasoned skip. Suggestions are
name evidence only. Existing-patient decisions require typed phone/DOB evidence.
New-patient decisions require the backend's demographics, including phone and
date-only DOB; an unknown DOB is never invented. Doctor selections are drafts
until included in an individual server review. Changing a selection makes
affected included rows stale in the UI until reviewed again.

Saved batches reopen through `?batch=ID` or the source-stage ID input. There is
no batch-list endpoint. The last batch ID and doctor drafts are scoped to the
user/role/clinic in session storage. Sensitive identity verification values
are held only in memory; editing a reopened decision requires verification
again. Server-saved decisions remain resolved without editing.

Commit failures with uncertain outcomes trigger a batch-status read.
An unresolved commit retains its original version and operation ID, including
across reload when session storage is available. A newer fetched version never
silently rotates that key. If storage is unavailable, the UI warns that retry
state is memory-only. Confirmed commits expose the authorized localized JSON
report.

## Duplicates

Candidates come from the server, not client similarity. The separate comparison
tab can select two authorized patient records even when they are not candidates.
Differences in DOB and phone produce a localized non-match explanation.

A merge requires a server-listed pair, explicit survivor, read-only preview,
reason and final confirmation. Appointment impact counts are limited to the
preview's stated scope; hidden clinical references are not inferred. The
preview is advisory and the mutation revalidates eligibility and versions.
An uncertain merge retains its exact request while the screen remains mounted;
changing selection or reason is disabled until resolved. This pending merge
request is not persisted across a full page reload.

## Checks

- `pnpm --filter @workspace/amal-network test:imports:unit`
- `pnpm run typecheck`
- `pnpm --filter @workspace/scripts seed:verify`

The frontend does not modify schema or seed records. Development prerequisites
are the existing backend import and merge migrations, applied only with setup
authorization. See `docs/MERGE_PREVIEW_HANDOFF.md` for the preview contract.

### Browser verification limits

The development browser pass staged the real export, individually saved all
24 rows as reasoned skips through a source-clinic reception session, reopened
the batch, and reached conflict review and the final summary. It confirmed
zero automatic links and the authorized Samer comparison's DOB/phone mismatch
in both languages. Mobile English and Arabic, including Arabic dark mode,
had no document-level horizontal overflow.

The run did not execute commit/report retrieval, an eligible merge, simulated
network failures, or an exhaustive four-combination accessibility audit.
Those interactions must not be described as browser-verified.
