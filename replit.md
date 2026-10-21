# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `AMAL_OFFLINE_E2E=1 AMAL_BOOKING_DISPOSABLE=1 pnpm test:offline` — live offline/reconnect/retry suite; see `docs/testing/offline-live.md` for required development prerequisites and safety boundaries
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/scripts operational:migrate` — apply tracked, additive operational SQL; schema push is disabled to protect seed/trigger contracts
- `pnpm --filter @workspace/scripts demo:populate --demo` — opt-in synthetic demo accounts/data, development only
- `docs/data/operational-demo.md` — schema mapping, exact fixture counts, guarded reset and scenario recipes
- Required env: `DATABASE_URL` — Postgres connection string

### Simulated reminders

- Apply only the additive migration with `pnpm --filter @workspace/api-server reminders:migrate`; it changes operational tables only and performs no appointment backfill. Never run foundation bootstrap/reset to enable reminders.
- Clinic `reminders_enabled` defaults to false; patient-wide `reminder_opt_out` defaults to false, independently of clinical-sharing consent. Tests explicitly enable their disposable clinic. Disable/opt-out cancels pending history; re-enable affects subsequent bookings/moves only. Identity merge preserves either patient's opt-out.
- The API process runs a sequential 15-second simulator dispatcher, retrying safely if reminder schema is not yet installed. There is no provider, credential lookup, address payload or outbound messaging. Each bilingual record represents one simulated delivery.
- Booking/move/cancel, preference changes and dispatch share scheduling transaction lock `761910`. The worker first obtains shared reset-admission lock `761930`, then scheduling lock, then row locks. A cancellation/opt-out committed first prevents dispatch; a committed simulated send remains history. Receipt and simulated status commit together, with no externally visible simulator effect before commit.
- Schedule identity is `(appointment_id, schedule_version, offset_hours)`, separate from generic appointment revision. A real schedule change increments identity; replay does not. UTC offsets are 24/2 elapsed hours; missed windows become cancelled without catch-up, and nothing sends at/after appointment start. AR/EN snapshots format the instant in Asia/Hebron via date-fns-tz.
- Restart-late policy: the 24-hour reminder expires when the 2-hour window arrives. An overdue 24-hour record is cancelled with `missed_window`, even across separate worker batches/restarts; only the latest relevant 2-hour reminder may simulate delivery before appointment start. At/after start both are cancelled. This prevents a recovery catch-up burst.
- `pnpm --filter @workspace/api-server reminders:test` runs focused simulator/privacy/lifecycle coverage. Persisted statuses remain `pending`, `simulated`, `cancelled`; the UI labels them scheduled, sent (simulated), cancelled.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

## Amal UI foundation

- `artifacts/amal-network` retains `/ui-kit`; `/` now opens the session-aware role shell. Clinical destinations are localized placeholders, not implemented workflows.
- `lib/amal-ui` owns shared tokens, localized components, preferences, fonts, and brand assets. Import reusable UI from `@workspace/amal-ui`.
- `pnpm run typecheck:libs` builds shared declarations before the frontend typecheck.
- `pnpm --filter @workspace/amal-network run typecheck` checks the showcase.
- `pnpm --filter @workspace/amal-ui contrast` verifies defined foreground/background pairs; `tokens` regenerates CSS from the token source.
- The existing UI-kit browser suite covers both languages and themes; its presence does not imply it was run during every implementation session.
- Preserve source brand colors; use semantic text variants for contrast. Gold is restricted to logos and illustrations.
- This UI kit does not read or modify any seed table.

## Amal shell boundaries

- `docs/frontend/app-shell.md` describes real identity integration, explicit development fixtures, display persistence and verification commands.
- Client routing is presentation-only; it does not grant server permission. Admin routes never grant clinical access.
- Keep development fixture identity opt-in and separate from real sessions. Do not silently replace missing clinic or session endpoints with synthetic data.
- Browser account display settings deliberately do not inherit the anonymous UI-kit preferences or server profile defaults. First use is Arabic, Light and Latin digits. Profile synchronization needs a future supported contract.
