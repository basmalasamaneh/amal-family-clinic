import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ListPlus, Loader2, RotateCcw, UserRound, WifiOff, X } from 'lucide-react';
import { getListDoctorsQueryKey, useCreateWaitlistEntry, useListDoctors, type WaitlistEntry } from '@workspace/api-client-react';
import { PatientQuickSearch } from '@/booking/PatientQuickSearch';
import type { PatientHit, PatientSearchAdapter } from '@/booking/patients';
import { createAttemptKeeper, stableKey, type Attempt } from '@/booking/ops';
import { classifyError } from '@/booking/errors';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { WEEKDAYS, isUncertain, isWaitlistKey, toEntryPayload, validateEntry, type EntryPayload } from './model';
import './strings';
import '@/booking/booking.css';
import './waitlist.css';

export interface AddToWaitlistDialogProps {
  clinicId: number; patients: PatientSearchAdapter;
  initialPatient?: PatientHit | null; initialDoctorId?: number | null;
  onClose: (created: WaitlistEntry | null) => void;
  /** Owner-held unconfirmed attempt: survives this dialog unmounting so a retry re-sends the exact UUID/payload. */
  retained?: Attempt<EntryPayload> | null; onRetain?: (a: Attempt<EntryPayload> | null) => void;
}

type Err = { kind: 'uncertain' } | { kind: 'rejected' } | { kind: 'auth' } | null;

export function AddToWaitlistDialog({ clinicId, patients, initialPatient, initialDoctorId, onClose, retained = null, onRetain }: AddToWaitlistDialogProps) {
  const { t } = useTranslation('wl');
  const qc = useQueryClient();
  const online = useOnlineStatus();
  const [patient, setPatient] = useState<PatientHit | null>(!retained && initialPatient && initialPatient.clinicId === clinicId ? initialPatient : null);
  const [doctorId, setDoctorId] = useState<number | null>(retained?.payload.doctorId ?? initialDoctorId ?? null);
  const [weekdays, setWeekdays] = useState<number[]>(retained?.payload.weekdays ?? []);
  const [windowStart, setStart] = useState(retained?.payload.windowStart ?? '08:00');
  const [windowEnd, setEnd] = useState(retained?.payload.windowEnd ?? '14:00');
  const [touched, setTouched] = useState(false);
  const [err, setErr] = useState<Err>(retained ? { kind: 'uncertain' } : null);
  const [busy, setBusy] = useState(false);
  const keeper = useRef(createAttemptKeeper<EntryPayload>()).current;
  const [pending, setPendingState] = useState<Attempt<EntryPayload> | null>(retained);
  const retainRef = useRef(onRetain); retainRef.current = onRetain;
  // Owner is notified even after unmount, so a late success clears and a late uncertainty is kept.
  const setPending = (a: Attempt<EntryPayload> | null) => { if (alive.current) setPendingState(a); retainRef.current?.(a); };
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const params = { clinicId, limit: 100 };
  const doctors = useListDoctors(params, { query: { queryKey: getListDoctorsQueryKey(params), enabled: online } });
  const list = (doctors.data?.items ?? []).filter((d) => d.clinicId === clinicId);
  useEffect(() => { if (doctorId && doctors.data && !list.some((d) => d.id === doctorId)) setDoctorId(null); }, [doctors.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = useCreateWaitlistEntry();
  const mutateRef = useRef(create.mutateAsync); mutateRef.current = create.mutateAsync;

  const draft = { patientId: patient?.id ?? retained?.payload.patientId ?? null, doctorId, weekdays, windowStart, windowEnd };
  const invalid = validateEntry(draft);
  const locked = !!pending || busy;

  const send = async (attempt: Attempt<EntryPayload>) => {
    if (!online) return;
    setBusy(true); setErr(null);
    try {
      const entry = await mutateRef.current({ data: { ...attempt.payload, clientOpId: attempt.clientOpId } });
      keeper.clear(); setPending(null);
      if (!alive.current) { void qc.invalidateQueries({ predicate: (q) => isWaitlistKey(q.queryKey) }); return; }
      void qc.invalidateQueries({ predicate: (q) => isWaitlistKey(q.queryKey) });
      onClose(entry);
    } catch (e) {
      const f = classifyError(e);
      if (isUncertain(f.status)) { setPending(attempt); if (alive.current) setErr({ kind: 'uncertain' }); return; }
      keeper.clear(); setPending(null); if (alive.current) setErr(f.kind === 'auth' ? { kind: 'auth' } : { kind: 'rejected' });
    } finally { if (alive.current) setBusy(false); }
  };
  const submit = () => {
    setTouched(true);
    const payload = toEntryPayload(draft);
    if (!payload || locked || !online) return;
    void send(keeper.begin(stableKey(payload), () => payload));
  };
  const toggleDay = (d: number) => setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d]));

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o && !busy) onClose(null); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="bk-overlay bk-dialog-overlay" />
        <Dialog.Content className="bk-dialog" data-testid="dialog-add-waitlist" aria-describedby="wl-form-intro"
          onInteractOutside={(e) => { if (busy) e.preventDefault(); }}>
          <div className="bk-dialog__head">
            <Dialog.Title className="bk-dialog__title">{t('form.title')}</Dialog.Title>
            <Dialog.Close className="bk-x" aria-label={t('form.cancel')} disabled={busy} data-testid="button-close-waitlist"><X size={20} aria-hidden="true" /></Dialog.Close>
          </div>
          <p id="wl-form-intro" className="bk-hint">{t('form.intro')}</p>
          {!online && <div className="bk-msg bk-msg--warn" role="status" data-testid="status-waitlist-form-offline"><WifiOff size={20} aria-hidden="true" /><div className="bk-msg__body"><p>{t('form.offline')}</p></div></div>}
          <form className="wl-form" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <fieldset disabled={locked}>
              <div className="bk-field">
                <span className="bk-label">{t('form.patient')}</span>
                {!patient && pending ? <p className="bk-chosen" data-testid="text-waitlist-retained-patient">{t('form.retainedPatient', { id: pending.payload.patientId })}</p> : patient ? (
                  <div className="bk-chosen" data-testid="card-waitlist-patient">
                    <span className="bk-opt__av" aria-hidden="true"><UserRound size={20} /></span>
                    <span className="bk-opt__main"><bdi className="bk-opt__name" dir="auto">{patient.name}</bdi>
                      <span className="bk-opt__meta">{patient.phone && <bdi dir="ltr">{patient.phone}</bdi>}<span data-testid="text-waitlist-patient-id">{t('entry.patientId', { id: patient.id })}</span></span></span>
                    <button type="button" className="bk-btn bk-btn--sm" onClick={() => setPatient(null)} data-testid="button-waitlist-change-patient">{t('form.change')}</button>
                  </div>
                ) : <PatientQuickSearch adapter={patients} clinicId={clinicId} onSelect={(p) => { if (p.clinicId === clinicId) setPatient(p); }} paginate />}
                {touched && invalid === 'patient' && <p className="bk-err" role="alert">{t('form.err.patient')}</p>}
              </div>
              <div className="bk-field">
                <label className="bk-label" htmlFor="wl-doctor">{t('form.doctor')}</label>
                <select id="wl-doctor" className="bk-input" value={doctorId ?? ''} disabled={!doctors.data} aria-invalid={touched && invalid === 'doctor'}
                  onChange={(e) => setDoctorId(e.target.value ? Number(e.target.value) : null)} data-testid="select-waitlist-doctor">
                  <option value="">{doctors.isLoading ? t('form.doctorsLoading') : t('form.chooseDoctor')}</option>
                  {list.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                {doctors.isError && <p className="bk-err" role="alert" data-testid="status-waitlist-doctors-error">{t('form.doctorsError')}{' '}
                  <button type="button" className="bk-btn bk-btn--sm" onClick={() => void doctors.refetch()} data-testid="button-waitlist-doctors-retry"><RotateCcw size={16} aria-hidden="true" />{t('retry')}</button></p>}
                {touched && invalid === 'doctor' && <p className="bk-err" role="alert">{t('form.err.doctor')}</p>}
              </div>
              <div className="bk-field" role="group" aria-labelledby="wl-days-l">
                <span id="wl-days-l" className="bk-label">{t('form.days')}</span>
                <div className="wl-days">
                  {WEEKDAYS.map((d) => (
                    <label key={d} className="wl-day"><input type="checkbox" checked={weekdays.includes(d)} onChange={() => toggleDay(d)} data-testid={`checkbox-weekday-${d}`} /><span>{t(`wd.${d}`)}</span></label>
                  ))}
                </div>
                {touched && invalid === 'weekdays' && <p className="bk-err" role="alert">{t('form.err.weekdays')}</p>}
              </div>
              <div className="wl-row">
                <div className="bk-field"><label className="bk-label" htmlFor="wl-from">{t('form.from')}</label>
                  <input id="wl-from" type="time" step={300} className="bk-input" value={windowStart} onChange={(e) => setStart(e.target.value)} aria-invalid={touched && (invalid === 'time' || invalid === 'order')} data-testid="input-waitlist-from" /></div>
                <div className="bk-field"><label className="bk-label" htmlFor="wl-to">{t('form.to')}</label>
                  <input id="wl-to" type="time" step={300} className="bk-input" value={windowEnd} onChange={(e) => setEnd(e.target.value)} aria-invalid={touched && (invalid === 'time' || invalid === 'order')} data-testid="input-waitlist-to" /></div>
              </div>
              <p className="bk-hint">{t('form.localNote')}</p>
              {(invalid === 'order' || (touched && invalid === 'time')) && <p className="bk-err" role="alert" data-testid="text-waitlist-window-error">{t(`form.err.${invalid}`)}</p>}
            </fieldset>
            {err && <div className="bk-msg bk-msg--block" role="alert" data-testid={`status-waitlist-create-${err.kind}`}>
              <AlertTriangle size={20} aria-hidden="true" />
              <div className="bk-msg__body"><p>{t(err.kind === 'uncertain' ? 'form.uncertain' : err.kind === 'auth' ? 'form.authFail' : 'form.rejected')}</p>
                {err.kind === 'uncertain' && pending && <div className="wl-actions">
                  <button type="button" className="bk-btn bk-btn--sm" disabled={busy || !online} onClick={() => void send(pending)} data-testid="button-waitlist-create-retry"><RotateCcw size={16} aria-hidden="true" />{t('form.retry')}</button>
                  {!online && <span className="bk-hint">{t('offer.offlineRetry')}</span>}
                </div>}
              </div>
            </div>}
            <div className="wl-actions">
              <button type="submit" className="bk-btn bk-btn--primary" disabled={locked || !online} aria-busy={busy} data-testid="button-waitlist-submit">
                {busy ? <><Loader2 size={18} aria-hidden="true" />{t('form.submitting')}</> : <><ListPlus size={18} aria-hidden="true" />{t('form.submit')}</>}
              </button>
              <button type="button" className="bk-btn" disabled={busy} onClick={() => onClose(null)} data-testid="button-waitlist-cancel">{t('form.cancel')}</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
