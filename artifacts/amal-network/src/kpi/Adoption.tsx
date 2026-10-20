import { useTranslation } from 'react-i18next';
import { Info, Layers } from 'lucide-react';
import type { KpiResult } from '@workspace/api-client-react';
import { formatInstant } from '@/shell/formatting';
import { ChartFrame, Unavail, iso, useFmt } from './ChartFrame';
import { ADOPTION_STEPS, resolveDesignation } from './model';

/** Read-only Trial → Lite → Full stepper per clinic. Trial and transition history are unavailable upstream. */
export function AdoptionSection({ data }: { data: KpiResult }) {
  const { t } = useTranslation(); const f = useFmt();
  const a = data.adoption;
  const clinics = [...a.clinics].sort((x, y) => x.clinicId - y.clinicId);
  const designation = resolveDesignation(data);
  const joined = (j: string | null) => (j ? formatInstant(j, f.locale, f.digits) : null);
  return (
    <ChartFrame id="adoption" className="kpi-card--wide" icon={<Layers size={20} aria-hidden="true" />} title={t('kpi.adoption.title')}
      summary={t('kpi.adoption.summary', { total: f.n(clinics.length), lite: f.n(a.counts.lite), full: f.n(a.counts.full) })}
      caption={t('kpi.adoption.caption')}
      head={[t('kpi.adoption.colClinic'), t('kpi.adoption.colState'), t('kpi.adoption.colJoined'), t('kpi.adoption.colTransitions')]}
      rows={clinics.map((c) => [<bdi key="n">{c.clinicName}</bdi>, t(`kpi.adoption.steps.${c.state}`), joined(c.joinedAt) ?? <Unavail key="j" />, <Unavail key="h" />])}
      notes={<><p>{t('kpi.adoption.history')}</p><p dir="auto">{a.coverage}</p></>}>
      <p className="kpi-hint">{t('kpi.adoption.readOnly')} {t('kpi.adoption.counts', { lite: f.n(a.counts.lite), full: f.n(a.counts.full) })}</p>
      {designation.kind === 'unavailable' && (
        <div className="kpi-notice" role="note" data-testid="notice-designation-unavailable">
          <Info size={18} aria-hidden="true" />
          <div><p className="kpi-notice__title">{t('kpi.adoption.designationTitle')}</p><p>{t('kpi.adoption.designation')}</p></div>
        </div>
      )}
      {clinics.length === 0 ? <p className="kpi-empty-line">{t('kpi.adoption.empty')}</p> : (
        <ul className="kpi-adopt">
          {clinics.map((c) => {
            const cur = ADOPTION_STEPS.indexOf(c.state);
            const highlighted = designation.kind === 'designated' && designation.clinicId === c.clinicId;
            return (
              <li key={c.clinicId} className={`kpi-adopt__clinic${highlighted ? ' is-highlighted' : ''}`} data-testid={`adoption-${c.clinicId}`}>
                <h3 className="kpi-adopt__name"><bdi>{c.clinicName}</bdi></h3>
                <ol className="kpi-stepper" aria-label={t('kpi.adoption.stepperLabel', { clinic: iso(c.clinicName) })}>
                  {ADOPTION_STEPS.map((s, i) => {
                    const status = s === 'trial' ? 'unknown' : i === cur ? 'current' : i < cur ? 'reached' : 'todo';
                    return (
                      <li key={s} className="kpi-step" data-status={status} aria-current={status === 'current' ? 'step' : undefined} data-testid={`step-${c.clinicId}-${s}`}>
                        <span className="kpi-step__dot" aria-hidden="true">{status === 'current' ? '●' : status === 'reached' ? '✓' : status === 'unknown' ? '?' : ''}</span>
                        <span className="kpi-step__label">{t(`kpi.adoption.steps.${s}`)}</span>
                        <span className="kpi-step__state">{status === 'unknown' ? t('kpi.adoption.trialUnknown') : status === 'current' ? t('kpi.adoption.current') : status === 'reached' ? t('kpi.adoption.reached') : t('kpi.adoption.notReached')}</span>
                      </li>
                    );
                  })}
                </ol>
                <p className="kpi-adopt__date">{c.joinedAt ? t('kpi.adoption.joined', { date: joined(c.joinedAt) }) : t('kpi.adoption.joinedNone')}</p>
              </li>
            );
          })}
        </ul>
      )}
    </ChartFrame>
  );
}
