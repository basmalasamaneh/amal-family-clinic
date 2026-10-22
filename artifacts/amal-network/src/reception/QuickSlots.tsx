import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CalendarClock, Clock, Loader2, RotateCcw, Stethoscope } from 'lucide-react';
import { useAmalPreferences } from '@workspace/amal-ui';
import { formatLocalDate, formatTime, localDateOf } from '@/calendar/dates';
import type { CalendarDoctor } from '@/calendar/adapter';
import { classifyError, isAbort, type FailureKind } from '@/booking/errors';
import type { PatientHit } from '@/booking/patients';
import { formatExpiry } from '@/booking/time';
import type { Availability, AvailabilityFn, AvailabilitySlot } from './api';
import { quickRows } from './slots';
import './i18n';

type State = { kind: 'loading' } | { kind: 'ok'; data: Availability } | { kind: 'error'; failure: FailureKind };

/** Step 2 of the measured walk-in path: server-derived nearest slot per doctor; one explicit Book action each. */
export function QuickSlots({ clinicId, clinicName, patient, doctors, doctorsKind, availability, preferDoctorId = null, busy, onBook, onOther, onDoctorsRetry }: {
  clinicId: number; clinicName: string; patient: PatientHit; doctors: CalendarDoctor[]; doctorsKind: 'loading' | 'ok' | 'error';
  availability: AvailabilityFn; preferDoctorId?: number | null; busy: boolean; onBook: (s: AvailabilitySlot, doctorName: string) => void; onOther: () => void; onDoctorsRetry: () => void;
}) {
  const { t } = useTranslation();
  const { locale, digitPreference: dp } = useAmalPreferences();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const ctl = new AbortController(); setState({ kind: 'loading' });
    availability(clinicId, patient.id, ctl.signal).then(
      (data) => { if (!ctl.signal.aborted) setState({ kind: 'ok', data }); },
      (e) => { if (!ctl.signal.aborted && !isAbort(e)) setState({ kind: 'error', failure: classifyError(e).kind }); },
    );
    return () => ctl.abort();
  }, [availability, clinicId, patient.id, nonce]);
  const rows = useMemo(() => (state.kind === 'ok' ? quickRows(doctors, state.data.items, preferDoctorId) : []), [state, doctors, preferDoctorId]);
  // Revalidated against the actual roster; an unknown/foreign doctor is ignored, with a note.
  const preferValid = preferDoctorId != null && doctors.some((d) => d.id === preferDoctorId);
  const loading = state.kind === 'loading' || doctorsKind === 'loading';

  return (
    <section className="rx-quick" aria-labelledby="rx-quick-h" data-testid="walkin-quick-slots">
      <h3 id="rx-quick-h" className="rx-quick__h"><CalendarClock size={20} aria-hidden="true" />{t('rx.quick.title')}</h3>
      <div aria-live="polite" className="rx-sr">{loading ? t('rx.quick.checking') : ''}</div>
      {loading && <div className="bk-list" aria-hidden="true" data-testid="status-quick-loading"><div className="bk-skel" /><div className="bk-skel" /></div>}
      {doctorsKind === 'error' && <div className="bk-msg bk-msg--block" role="alert" data-testid="status-quick-doctors-error">
        <AlertTriangle size={20} aria-hidden="true" />
        <div className="bk-msg__body"><p>{t('bk.slot.doctorsError')}</p>
          <button type="button" className="bk-btn bk-btn--sm" disabled={busy} onClick={onDoctorsRetry}>{t('rx.quick.retry')}</button>
        </div>
      </div>}
      {!loading && state.kind === 'error' && (
        <div className="bk-msg bk-msg--block" role="alert" data-testid="status-quick-error"><AlertTriangle size={20} aria-hidden="true" />
          <div className="bk-msg__body"><p>{state.failure === 'unavailable' ? t('rx.quick.unavailable') : t('rx.quick.error')}</p>
            <button type="button" className="bk-btn bk-btn--sm" onClick={() => setNonce((n) => n + 1)} data-testid="button-quick-retry"><RotateCcw size={16} aria-hidden="true" />{t('rx.quick.retry')}</button></div></div>
      )}
      {!loading && doctorsKind === 'ok' && preferDoctorId != null && !preferValid && <p className="bk-hint" data-testid="text-quick-doctor-ignored">{t('rx.quick.preferIgnored')}</p>}
      {!loading && state.kind === 'ok' && doctorsKind === 'ok' && !doctors.length && <p className="bk-hint">{t('rx.quick.noDoctors')}</p>}
      {!loading && state.kind === 'ok' && (
        <>
          <ul className="rx-quick__list">
            {rows.map(({ doctor, slot }) => {
              if (!slot) return (
                <li key={doctor.id} className="rx-quick__none" data-testid={`text-quick-none-${doctor.id}`}>
                  <Stethoscope size={18} aria-hidden="true" /><bdi dir="auto">{doctor.name}</bdi><span className="bk-hint">{t('rx.quick.none')}</span>
                </li>);
              const date = formatLocalDate(localDateOf(slot.startsAt), locale, dp, 'EEE d MMM');
              const time = formatTime(slot.startsAt, locale, dp);
              const interval = `${time}–${formatTime(slot.endsAt, locale, dp)}`;
              return (
                <li key={doctor.id} data-preferred={doctor.id === preferDoctorId || undefined}>
                  <button type="button" className="rx-quick__book" disabled={busy} onClick={() => onBook(slot, doctor.name)}
                    aria-label={t('rx.quick.aria', { patient: patient.name, doctor: doctor.name, clinic: clinicName, date, interval })}
                    data-testid={`button-quick-book-${doctor.id}`}>
                    <span className="rx-quick__time"><Clock size={18} aria-hidden="true" /><bdi dir="ltr">{time}</bdi></span>
                    <span className="rx-quick__main">
                      {doctor.id === preferDoctorId && <span className="rx-tag" data-testid={`badge-quick-preferred-${doctor.id}`}>{t('rx.quick.preferred')}</span>}
                      <strong>{t('rx.quick.book', { doctor: '\u2068' + doctor.name + '\u2069', time })}</strong>
                      <span className="rx-quick__detail">{t('rx.quick.detail', { patient: '\u2068' + patient.name + '\u2069', clinic: '\u2068' + clinicName + '\u2069', date, interval: '\u2068' + interval + '\u2069' })}</span>
                    </span>
                    {busy && <Loader2 size={18} aria-hidden="true" className="rx-spin" />}
                  </button>
                </li>);
            })}
          </ul>
          <p className="bk-hint" data-testid="text-quick-checked">{t('rx.quick.duration', { n: state.data.durationMinutes })} · {t('rx.quick.checked', { t: formatExpiry(state.data.checkedAt, dp) })}</p>
        </>
      )}
      <button type="button" className="bk-btn bk-btn--sm" onClick={onOther} disabled={busy} data-testid="button-quick-other">{t('rx.quick.other')}</button>
    </section>
  );
}
