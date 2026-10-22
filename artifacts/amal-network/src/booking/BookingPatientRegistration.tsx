import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { isDemoReachable, subscribeDemoReachability } from '@/auth/demo-context';
import { localCache } from '@/offline';
import { getBookingSnapshot, prepareBookingCache } from '@/offline/booking-bridge';
import { createFixtureReceptionApi, realReceptionApi } from '@/reception/api';
import { NewPatientDialog, startSave, IDLE_STATUS, type RegStatus } from '@/reception/NewPatientDialog';
import { createRegSession, EMPTY_DRAFT, serverFieldErrors, type NewPatientPayload } from '@/reception/registration';
import type { SchedulingReadAdapter } from '@/calendar/adapter';
import type { PatientHit, PatientSearchAdapter } from './patients';
import { PatientQuickSearch } from './PatientQuickSearch';
import { refreshRegisteredPatient, registrationName, type CreatedRegistration } from './registration-flow';
import '@/reception/reception.css';

export function BookingPatientRegistration({ clinicId, fixture, scheduling, patients, onSelect, onOpenChange }: {
  clinicId: number; fixture: boolean; scheduling: SchedulingReadAdapter; patients: PatientSearchAdapter;
  onSelect: (p: PatientHit) => void; onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const online = useOnlineStatus();
  const reachable = useSyncExternalStore(subscribeDemoReachability, isDemoReachable, isDemoReachable);
  const allowed = online && (fixture || reachable);
  const api = useMemo(() => fixture ? createFixtureReceptionApi((id, signal) => scheduling.listDoctors(id, signal)) : realReceptionApi, [fixture, scheduling]);
  const session = useRef(createRegSession()).current;
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [status, setStatus] = useState<RegStatus>(IDLE_STATUS);
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<CreatedRegistration | null>(null);
  const [refreshState, setRefreshState] = useState<'idle' | 'loading' | 'error'>('idle');
  const busy = useRef(false);
  const alive = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const callbacks = useRef({ onSelect, onOpenChange });
  callbacks.current = { onSelect, onOpenChange };
  useEffect(() => {
    alive.current = true;
    const unsubscribe = fixture ? () => {} : localCache.subscribeContext(() => { alive.current = false; setOpen(false); callbacks.current.onOpenChange(false); });
    return () => { alive.current = false; unsubscribe(); callbacks.current.onOpenChange(false); };
  }, [fixture, clinicId]);
  const close = () => { setOpen(false); callbacks.current.onOpenChange(false); requestAnimationFrame(() => { if (alive.current) trigger.current?.focus(); }); };
  const complete = async (result: CreatedRegistration) => {
    if (busy.current || !alive.current || !allowed) return;
    busy.current = true; setRefreshState('loading');
    try {
      const p = fixture ? { ...result.patient, clinicId } : await refreshRegisteredPatient(result, clinicId, prepareBookingCache, getBookingSnapshot, () => alive.current);
      if (!alive.current) return;
      callbacks.current.onOpenChange(false);
      callbacks.current.onSelect(p);
    } catch { if (alive.current) setRefreshState('error'); }
    finally { busy.current = false; }
  };
  const submit = (key: string, payload: NewPatientPayload) => {
    if (!allowed || !alive.current || created) return;
    let operationId = '';
    const started = startSave(api, session, key, payload, res => {
      if (!alive.current) return;
      if (res.ok) {
        const result = { patient: res.patient, operationId };
        setCreated(result); setStatus(IDLE_STATUS); close(); void complete(result);
      } else setStatus({ saving: false, failure: res.failure, serverErrors: serverFieldErrors(res.failure, res.data) });
    });
    if (started === 'started') {
      operationId = session.pending!.clientOpId;
      session.snapshot = draft; setStatus({ saving: true, failure: null, serverErrors: {} });
    }
  };
  const show = (query?: string) => {
    if (!allowed || !alive.current) return;
    trigger.current = document.activeElement as HTMLElement;
    if (query && draft === EMPTY_DRAFT && !session.pending) setDraft({ ...EMPTY_DRAFT, name: registrationName(query) });
    setOpen(true); callbacks.current.onOpenChange(true);
  };
  return <>
    {created ? <div className="bk-msg bk-msg--info" role="status" data-testid="status-registration-refresh">
      <div className="bk-msg__body"><p>{t(refreshState === 'loading' ? 'rx.bookingRefreshing' : 'rx.bookingRefreshFailed')}</p>
        {refreshState !== 'loading' && <button className="bk-btn bk-btn--sm" type="button" disabled={!allowed} onClick={() => void complete(created)} data-testid="button-registration-refresh">{t('bk.search.retry')}</button>}
        {!allowed && <p className="bk-hint">{t('rx.bookingOffline')}</p>}
      </div>
    </div> : <>
      <PatientQuickSearch adapter={patients} clinicId={clinicId} autoFocus paginate onSelect={onSelect} onCreate={show} createDisabledReason={!allowed ? t('rx.bookingOffline') : undefined} />
      {(draft !== EMPTY_DRAFT || session.pending || status.saving) && !open && <button className="bk-btn bk-btn--sm" type="button" disabled={!allowed} onClick={() => show()} data-testid="button-booking-registration-resume">{t('rx.reg.resume')}</button>}
    </>}
    {open && !created && <NewPatientDialog api={api} clinicId={clinicId} draft={draft} onDraft={setDraft} onClose={close} onWalkIn={null} session={session} status={status} onSubmit={submit} saveDisabled={!allowed} />}
  </>;
}
