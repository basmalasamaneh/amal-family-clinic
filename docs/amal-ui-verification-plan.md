# Amal UI kit verification

This is a frontend-only design foundation. Verification must never read or write clinical tables, call clinical APIs, or mutate seed data.

## Required matrix

For Arabic/RTL and English/LTR, each in Light and Dark:

- Load `/ui-kit` directly, refresh, switch preferences with keyboard-operable controls.
- Confirm six localized status labels with their specified icons.
- Exercise local input validation, button feedback, toast announcements/dismissal, and the empty-state action.
- Check desktop and narrow mobile layouts, document language/direction, font loading, logo visibility, focus, touch targets, and reduced-motion behavior.
- Run axe and measure text contrast separately, including semantic status, muted, placeholder, disabled, hover, active and focus presentations.

## Boundaries

These examples are not clinical workflows. There is no login, booking, consent, database integration, or synchronization implementation in this deliverable. The existing API and Canvas remain independent.

## Results — 2026-10-18

- `pnpm run typecheck`: passed across shared libraries, Amal, API, Canvas and scripts.
- `pnpm --filter @workspace/amal-network test:ui-kit`: four test cases passed (Arabic/English × Light/Dark).
- Each case runs axe WCAG A/AA checks at 1280px and 390px with the actionable alert toast visible: eight scans, zero violations.
- Covered direct `/ui-kit` load and refresh, persisted preferences, all six localized icon badges, document `lang`/`dir`, self-hosted font availability and inline logo typography, mark asset response, input validation/focus, loading feedback, toast announcement/action, empty-state add/remove, no horizontal overflow, ≥44px controls, keyboard activation/focus, reduced motion, and no page errors.
- Explicit numeric token contrast is recorded separately in `lib/amal-ui/docs/contrast-report.md`, including interaction/disabled/error/status pairings and focus-indicator contrast.
- A preview screenshot confirmed the Arabic desktop presentation and legible horizontal logo. Browser checks use the installed Chromium where present; other environments can install the Playwright Chromium browser.

These checks cover this UI kit, not future clinical journeys, assistive-technology user testing, or every browser engine. Tests require the managed Amal workflow to be running; they do not start a second server.
