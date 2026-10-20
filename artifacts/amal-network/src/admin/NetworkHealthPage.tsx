import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, Radio, CircleOff, ChevronDown } from 'lucide-react';
import { Button, useAmalPreferences } from '@workspace/amal-ui';
import { getGetNetworkHealthQueryKey, useGetNetworkHealth, type NetworkClinicHealth } from '@workspace/api-client-react';
import { isAuthFailure } from '@/auth/errors';
import { formatNumber } from '@/shell/formatting';
import { Empty, LoadError, Notice, PageHead, Skeleton, isAccessFailure, useInstant } from './common';
import './admin.css';

export function NetworkHealthPage({ title }: { title: string }) {
  const { t } = useTranslation();
  const fmt = useInstant();
  const q = useGetNetworkHealth({ query: { queryKey: getGetNetworkHealthQueryKey(), retry: (n, e) => !isAuthFailure(e) && n < 1, refetchInterval: 60_000, staleTime: 15_000 } });
  // A 401/403 means the cached observation is no longer ours to show.
  const denied = q.isError && isAccessFailure(q.error);
  const data = denied ? undefined : q.data;
  // Age is checked against the wall clock too, so a paused poll (offline tab) still reads as stale.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 15_000); return () => window.clearInterval(id); }, []);
  const aged = !!data && now - Date.parse(data.generatedAt) > data.heartbeatTimeoutSeconds * 1000;
  const failedAfterData = !!data && (q.isError || aged);

  return (
    <section className="adm" data-testid="page-networkHealth" aria-busy={q.isFetching}>
      <PageHead id="networkHealth" title={title} lede={t('adm.health.lede')} actions={
        <Button variant="secondary" startIcon={<RotateCcw size={16} aria-hidden="true" />} loading={q.isFetching} onClick={() => void q.refetch()} data-testid="button-health-refresh">
          {q.isFetching ? t('adm.common.refreshing') : t('adm.common.refresh')}
        </Button>} />
      {data && (
        <p className="adm-observed" data-testid="text-health-observed">
          <span className={`adm-dot${failedAfterData ? ' adm-dot--stale' : ''}`} aria-hidden="true" />
          {t('adm.health.observed', { time: fmt(data.generatedAt) })} · {t('adm.health.timeout', { seconds: data.heartbeatTimeoutSeconds })} · {t('adm.common.hebron')}
        </p>
      )}
      {failedAfterData && <Notice tone="warn" testId="status-health-stale">{t('adm.health.staleBanner', { time: fmt(data.generatedAt) })}</Notice>}
      {q.isPending ? <div className="adm-health-grid"><Skeleton rows={3} /></div>
        : !data ? <LoadError text={t('adm.health.loadFailed')} error={q.error} onRetry={() => void q.refetch()} />
        : data.clinics.length === 0 ? <Empty testId="state-health-empty" title={t('adm.health.empty')} desc={t('adm.health.emptyDesc')} />
        : <ul className={`adm-health-grid${failedAfterData ? ' is-stale' : ''}`} data-testid="list-health-clinics">
            {data.clinics.map(c => <ClinicCard key={c.clinicId} c={c} generatedAt={data.generatedAt} timeout={data.heartbeatTimeoutSeconds} stale={failedAfterData} />)}
          </ul>}
    </section>
  );
}

function ClinicCard({ c, generatedAt, timeout, stale }: { c: NetworkClinicHealth; generatedAt: string; timeout: number; stale: boolean }) {
  const { t } = useTranslation();
  const { locale, digitPreference } = useAmalPreferences();
  const fmt = useInstant();
  const n = (v: number) => formatNumber(v, locale, digitPreference);
  const cov = c.queueCoverage;
  const hbAge = c.lastHeartbeatAt ? (Date.parse(generatedAt) - Date.parse(c.lastHeartbeatAt)) / 1000 : null;
  const hbStale = hbAge !== null && hbAge > timeout;
  const online = c.connectivity === 'online' && !stale;
  const pending = c.unsubmittedOperationCount === null
    ? t('adm.health.pendingUnknown')
    : cov.complete ? n(c.unsubmittedOperationCount) : t('adm.health.pendingPartial', { count: n(c.unsubmittedOperationCount) });
  return (
    <li className={`adm-hcard adm-hcard--${c.connectivity}`} data-testid={`card-health-${c.clinicId}`}>
      <div className="adm-hcard__top">
        <h2 className="adm-hcard__name" data-testid={`text-health-name-${c.clinicId}`}><bdi>{c.clinicName}</bdi></h2>
        <span className={`adm-pill adm-pill--${c.networkMode}`} data-testid={`text-health-mode-${c.clinicId}`}>{t(`adm.health.${c.networkMode}`)}</span>
      </div>
      <p className={`adm-conn adm-conn--${c.connectivity}`} data-testid={`status-health-conn-${c.clinicId}`}>
        {c.connectivity === 'online' ? <Radio size={18} aria-hidden="true" /> : <CircleOff size={18} aria-hidden="true" />}
        <strong>{t(`adm.health.${c.connectivity}`)}</strong>
        {stale && <span className="adm-tag">{t('adm.health.lastReported')}</span>}
        {!online && !c.lastHeartbeatAt && <span className="adm-conn__sub">{t('adm.health.noHeartbeat')}</span>}
      </p>
      <dl className="adm-hcard__dl">
        <div><dt>{t('adm.health.pending')}</dt><dd className="adm-num" data-testid={`text-health-pending-${c.clinicId}`}>{pending}</dd></div>
        <div><dt>{t('adm.health.lastSync')}</dt><dd data-testid={`text-health-sync-${c.clinicId}`}>{c.lastSuccessfulSyncAt ? fmt(c.lastSuccessfulSyncAt) : t('adm.health.neverSynced')}</dd></div>
        <div><dt>{t('adm.health.lastHeartbeat')}</dt><dd data-testid={`text-health-heartbeat-${c.clinicId}`}>{c.lastHeartbeatAt ? fmt(c.lastHeartbeatAt) : t('adm.common.never')}{hbStale && <span className="adm-tag">{t('adm.health.stale')}</span>}</dd></div>
        <div><dt>{t('adm.health.conflicts')}</dt><dd className="adm-num">{n(c.serverOpenConflictCount)}</dd></div>
      </dl>
      <p className="adm-cov" data-testid={`text-health-coverage-${c.clinicId}`}>
        <span className="adm-cov__label">{t('adm.health.coverage')}</span>
        {cov.trustedDeviceCount === 0 ? t('adm.health.noDevices')
          : cov.complete ? t('adm.health.coverageComplete', { count: cov.trustedDeviceCount })
          : t('adm.health.coverageIncomplete', { fresh: cov.freshDeviceCount, trusted: cov.trustedDeviceCount, stale: cov.staleDeviceCount, unknown: cov.unknownDeviceCount })}
      </p>
      {c.devices.length > 0 && (
        <details className="adm-devs">
          <summary data-testid={`button-health-devices-${c.clinicId}`}><ChevronDown size={16} aria-hidden="true" />{t('adm.health.devices', { count: c.devices.length })}</summary>
          <ul>{c.devices.map(d => (
            <li key={d.deviceId} data-testid={`row-health-device-${d.deviceId}`}>
              <span className="adm-mono">{d.label}</span>
              <span>{t(`adm.health.deviceTrust.${d.trustStatus}`)} · {t(`adm.health.${d.connectivity}`)}</span>
              <span>{t('adm.health.pending')}: {d.unsubmittedOperationCount === null ? t('adm.health.pendingUnknown') : n(d.unsubmittedOperationCount)}</span>
              <span>{t('adm.health.lastHeartbeat')}: {d.lastHeartbeatAt ? fmt(d.lastHeartbeatAt) : t('adm.common.never')}</span>
            </li>))}
          </ul>
        </details>
      )}
    </li>
  );
}
