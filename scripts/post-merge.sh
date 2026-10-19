#!/bin/bash
set -e
pnpm install --frozen-lockfile
uv sync --frozen
# Initial load only on an entirely absent six-table seed set; otherwise verification.
# Do not run schema-push or a reset against immutable workbook tables.
pnpm --filter @workspace/scripts seed:import --initialize
pnpm --filter @workspace/scripts seed:verify
