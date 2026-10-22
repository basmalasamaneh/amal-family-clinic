---
name: Test browser environment
description: NixOS browser dependency boundary and screenshot portability.
---

Mocked visual checks must satisfy application bootstrap requests as well as the
page's data requests.

**Why:** Legacy admin fixtures intercepted all unknown APIs with 503, preventing
the demo-context bootstrap from ever reaching the shell. A selector timeout was
therefore not evidence of a layout regression.

**How to apply:** Inspect failed request paths before changing UI or test
assertions. Supply an explicit disabled demo context for isolated visual checks,
without changing real demo state or production transport behavior.

Native browser zoom screenshots need a virtual display large enough to contain
the whole browser window. DevTools full-page captures may omit composited text;
use actual foreground-window captures before diagnosing apparent clipping.

**Why:** At genuine 200% zoom, a smaller virtual display clipped the capture
even though layout measurements passed; resizing the display exposed the intact UI.

**How to apply:** Verify browser/display geometry and capture method before
changing responsive CSS based on a zoom screenshot alone.

Use a Nix-wrapped Chromium for browser tests in Replit; Playwright's downloaded
Linux executable may install successfully but fail to launch because native
shared libraries are not on its search path.

For actual Orca checks, a Nix AT-SPI launcher may reference a nonexistent
system dbus-daemon even when D-Bus is installed. A private bus started with the
installed daemon, exported through `AT_SPI_BUS_ADDRESS`, and an explicitly
started registry can supply the real accessibility service.

**Why:** The default session config and compiled launcher paths did not exist
in the task container; direct private-bus startup produced real reader events.

**How to apply:** Verify actual Orca announcement output, not just a browser
accessibility tree. Keep temporary buses/displays isolated, clean them up, and
distinguish reader synthesis requests from human listening.

**Why:** Browser download success does not establish runtime compatibility on
NixOS. Baselines made with a wrapped browser also depend on its version and fonts.

**How to apply:** Keep browser selection explicit/documented and review screenshot
baselines when changing the browser/OS/font environment. Do not treat resulting
pixel differences as automatic product regressions or blindly accept updates.

Chromium can report `navigator.onLine === true` after a service-worker-served
reload even while network requests remain disconnected.

**Why:** The offline booking test observed this with genuine context offline
emulation and reproduced it without axe; uncached requests still failed.

**How to apply:** Prove offline reload with a service-worker response and an
uncached failing network probe. Do not fake navigator or weaken application
authorization to satisfy the browser signal.

Do not reconnect a context while a second CDP session still owns network
emulation. Detach the extra session before `context.setOffline(false)`.

**Why:** Competing emulator state prevented a genuine reconnect event from
restarting automatic delivery during live PWA verification.

**How to apply:** Use the extra CDP session only to restore the offline signal
after a worker-served navigation; let the context own reconnect.
