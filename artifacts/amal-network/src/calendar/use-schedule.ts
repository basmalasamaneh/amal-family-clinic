import { useCallback, useEffect, useRef, useState } from 'react';
import type { CalendarAppointment, CalendarDoctor, ClinicHours, SchedulingReadAdapter } from './adapter';
import type { CacheMetadata } from '../offline/types';
import { coversCalendarRange, mergeLocalCalendar } from './local-schedule';

export type Load<T> = { state: 'loading' } | { state: 'error'; error: unknown } | { state: 'ready'; data: T };
export interface Schedule {
  doctors: CalendarDoctor[]; appointments: CalendarAppointment[]; hours: ClinicHours | null;
  localCache?: { metadata: CacheMetadata | null; refreshFailed: boolean; incomplete: boolean };
}

/** Creates a guard so only the latest request for a scope may commit results. */
export function createLatestGuard() {
  let current = 0;
  return { next: () => ++current, isCurrent: (id: number) => id === current };
}

/**
 * Loads doctors, hours and appointments for one clinic/range scope. Scope changes clear
 * previous results immediately and abort in-flight requests; late responses are discarded.
 */
export function useSchedule(adapter: SchedulingReadAdapter, clinicId: number | null, from: string, to: string): { load: Load<Schedule>; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const scope = `${clinicId}|${from}|${to}|${attempt}`;
  const [result, setResult] = useState<{ scope: string; adapter: SchedulingReadAdapter; load: Load<Schedule> } | null>(null);
  const load: Load<Schedule> = result?.scope === scope && result.adapter === adapter ? result.load : { state: 'loading' };
  const guard = useRef(createLatestGuard());
  useEffect(() => {
    const id = guard.current.next();
    const setLoad = (next: Load<Schedule>) => setResult({ scope, adapter, load: next });
    setLoad({ state: 'loading' });
    if (clinicId === null) return;
    const ctl = new AbortController();
    let unsubscribe = () => {};
    (async () => {
      try {
        let reader = adapter;
        let localState: Schedule['localCache'];
        let bridge: typeof import('../offline/booking-bridge') | undefined;
        if (adapter.mode === 'real') {
          // Lazy import keeps fixture behavior and pure calendar helpers independent of storage.
          const [loaded, { localCache }] = await Promise.all([import('../offline/booking-bridge'), import('../offline')]);
          bridge = loaded;
          if (ctl.signal.aborted) return;
          let authorized = false;
          unsubscribe = localCache.subscribeContext(() => {
            if (!authorized) return;
            ctl.abort();
            if (guard.current.isCurrent(id)) setLoad({ state: 'error', error: new Error('Local booking context invalidated') });
          });
          let refreshFailed = false;
          if (navigator.onLine) {
            try { await bridge.prepareBookingCache(); } catch { refreshFailed = true; }
          }
          const snapshot = await bridge.getBookingSnapshot();
          if (!snapshot.metadata || snapshot.metadata.clinicId !== clinicId) throw new Error('Local booking cache not ready');
          authorized = true;
          reader = bridge.cachedSchedulingAdapter;
          localState = { metadata: snapshot.metadata, refreshFailed, incomplete: !coversCalendarRange(snapshot.metadata, from, to) };
        }
        const [doctors, hours] = await Promise.all([reader.listDoctors(clinicId, ctl.signal), reader.clinicHours(clinicId, ctl.signal)]);
        const authorized = doctors.filter((d) => d.clinicId === clinicId);
        const q = { clinicId, from, to };
        let appointments: CalendarAppointment[] = authorized.length ? await (bridge ? bridge.getLocalCalendar(q) : reader.listAppointments(q, ctl.signal)) : [];
        if (bridge && localState?.incomplete && navigator.onLine && authorized.length) {
          try {
            appointments = mergeLocalCalendar(await adapter.listAppointments(q, ctl.signal), appointments);
            localState.incomplete = false;
          } catch {
            // Retain available local records and proposals, with an explicit incomplete notice.
            localState.refreshFailed = true;
          }
        }
        const ids = new Set(authorized.map((d) => d.id));
        if (ctl.signal.aborted || !guard.current.isCurrent(id)) return;
        setLoad({ state: 'ready', data: { doctors: authorized, hours, appointments: appointments.filter((a) => a.clinicId === clinicId && ids.has(a.doctorId)), ...(localState ? { localCache: localState } : {}) } });
      } catch (error) {
        if (ctl.signal.aborted || !guard.current.isCurrent(id)) return;
        setLoad({ state: 'error', error });
      }
    })();
    return () => { ctl.abort(); unsubscribe(); };
  }, [adapter, clinicId, from, to, attempt, scope]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    window.addEventListener('amal:appointments-changed', retry);
    return () => window.removeEventListener('amal:appointments-changed', retry);
  }, [retry]);
  return { load, retry };
}
