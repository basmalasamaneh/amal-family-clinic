# Task 37 — final visual inspection

## Authoritative disposition

**PASS for the documented four-combination presentation review.**
The final dark print-margin issue described below is resolved by a light print
color scheme. Two targeted dark-mode cases passed in
`generated-artifacts/polish/print-paper/`. The final Arabic empty and English
populated PDF renders were directly inspected: white margins and readable
print-only content. Earlier defect descriptions are historical, not current
blockers. Scope/evidence limitations below remain explicit; this is not a
certification of security, physical printers or live mutation correctness.

Both corrected **dark-theme empty A4 PDFs print a black frame in the page
margins**. Both light-theme PDFs have white margins. Content is correctly
print-only, bilingual, and readable; this is a newly observed visual issue,
not the old screen-media fixture mistake. Exact evidence:

- Source: `generated-artifacts/polish/sheet-focus/results/*-{ar,en}-dark-360/authorized-empty.pdf`
- Actual PDF renders: `generated-artifacts/polish/inspection/pdf/{ar,en}-dark-360-corrected-empty.png`
- Controls: corresponding `{ar,en}-light-360-corrected-empty.png`

Required next action is minimal: owner fixes the dark print page/canvas
background, recaptures the affected print cases, and visually checks their
PDFs. No DB writes, broad suite, new screens or physical printers are needed.

**Resolved, not blockers:** all ten former supplementary failures; native zoom
mechanism/capture; developer setup; corrected empty print media; representative
full-resolution bilingual text and below-fold/overlay review. The original
624-case composite is untouched. Supplementary latest unique results are
**101 passed / 0 failed**, not a claim that automation detected every visual
problem. `inspection/supplement-latest.json` retains latest-case provenance.

## Actual review ledger

All paths below are relative to `generated-artifacts/polish/`.

### Original overview inspection

Actually opened all **48** `inspection/{ar,en}-{light,dark}-{360,768,1024,1440}-{admin,delivered,states}.jpg`
contact sheets, covering **720 named source checkpoints**: six admin/KPI,
twenty other delivered destinations and nineteen state checkpoints per cell.
All locale/theme/width combinations exist. The earlier assertion that only
Arabic/light archives existed was incorrect.

`inspection/manifest.json` records each exact source, crop and full height,
with zero missing named checkpoints. These sheets are deliberately overview
crops, not evidence that all 720 original full-page PNGs were read at native
resolution. Four `*-kpi-full.jpg` sheets were viewed for distribution only;
their tiny text was not used to approve microcopy.

### Readable/full-resolution continuation

`inspection/readable/manifest.json` records native-pixel, **unresized** source
crops. Actually viewed:

| Cell coverage | Actual image(s) inspected | Specific judgement |
| --- | --- | --- |
| AR/EN × light/dark × 360 | `*-doctor-edit-dialog.png` from corrected overflow reruns | Full visible form/title/actions, bidi mixed-script name, wrapped explanatory text, backdrop and bottom-nav separation |
| Same four 360 cells | `*-registration-minor-validation.png` | Required-field errors, phone leading-zero help, date-only age wording, guardian does not imply consent, visible save/cancel strip |
| AR/EN × light/dark × 768 | `*-clinical-card.png` | Full timeline/card, identity-verification caution, consent-not-recorded-here wording, no-flags-not-no-risk wording, dates and bottom-nav clearance |
| AR/EN × light/dark × 1024 | `*-kpi-definitions.png` | Lower-fold lookup unknown-not-zero explanation and adoption card/transition-date limitations |
| AR/EN × light/dark × 1440 | `*-privacy-0.png`, `*-privacy-1000.png`, `*-privacy-2000.png` | Public long-form bilingual headings, role table, planned safeguards, consent levels, withdrawal/recovery instructions and disabled online actions |
| AR/EN × light/dark × 360 | `*-empty-triptych.png` | Changed doctor-empty, duplicates-empty and sync queue illustrations, paired with distinct locked/empty language |

The privacy sources were split into consecutive crops; later English footer
text also appears, at genuine 200% zoom, in the actual-window bottom captures
listed below. Deliberate crop edges are not classified as UI clipping.
The 360px registration form has an inner scrolling body and a visible action
strip; no claim is made that this single retained scroll position displays
every guardian input simultaneously.

This completes the requested **representative** native-resolution inspection
across all sixteen display cells, in addition to all-destination overview
review. It is not an exhaustive claim that every possible translated string,
state-machine branch or offscreen widget was freshly exercised.

Earlier supplemental review also actually opened all twelve
`inspection/supplement-{ar,en}-{light,dark}-360-{dialogs,imports,offline}.jpg`
sheets. Other generated supplemental sheets are not silently labelled viewed.
Corrected narrow doctor dialog images, actual native-window pixels and PDF
renders replace the earlier inadequate thumbnails for the relevant approval
decisions.

### Native 200% — capture anomaly resolved

Focused reruns selected **only the existing `native-zoom` case**; the 624 and
101-case matrices were not rerun. Final evidence is in
`supplement-native-full-display/`, one passing case.

Native browser zoom uses a disposable Chromium extension:
`chrome.tabs.setZoom(tabId, 2)` and `chrome.tabs.getZoom(tabId) === 2`.
Outer width stays 1440, inner width **1432→716**, DPR **1→2**, root font remains
**16px**. This is not CSS zoom, a root-font proxy or pinch emulation.

Playwright native-zoom captures returned incorrect crop sizes; DevTools
compositor images also omitted nav-label layers. The existing X11 display was
only 800×600, smaller than the 1440×1000 browser. For the final focused case the
display was temporarily made **1920×1200**, the browser positioned at (0,0),
and actual foreground-window pixels captured with ImageMagick `import`.
Display mode was restored to **800×600** on exit. No app/workflow was restarted.

**All twenty `*-display.png` images in that final run were actually opened:**

- UI-kit top × AR/EN × light/dark: four.
- Doctor day top and bottom × all four display variants: eight.
- Public privacy top and bottom × all four variants: eight.

These show complete header controls, readable doubled text, wrapping without
document horizontal loss, correct RTL/LTR, and the actual bottom nav icons/
labels (missing in the unreliable DevTools images). Doctor “Open card” clears
the nav at the bottom in all variants; privacy footer/withdrawal text clears
the sticky header. In the short 426-CSS-pixel native viewport, the existing
small-height media rule makes the bottom nav static rather than overlaying
the page. Named geometry attachments include main, focus, fixed regions,
media-query status and nav-item rectangles. Twelve axe/overflow checkpoints
and actual Tab/focus-indicator checks pass. These bounded native samples are
accepted; earlier broken image derivatives are retained as diagnosis history.

### Actual PDF inspection

Previously viewed all four English/light multipage PDF renders; Arabic/light
first and last pages; and the Arabic/light populated one-row PDF. All four
48-row locale/theme PDFs have four pages per `pdfinfo`. Repeated table headings,
wrapped bilingual names, cancelled strike-through and final-row pagination are
visible in the pages actually inspected. This is not a claim that every PDF
page was image-reviewed.

During this continuation, **all four corrected empty PDFs** from `sheet-focus`
were rendered using `pdftoppm` and actually opened:

- Arabic/light and English/light: correct empty day, clinic/date/coverage/
  saved-refresh metadata, zero counts, no shell controls, white paper.
- Arabic/dark and English/dark: same correct content, but **black page-margin
  frame**. These are not visually approved.

The earlier screen-media empty PDFs remain invalid evidence; the corrected
run resolves that fixture problem but reveals the dark-page visual defect.
Automated green status cannot override these actual images.

### Already-running live preview

Fresh Screenshot-tool capture:
`inspection/login-ready-current-360.jpg`. Actual Arabic/light 360px login form
is ready, with credential/PIN tabs, input labels, password visibility control
and sign-in action. No credential was entered. An unauthenticated `/me` 401 is
expected, not the prior identity-service 500. Owner reports successful existing
developer-only setup after explicit approval, `/api/demo/context` 200 and no
reset. This reviewer performed no DB setup/write or signed-in live checks.

## Microcopy and overlay conclusions

- English/Arabic public privacy preserve the same distinction between consent,
  local records and future sharing; “Planned” is explicit rather than a false
  active safeguard. Online withdrawal/download are disabled with clinic-based
  recovery instructions; withdrawal is explicitly not deletion.
- Doctor card says consent is recorded with the patient, not on the read-only
  card; same-name identity is not verification. “No flags” explicitly does not
  mean no clinical risk.
- KPI unavailable lookup/trial/transition measurements are not fabricated zeros.
  The adoption card explicitly avoids guessing the highlighted clinic.
- Registration required fields/error summary offer a specific recovery; guardian
  recording explicitly does not record consent or enable sharing.
- The empty doctor list, no eligible duplicate pairs, private-cache lock, HTTP
  error and permission denial are distinct rather than all rendered “empty”.
  Synthetic names and fixture timestamps are not represented as production data.
- Corrected 360px doctor edit actions are clear of bottom navigation; 768px
  clinical-card final content clears it. Long full-page originals may show a
  fixed nav intersecting an intermediate document location. Such a capture
  alone is not a persistent obstruction: existing `.shell-main` bottom padding
  reserves 96px plus safe area. Native actual-window bottom samples additionally
  confirm reachable final content, rather than relying on screenshot filenames.

## Scope and integrity

No UI/backend/auth/Canvas source was changed by this reviewer; only the new
supplementary evidence utilities/config/spec and these two review documents.
Existing application signer and unchanged browser nonce verification authorize
the isolated synthetic cache; no permit bypass, manual private IDB seeding or
live API fallback. Completed request-safety attachments report zero API mutation
attempts. No credentials, reset/copy jobs or operational DB writes.

Existing unchanged queue/booking/import state-machine tests were consulted, not
rerun or counted as new visual evidence. Their mutation branches do not require
real DB writes to complete this bounded presentation review. Physical printers,
screen-reader certification, additional browser/phone certification, 400% zoom
and exhaustive every-string/every-state re-certification are not newly imposed
completion criteria. The **one concrete current blocker is the dark PDF frame**.
