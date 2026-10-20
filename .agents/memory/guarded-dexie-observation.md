---
name: Guarded Dexie observation
description: Reactive reads must respect the controller's transaction boundary
---
Do not wrap authorized controller reads in Dexie `liveQuery` when the controller
uses read-write transactions for lifecycle validation.

**Why:** Dexie rejects read-write transactions inside liveQuery, turning valid
authorized queue reads into an unavailable state.

**How to apply:** Observe committed storage mutations and perform ordinary
ticket-guarded reads, discarding stale asynchronous results. Context invalidation
and successful storage-ready grants are distinct notifications; subscribe to
both when a component may mount before authorization is granted.
