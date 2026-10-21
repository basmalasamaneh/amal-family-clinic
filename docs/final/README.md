# Amal Network — non-production final handoff

Prepared 2026-10-21. **The owner does not want this project published.**
Publication, production provisioning, production URLs and deployed verification
are excluded. This is not release approval. A development preview is not a
published demo.

## Handoff index

- [Assumptions, stakeholders and delivered scope](scope.md)
- [KPI evidence and limitations](kpis.md)
- [Five-minute presentation and preflight](script.md)
- [Rehearsal readiness and actual observations](rehearsal.md)
- [Original assumptions A1–A10 and success targets S1–S4](../assumptions.md)
- [Demo environment handoff](../DEMO.md): use its **Status — 2026-10-21**
  section, which supersedes earlier publication-gate text.
- [Development access and scenario recipes](../data/operational-demo.md):
  development-only accounts; never copy credentials, PINs or device tokens
  into presentation material. Reserved production secrets are not demo access.
- [Authentication and trusted-device rules](../auth-security.md)
- [Quality evidence and remaining limitations](../testing/bug-bash.md)
- [Security evidence](../security-review.md)

## Current acceptance

**Complete as a documentation-only handoff, by explicit owner choice.** After
reading the unsuccessful preflight result, the owner selected: “Complete the
documentation-only handoff; exclude successful rehearsal.” A successful
five-minute rehearsal and its prerequisite repairs are therefore excluded from
this handoff's acceptance, alongside all publication and production work.
The failures below remain unresolved; this scope decision is not a test pass.

The documentation identifies implemented capabilities and upstream evidence; it
does not certify a successful eight-scene, five-minute run. The script's segment
budgets are a plan, not measurements. See the rehearsal record for actual status.

Read-only readiness checks on 2026-10-21:

- `pnpm --filter @workspace/scripts seed:verify` passed every cell of all six
  source tables, Q01–Q12, two verification-only reruns, timezone invariance and
  immutable-source protections.
- `pnpm --filter @workspace/scripts demo:recipes` succeeded and reported
  **notExecuted**. It produced scenario inputs, not completed bookings/imports.
- Reem's receiving clinic is currently Lite; Clinical access requires an
  explicit authorized Full choice, independently of patient consent.
- Adoption results configuration has null trial/result clinic mappings.
  Do not infer these mappings from names or row order.
- The existing outage recipe includes historical dates outside the current
  next-14-day cache horizon. It is not a ready-to-run offline fixture.

No reset, migration, population, seed modification or production operation was
performed for this handoff. Do not silently resolve readiness gaps by changing
another feature or by using unrestricted administrative SQL.
