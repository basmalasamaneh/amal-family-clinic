# Deterministic source-note flags — dictionary 1.0.0

These are **unconfirmed source-note mentions**, not diagnoses, a current medication
list, severity, medical advice, or comprehensive clinical coverage. No AI, external
service, seed mutation, name matching or sharing permission is involved.

## Rules and evidence

`dictionary.ts` is the versioned English/Arabic dictionary and bilingual resource
bundle. Stable IDs survive dictionary revisions. Version changes accompany every
matching, suppression or parameter change. Supported medication names: amlodipine,
metformin, insulin; explicit allergies: penicillin, latex; condition mentions:
diabetes, asthma, hypertension. Generic antibiotics never imply allergy.

Matching uses NFKC, case folding, Arabic alef/ya variants, diacritic/tatweel
removal and Arabic-Indic digits. Unicode letter/number/underscore boundaries
prevent substring matches. Source text is never normalized in storage.
Evidence is the original trimmed clause; offsets are zero-based UTF-16 indexes,
end-exclusive, into the operational note (JavaScript `slice`). Decimal points do
not break doses. Each stable rule emits at most one flag per visit, using the first
eligible mention. Dose number and unit must immediately follow the explicit
medicine name. No dose is supplied by default. A blood-pressure label requires
the explicit phrase in the same clause; amlodipine alone does not imply hypertension.

Negation, uncertainty, hypotheticals, screening and family-subject words suppress
the entire clause, even when that discards a true positive. Semicolons, newlines,
sentence periods and terminal punctuation delimit clauses; conjunctions and commas
do not reset suppression. Allergies require an immediately preceding allergy
phrase, not merely a drug name. Question clauses are excluded.

Unsupported: general Arabic morphology/dialects, transliteration, typos,
abbreviations outside the listed dictionary, indirect speech, pronouns referring
to a family member in another sentence, complex scope across sentences, tabular
lists, arbitrary dose formats, and exhaustive clinical vocabulary. Coverage must
never be presented as complete or validated for clinical decision-making.

## Operation and ownership

After the existing consent migration, apply `pnpm --filter @workspace/api-server
alerts:migrate`. Run `pnpm --filter @workspace/api-server alerts:extract --visit 31`
for one visit, or `alerts:extract --backfill 0 100` for a bounded page. Resume with
the returned `nextCursor` until null. Maximum page size is 500. `--initialize`
processes 100-row pages up to a captured maximum visit ID; setup invokes it after
migration. The `demo:populate` / `demo:reset` command wrappers compose the unchanged
demo implementations with this extraction step. They require installed consent
prerequisites and retain the existing `--demo` and deployment guards.
These are internal
operator/service entry points, not public HTTP routes. They disclose only counts
and cursors and log no source text. Exported `extractVisit` is the per-visit entry
point for future operational writers; there is currently no note-edit API to hook.

A row lock serializes concurrent extraction and note edits. Reconciliation deletes
and replaces only rows with `extractor_rule_id`, in one transaction. The explicitly
designated old demo fixture is adopted only when its fixture key, kind, legacy
label and original amlodipine evidence match; no patient/clinic ID or name branches.
Its fixture key transfers to the generated result and persists on re-extraction,
so later demo population cannot insert a second legacy chip.
Unrelated/manual alerts remain untouched. The database invalidates derived rows
within note edits, so an edit cannot expose obsolete generated evidence before
the next extraction. New manual evidence must be verbatim at write time; retained
manual evidence is historical and is not silently rewritten on subsequent edits.
Existing seed/clinical composite foreign keys and runtime restrictions remain.

The source visit date stays a date. UTC instants already normalized upstream are
not re-converted. The existing network projection retains its documented
Asia/Hebron start-of-day UTC representation for date-only legacy visits; the new
`sourceVisitDate` preserves the actual date without pretending a time is known.

## Consumer contract (no screen in this task)

The existing audited `/api/network/lookup` returns `visits[].alerts` **only** in
Clinical projections under the existing doctor/consent/Full-network policy.
Basic omits both flags and excerpts. Reception/admin cannot read this endpoint.
Withdrawal is ordered with reads using existing database locks; no-store and
durable disclosure auditing are unchanged. `keyAlerts` remains a deprecated
compatibility list; consumers must not render it as stand-alone clinical chips.

Each `AlertChip` includes category, translation key/parameters, English label,
stable rule/version (null for manual), verbatim evidence, source visit/patient/
clinic metadata and source date. Always show the **untranslated excerpt visibly
adjacent** to its chip and `alerts.unconfirmed`, not only in a tooltip.
When `crossClinicDisclaimerKey` is non-null, show:

* English: **Flag from another clinic: confirm with the patient**
* Arabic: **تنبيه من عيادة أخرى: تأكد من المريض**

Import/copy the bilingual resource bundle without translating source data.
Use Arabic RTL / English LTR, logical CSS (`margin-inline`, `padding-inline`,
`text-align: start`), Light/Dark tokens and readable contrast. Isolate excerpts
with `dir="auto"` and medicine/dose parameters with bidirectional isolation.
Medication parameters preserve an explicitly present name and dose, not current
use. Empty results mean “no supported mention extracted”, never “no conditions”.
Error keys have both translations; never render raw database exceptions.
