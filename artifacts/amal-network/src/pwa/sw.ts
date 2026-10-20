import { setCacheNameDetails } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { isAppDocument } from './navigation';

// Keep the worker's build separate from DOM typings used by the React app.
declare const self: {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
  registration: { scope: string };
};

const base = new URL(self.registration.scope);
// Scope-specific names avoid collisions when more than one Amal mount shares an origin.
setCacheNameDetails({ prefix: 'amal-public-shell', suffix: base.pathname, precache: 'precache-v1' });
cleanupOutdatedCaches();

// Build outputs only: no runtime caching, API strategies, background sync or credentials.
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(
  ({ request, url }) => isAppDocument(request, url, base),
  createHandlerBoundToURL(`${base.pathname}index.html`),
);

// Deliberately no skipWaiting(), clientsClaim(), message-triggered activation or reload.
// A new version waits until every tab controlled by the old worker has closed.
