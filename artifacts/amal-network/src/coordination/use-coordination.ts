import { useCallback, useEffect, useRef, useState } from 'react';
import { reportUnauthorized } from '@/auth/session-events';
import { coordinationAccess, coordinationSnapshot } from './api';
import { mayCheckCoordination, mayShowCoordination, type CoordinationPrincipal, type CoordinationSnapshot } from './model';

type State = { accountId: string; canCoordinate: boolean; validUntil: number; status: 'loading' | 'denied' | 'error' | 'ready'; data: CoordinationSnapshot | null };
export function useCoordination(principal: CoordinationPrincipal, fixture: boolean, active: boolean) {
  const [state, setState] = useState<State | null>(null);
  const [revision, setRevision] = useState(0);
  const [online, setOnline] = useState(() => navigator.onLine);
  const current = useRef(principal); current.current = principal;
  const refresh = useCallback(() => { setState(null); setRevision(v => v + 1); }, []);
  useEffect(() => {
    const change = () => { setState(null); setOnline(navigator.onLine); setRevision(v => v + 1); };
    window.addEventListener('online', change); window.addEventListener('offline', change);
    window.addEventListener('focus', change);
    return () => { window.removeEventListener('online', change); window.removeEventListener('offline', change); window.removeEventListener('focus', change); };
  }, []);
  useEffect(() => {
    setState(null);
    if (!mayCheckCoordination(principal, online, fixture)) return;
    const controller = new AbortController();
    const accountId = principal.id;
    let timer: ReturnType<typeof setTimeout>;
    const valid = () => !controller.signal.aborted && current.current.id === accountId && mayCheckCoordination(current.current, navigator.onLine, fixture);
    void (async () => {
      try {
        const access = await coordinationAccess(controller.signal);
        if (!valid()) return;
        if (access.canCoordinate !== true) { setState({ accountId, canCoordinate: false, validUntil: 0, status: 'denied', data: null }); return; }
        const validUntil = Math.min(Date.now() + 60_000, principal.expiresAt ? Date.parse(principal.expiresAt) : Infinity);
        // Expiration clears the payload before rechecking, including background tabs.
        timer = setTimeout(refresh, Math.max(0, validUntil - Date.now()));
        setState({ accountId, canCoordinate: true, validUntil, status: active ? 'loading' : 'ready', data: null });
        if (!active) return;
        const data = await coordinationSnapshot(controller.signal);
        if (valid() && Date.now() < validUntil) setState({ accountId, canCoordinate: true, validUntil, status: 'ready', data });
      } catch (error) {
        if (!valid()) return;
        const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
        setState({ accountId, canCoordinate: false, validUntil: 0, status: status === 401 || status === 403 ? 'denied' : 'error', data: null });
        if (status === 401) reportUnauthorized();
      }
    })();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [principal.id, principal.role, principal.expiresAt, principal.offlineRestored, fixture, online, active, revision, refresh]);
  const allowed = mayShowCoordination(principal, online && navigator.onLine, fixture, state);
  const eligible = mayCheckCoordination(principal, online && navigator.onLine, fixture);
  return { allowed, data: allowed ? state?.data ?? null : null, status: !eligible ? 'denied' : state?.accountId === principal.id ? state.status : 'loading', online, refresh };
}
