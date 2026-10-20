import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { updateAppointment } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { CancellationStore } from './cancellation-store';
import type { CalendarAppointment } from './adapter';
import { isUnauthorized } from '@/auth/errors';
import { reportUnauthorized } from '@/auth/session-events';
import './cancellation-messages';
import './cancellation.css';

const Context = createContext<{ store: CancellationStore; open: (appt: CalendarAppointment) => void } | null>(null);
export const useCancellation = () => useContext(Context);
export function CancellationProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation('cancellation');
  const queryClient = useQueryClient();
  const [success, setSuccess] = useState(false);
  const [created, setCreated] = useState<'created' | 'simulated' | null>(null);
  const refresh = () => {
    window.dispatchEvent(new Event('amal:appointments-changed'));
    void queryClient.invalidateQueries({ queryKey: ['/api/appointments'] });
  };
  const [store] = useState(() => new CancellationStore(async (entry) => {
    try {
      await updateAppointment(entry.target.id, { clientOpId: entry.operationId, expectedVersion: entry.target.version, status: 'cancelled' });
    } catch (error) {
      if (isUnauthorized(error)) reportUnauthorized();
      throw error;
    }
  }, refresh, () => setSuccess(true)));
  const entries = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [target, setTarget] = useState<CalendarAppointment | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    const clear = () => { store.clear(); setTarget(null); setSuccess(false); setCreated(null); };
    const onCreated = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string; simulated?: boolean }>).detail;
      if (detail?.kind === 'created') setCreated(detail.simulated ? 'simulated' : 'created');
    };
    window.addEventListener('amal:appointments-changed', onCreated);
    window.addEventListener('amal:discard-cancellations', clear);
    window.addEventListener('pagehide', clear);
    return () => {
      clearInterval(timer); store.clear();
      window.removeEventListener('amal:discard-cancellations', clear);
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('amal:appointments-changed', onCreated);
    };
  }, [store]);
  const open = (appt: CalendarAppointment) => { trigger.current = document.activeElement as HTMLElement; setTarget(appt); };
  const allowed = target?.version !== undefined && ['booked', 'double_booked'].includes(target.lifecycle) && !target.syncPending;
  return <Context.Provider value={{ store, open }}>
    {children}
    <section className="cancel-notices" aria-label={t('region')}>
      {created && <p role="status">{t(created)} <button className="cal-btn" onClick={() => setCreated(null)}>{t('dismiss')}</button></p>}
      {success && <p role="status">{t('success')} <button className="cal-btn" onClick={() => setSuccess(false)}>{t('dismiss')}</button></p>}
      {entries.map((item) => <div key={item.target.id} className="cancel-notice">
        <strong>{t('appointment', { id: item.target.id })}</strong>
        <p role="status">{item.state === 'pending' ? t('pending', { seconds: Math.max(0, Math.ceil((item.deadline - now) / 1000)) }) : t(item.state === 'sending' ? 'sending' : 'failed')}</p>
        {item.state === 'pending' && <button className="cal-btn" data-cancellation-undo={item.target.id} onClick={() => store.undo(item.target.id)}>{t('undo')}</button>}
        {item.state === 'failed' && <><button className="cal-btn" onClick={() => store.retry(item.target.id)}>{t('retry')}</button><button className="cal-btn" onClick={() => store.dismiss(item.target.id)}>{t('dismiss')}</button></>}
      </div>)}
    </section>
    <Dialog.Root open={!!target} onOpenChange={(value) => { if (!value) setTarget(null); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="shell-overlay" />
        <Dialog.Content className="shell-dialog cancel-dialog" onCloseAutoFocus={(e) => {
          e.preventDefault();
          if (trigger.current?.isConnected && !trigger.current.matches(':disabled')) trigger.current.focus();
          else (document.querySelector<HTMLElement>('[data-cancellation-undo]') ?? document.getElementById('page-title'))?.focus();
        }}>
          <Dialog.Title><AlertTriangle aria-hidden="true" />{t('title')}</Dialog.Title>
          <Dialog.Description>{t('description')}</Dialog.Description>
          {target && <p><bdi dir="auto">{target.patientName ?? t('appointment', { id: target.id })}</bdi></p>}
          {!allowed && <p role="note">{t(target?.version === undefined ? 'fixture' : 'unavailable')}</p>}
          <div className="cancel-actions">
            <Dialog.Close className="cal-btn">{t('keep')}</Dialog.Close>
            {allowed && target && <button className="cal-btn cancel-danger" onClick={() => {
              store.schedule({ id: target.id, clinicId: target.clinicId, version: target.version! }); setSuccess(false); setTarget(null);
            }}>{t('confirm')}</button>}
            <Dialog.Close className="cal-btn" aria-label={t('close')}><X aria-hidden="true" /></Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </Context.Provider>;
}
