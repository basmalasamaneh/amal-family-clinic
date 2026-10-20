import { useTranslation } from 'react-i18next';
import type { KpiResult } from '@workspace/api-client-react';
import { ChartFrame, Unavail, useFmt } from './ChartFrame';
import { addDays } from './model';
import { formatDateOnly } from '@/shell/formatting';

/** The current contract exposes no daily lookup producer. Never substitute activity proxies. */
export function NetworkActivity({ data }: { data: KpiResult }) {
  const { t } = useTranslation();
  const f = useFmt();
  const period = data.after.period;
  return (
    <ChartFrame id="network-activity" title={t('kpi.networkActivity.title')}
      summary={t('kpi.networkActivity.summary', { days: f.n(period.days) })}
      caption={t('kpi.networkActivity.caption')}
      head={[t('kpi.networkActivity.date'), t('kpi.networkActivity.count')]}
      rows={Array.from({ length: period.days }, (_, i) => [
        formatDateOnly(addDays(period.startDate, i), f.locale, f.digits),
        <Unavail key={i} />,
      ])}>
      <p data-testid="state-network-activity-unavailable">{t('kpi.networkActivity.unavailable')}</p>
    </ChartFrame>
  );
}
