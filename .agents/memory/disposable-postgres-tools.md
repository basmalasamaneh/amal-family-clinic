---
name: Disposable PostgreSQL tool environment
description: A libpq environment quirk affecting isolated test setup.
---

In this workspace's PostgreSQL tooling, a full URI assigned to `PGDATABASE` was treated as a literal database name rather than a connection URI. Use parsed connection environment fields for schema-only tooling, without printing credentials.

**Why:** An isolated test bootstrap failed before connecting even though the same URL worked with the Node PostgreSQL client. Repeated setup attempts must not be mistaken for missing application prerequisites.

**How to apply:** When invoking PostgreSQL command-line tools from Node, distinguish libpq environment parsing from the application's connection-string parser. Keep source reads separate from disposable-target administration.
