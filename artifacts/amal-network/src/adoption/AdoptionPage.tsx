import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { BarChart3, Download, EyeOff, Handshake, LogOut, RefreshCw, RotateCcw, ShieldCheck, Undo2 } from 'lucide-react';
import { useAmalPreferences } from '@workspace/amal-ui';
import {
  exportClinic, getGetAdoptionResultsQueryKey, getGetClinicAdoptionQueryKey, useGetAdoptionResults, type AdoptionResultMetric, leaveClinic, transitionClinicAdoption, useGetClinicAdoption,
  type ClinicAdoption,
} from '@workspace/api-client-react';
import type { ShellClinic } from '@/shell/identity';
import { demoPath } from '@/shell/identity';
import { formatDateOnly, formatInstant, formatNumber } from '@/shell/formatting';
import { addDays } from '@/kpi/model';
import { Skeleton } from '@/network/NetworkSearchPage';
import { clearSelection as clearNetworkSelection } from '@/network/model';
import { clearConsentSelection } from '@/consent/model';
import {
  classifyFailure, clearMarker, createMutex, dropsRemote, keepsMarker, readMarker, writeMarker, isCrossClinicKey, isLifecycle, mayStart, reasonKey, METRIC_KEYS,
  type ActionKind, type ActionTarget, type FailureKind, type MetricKey,
} from './model';
import '@/network/network.css';
import '@/doctor/doctor.css';
import './adoption.css';
import './i18n';

type Msg = { tone: 'ok' | 'pending' | 'error'; text: string } | null;

const online = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

export function AdoptionPage({ clinic, accountId, title, landing, canSeePrivacy, onRefresh }: { clinic: ShellClinic | null; accountId: string; title: string; landing: string | null; canSeePrivacy: boolean; onRefresh: (strict?: boolean) => Promise<void> }) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const id = clinic?.id ?? 0;
  const adoption = useGetClinicAdoption(id, { query: { enabled: !!clinic, queryKey: getGetClinicAdoptionQueryKey(id), networkMode: 'always', retry: false, refetchOnWindowFocus: true, refetchInterval: 60_000, refetchIntervalInBackground: false }, request: { cache: 'no-store' } });

  const mutex = useRef(createMutex());
  const [busy, setBusy] = useState<ActionKind | null>(null);
  // Restored from sessionStorage on mount; never auto-submitted, only offered as a deliberate exact retry.
  const [unresolved, setUnresolved] = useState<ActionTarget | null>(() => (clinic ? readMarker(accountId, clinic.id) : null));
  const [msg, setMsg] = useState<Msg>(null);

  const clearCrossClinic = () => {
    clearNetworkSelection(); clearConsentSelection();
    void qc.cancelQueries({ predicate: (q) => isCrossClinicKey(q.queryKey) });
    qc.removeQueries({ predicate: (q) => isCrossClinicKey(q.queryKey) });
  };

  const refreshAuthority = async () => {
    await qc.invalidateQueries({ queryKey: getGetClinicAdoptionQueryKey(id) });
    try { await onRefresh(true); } catch { /* shell shows its own identity error */ }
  };

  const run = async (kind: ActionKind) => {
    if (!clinic) return;
    const target = { kind, clinicId: clinic.id };
    if (!mayStart(target, unresolved)) return;
    if (!online()) { setMsg({ tone: 'error', text: t('adoption.msg.offline') }); return; }
    if (!mutex.current.acquire(target)) return;
    if (isLifecycle(kind)) { writeMarker(accountId, target); setUnresolved(target); clearCrossClinic(); }
    setBusy(kind); setMsg({ tone: 'pending', text: t('adoption.msg.pending') });
    try {
      if (kind === 'export') {
        const data = await exportClinic(clinic.id, {});
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `amal-clinic-${clinic.id}-export.json`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
        setMsg({ tone: 'ok', text: t('adoption.msg.exportDone') });
      } else {
        const next: ClinicAdoption = kind === 'leave'
          ? await leaveClinic(clinic.id, { confirm: true })
          : await transitionClinicAdoption(clinic.id, { state: kind });
        clearMarker(accountId, clinic.id); setUnresolved(null);
        qc.setQueryData(getGetClinicAdoptionQueryKey(clinic.id), next);
        if (dropsRemote(kind)) clearCrossClinic();
        setMsg({ tone: 'ok', text: t(`adoption.msg.${kind}Done`) });
        void refreshAuthority();
      }
    } catch (err) {
      const why: FailureKind = classifyFailure(err);
      if (isLifecycle(kind)) {
        if (keepsMarker(why)) { writeMarker(accountId, target); setUnresolved(target); clearCrossClinic(); }
        else { clearMarker(accountId, clinic.id); setUnresolved(null); }
      }
      setMsg({ tone: 'error', text: t(`adoption.msg.${why}`) });
      if (why !== 'offline' && why !== 'busy') void refreshAuthority();
    } finally {
      mutex.current.release(); setBusy(null);
    }
  };

  const refresh = async () => {
    if (!online()) { setMsg({ tone: 'error', text: t('adoption.msg.offline') }); return; }
    await adoption.refetch();
  };

  const data = adoption.data;
  const ready = !!data && !adoption.isError;

  return (
    <section className="net doc adopt" data-testid="page-adoption">
      <header className="net-head">
        <p className="net-eyebrow">{clinic && <><bdi>{clinic.name}</bdi> · </>}{t('adoption.eyebrow')}</p>
        <h1 id="page-title" tabIndex={-1} className="net-h1">{title}</h1>
        <p className="adopt-lead">{t('adoption.lead')}</p>
      </header>

      <aside className="adopt-pledge" aria-labelledby="adopt-pledge-h" data-testid="text-no-monitoring">
        <h2 id="adopt-pledge-h" className="adopt-pledge__title"><EyeOff size={22} aria-hidden="true" />{t('adoption.monitoring.title')}</h2>
        <p>{t('adoption.monitoring.body')}</p>
        <ul>
          <li>{t('adoption.monitoring.detail1')}</li>
          <li>{t('adoption.monitoring.detail2')}</li>
          <li>{t('adoption.monitoring.detail3')}</li>
        </ul>
        {canSeePrivacy && <Link href={demoPath('/doctor/privacy')} className="adopt-link" data-testid="link-adoption-privacy"><ShieldCheck size={16} aria-hidden="true" />{t('shell.nav.privacy')}</Link>}
      </aside>

      <section className="doc-panel" aria-labelledby="adopt-status-h" aria-busy={adoption.isFetching} data-testid="state-adoption-status" data-state={ready ? data!.state : adoption.isError ? 'error' : 'loading'}>
        <div className="adopt-row">
          <h2 id="adopt-status-h" className="net-h2">{t('adoption.status.heading')}</h2>
          <button type="button" className="amal-btn amal-btn--secondary amal-btn--sm" onClick={() => void refresh()} disabled={adoption.isFetching || busy !== null} data-testid="button-adoption-refresh">
            <RefreshCw size={16} aria-hidden="true" />{t('adoption.status.refresh')}
          </button>
        </div>
        {!clinic && <p className="net-hint">{t('shell.page.noClinic')}</p>}
        {clinic && adoption.isLoading && <Skeleton rows={1} />}
        {clinic && adoption.isError && <p className="adopt-msg adopt-msg--error" role="alert">{t('adoption.msg.loadError')}</p>}
        {ready && <StatusView a={data!} />}
      </section>

      <section className="doc-panel" aria-labelledby="adopt-modes-h">
        <h2 id="adopt-modes-h" className="net-h2">{t('adoption.modes.heading')}</h2>
        <dl className="adopt-modes">
          <div><dt>{t('adoption.modes.trialLite')}</dt><dd>{t('adoption.modes.trialLiteBody')}</dd></div>
          <div><dt>{t('adoption.modes.full')}</dt><dd>{t('adoption.modes.fullBody')}</dd></div>
        </dl>
        <p className="net-hint">{t('adoption.modes.voluntary')}</p>
      </section>

      <ResultsPanel />

      <section className="doc-panel" aria-labelledby="adopt-actions-h">
        <h2 id="adopt-actions-h" className="net-h2">{t('adoption.actions.heading')}</h2>
        <p className="adopt-msg" data-tone={msg?.tone ?? 'none'} role={msg?.tone === 'error' ? 'alert' : 'status'} aria-live="polite" data-testid="state-adoption-message">{msg?.text}</p>
        {unresolved && (
          <button type="button" className="amal-btn amal-btn--primary" disabled={busy !== null} onClick={() => void run(unresolved.kind)} data-testid="button-adoption-retry">
            <RotateCcw size={16} aria-hidden="true" />{t('adoption.msg.retry')}
          </button>
        )}
        {ready && <Actions a={data!} busy={busy} blocked={unresolved} onRun={(k) => void run(k)} />}
        <button type="button" className="amal-btn amal-btn--secondary adopt-dismiss" disabled={busy === 'export'} onClick={() => navigate(demoPath(landing ?? '/'))} data-testid="button-adoption-dismiss">
          <Undo2 size={16} aria-hidden="true" className="shell-dir-icon" />{t('adoption.actions.dismiss')}
        </button>
      </section>
    </section>
  );
}

function StatusView({ a }: { a: ClinicAdoption }) {
  const { t } = useTranslation();
  const { locale, digitPreference } = useAmalPreferences();
  const since = a.membershipStatus === 'left' ? a.leftAt : a.state === 'full' ? a.fullStartedAt : a.state === 'lite' ? a.liteStartedAt : a.trialStartedAt;
  return (
    <dl className="adopt-status">
      <div><dt>{t('adoption.status.state')}</dt><dd><span className={`adopt-badge adopt-badge--${a.state}`} data-testid="text-adoption-state"><Handshake size={14} aria-hidden="true" />{t(`adoption.status.${a.state}`)}</span></dd></div>
      <div><dt>{t('adoption.status.membership')}</dt><dd data-testid="text-adoption-membership">{t(`adoption.status.${a.membershipStatus}`)}</dd></div>
      <div><dt>{t('adoption.status.since')}</dt><dd>{since ? <bdi>{formatInstant(since, locale, digitPreference)}</bdi> : t('adoption.status.unknownSince')}</dd></div>
      <div><dt>{t('adoption.modes.heading')}</dt><dd>{a.capabilities.networkSharing ? t('adoption.status.sharingOn') : t('adoption.status.sharingOff')}</dd></div>
    </dl>
  );
}

function Actions({ a, busy, blocked, onRun }: { a: ClinicAdoption; busy: ActionKind | null; blocked: ActionTarget | null; onRun: (k: ActionKind) => void }) {
  const { t } = useTranslation();
  const c = a.capabilities;
  const left = a.membershipStatus === 'left';
  const dis = (k: ActionKind) => busy !== null || (blocked !== null && blocked.kind !== k);
  const label = (k: ActionKind, text: string) => (busy === k ? t('adoption.msg.pending') : text);
  const canFull = c.canManage && !left && a.allowedTransitions.includes('full') && a.state !== 'full';
  const canLite = c.canManage && !left && a.allowedTransitions.includes('lite') && a.state !== 'lite';
  return (
    <div className="adopt-actions">
      {!c.canManage && <p className="net-hint" data-testid="text-adoption-readonly">{t('adoption.status.readOnly')}</p>}
      {left && <p className="net-hint">{t('adoption.actions.leftNote')}</p>}
      {canFull && (
        <article className="adopt-choice adopt-choice--full">
          <h3>{t('adoption.actions.fullTitle')}</h3>
          <p id="adopt-full-c">{t('adoption.actions.fullConsequences')}</p>
          <button type="button" className="amal-btn amal-btn--primary" aria-describedby="adopt-full-c" disabled={dis('full')} onClick={() => onRun('full')} data-testid="button-adoption-full">
            <Handshake size={16} aria-hidden="true" />{label('full', t('adoption.actions.full'))}
          </button>
        </article>
      )}
      <article className="adopt-choice">
        <h3>{t('adoption.actions.liteTitle')}</h3>
        <p id="adopt-lite-c">{t('adoption.actions.liteConsequences')}</p>
        {canLite
          ? <button type="button" className="amal-btn amal-btn--secondary" aria-describedby="adopt-lite-c" disabled={dis('lite')} onClick={() => onRun('lite')} data-testid="button-adoption-lite">{label('lite', t('adoption.actions.lite'))}</button>
          : a.state === 'lite' && <p className="net-hint">{t('adoption.actions.alreadyLite')}</p>}
      </article>
      {c.canExport && (
        <article className="adopt-choice">
          <h3>{t('adoption.actions.exportTitle')}</h3>
          <p id="adopt-export-c">{t('adoption.actions.exportConsequences')}</p>
          <button type="button" className="amal-btn amal-btn--secondary" aria-describedby="adopt-export-c" disabled={dis('export')} onClick={() => onRun('export')} data-testid="button-adoption-export">
            <Download size={16} aria-hidden="true" />{label('export', t('adoption.actions.export'))}
          </button>
        </article>
      )}
      {c.canLeave && !left && (
        <article className="adopt-choice adopt-choice--leave">
          <h3>{t('adoption.actions.leaveTitle')}</h3>
          <p id="adopt-leave-c">{t('adoption.actions.leaveConsequences')}</p>
          <button type="button" className="amal-btn amal-btn--secondary adopt-leave" aria-describedby="adopt-leave-c" disabled={dis('leave')} onClick={() => onRun('leave')} data-testid="button-adoption-leave">
            <LogOut size={16} aria-hidden="true" className="shell-dir-icon" />{label('leave', t('adoption.actions.leave'))}
          </button>
        </article>
      )}
      {c.canManage && !canFull && !canLite && !c.canLeave && !c.canExport && <p className="net-hint">{t('adoption.actions.noneAvailable')}</p>}
    </div>
  );
}

function ResultsPanel() {
  const { t } = useTranslation();
  const { locale, digitPreference } = useAmalPreferences();
  const q = useGetAdoptionResults({ query: { queryKey: getGetAdoptionResultsQueryKey(), networkMode: 'always', retry: false, refetchOnWindowFocus: false }, request: { cache: 'no-store' } });
  const res = q.data;
  const ok = !!res && res.available && res.clinics.length === 2;
  const d = (s: string) => formatDateOnly(s, locale, digitPreference);
  return (
    <section className="doc-panel" aria-labelledby="adopt-res-h" aria-busy={q.isLoading} data-testid="results-adoption" data-state={q.isLoading ? 'loading' : q.isError ? 'error' : ok ? 'available' : 'unavailable'}>
      <h2 id="adopt-res-h" className="net-h2"><BarChart3 size={20} aria-hidden="true" /> {t('adoption.results.heading')}</h2>
      <p className="net-hint">{t('adoption.results.desc')}</p>
      {q.isLoading && <Skeleton rows={2} />}
      {q.isError && (
        <div className="adopt-unavail" role="alert">
          <strong>{t('adoption.results.loadError')}</strong>
          <button type="button" className="amal-btn amal-btn--secondary amal-btn--sm" onClick={() => void q.refetch()} data-testid="button-adoption-results-retry"><RotateCcw size={14} aria-hidden="true" />{t('doc.common.retry')}</button>
        </div>
      )}
      {res && !ok && (
        <div className="adopt-unavail" data-testid="state-results-unavailable"><strong>{t('adoption.results.unavailableTitle')}</strong><p>{t(`adoption.results.reasons.${reasonKey(res.reason)}`)}</p></div>
      )}
      {res && ok && (
        <>
          <dl className="adopt-meta adopt-meta--top">
            <div><dt>{t('adoption.results.window')}</dt><dd data-testid="text-results-window"><bdi>{d(res.window.startDate)} – {d(addDays(res.window.endDateExclusive, -1))}</bdi> ({t('adoption.results.days', { count: res.window.days, n: formatNumber(res.window.days, locale, digitPreference) })})</dd></div>
            <div><dt>{t('adoption.results.calculated')}</dt><dd data-testid="text-results-generated"><bdi>{formatInstant(res.generatedAt, locale, digitPreference)}</bdi></dd></div>
            <div><dt>{t('adoption.results.version')}</dt><dd><bdi>{res.calculationVersion}</bdi></dd></div>
          </dl>
          <div className="adopt-results">
            {res.clinics.map((c) => (
              <article key={c.clinicId} className="adopt-result" data-testid={`card-result-${c.clinicId}`}>
                <h3><bdi>{c.clinicName}</bdi></h3>
                {METRIC_KEYS.map((k) => <MetricView key={k} k={k} m={c[k]} testId={`metric-${c.clinicId}-${k}`} />)}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function MetricView({ k, m, testId }: { k: MetricKey; m: AdoptionResultMetric; testId: string }) {
  const { t } = useTranslation();
  const { locale, digitPreference } = useAmalPreferences();
  const n = (v: number, f: number) => formatNumber(Number(v.toFixed(f)), locale, digitPreference);
  const has = m.available && m.value !== null;
  return (
    <div className="adopt-metric" data-testid={testId} data-available={has}>
      <p className="adopt-metric__label">{t(`adoption.results.metrics.${k}.label`)}</p>
      <p className="adopt-metric__value">
        {has ? <><bdi>{n(m.value!, m.units === 'seconds' ? 1 : 0)}</bdi> <small>{t(`adoption.results.units.${m.units}`)}</small></>
          : <span className="kpi-unavail" data-unavailable="true">{t('adoption.results.unavailableValue')}</span>}
      </p>
      {!has && <p className="net-hint">{t(`adoption.results.reasons.${reasonKey(m.reason)}`)}</p>}
      <dl className="adopt-meta">
        <div><dt>{t('adoption.results.samples')}</dt><dd><bdi>{n(m.sampleCount, 0)}</bdi></dd></div>
      </dl>
      <details className="adopt-details">
        <summary>{t('adoption.results.howMeasured')}</summary>
        <p><strong>{t('adoption.results.coverage')}:</strong> {t(`adoption.results.metrics.${k}.coverage`)}</p>
        <p><strong>{t('adoption.results.provenance')}:</strong> {t(`adoption.results.metrics.${k}.provenance`)}</p>
      </details>
    </div>
  );
}
