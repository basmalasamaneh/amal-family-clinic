import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { BellOff, BellRing } from 'lucide-react';
import {
  getGetReminderPatientPreferenceQueryKey, useGetReminderPatientPreference, useSetReminderPatientPreference,
} from '@workspace/api-client-react';
import './strings';
import './reminders.css';

/** Minimal front-desk control: patient-wide opt-out only. Never touches consent or clinical data. */
export function ReminderOptOut({ patientId }: { patientId: number }) {
  const { t } = useTranslation('rem');
  const qc = useQueryClient();
  const pref = useGetReminderPatientPreference(patientId);
  const save = useSetReminderPatientPreference();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const optedOut = pref.data?.optedOut ?? false;

  const toggle = () => {
    const next = !optedOut;
    setMsg(null);
    save.mutate({ patientId, data: { optedOut: next } }, {
      onSuccess: (res) => {
        qc.setQueryData(getGetReminderPatientPreferenceQueryKey(patientId), res);
        setMsg({ ok: true, text: t(res.optedOut ? 'patient.savedOut' : 'patient.savedIn') });
      },
      onError: () => setMsg({ ok: false, text: t('patient.saveError') }),
    });
  };

  return (
    <section className="rem-opt" aria-labelledby={`rem-opt-${patientId}`} data-testid="section-reminder-optout">
      <div className="rem-opt__head">
        {optedOut ? <BellOff size={20} aria-hidden="true" /> : <BellRing size={20} aria-hidden="true" />}
        <h3 id={`rem-opt-${patientId}`} className="rem-opt__title">{t('patient.title')}</h3>
        {pref.data && <span className={`rem-badge rem-badge--${optedOut ? 'cancelled' : 'sent'}`} data-testid="status-reminder-optout">{t(optedOut ? 'patient.optedOut' : 'patient.optedIn')}</span>}
      </div>
      <p className="rem-opt__body">{t('patient.body')}</p>
      {pref.isLoading && <div className="rem-skel rem-skel--line" role="status" aria-label={t('patient.loading')} data-testid="status-reminder-optout-loading" />}
      {pref.isError && (
        <p className="rem-inline-err" role="alert" data-testid="status-reminder-optout-error">
          {t('patient.loadError')}{' '}
          <button type="button" className="rem-link" onClick={() => void pref.refetch()} data-testid="button-reminder-optout-retry">{t('retry')}</button>
        </p>
      )}
      {pref.data && (
        <button type="button" className="bk-btn bk-btn--sm" aria-pressed={optedOut} disabled={save.isPending} onClick={toggle} data-testid="button-reminder-optout-toggle">
          {save.isPending ? t('patient.saving') : t(optedOut ? 'patient.optIn' : 'patient.optOut')}
        </button>
      )}
      <p className={msg && !msg.ok ? 'rem-inline-err' : 'rem-opt__msg'} role="status" aria-live="polite" data-testid="text-reminder-optout-result">{msg?.text ?? ''}</p>
    </section>
  );
}
