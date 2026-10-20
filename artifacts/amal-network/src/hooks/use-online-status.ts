import { useSyncExternalStore } from 'react';

/** Browser connectivity only: not API reachability, authorization or sync status. */
export function browserOnline(): boolean {
  return typeof navigator === 'undefined' ? false : navigator.onLine;
}

export function subscribeOnlineStatus(notify: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  return () => {
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
  };
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribeOnlineStatus, browserOnline, () => false);
}
