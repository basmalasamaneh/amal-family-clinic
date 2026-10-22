import { createContext, Fragment, useContext, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { localCache } from '@/offline';
import { createPatientSearchHandoff } from './patient-search-handoff';

const Context = createContext<ReturnType<typeof createPatientSearchHandoff> | null>(null);
const empty = { revision: 0, request: null };
const emptySnapshot = () => empty;
const noSubscribe = () => () => {};

/** Keyed by the shell's identity/role/clinic/authorization mode. Auth loss unmounts it.
 * Cache revocation synchronously clears the mailbox and resets consumers, including drafts.
 * No second search API, result cache, persistence or query-bearing navigation is introduced.
 */
export function PatientSearchProvider({ role, fixture, children }: { role: string | null; fixture: boolean; children: ReactNode }) {
  const [store] = useState(() => createPatientSearchHandoff(role));
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useLayoutEffect(() => {
    const unsubscribe = fixture ? () => {} : localCache.subscribeContext(store.clear);
    return () => { unsubscribe(); store.clear(); };
  }, [store, fixture]);
  return <Context.Provider value={store}><Fragment key={snapshot.revision}>{children}</Fragment></Context.Provider>;
}

export function usePatientSearchHandoff() {
  const store = useContext(Context);
  const snapshot = useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.getSnapshot ?? emptySnapshot, store?.getSnapshot ?? emptySnapshot);
  return { store, request: snapshot.request };
}

/** Consume once into page-local state. Leaving the page releases the query; returning
 * to a doctor card/search continues to use the existing scoped selection mechanism.
 */
export function usePatientSearchRequest() {
  const { store, request } = usePatientSearchHandoff();
  const [received, setReceived] = useState(request);
  useLayoutEffect(() => {
    if (!request) return;
    setReceived(request);
    store?.acknowledge(request.id);
  }, [store, request]);
  return request ?? received;
}
