import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RotateCcw, ShieldAlert } from 'lucide-react';
import { Segmented } from '@workspace/amal-ui';
import { getGetKpisQueryKey, useGetKpis, type GetKpisParams, type KpiPeriod, type KpiResult } from '@workspace/api-client-react';
import { describeApiError, isAuthFailure } from '@/auth/errors';
import { hebronToday } from '@/doctor/model';
import { formatDateOnly, formatInstant } from '@/shell/formatting';
import { useFmt } from './ChartFrame';
import { CollisionsChart, LossCard, LookupCard, NoShowChart, PreventionChart, SourcesChart, WeekdayStrip } from './charts';
import { AdoptionSection } from './Adoption';
import { NetworkActivity } from './NetworkActivity';
import { inclusiveEnd, isEmptyWindow, matchesSelection, partialItems, type RangeKind } from './model';
import './kpi.css';
import './i18n';
import type { ShellClinic } from '@/shell/identity';

const DATE_RE = /^(?:20\d{2}|2100)-\d{2}-\d{2}$/;

export function KpiPage({ title, clinics }: { title: string; clinics: ShellClinic[] }) {
  const { t } = useTranslation();
  const [range, setRange] = useState<RangeKind>('week');
  const [date, setDate] = useState(() => hebronToday(new Date()));
  const [clinicId, setClinicId] = useState<number | undefined>();
  const selectedClinic = clinics.some(c => c.id === clinicId) ? clinicId : undefined;
  const params: GetKpisParams = { range, ...(selectedClinic ? { clinicId: selectedClinic } : {}), ...(DATE_RE.test(date) ? { date } : {}) };
  // Query key includes range+date: a late response for an older selection lands in its own cache entry and is never shown.
  const q = useGetKpis(params, { query: { queryKey: getGetKpisQueryKey(params), retry: (n, e) => !isAuthFailure(e) && n < 1, staleTime: 30_000 } });
  const data = matchesSelection(q.data, range) ? q.data : undefined;
  const err = q.error ? describeApiError(q.error).key : null;

  return (
    <section className="kpi" data-testid="page-kpi" aria-busy={q.isFetching}>
      <header className="kpi-head">
        <p className="kpi-eyebrow">{t('kpi.eyebrow')}</p>
        <h1 id="page-title" tabIndex={-1} className="kpi-h1">{title}</h1>
        <p className="kpi-lede">{t('kpi.lede')}</p>
        <p className="kpi-noperf" data-testid="text-no-performance">{t('kpi.noPerformance')}</p>
      </header>

      <form className="kpi-controls" aria-label={t('kpi.controls.label')} onSubmit={(e) => { e.preventDefault(); void q.refetch(); }}>
        <label className="kpi-date">
          <span>{t('kpi.lookup.clinic')}</span>
          <select value={selectedClinic ?? ''} onChange={e => setClinicId(e.target.value ? Number(e.target.value) : undefined)} data-testid="select-kpi-clinic">
            <option value="">{t('kpi.lookup.allClinics')}</option>
            {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <Segmented label={t('kpi.controls.range')} value={range} onChange={(v) => setRange(v as RangeKind)} options={(['day', 'week', 'month'] as const).map((r) => ({ value: r, label: t(`kpi.controls.${r}`), testId: `button-range-${r}` }))} />
        <label className="kpi-date">
          <span>{t('kpi.controls.anchor')}</span>
          <input type="date" value={date} min="2000-01-01" max="2100-12-31" onChange={(e) => setDate(e.target.value)} data-testid="input-kpi-date" />
        </label>
        <button type="submit" className="amal-btn amal-btn--secondary" disabled={q.isFetching} data-testid="button-kpi-refresh">
          <RotateCcw size={16} aria-hidden="true" />{q.isFetching ? t('kpi.controls.refreshing') : t('kpi.controls.refresh')}
        </button>
        <p className="kpi-hint">{t('kpi.controls.rangeHint')}</p>
      </form>

      <div aria-live="polite" className="shell-sr">{q.isFetching ? t('kpi.states.loading') : ''}</div>

      {err === 'forbidden' || err === 'unauthorized' ? (
          <div className="kpi-state" role="alert" data-testid="state-kpi-forbidden">
            <ShieldAlert size={30} aria-hidden="true" /><h2>{t('kpi.states.forbiddenTitle')}</h2><p>{t('kpi.states.forbiddenDesc')}</p>
          </div>
        ) : err && !data ? (
          <div className="kpi-state" role="alert" data-testid="state-kpi-error">
            <AlertTriangle size={30} aria-hidden="true" /><h2>{t('kpi.states.errorTitle')}</h2><p>{t('kpi.states.errorDesc')}</p>
            <button type="button" className="amal-btn amal-btn--primary" onClick={() => void q.refetch()} data-testid="button-kpi-retry"><RotateCcw size={16} aria-hidden="true" />{t('kpi.states.retry')}</button>
          </div>
      ) : !data ? <Loading /> : (
        <>
          {err && (
            <div className="kpi-notice kpi-notice--error" role="alert" data-testid="state-kpi-refresh-error">
              <AlertTriangle size={18} aria-hidden="true" />
              <div><p className="kpi-notice__title">{t('kpi.states.refreshFailedTitle')}</p><p>{t('kpi.states.refreshFailed')}</p>
                <button type="button" className="amal-btn amal-btn--secondary" onClick={() => void q.refetch()} data-testid="button-kpi-refresh-retry"><RotateCcw size={16} aria-hidden="true" />{t('kpi.states.retry')}</button></div>
            </div>
          )}
          <Dashboard data={data} />
        </>
      )}
    </section>
  );
}

function Loading() {
  const { t } = useTranslation();
  return (
    <div className="kpi-grid" data-testid="state-kpi-loading" aria-label={t('kpi.states.loading')} role="status">
      {Array.from({ length: 6 }, (_, i) => <div key={i} className={`kpi-card kpi-skel${i < 2 ? ' kpi-card--wide' : ''}`} aria-hidden="true"><span /><span /><span /></div>)}
    </div>
  );
}

function PeriodLine({ label, p }: { label: string; p: KpiPeriod }) {
  const { t } = useTranslation(); const f = useFmt();
  return (
    <div className="kpi-period">
      <dt>{label}</dt>
      <dd>{t('kpi.meta.window', { start: formatDateOnly(p.startDate, f.locale, f.digits), end: formatDateOnly(inclusiveEnd(p), f.locale, f.digits) })} · {t('kpi.meta.days', { n: f.n(p.days) })}</dd>
    </div>
  );
}

function Dashboard({ data }: { data: KpiResult }) {
  const { t } = useTranslation(); const f = useFmt();
  const partial = partialItems(data);
  return (
    <>
      <section className="kpi-meta" aria-labelledby="kpi-meta-h" data-testid="section-kpi-meta">
        <h2 id="kpi-meta-h" className="kpi-meta__h">{t('kpi.meta.heading')}</h2>
        <dl className="kpi-periods">
          <PeriodLine label={t('kpi.meta.before')} p={data.before.period} />
          <PeriodLine label={t('kpi.meta.after')} p={data.after.period} />
        </dl>
        <p className={data.comparison.equalExposure ? 'kpi-hint' : 'kpi-warn-note'} data-testid="text-exposure">
          {data.comparison.equalExposure ? t('kpi.meta.equal') : t('kpi.meta.unequal', { before: t('kpi.meta.days', { n: f.n(data.before.period.days) }), after: t('kpi.meta.days', { n: f.n(data.after.period.days) }) })}
        </p>
        <details className="kpi-prov">
          <summary>{t('kpi.meta.provenance')}</summary>
          <p><strong>{t('kpi.meta.before')}:</strong> <span dir="auto">{data.before.provenance}</span></p>
          <p><strong>{t('kpi.meta.after')}:</strong> <span dir="auto">{data.after.provenance}</span></p>
          <p><strong>{t('kpi.meta.apiNote')}:</strong> <span dir="auto">{data.comparison.note}</span></p>
        </details>
        <p className="kpi-hint" data-testid="text-generated">{t('kpi.meta.generated', { time: formatInstant(data.generatedAt, f.locale, f.digits) })} · {t('kpi.meta.version', { version: data.calculationVersion })}</p>
      </section>

      {isEmptyWindow(data) && (
        <div className="kpi-notice" role="status" data-testid="state-kpi-empty"><Info2 /><div><p className="kpi-notice__title">{t('kpi.states.emptyTitle')}</p><p>{t('kpi.states.emptyDesc')}</p></div></div>
      )}
      {partial.length > 0 && (
        <div className="kpi-notice kpi-notice--partial" data-testid="state-kpi-partial">
          <Info2 /><div><p className="kpi-notice__title">{t('kpi.states.partialTitle')}</p>
            <ul>{partial.map((p) => <li key={p} data-testid={`partial-${p}`}>{t(`kpi.states.partial.${p}`)}</li>)}</ul></div>
        </div>
      )}

      <div className="kpi-grid">
        <CollisionsChart data={data} />
        <PreventionChart data={data} />
        <LookupCard data={data} />
        <LossCard data={data} />
        <SourcesChart data={data} />
        <NoShowChart data={data} />
        <WeekdayStrip data={data} />
        <NetworkActivity data={data} />
        <AdoptionSection data={data} />
      </div>
    </>
  );
}

const Info2 = () => <AlertTriangle size={18} aria-hidden="true" />;
