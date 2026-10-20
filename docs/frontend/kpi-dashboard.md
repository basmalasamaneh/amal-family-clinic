# KPI dashboard (P2-09) — `/admin/kpi`

Admin-only route in the existing shell (`SHELL_ROUTES` id `kpi`, roles `['admin']`). Non-admins get the shell's inherited forbidden state; a 401/403 from the API shows a localized forbidden panel and clears figures.

Code: `artifacts/amal-network/src/kpi/` — `KpiPage.tsx` (route, range/date controls, states), `charts.tsx`, `Adoption.tsx`, `ChartFrame.tsx` (shared summary + keyboard data-table toggle), `model.ts` (pure view-model), `strings.ts`/`i18n.ts` (EN/AR bundle under `kpi`), `kpi.css` (logical properties only).

## Data
`useGetKpis({ range, date? })` with `getGetKpisQueryKey(params)`. Range+date are in the query key, so a late response for an older selection lands in its own cache entry; `matchesSelection` also checks `data.range`. No placeholder/previous data and no fixture fallback. Errors show retry (auth failures never auto-retried).
- **401/403 at any time** (even with cached figures) replaces the whole dashboard with the localized forbidden panel; no figures remain visible.
- **Failed refresh with cached data** keeps the earlier figures but shows a visible alert (`state-kpi-refresh-error`) with retry, pointing to the calculation time. Figures are never stale without notice.
- Targets (`LOOKUP_TARGET_SECONDS = 10`, `LOSS_TARGET = 0` in `model.ts`) and all other numbers are interpolated and formatted with the digit preference; strings contain no literal digits (unit-checked).

## Visuals → API fields
| Visual | Source | Honesty rules |
|---|---|---|
| Grouped bar (collisions) | `before/after.metrics.clinics[].collisions` | Clinic union by ID; absent side = "not applicable", never 0. Non-additive note + network row. Unequal exposure disclosed from `comparison`. |
| Prevention line | `after.telemetry.conflicts.daily` (blocked / cumulativeBlocked) | Daily/cumulative toggle states which is shown. Missing dates are gaps and "No observation" rows. Warnings/overrides only in table, not prevention. |
| Lookup median + sparkline | `after.telemetry.lookupTime` | Always unavailable upstream: "—", samples unavailable, target < 10 s, sparkline replaced by explicit unavailable notice. |
| Lost appointments | `after.telemetry.downtime` | `lost` unavailable ≠ 0; target 0; receipt counts shown only as non-loss context. |
| Source donut | `bookingsBySource` (after/before toggle) | Five normalized keys incl. unknown; shape glyphs + counts + %; all-zero → empty state, no ring. |
| No-show bar | `after.metrics.clinics[].noShow` | null percent → unavailable; numerator/denominator shown. |
| Weekday heat strip | `after.metrics.weekdays` | API Asia/Hebron buckets, Sunday-first; levels plus printed values. Zero-denominator buckets show rate Unavailable with real 0/0 counts; buckets absent from the response are marked `missing` with null numerator/denominator, shown as Unavailable / No observation, never invented zeros. |
| Adoption stepper | `adoption` | Trial unknown ("?"), current from `state`, `joinedAt` labelled as non-transition; history unavailable. |
| Network activity table | `after.telemetry.networkActivity` | No logical lookup producer: each date in the selected window has an unavailable count, never a substitute patient/visit/result count or invented zero. |

## Upstream coverage limitations (as of this contract)
- Lookup time: no duration producer → no median, samples or daily medians.
- Client loss/queues: not observed → lost appointments unavailable.
- Network lookup activity: unavailable.
- Adoption: no Trial state, no transition history; `joinedAt` may be a bootstrap timestamp.
- **Dr. Nabil clinic designation: no upstream field or configuration exists.** `resolveDesignation` returns `unavailable`; the UI shows a localized notice and highlights nothing. No ID or name matching. Wire a real designation field into `resolveDesignation` when the API provides one.
- Scope is network-wide; the optional `clinicId` param is not exposed (no admin clinic picker in this task).

## i18n / RTL / formatting
All authored text via `kpi.*`; clinic names are data, wrapped in `<bdi>`/FSI isolates. Numbers use `Intl` with the shell digit preference. Period dates are date-only (`formatDateOnly`, inclusive end = exclusive − 1 day by calendar arithmetic); `generatedAt`/`joinedAt` instants use `formatInstant` (date-fns-tz, Asia/Hebron). Bars and heat strip follow document direction via logical CSS; the SVG time axis is mirrored in Arabic and states "Time runs right to left". Text is never mirrored.

## Checks
- `pnpm --filter @workspace/amal-network run typecheck`
- `pnpm --filter @workspace/amal-network run test:kpi:unit` (semantics, gaps, null-vs-zero, targets at 10 s / 0, weekday buckets, DST date-only, designation, string parity, no literal digits in strings, logical CSS incl. no multi-value physical shorthands, auth/refresh-error handling)
- `pnpm --filter @workspace/amal-network run test:kpi` (Playwright AR/EN × Light/Dark: charts/tables/summaries, keyboard toggles, axe, stale range race, error retry, empty, forbidden, mobile overflow).

Verification on 2026-10-20: workspace typecheck passed, 13 KPI unit tests passed, and all 16 browser cases passed. Browser checks use explicitly intercepted synthetic API responses (including the identity adapter's clinic read); they do not establish live telemetry availability. The signed-in Arabic-dark and English-light dashboard was visually checked. No data writes, schema changes, or production fixtures were introduced.

After completion feedback, added the explicit daily network-activity unavailable table and corrected empty-window detection to inspect blocked/warning/override totals rather than daily-row presence. The server supplies zero-event daily rows, which are not themselves activity. Updated regression fixtures accordingly; unit tests and workspace typecheck passed again. The earlier browser pass predates these two focused corrections.
