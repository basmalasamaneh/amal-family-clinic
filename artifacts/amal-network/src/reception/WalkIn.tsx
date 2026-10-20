import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearch } from 'wouter';
import { CheckCircle2, DoorOpen } from 'lucide-react';
import { useAmalPreferences } from '@workspace/amal-ui';
import type { Appointment } from '@workspace/api-client-react';
import type { ShellClinic } from '@/shell/identity';
import { resolveSchedulingAdapter } from '@/calendar/adapter';
import { formatTime } from '@/calendar/dates';
import { BookingDrawer } from '@/booking/BookingDrawer';
import { createFixtureBookingApi, realBookingApi } from '@/booking/api';
import { resolvePatientSearch, type PatientHit } from '@/booking/patients';
import { createFixtureReceptionApi, realReceptionApi, type ReceptionApi } from './api';
import '@/booking/i18n';
import './i18n';
import './reception.css';
import { getWalkInPageContext, registerWalkIn, type WalkInContext } from './walkin-bus';

interface WalkInCtx {
  enabled: boolean;
  /** Opens the global walk-in drawer over the current screen; the page underneath stays mounted. */
  open: (opts?: WalkInContext) => void;
  reception: ReceptionApi | null;
}
const Ctx = createContext<WalkInCtx>({ enabled: false, open: () => undefined, reception: null });
export const useWalkIn = () => useContext(Ctx);

/**
 * Global quick Walk-in for front-desk only. Keyed by clinic by the caller so a clinic switch
 * discards any open drawer, hold and patient selection. Fixture writes only in existing DEV fixture sessions.
 */
export function WalkInProvider({ clinic, fixture, enabled, children }: { clinic: ShellClinic | null; fixture: boolean; enabled: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  const { locale, digitPreference: dp } = useAmalPreferences();
  const search = useSearch();
  const useFixture = import.meta.env.DEV && fixture;
  const scheduling = useMemo(() => resolveSchedulingAdapter(search, fixture), [fixture]); // eslint-disable-line react-hooks/exhaustive-deps
  const api = useMemo(() => (useFixture ? createFixtureBookingApi() : realBookingApi), [useFixture]);
  const patients = useMemo(() => resolvePatientSearch(useFixture), [useFixture]);
  const reception = useMemo(() => (useFixture ? createFixtureReceptionApi((id, s) => scheduling.listDoctors(id, s)) : realReceptionApi), [useFixture, scheduling]);
  const [run, setRun] = useState<{ n: number; patient: PatientHit | null; doctorId: number | null } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  const open = useCallback((opts?: WalkInContext) => {
    if (!enabled || !clinic) return;
    // Revalidate scope: context from another clinic is dropped, never carried across.
    const c = opts && (opts.clinicId == null || opts.clinicId === clinic.id) ? opts : null;
    const patient = c?.patient && c.patient.clinicId === clinic.id ? c.patient : null;
    const doctorId = typeof c?.doctorId === 'number' && c.doctorId > 0 ? c.doctorId : null;
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDone(null);
    setRun((r) => ({ n: (r?.n ?? 0) + 1, patient, doctorId }));
  }, [enabled, clinic]);
  useEffect(() => { registerWalkIn(enabled && clinic ? (c) => open(c) : null); return () => registerWalkIn(null); }, [enabled, clinic, open]);
  useEffect(() => { if (!done) return; const id = setTimeout(() => setDone(null), 8000); return () => clearTimeout(id); }, [done]);

  const close = (created: Appointment | null, doctorName?: string) => {
    setRun(null);
    if (created) setDone(t(api.mode === 'fixture' ? 'rx.doneSim' : 'rx.done', { time: formatTime(created.startsAt, locale, dp), doctor: '\u2068' + (doctorName ?? t('rx.quick.doctor', { id: created.doctorId })) + '\u2069' }));
    setTimeout(() => {
      const el = returnTo.current;
      (el && el.isConnected ? el : document.getElementById('main'))?.focus();
    }, 0);
  };
  const value = useMemo(() => ({ enabled: enabled && !!clinic, open, reception: enabled ? reception : null }), [enabled, clinic, open, reception]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <p className="rx-sr" role="status" aria-live="polite">{done ?? ''}</p>
      {done && <div className="rx-toast" data-testid="status-walkin-done"><CheckCircle2 size={20} aria-hidden="true" /><span>{done}</span></div>}
      {run && clinic && enabled && (
        <DrawerWithNames key={run.n} clinic={clinic} scheduling={scheduling} patients={patients} api={api} reception={reception} patient={run.patient} doctorId={run.doctorId} onClose={close} title={t('bk.walkInTitle')} />
      )}
    </Ctx.Provider>
  );
}

function DrawerWithNames({ clinic, scheduling, patients, api, reception, patient, doctorId, onClose, title }: {
  clinic: ShellClinic; scheduling: ReturnType<typeof resolveSchedulingAdapter>; patients: ReturnType<typeof resolvePatientSearch>;
  api: typeof realBookingApi; reception: ReceptionApi; patient: PatientHit | null; doctorId: number | null; title: string; onClose: (a: Appointment | null, doctorName?: string) => void;
}) {
  const names = useRef(new Map<number, string>());
  useEffect(() => {
    const ctl = new AbortController();
    scheduling.listDoctors(clinic.id, ctl.signal).then((ds) => { for (const d of ds) names.current.set(d.id, d.name); }, () => undefined);
    return () => ctl.abort();
  }, [scheduling, clinic.id]);
  return (
    <BookingDrawer clinic={clinic} ctx={{ clinicId: clinic.id, source: 'walk-in' }} title={title} scheduling={scheduling} patients={patients} api={api}
      initialPatient={patient} preferDoctorId={doctorId} availability={reception.availability} onClose={(a) => onClose(a, a ? names.current.get(a.doctorId) : undefined)} />
  );
}

/** One-tap entry rendered in the shell header (all reception screens, desktop and mobile). */
export function WalkInButton() {
  const { t } = useTranslation();
  const { enabled, open } = useWalkIn();
  if (!enabled) return null;
  return (
    <button type="button" className="shell-walkin" onClick={() => open(getWalkInPageContext() ?? undefined)} data-testid="link-walk-in" aria-haspopup="dialog">
      <DoorOpen size={22} aria-hidden="true" /><span>{t('calendar.actions.walkIn')}</span>
    </button>
  );
}
