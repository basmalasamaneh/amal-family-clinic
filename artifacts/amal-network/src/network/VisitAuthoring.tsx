import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useAmalPreferences } from '@workspace/amal-ui';
import { createDoctorVisit, createVisitAddendum, getVisitAuthoringAccess, type NetworkPatient, type NetworkVisit } from '@workspace/api-client-react';
import { Root as Dialog, Content as DialogContent, Title as DialogTitle, Description as DialogDescription, Portal, Overlay } from '@radix-ui/react-dialog';
import { Form } from '@/components/ui/form';
import { getSelection } from './model';
import { clinicalDataBlocked } from './consent-invalidation';
import { localVisitNow, mayAppend, VisitOperation, visitTimeUTC } from './visit-authoring-model';
import './visit-authoring-strings';
import './visit-authoring.css';

type Props = {
  patientId: number; scope: string; clinicId: number | null;
  patient: NetworkPatient | null; denied: boolean; refresh: () => void;
  children: (append: (visit: NetworkVisit) => void, ready: boolean) => ReactNode;
};

/** Kept outside the transient card projection: a focus/interval read never unmounts the editor. */
export function VisitAuthoring({ patientId, scope, clinicId, patient, denied, refresh, children }: Props) {
  const { t } = useTranslation();
  const { locale } = useAmalPreferences();
  const [online, setOnline] = useState(navigator.onLine);
  const [access, setAccess] = useState<Awaited<ReturnType<typeof getVisitAuthoringAccess>> | null>(null);
  const [target, setTarget] = useState<number | 'new' | null>(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [locked, setLocked] = useState(false);
  const [verificationError, setVerificationError] = useState(false);
  const [verificationAttempt, setVerificationAttempt] = useState(0);
  const op = useRef(new VisitOperation());
  const epoch = useRef(0);
  const alive = useRef(true);
  const current = useRef({ patient, denied, online, access });
  current.current = { patient, denied, online, access };
  const form = useForm({ defaultValues: { note: '', date: localVisitNow() } });
  const draft = form.watch('note');
  useEffect(() => {
    if (target === null || (!draft.trim() && !locked)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [target, draft, locked]);
  const resetRef = useRef(() => {});
  resetRef.current = () => {
    epoch.current++; op.current.reset(); setSaving(false); setLocked(false); setTarget(null);
    form.reset({ note: '', date: localVisitNow() });
  };
  useEffect(() => {
    alive.current = true;
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on); window.addEventListener('offline', on);
    return () => { alive.current = false; epoch.current++; op.current.reset(); window.removeEventListener('online', on); window.removeEventListener('offline', on); };
  }, []);
  useEffect(() => {
    setAccess(null);
    setVerificationError(false);
    if (denied || clinicalDataBlocked()) { resetRef.current(); return; }
    if (!online || !patient || patient.id !== patientId || getSelection(scope)?.id !== patientId) return;
    if (typeof target === 'number' && !patient.visits.some(v => v.visitId === target && mayAppend(v))) resetRef.current();
    const ac = new AbortController();
    getVisitAuthoringAccess(patientId, { signal: ac.signal, cache: 'no-store', credentials: 'include' }).then(result => {
      if (ac.signal.aborted || !alive.current || clinicalDataBlocked() || getSelection(scope)?.id !== patientId) return;
      if (result.clinicId !== clinicId) { resetRef.current(); return; }
      setAccess(result);
      if (target === 'new' && !result.canCreate) resetRef.current();
      if (typeof target === 'number' && !patient.visits.some(v => v.visitId === target && mayAppend(v))) resetRef.current();
    }, error => {
      if (ac.signal.aborted || !alive.current) return;
      setAccess(null);
      if (op.current.capabilityFailed(error) === 'clear') {
        resetRef.current(); setMessage('failed');
      } else {
        setVerificationError(true);
      }
    });
    return () => ac.abort();
    // Target changes do not initiate permission requests; each verified projection does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient, patientId, scope, clinicId, denied, online, verificationAttempt]);

  const allowed = () => {
    const c = current.current;
    return !!c.online && !!c.access && !c.denied && !clinicalDataBlocked() && !!c.patient &&
      c.patient.id === patientId && getSelection(scope)?.id === patientId &&
      (target === 'new' ? c.access.canCreate : c.patient.visits.some(v => v.visitId === target && mayAppend(v)));
  };
  const open = (value: number | 'new') => {
    if (target !== null || !online || !access || !patient || clinicalDataBlocked()) return;
    form.reset({ note: '', date: localVisitNow() }); setMessage(''); setTarget(value);
  };
  const close = () => {
    if (locked) return;
    if (form.getValues('note').trim() && !window.confirm(t('visitAuthor.discard'))) return;
    resetRef.current();
  };
  const save = async () => {
    if (!allowed() || op.current.pending) return;
    let payload = op.current.payload;
    if (!payload) {
      const values = form.getValues();
      if (!values.note.trim() || values.note.length > 10000) { setMessage('invalid'); return; }
      try {
        const appointmentId = getSelection(scope)?.appointmentId;
        payload = { clientOpId: crypto.randomUUID(), note: values.note.trim(),
          ...(target === 'new' ? { seenAt: visitTimeUTC(values.date), ...(appointmentId ? { appointmentId } : {}) } : {}) };
      } catch { setMessage('invalid'); return; }
    }
    const request = op.current.begin(payload);
    if (!request) return;
    const version = epoch.current;
    setSaving(true); setLocked(true); setMessage('');
    try {
      if (target === 'new' && 'seenAt' in request && typeof request.seenAt === 'string') await createDoctorVisit(patientId, { ...request, seenAt: request.seenAt }, { credentials: 'include', cache: 'no-store' });
      else if (typeof target === 'number') await createVisitAddendum(patientId, target, request, { credentials: 'include', cache: 'no-store' });
      else throw new Error('invalid operation');
      if (!alive.current || version !== epoch.current || getSelection(scope)?.id !== patientId) return;
      resetRef.current(); setMessage('saved'); setAccess(null); refresh();
    } catch (error) {
      if (!alive.current || version !== epoch.current) return;
      const failure = op.current.saveFailed(error);
      if (failure === 'authority') {
        resetRef.current(); setAccess(null); setMessage('failed'); refresh();
      } else if (failure === 'validation') {
        // The server guarantees 400/422 never wrote; correction can start a fresh operation.
        setSaving(false); setLocked(false); setMessage('invalid');
      } else {
        // Even a failed HTTP response can follow a committed transaction. Never change its payload.
        setSaving(false); setMessage(failure === 'conflict' ? 'conflict' : 'unknown');
      }
    }
  };
  return <>
    <div className="visit-authoring">
      {online && access?.canCreate && patient && <button type="button" className="amal-btn amal-btn--primary" data-testid="button-new-visit" onClick={() => open('new')}>{t('visitAuthor.create')}</button>}
      {!online && <p className="net-hint" role="status">{t('visitAuthor.offline')}</p>}
      {message && target === null && <p role="status" data-testid="status-visit-save">{t(`visitAuthor.${message}`)}</p>}
      {verificationError && target === null && <p role="status">{t('visitAuthor.revalidation')} <button type="button" className="amal-btn amal-btn--secondary" data-testid="button-verify-visit" disabled={!online} onClick={() => setVerificationAttempt(n => n + 1)}>{t('visitAuthor.verify')}</button></p>}
    </div>
    {children(v => { if (mayAppend(v) && v.visitId !== undefined) open(v.visitId); }, online && !!access && !!patient && !denied && !clinicalDataBlocked())}
    <Dialog open={target !== null} onOpenChange={value => { if (!value) close(); }}>
      <Portal>
      <Overlay className="visit-composer-overlay" />
      <DialogContent className="visit-composer" dir={locale === 'ar' ? 'rtl' : 'ltr'} onInteractOutside={e => e.preventDefault()}>
        <DialogTitle>{t(target === 'new' ? 'visitAuthor.title' : 'visitAuthor.appendTitle')}</DialogTitle>
        <DialogDescription>{t('visitAuthor.description')}</DialogDescription>
        <Form {...form}>
          <form onSubmit={e => { e.preventDefault(); void save(); }}>
            {target === 'new' && <label htmlFor="visit-date">{t('visitAuthor.date')}<input id="visit-date" data-testid="input-visit-date" type="datetime-local" required disabled={locked} {...form.register('date')} /></label>}
            <label htmlFor="visit-note">{t('visitAuthor.note')}<textarea id="visit-note" data-testid="input-visit-note" dir="auto" required maxLength={10000} disabled={locked} {...form.register('note')} /></label>
            {target === 'new' && getSelection(scope)?.appointmentId && <p className="net-hint">{t('visitAuthor.linked')}</p>}
            {(!online || !access || message) && <p role="status" data-testid="status-visit-composer">{t(`visitAuthor.${message || (!online ? 'offline' : 'checking')}`)}</p>}
            {verificationError && <p role="status">{t('visitAuthor.revalidation')} <button type="button" className="amal-btn amal-btn--secondary" data-testid="button-verify-visit-composer" disabled={!online || saving} onClick={() => setVerificationAttempt(n => n + 1)}>{t('visitAuthor.verify')}</button></p>}
            <div className="visit-composer__actions">
              <button type="button" className="amal-btn amal-btn--secondary" disabled={locked} data-testid="button-cancel-visit" onClick={close}>{t('visitAuthor.cancel')}</button>
              <button type="submit" className="amal-btn amal-btn--primary" disabled={saving || !allowed()} data-testid="button-save-visit">{t(`visitAuthor.${saving ? 'saving' : locked ? 'retry' : 'save'}`)}</button>
            </div>
          </form>
        </Form>
      </DialogContent>
      </Portal>
    </Dialog>
  </>;
}
