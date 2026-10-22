import { useEffect, useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGetAdminReminderOverview } from '@workspace/api-client-react';
import { EmptyState, useAmalPreferences } from '@workspace/amal-ui';
import { Building2, CircleCheck, CircleX, Clock3, RotateCcw } from 'lucide-react';
import { formatNumber } from '@/shell/formatting';
import { REMINDER_REVOKED } from './use-reminder-access';
import { errorStatus } from './model';
import { overviewCopy, overviewInstant, overviewTotals, type OverviewCounts } from './admin-overview-model';
import './admin-overview.css';

export function AdminReminderOverview({ accountId }: { accountId: string }) {
  const [revoked, setRevoked] = useState(false);
  const { locale } = useAmalPreferences();
  const copy = overviewCopy[locale];
  useEffect(() => {
    const revoke = () => setRevoked(true);
    window.addEventListener(REMINDER_REVOKED, revoke);
    return () => window.removeEventListener(REMINDER_REVOKED, revoke);
  }, []);
  if (revoked) return <div role="alert" data-testid="status-overview-revoked">
    <EmptyState headingLevel={2} title={copy.error} description={copy.errorBody} />
    <button className="bk-btn bk-btn--sm" onClick={() => setRevoked(false)} type="button"><RotateCcw size={16} aria-hidden="true" />{copy.retry}</button>
  </div>;
  return <OverviewQuery accountId={accountId} />;
}

function OverviewQuery({ accountId }: { accountId: string }) {
  const mountId = useId();
  const qc = useQueryClient();
  const { locale, digitPreference: digits } = useAmalPreferences();
  const copy = overviewCopy[locale];
  // Unique mount scope prevents a prior snapshot flashing, even during rapid account transitions.
  const queryKey = ['/api/reminders/overview', accountId, mountId];
  const query = useGetAdminReminderOverview({ query: {
    queryKey, gcTime: 0, staleTime: 0, retry: false,
    refetchOnMount: 'always', refetchOnWindowFocus: 'always',
    meta: { persist: false },
  } });
  useEffect(() => () => {
    const filters = { queryKey: ['/api/reminders/overview', accountId, mountId], exact: true };
    void qc.cancelQueries(filters);
    qc.removeQueries(filters);
  }, [qc, accountId, mountId]);
  useEffect(() => {
    if ([401, 403].includes(errorStatus(query.error) ?? 0)) window.dispatchEvent(new Event(REMINDER_REVOKED));
  }, [query.error]);
  const data = query.isFetchedAfterMount && !query.isError && !query.isFetching && navigator.onLine ? query.data : undefined;
  return <section className="rem-overview" data-testid="section-admin-reminder-overview" aria-label={copy.title}>
    <div className="rem-overview__toolbar">
      <p>{data && <>{copy.asOf}: <time dateTime={data.asOf}>{overviewInstant(data.asOf, locale, digits) ?? '—'}</time></>}</p>
      <button type="button" className="bk-btn bk-btn--sm" disabled={query.isFetching} onClick={() => void query.refetch()} data-testid="button-overview-refresh">
        <RotateCcw size={16} aria-hidden="true" />{query.isFetching ? copy.refreshing : copy.refresh}
      </button>
    </div>
    {(query.isPending || query.isFetching) && <div role="status" aria-label={copy.loading} data-testid="status-overview-loading"><div className="rem-skel rem-skel--item" /></div>}
    {query.isError && <div role="alert" data-testid="status-overview-error">
      <EmptyState headingLevel={2} title={copy.error} description={copy.errorBody} />
      <button type="button" className="bk-btn bk-btn--sm" onClick={() => void query.refetch()} data-testid="button-overview-retry"><RotateCcw size={16} aria-hidden="true" />{copy.retry}</button>
    </div>}
    {data && data.clinics.length === 0 && <div data-testid="status-overview-empty"><EmptyState headingLevel={2} title={copy.empty} description={copy.emptyBody} /></div>}
    {data && data.clinics.length > 0 && <>
      <section className="rem-card rem-overview__summary" aria-labelledby="overview-total-heading" data-testid="overview-totals">
        <h2 id="overview-total-heading">{copy.summary}</h2>
        <Metrics counts={overviewTotals(data.clinics)} />
      </section>
      <ul className="rem-overview__clinics">
        {data.clinics.map((clinic) => <li className="rem-card" key={clinic.clinicId} data-testid={`overview-clinic-${clinic.clinicId}`}>
          <div className="rem-overview__clinic-head">
            <h2><Building2 size={19} aria-hidden="true" />{clinic.clinicName}</h2>
            <span className={`rem-badge rem-badge--${clinic.enabled ? 'sent' : 'cancelled'}`}>{clinic.enabled ? copy.enabled : copy.disabled}</span>
          </div>
          <Metrics counts={clinic} />
          <p className="rem-overview__due"><span>{copy.due}:</span>
            {clinic.nextScheduledAt === null ? copy.none : <time dateTime={clinic.nextScheduledAt}>{overviewInstant(clinic.nextScheduledAt, locale, digits) ?? '—'}</time>}
          </p>
        </li>)}
      </ul>
    </>}
  </section>;
}

function Metrics({ counts }: { counts: OverviewCounts }) {
  const { locale, digitPreference: digits } = useAmalPreferences();
  const copy = overviewCopy[locale];
  return <dl className="rem-overview__metrics">
    <div><dt><Clock3 size={16} aria-hidden="true" />{copy.scheduled}</dt><dd>{formatNumber(counts.scheduledCount, locale, digits)}</dd></div>
    <div><dt><CircleCheck size={16} aria-hidden="true" />{copy.sent}</dt><dd>{formatNumber(counts.sentCount, locale, digits)}</dd></div>
    <div><dt><CircleX size={16} aria-hidden="true" />{copy.cancelled}</dt><dd>{formatNumber(counts.cancelledCount, locale, digits)}</dd></div>
  </dl>;
}
