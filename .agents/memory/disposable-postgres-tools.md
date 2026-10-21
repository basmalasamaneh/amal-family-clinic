---
name: Disposable PostgreSQL tool environment
description: A libpq environment quirk affecting isolated test setup.
---

In this workspace's PostgreSQL tooling, a full URI assigned to `PGDATABASE` was treated as a literal database name rather than a connection URI. Use parsed connection environment fields for schema-only tooling, without printing credentials.

**Why:** An isolated test bootstrap failed before connecting even though the same URL worked with the Node PostgreSQL client. Repeated setup attempts must not be mistaken for missing application prerequisites.

**How to apply:** When invoking PostgreSQL command-line tools from Node, distinguish libpq environment parsing from the application's connection-string parser. Keep source reads separate from disposable-target administration.

Isolated suites must choose their application mode deliberately rather than
inherit optional workspace feature flags.

**Why:** A workspace enabled developer demo admission, which requires generation
state and request headers. A schema-only ordinary privacy fixture then failed
broadly before reaching the authorization behavior it intended to test. Those
failures were not evidence that ordinary authorization had regressed.

**How to apply:** Keep ordinary authorization and demo-generation coverage
explicitly separate. Do not disable a mode in product code or count tests with
the mode disabled as coverage of that mode's protections.

Production-PWA test builds must set production mode on the build subprocess
even when the API and disposable fixtures deliberately run in development mode.

**Why:** Inheriting development mode into a Vite build can omit production-only
service-worker registration despite a successful build, leaving offline tests
waiting indefinitely for worker readiness.

**How to apply:** Separate build-mode configuration from runtime safety guards;
never make the disposable fixture or API a production runtime to fix this.
