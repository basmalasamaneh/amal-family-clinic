---
name: Test browser environment
description: NixOS browser dependency boundary and screenshot portability.
---

Use a Nix-wrapped Chromium for browser tests in Replit; Playwright's downloaded
Linux executable may install successfully but fail to launch because native
shared libraries are not on its search path.

**Why:** Browser download success does not establish runtime compatibility on
NixOS. Baselines made with a wrapped browser also depend on its version and fonts.

**How to apply:** Keep browser selection explicit/documented and review screenshot
baselines when changing the browser/OS/font environment. Do not treat resulting
pixel differences as automatic product regressions or blindly accept updates.
