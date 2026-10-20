import { useCallback, useEffect, useRef, useState } from 'react';
import { CONSENT_CHANGED_EVENT, REVALIDATE_MS, classifyFailure, isAbortError, type Failure } from '@/network/model';
import { createGate, fetchThrough } from './model';
import { clinicalDataBlocked } from '@/network/consent-invalidation';

type Item<P> = P extends { items: (infer I)[] } ? I : never;
export type Paged<P> =
  | { kind: 'loading'; pages: number }
  | { kind: 'fail'; why: Failure }
  | { kind: 'ok'; first: P; items: Item<P>[]; nextCursor: string | null; pages: number; capped: boolean };

/** Shared refresh triggers: focus, visible, consent change and interval refresh; hidden drops data. */
function useRefreshTriggers(load: () => void, drop: () => void) {
  useEffect(() => {
    const fresh = () => load();
    const onVis = () => { if (document.visibilityState === 'hidden') drop(); else load(); };
    const tick = setInterval(() => { if (document.visibilityState === 'visible') load(); }, REVALIDATE_MS);
    window.addEventListener('focus', fresh);
    document.addEventListener('visibilitychange', onVis);
    document.addEventListener(CONSENT_CHANGED_EVENT, fresh);
    return () => { clearInterval(tick); window.removeEventListener('focus', fresh); document.removeEventListener('visibilitychange', onVis); document.removeEventListener(CONSENT_CHANGED_EVENT, fresh); };
  }, [load, drop]);
}

/**
 * Memory-only, cancellable, cursor-paged protected read. Every load (including "load more") clears all
 * shown payloads first and re-reads page 1 through the requested page as one fresh bounded sequence;
 * old cursors and data are never reused, and failures never restore earlier success.
 */
export function useProtectedPages<P extends { items: { id: number }[]; nextCursor: string | null }>(
  key: string,
  fetchPage: (cursor: string | undefined, signal: AbortSignal) => Promise<P>,
  maxPages: number,
) {
  const [state, setState] = useState<Paged<P>>({ kind: 'loading', pages: 1 });
  const gate = useRef(createGate());
  const ctl = useRef<AbortController | null>(null);
  const fetchRef = useRef(fetchPage); fetchRef.current = fetchPage;
  const pagesRef = useRef(1);

  const run = useCallback((target: number) => {
    ctl.current?.abort();
    const tok = gate.current.begin();
    const ac = new AbortController(); ctl.current = ac;
    pagesRef.current = target;
    setState({ kind: 'loading', pages: target });
    if (clinicalDataBlocked()) return;
    fetchThrough(fetchRef.current, target, maxPages, ac.signal).then(
      (r) => {
        if (!gate.current.isCurrent(tok) || clinicalDataBlocked()) return;
        pagesRef.current = r.pages;
        setState({ kind: 'ok', first: r.first, items: r.items as Item<P>[], nextCursor: r.nextCursor, pages: r.pages, capped: r.capped });
      },
      (e) => { if (gate.current.isCurrent(tok) && !isAbortError(e)) setState({ kind: 'fail', why: classifyFailure(e) }); },
    );
  }, [maxPages]);

  const reload = useCallback(() => run(1), [run]);
  /** Refreshes keep the number of pages the user asked for, re-read from scratch. */
  const refresh = useCallback(() => run(pagesRef.current), [run]);
  const loadMore = useCallback(() => run(pagesRef.current + 1), [run]);
  const drop = useCallback(() => { ctl.current?.abort(); gate.current.invalidate(); setState({ kind: 'loading', pages: pagesRef.current }); }, []);

  useEffect(() => {
    run(1);
    const g = gate.current;
    return () => { ctl.current?.abort(); g.invalidate(); };
  }, [key, run]);
  useRefreshTriggers(refresh, drop);

  return { state, reload, loadMore };
}

export type Single<T> = { kind: 'loading' } | { kind: 'fail'; why: Failure } | { kind: 'ok'; data: T };

/** Single protected read with the same lifecycle, including interval revalidation. */
export function useProtected<T>(key: string, fetchOne: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<Single<T>>({ kind: 'loading' });
  const gate = useRef(createGate());
  const ctl = useRef<AbortController | null>(null);
  const fetchRef = useRef(fetchOne); fetchRef.current = fetchOne;
  const load = useCallback(() => {
    ctl.current?.abort();
    const tok = gate.current.begin();
    const ac = new AbortController(); ctl.current = ac;
    setState({ kind: 'loading' });
    if (clinicalDataBlocked()) return;
    fetchRef.current(ac.signal).then(
      (data) => { if (gate.current.isCurrent(tok) && !clinicalDataBlocked()) setState({ kind: 'ok', data }); },
      (e) => { if (gate.current.isCurrent(tok) && !isAbortError(e)) setState({ kind: 'fail', why: classifyFailure(e) }); },
    );
  }, []);
  const drop = useCallback(() => { ctl.current?.abort(); gate.current.invalidate(); setState({ kind: 'loading' }); }, []);
  useEffect(() => { load(); const g = gate.current; return () => { ctl.current?.abort(); g.invalidate(); }; }, [key, load]);
  useRefreshTriggers(load, drop);
  return { state, reload: load };
}
