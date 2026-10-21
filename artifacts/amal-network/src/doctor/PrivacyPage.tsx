import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Eye, EyeOff, Globe2, Lock, ScrollText, UserRound } from 'lucide-react';
import { AmalIcons, PageHeader, useAmalPreferences } from '@workspace/amal-ui';
const ShieldCheck = AmalIcons.privacy;
import { getDoctorPrivacy, listDoctorAudit } from '@workspace/api-client-react';
import type { ShellClinic } from '@/shell/identity';
import { Empty, Skeleton } from '@/network/NetworkSearchPage';
import { formatVisitDay } from '@/network/model';
import { AUDIT_PAGE_LIMIT, MAX_AUDIT_PAGES, formatAuditInstant, privacyView } from './model';
import { useProtected, useProtectedPages } from './use-protected';
import { FailState } from './FailState';
import '@/network/network.css';
import './doctor.css';
import './i18n';

type AuditPage = Awaited<ReturnType<typeof listDoctorAudit>>;
type AuditItem = AuditPage['items'][number];

export function PrivacyPage({ clinic, title, scope }: { clinic: ShellClinic | null; title: string; scope: string }) {
  const { t } = useTranslation();
  const privacy = useProtected(scope, (signal) => getDoctorPrivacy({ signal, cache: 'no-store' }));
  const audit = useProtectedPages<AuditPage>(scope,
    (cursor, signal) => listDoctorAudit({ limit: AUDIT_PAGE_LIMIT, ...(cursor ? { cursor } : {}) }, { signal, cache: 'no-store' }),
    MAX_AUDIT_PAGES);
  const a = audit.state;
  const listRef = useRef<HTMLOListElement>(null); const wantFocus = useRef(false);
  useEffect(() => { if (a.kind === 'ok' && wantFocus.current) { wantFocus.current = false; listRef.current?.focus(); } }, [a]);

  return (
    <section className="net doc" data-testid="page-privacy">
      <PageHeader icon={ShieldCheck} section="network" eyebrow={<>{clinic && <><bdi>{clinic.name}</bdi> · </>}{t('doc.privacy.eyebrow')}</>} title={title} />

      <aside className="doc-statement" aria-label={t('doc.privacy.statementLabel')} data-testid="text-no-performance">
        <p lang="ar" dir="rtl" data-testid="text-no-performance-ar">{t('doc.privacy.statement', { lng: 'ar' })}</p>
        <p lang="en" dir="ltr" data-testid="text-no-performance-en">{t('doc.privacy.statement', { lng: 'en' })}</p>
      </aside>

      <section className="doc-panel" aria-labelledby="doc-mode-h" aria-busy={privacy.state.kind === 'loading'} data-testid="section-privacy-mode">
        <h2 id="doc-mode-h" className="net-h2">{t('doc.privacy.modeHeading')}</h2>
        <p className="net-hint"><Lock size={14} aria-hidden="true" /> {t('doc.privacy.readOnly')}</p>
        {privacy.state.kind === 'loading' && <Skeleton rows={1} />}
        {privacy.state.kind === 'fail' && <FailState why={privacy.state.why} onRetry={privacy.reload} testPrefix="privacy" />}
        {privacy.state.kind === 'ok' && <ModeView data={privacy.state.data} />}
      </section>

      <section className="doc-panel" aria-labelledby="doc-audit-h" aria-busy={a.kind === 'loading'} data-testid="section-audit">
        <h2 id="doc-audit-h" className="net-h2"><ScrollText size={20} aria-hidden="true" /> {t('doc.privacy.auditHeading')}</h2>
        <p className="net-hint">{t('doc.privacy.auditDesc')}</p>
        {a.kind === 'loading' && <Skeleton rows={3} />}
        {a.kind === 'fail' && <FailState why={a.why} onRetry={audit.reload} testPrefix="audit" />}
        {a.kind === 'ok' && a.items.length === 0 && <Empty icon={<EyeOff size={30} />} title={t('doc.privacy.auditEmptyTitle')} desc={t('doc.privacy.auditEmptyDesc')} testId="state-audit-empty" gold />}
        {a.kind === 'ok' && a.items.length > 0 && (
          <>
            <ol ref={listRef} tabIndex={-1} className="doc-audit" aria-label={t('doc.privacy.auditListLabel')} data-testid="list-audit">
              {(a.items as AuditItem[]).map((e) => <AuditRow key={e.id} e={e} />)}
            </ol>
            {a.nextCursor && (
              <button type="button" className="amal-btn amal-btn--secondary doc-more" onClick={() => { wantFocus.current = true; audit.loadMore(); }} data-testid="button-audit-more">
                {t('doc.common.loadMore')}
              </button>
            )}
            {a.capped ? <p className="net-hint" data-testid="status-audit-capped">{t('doc.privacy.capped')}</p>
              : !a.nextCursor && <p className="net-hint" data-testid="status-audit-end">{t('doc.privacy.end')}</p>}
          </>
        )}
      </section>
    </section>
  );
}

function ModeView({ data }: { data: Awaited<ReturnType<typeof getDoctorPrivacy>> }) {
  const { t } = useTranslation();
  const v = privacyView(data);
  return (
    <dl className="doc-mode" data-testid="privacy-mode" data-mode={v.mode} data-sharing={v.sharing}>
      <div>
        <dt>{t('doc.privacy.modeLabel')}</dt>
        <dd>
          <span className={`doc-mode__pill doc-mode__pill--${v.mode}`} data-testid="text-privacy-mode">{t(`doc.privacy.mode.${v.mode}`)}</span>
          {data?.clinic?.name && <span className="net-clinic"><Building2 size={14} aria-hidden="true" /><bdi dir="auto" data-testid="text-privacy-clinic">{data.clinic.name}</bdi></span>}
          <p className="net-hint" data-testid="text-privacy-mode-desc">{t(`doc.privacy.modeDesc.${v.mode}`)}</p>
          {!data.trialStateAvailable && <p className="net-hint">{t('doc.privacy.mode.trialUnavailable')}</p>}
        </dd>
      </div>
      <div>
        <dt>{t('doc.privacy.sharingLabel')}</dt>
        <dd>
          <span className="doc-mode__pill" data-testid="text-privacy-sharing">{v.sharing === 'consent' ? <Globe2 size={14} aria-hidden="true" /> : <Lock size={14} aria-hidden="true" />}{t(`doc.privacy.sharing.${v.sharing}`)}</span>
          <p className="net-hint">{t(`doc.privacy.sharingDesc.${v.sharing}`)}</p>
        </dd>
      </div>
    </dl>
  );
}

function AuditRow({ e }: { e: AuditItem }) {
  const { t } = useTranslation();
  const { locale, digitPreference } = useAmalPreferences();
  const when = formatAuditInstant(e.at, digitPreference);
  const action = e.action === 'patient-view' ? 'patient-view' : 'unknown';
  return (
    <li className="doc-audit__row" data-testid={`row-audit-${e.id}`}>
      <span className="doc-audit__icon" aria-hidden="true"><Eye size={18} /></span>
      <div className="doc-audit__body">
        <p className="doc-audit__what">
          <strong>{e.viewerName ? <span data-testid={`text-audit-viewer-${e.id}`}>{t('doc.privacy.viewerRoleGeneric')}</span> : <span data-testid={`text-audit-viewer-${e.id}`} className="doc-unknown">{t('doc.privacy.unknownViewer')}</span>}</strong>
          <span className="net-clinic"><Building2 size={14} aria-hidden="true" />{e.viewerClinicName ? <bdi dir="auto" data-testid={`text-audit-clinic-${e.id}`}>{e.viewerClinicName}</bdi> : <span data-testid={`text-audit-clinic-${e.id}`} className="doc-unknown">{t('doc.privacy.unknownClinic')}</span>}</span>
        </p>
        <p className="doc-audit__meta">
          <span className="net-tag" data-testid={`text-audit-action-${e.id}`}>{t(`doc.privacy.action.${action}`)}</span>
          <span><UserRound size={14} aria-hidden="true" /><bdi dir="auto" data-testid={`text-audit-patient-${e.id}`}>{e.patient?.name}</bdi></span>
          <time dateTime={e.at} data-testid={`text-audit-time-${e.id}`}>{when.day ? t('doc.privacy.viewedAt', { day: formatVisitDay(when.day, locale, digitPreference), time: when.time }) : ''}</time>
        </p>
      </div>
    </li>
  );
}
