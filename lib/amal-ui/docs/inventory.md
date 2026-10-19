# Amal UI — inventory (P2-00)

Source of truth: task P2-00 specification + supplied SVGs (`docs/references/logos/`).

| Family | File | States covered |
|---|---|---|
| Button | src/components/Button.tsx | default, hover, pressed, focus-visible, loading, disabled; 4 variants; sm/md/lg; icon-only |
| TextField | src/components/TextField.tsx | default, hover, focus, placeholder, error, disabled, required/optional, hint |
| Card | src/components/Card.tsx | surface, muted |
| StatusBadge | src/components/StatusBadge.tsx | booked (clock/blue), completed (check/green), noshow (user-x/grey-red), conflict (alert-triangle/red), sync (cloud-upload/amber), cancelled (x/grey) |
| Toast | src/components/Toast.tsx | info, success, warning, danger; action; dismiss; auto-dismiss with pause |
| EmptyState | src/components/EmptyState.tsx | with illustration + actions |
| LanguageSwitch / ThemeSwitch | src/components/PreferenceControls.tsx | ar/en, light/dark |
| Logo | src/components/Logo.tsx | mark, horizontal with theme-aware lettering and transparent background |

Out of scope (later tasks): dialogs, drawers, search, tables, sync queue, charts, consent, app shell.
