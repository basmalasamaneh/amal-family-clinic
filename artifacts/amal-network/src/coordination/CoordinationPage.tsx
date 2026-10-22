import { useTranslation } from 'react-i18next';
import { Button, EmptyState, PageHeader, useAmalPreferences } from '@workspace/amal-ui';
import { RotateCw } from 'lucide-react';
import type { useCoordination } from './use-coordination';
import type { CoordinationMetric } from './model';
import './i18n';
import './coordination.css';

export function CoordinationPage({ view }: { view: ReturnType<typeof useCoordination> }) {
  const { t, i18n } = useTranslation();
  const { digitPreference: digits } = useAmalPreferences();
  const number = (value: number) => new Intl.NumberFormat(i18n.language, { numberingSystem: digits, maximumFractionDigits: 2 }).format(value);
  const date = (value: string) => new Intl.DateTimeFormat(i18n.language, { numberingSystem: digits, dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Hebron' }).format(new Date(value));
  const metric = (name: string, item: CoordinationMetric, seconds = false) => <div>
    <dt>{t(`coordination.${name}`)}</dt>
    <dd>{item.coverage === 'unavailable' || item.value === null ? t('coordination.unavailable') : `${number(item.value)}${seconds ? ` ${t('coordination.seconds')}` : ''}`}
      <small>{t(`coordination.${item.coverage}`)} · {t('coordination.samples', { count: item.sampleCount, value: number(item.sampleCount) })}</small>
    </dd>
  </div>;
  return <section className="coordination" data-testid="page-coordination">
    <PageHeader title={t('shell.nav.coordination')} secondaryActions={<Button onClick={view.refresh} disabled={!view.online || view.status === 'loading'} data-testid="button-refresh-coordination"><RotateCw size={16} />{t('coordination.refresh')}</Button>} />
    <aside className="coordination__note"><strong>{t('coordination.readonly')}</strong><p>{t('coordination.explanation')}</p></aside>
    {view.status === 'loading' ? <div role="status" data-testid="status-coordination-loading"><span>{t('coordination.loading')}</span><div className="coordination__skeleton" aria-hidden="true" /></div>
      : !view.allowed || !view.data ? <EmptyState title={t(`coordination.${!view.online ? 'offline' : view.status === 'error' ? 'error' : 'denied'}`)} description={t('coordination.private')} />
      : <>
        <div className="coordination__period" data-testid="text-coordination-period"><span>{t('coordination.period')}: {date(view.data.period.from)} — {date(view.data.period.to)} ({view.data.period.timeZone})</span><span>{t('coordination.asOf')}: {date(view.data.asOf)}</span></div>
        {!view.data.clinics.length ? <EmptyState title={t('coordination.empty')} description={t('coordination.emptyDescription')} /> : <div className="coordination__clinics">{view.data.clinics.map(clinic => <article className="coordination__clinic" key={clinic.id} data-testid={`card-coordination-clinic-${clinic.id}`}>
          <h2>{clinic.name}</h2><p className="coordination__meta">{t('coordination.mode')}: {t(`coordination.${clinic.mode}`)} · {t('coordination.membership')}: <bdi>{t(`coordination.memberships.${clinic.membershipStatus}`, { defaultValue: clinic.membershipStatus })}</bdi></p>
          <dl className="coordination__metrics">{metric('conflicts', clinic.metrics.preventedConflicts)}{metric('lookup', clinic.metrics.medianLookupSeconds, true)}</dl>
        </article>)}</div>}
      </>}
  </section>;
}
