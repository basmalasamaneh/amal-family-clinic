---
name: Deployment guard environment
description: Distinguish published application execution from platform infrastructure environment.
---

Do not use REPLIT_ENVIRONMENT=production to identify a published app.

**Why:** It was present in this development task workspace and incorrectly
blocked demo-only validation. Official Replit documentation identifies
REPLIT_DEPLOYMENT=1 as the published-project execution indicator.

**How to apply:** Keep explicit demo opt-in and NODE_ENV production checks;
use the documented deployment indicator for published execution. Never assume
CLI guards make an administrator-selected database connection safe.
