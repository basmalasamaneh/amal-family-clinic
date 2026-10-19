# @workspace/amal-ui

Shared design foundation for **Amal Network / شبكة أمل** (Amal Family Clinic Group).
Consumed as a workspace package — artifacts never import each other's source.

## Install / wire up

```jsonc
// artifact package.json
"@workspace/amal-ui": "workspace:*", "i18next": "...", "react-i18next": "..."
// artifact tsconfig.json → "references": [{ "path": "../../lib/amal-ui" }]
```

```ts
import '@workspace/amal-ui/styles.css';            // fonts + tokens + base + components
import { createAmalI18n, readStoredLocale, AmalPreferencesProvider, ToastProvider } from '@workspace/amal-ui';
const i18n = createAmalI18n({ ar: { translation: ar }, en: { translation: en } }, readStoredLocale());
// <AmalPreferencesProvider i18n={i18n}><ToastProvider>…</ToastProvider></AmalPreferencesProvider>
```

Add `'i18next', 'react-i18next'` to Vite `resolve.dedupe`. Optionally copy the
pre-paint snippet from `artifacts/amal-network/index.html` to avoid a theme flash.

## Tokens

- **Canonical source:** `tokens.json` (DTCG). Never edit `src/styles/tokens.css` by hand.
- Regenerate CSS: `pnpm --filter @workspace/amal-ui tokens`.
- Measure contrast: `pnpm --filter @workspace/amal-ui contrast` → `docs/contrast-report.md` (fails < 4.5:1).
- Every token becomes `--amal-<name>`; theme is selected by `[data-theme='light'|'dark']` (also `.dark`) on `<html>`.

| Group | Variables | Use |
|---|---|---|
| Raw brand (exact) | `--amal-primary`, `primary-strong`, `navy`, `bg`, `surface`, `surface-2`, `border`, `text`, `muted`, `success`, `warning`, `danger`, `info` | Fills, borders, body text. Do not put arbitrary text on `success`/`warning`/`info` fills. |
| Semantic | `on-primary`, `primary-pressed`, `primary-text`, `primary-soft`, `on-danger`, `danger-strong`, `disabled-fg/bg`, `focus-ring`, `toast-*`, `logo-island` | Accessible text/state pairings. Use `primary-text` (not `primary`) for teal text. |
| Status | `status-{booked,completed,noshow,conflict,sync,cancelled}-{fg,bg,border}` | StatusBadge only. |
| Brand gold | `--amal-gold` | **Logo and empty-state illustrations only.** Never status/action. |
| Type | `--amal-font-sans`, `--amal-text-{xs,sm,base,md,lg,xl,2xl,3xl}` = 12/14/16/18/20/24/30/38px, `--amal-text-body` 16, `--amal-text-reception` 18, `--amal-leading` 1.6 | `.amal-reception` sets 18px. |
| Radius | `--amal-radius-control` 8, `-card` 12, `-dialog` 16 | |
| Misc | `--amal-space-target` 44px, `--amal-duration-{fast,base}` | Touch targets, motion. |

IBM Plex Sans Arabic is self-hosted via `@fontsource/ibm-plex-sans-arabic` (400–700, Arabic + Latin subsets).

## Public exports (`src/index.ts`)

| Export | Notes |
|---|---|
| `createAmalI18n`, `amalUiResources`, `AMAL_UI_NS`, `AMAL_LOCALES`, `DEFAULT_LOCALE` (`ar`), `directionFor` | Component strings live in the `amalUi` namespace. |
| `AmalPreferencesProvider`, `useAmalPreferences` | Locale + theme state; updates `<html lang dir data-theme>` together and persists to `localStorage` (`amal.locale`, `amal.theme`). |
| `applyDocumentPreferences`, `readStoredLocale`, `readStoredTheme` | Low-level helpers. |
| `LanguageSwitch`, `ThemeSwitch`, `Segmented` | 44px toggle buttons with `aria-pressed`, localized group names. |
| `Button` | `variant` primary/secondary/ghost/danger, `size` sm/md/lg, `loading`, `startIcon`/`endIcon`, `iconOnly` (needs `aria-label`). |
| `TextField` | Always-visible label, `hint`, `error` (aria-invalid + describedby), `required`, `showOptional`. |
| `Card`, `CardHeader`, `CardBody`, `CardFooter` | `tone` surface/muted. |
| `StatusBadge`, `APPOINTMENT_STATUSES` | Six states: icon + colour + localized label. |
| `EmptyState`, `EmptyIllustration` | Always pass `actions`. |
| `ToastProvider`, `useToast` | `show({title, description, tone, action, duration})`; polite region, `role="alert"` for warning/danger, pauses on hover/focus. |
| `AmalLogo`, `AmalMark` | Inline renderings of the canonical SVGs so the wordmark uses the loaded font; localized `aria-label`; white island in dark theme. |

## Assets

`assets/amal-logo-mark.svg` (favicon) and `assets/amal-logo-horizontal.svg` — canonical,
unmodified copies of the supplied artwork (originals retained in `attached_assets/` and
`docs/references/logos/`). Importable as `@workspace/amal-ui/assets/<file>`.

See `docs/inventory.md` for the component inventory and `docs/contrast-report.md` for measured pairings.
