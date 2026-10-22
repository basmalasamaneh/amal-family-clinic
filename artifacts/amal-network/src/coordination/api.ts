import { getNetworkCoordinationAccess, getNetworkCoordination } from '@workspace/api-client-react';

// Generated helpers use shared base-URL and authenticated customFetch transport.
// Keep these sensitive responses out of persisted/offline/query caches.
export const coordinationAccess = (signal: AbortSignal) =>
  getNetworkCoordinationAccess({ signal, cache: 'no-store', credentials: 'include' });
export const coordinationSnapshot = (signal: AbortSignal) =>
  getNetworkCoordination({ signal, cache: 'no-store', credentials: 'include' });
