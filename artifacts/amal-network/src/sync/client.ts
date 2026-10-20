import { getSyncState, pushSync, pullSync, listSyncConflicts, resolveSync } from '@workspace/api-client-react';
import { localCache } from '../offline';
import { reportUnauthorized } from '../auth/session-events';
import { SyncRunner, browserQueueLock } from './runner';

export const syncClient = new SyncRunner(localCache, {
  state: signal => getSyncState({ signal }),
  push: (operations, signal) => pushSync({ operations }, { signal }),
  pull: (since, signal) => pullSync(since ? { since } : {}, { signal }),
  conflicts: (cursor, signal) => listSyncConflicts({ status: 'all', limit: 100, ...(cursor ? { cursor } : {}) }, { signal }),
  resolve: (input, signal) => resolveSync(input, { signal }),
}, browserQueueLock, () => navigator.onLine, reportUnauthorized,
() => window.dispatchEvent(new CustomEvent('amal:appointments-changed')));

// Wake other tabs without private information. The server and scoped IDB tickets
// remain authoritative; this pulse grants neither identity nor API reachability.
let channel: BroadcastChannel | null = null;
try {
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('amal-sync-wakeup');
    channel.onmessage = () => syncClient.refresh();
  }
} catch { /* Polling and in-tab events still deliver work. */ }
export function wakeSync() {
  syncClient.refresh();
  try { channel?.postMessage('wake'); } catch { /* optional pulse */ }
}
