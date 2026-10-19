# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

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

- `artifacts/amal-network` serves `/ui-kit`; `/` redirects there. This is a frontend-only component showcase, not the booking application.
- `lib/amal-ui` owns shared tokens, localized components, preferences, fonts, and brand assets. Import reusable UI from `@workspace/amal-ui`.
- `pnpm run typecheck:libs` builds shared declarations before the frontend typecheck.
- `pnpm --filter @workspace/amal-network run typecheck` checks the showcase.
- `pnpm --filter @workspace/amal-ui contrast` verifies defined foreground/background pairs; `tokens` regenerates CSS from the token source.
- The existing UI-kit browser suite covers both languages and themes; its presence does not imply it was run during every implementation session.
- Preserve source brand colors; use semantic text variants for contrast. Gold is restricted to logos and illustrations.
- This UI kit does not read or modify any seed table.
