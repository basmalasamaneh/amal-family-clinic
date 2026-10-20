import { useCallback, useEffect, useRef, useState } from 'react';
import type { CalendarAppointment, CalendarDoctor, ClinicHours, SchedulingReadAdapter } from './adapter';

export type Load<T> = { state: 'loading' } | { state: 'error'; error: unknown } | { state: 'ready'; data: T };
export interface Schedule { doctors: CalendarDoctor[]; appointments: CalendarAppointment[]; hours: ClinicHours | null }

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
    (async () => {
      try {
        const [doctors, hours] = await Promise.all([adapter.listDoctors(clinicId, ctl.signal), adapter.clinicHours(clinicId, ctl.signal)]);
        const authorized = doctors.filter((d) => d.clinicId === clinicId);
        const appointments = authorized.length ? await adapter.listAppointments({ clinicId, from, to }, ctl.signal) : [];
        const ids = new Set(authorized.map((d) => d.id));
        if (ctl.signal.aborted || !guard.current.isCurrent(id)) return;
        setLoad({ state: 'ready', data: { doctors: authorized, hours, appointments: appointments.filter((a) => a.clinicId === clinicId && ids.has(a.doctorId)) } });
      } catch (error) {
        if (ctl.signal.aborted || !guard.current.isCurrent(id)) return;
        setLoad({ state: 'error', error });
      }
    })();
    return () => ctl.abort();
  }, [adapter, clinicId, from, to, attempt, scope]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    window.addEventListener('amal:appointments-changed', retry);
    return () => window.removeEventListener('amal:appointments-changed', retry);
  }, [retry]);
  return { load, retry };
}
