#!/bin/bash
set -e
pnpm install --frozen-lockfile
uv sync --frozen
# Initial load only on an entirely absent six-table seed set; otherwise verification.
# Do not run schema-push or a reset against immutable workbook tables.
pnpm --filter @workspace/scripts seed:import --initialize
pnpm --filter @workspace/scripts seed:verify
# Additive operational migration only. Synthetic demo accounts are opt-in;
# never populate or reset them automatically during merge/deployment.
pnpm --filter @workspace/scripts operational:migrate
pnpm --filter @workspace/api-server auth:migrate
pnpm --filter @workspace/api-server appointments:migrate
pnpm --filter @workspace/api-server patients:migrate
pnpm --filter @workspace/api-server consent:migrate
pnpm --filter @workspace/api-server alerts:migrate
pnpm --filter @workspace/api-server alerts:extract --initialize
pnpm --filter @workspace/api-server imports:migrate
pnpm --filter @workspace/api-server merge:migrate
pnpm --filter @workspace/api-server sync:migrate
