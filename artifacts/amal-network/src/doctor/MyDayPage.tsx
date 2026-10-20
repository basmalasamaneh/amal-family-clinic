import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'wouter';
import { CalendarCheck, ChevronRight, Clock, UserRound } from 'lucide-react';
import { useAmalPreferences } from '@workspace/amal-ui';
import { getDoctorDay } from '@workspace/api-client-react';
import type { ShellClinic } from '@/shell/identity';
import { demoPath } from '@/shell/identity';
import { ConsentBadge, KeyAlertChip, NoAlerts } from '@/network/indicators';
import { Empty, Skeleton } from '@/network/NetworkSearchPage';
import { clearSelection, effectiveConsent, formatVisitDay, patientAlerts, setSelection } from '@/network/model';
import { DAY_PAGE_LIMIT, MAX_DAY_PAGES, formatScheduleTime, hebronToday, msUntilHebronMidnight, orderDay, statusKey } from './model';
import { useProtectedPages } from './use-protected';
import { FailState } from './FailState';
import '@/network/network.css';
import './doctor.css';
import './i18n';

type DayPage = Awaited<ReturnType<typeof getDoctorDay>>;
type DayItem = DayPage['items'][number];
const SHOWN_ALERTS = 3;

export function MyDayPage({ clinic, title, scope }: { clinic: ShellClinic | null; title: string; scope: string }) {
  const { t } = useTranslation();
  const { locale, digitPreference } = useAmalPreferences();
  const [day, setDay] = useState(() => hebronToday(new Date()));
  // Roll over at Asia/Hebron midnight, and on focus if the day changed while away.
  useEffect(() => {
    const timer = setTimeout(() => setDay(hebronToday(new Date())), msUntilHebronMidnight(new Date()));
    const check = () => setDay((d) => { const n = hebronToday(new Date()); return n === d ? d : n; });
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => { clearTimeout(timer); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, [day]);

  const { state, reload, loadMore } = useProtectedPages<DayPage>(`${scope}:${day}`,
    (cursor, signal) => getDoctorDay({ limit: DAY_PAGE_LIMIT, ...(cursor ? { cursor } : {}) }, { signal, cache: 'no-store' }),
    MAX_DAY_PAGES);
  const listRef = useRef<HTMLOListElement>(null); const wantFocus = useRef(false);
  useEffect(() => { if (state.kind === 'ok' && wantFocus.current) { wantFocus.current = false; listRef.current?.focus(); } }, [state]);
  useEffect(() => { if (state.kind === 'fail' && state.why !== 'error') clearSelection(); }, [state]);

  const shownDay = state.kind === 'ok' && /^\d{4}-\d{2}-\d{2}$/.test(state.first.day) ? state.first.day : day;
  const items = state.kind === 'ok' ? orderDay(state.items as DayItem[]) : [];

  return (
    <section className="net doc" data-testid="page-myDay" aria-busy={state.kind === 'loading'}>
      <header className="net-head">
        <p className="net-eyebrow">{clinic && <><bdi>{clinic.name}</bdi> · </>}{t('doc.day.eyebrow')}</p>
        <h1 id="page-title" tabIndex={-1} className="net-h1">{title}</h1>
        <p className="doc-date" data-testid="text-day-date"><CalendarCheck size={18} aria-hidden="true" />{t('doc.day.dateLine', { date: formatVisitDay(shownDay, locale, digitPreference) })}</p>
        <p className="net-hint">{t('doc.day.scope')}</p>
      </header>
      <p className="net-sr" role="status" aria-live="polite" data-testid="status-my-day">{state.kind === 'loading' ? t('doc.common.loading') : ''}</p>

      {state.kind === 'loading' && <Skeleton rows={3} />}
      {state.kind === 'fail' && <FailState why={state.why} onRetry={reload} testPrefix="day" />}
      {state.kind === 'ok' && items.length === 0 && <Empty icon={<Clock size={30} />} title={t('doc.day.emptyTitle')} desc={t('doc.day.emptyDesc')} testId="state-day-empty" gold />}
      {state.kind === 'ok' && items.length > 0 && (
        <>
          <ol ref={listRef} tabIndex={-1} className="doc-day" aria-label={t('doc.day.listLabel')} data-testid="list-my-day">
            {items.map((it) => <DayRow key={it.id} it={it} digits={digitPreference} scope={scope} />)}
          </ol>
          {state.nextCursor && (
            <button type="button" className="amal-btn amal-btn--secondary doc-more" onClick={() => { wantFocus.current = true; loadMore(); }} data-testid="button-day-more">
              {t('doc.common.loadMore')}
            </button>
          )}
          {state.capped && <p className="net-hint" data-testid="status-day-capped">{t('doc.day.capped')}</p>}
        </>
      )}
    </section>
  );
}

function DayRow({ it, digits, scope }: { it: DayItem; digits: 'latn' | 'arab'; scope: string }) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const p = it.patient;
  const alerts = patientAlerts(p);
  const shown = alerts.slice(0, SHOWN_ALERTS);
  const status = statusKey(it.status);
  const time = formatScheduleTime(it.startsAt, digits);
  // Stable own-patient id kept in memory only; never in the URL.
  const open = () => { setSelection({ scope, id: p.id }); navigate(demoPath('/doctor/patient-card')); };
  return (
    <li className={`doc-row doc-row--${status}`} data-testid={`row-day-${it.id}`}>
      <time className="doc-row__time" dateTime={it.startsAt} data-testid={`text-day-time-${it.id}`} aria-label={t('doc.day.at', { time })}>{time}</time>
      <div className="doc-row__body">
        <div className="doc-row__top">
          <span className="net-hit__av" aria-hidden="true"><UserRound size={20} /></span>
          <h2 className="doc-row__name" data-testid={`text-day-name-${it.id}`}><bdi dir="auto">{p.name}</bdi></h2>
          <span className={`net-tag doc-status doc-status--${status}`} data-testid={`status-day-${it.id}`}>{t(`doc.day.status.${status}`)}</span>
          <ConsentBadge level={effectiveConsent(p)} testId={`badge-day-consent-${it.id}`} />
        </div>
        {shown.length > 0
          ? <div className="net-flags" aria-label={t('doc.day.alerts')}>{shown.map((a, j) => <KeyAlertChip key={j} alert={a} testId={`chip-day-alert-${it.id}-${j}`} />)}</div>
          : <NoAlerts testId={`status-day-no-alerts-${it.id}`} />}
        {alerts.length > shown.length && <p className="net-hint">{t('doc.day.moreAlerts', { count: alerts.length - shown.length })}</p>}
      </div>
      <button type="button" className="amal-btn amal-btn--secondary doc-row__open" onClick={open} aria-label={t('doc.day.open', { name: p.name })} data-testid={`button-day-open-${it.id}`}>
        {t('doc.day.openShort')}<ChevronRight size={18} aria-hidden="true" className="doc-dir-icon" />
      </button>
    </li>
  );
}
