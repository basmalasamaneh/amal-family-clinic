import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'wouter';
import { CalendarCheck, ChevronRight, Clock, UserRound } from 'lucide-react';
import { AmalIcons, PageHeader, useAmalPreferences } from '@workspace/amal-ui';
const Stethoscope = AmalIcons.myDay;
import { getDoctorDay } from '@workspace/api-client-react';
import type { ShellClinic } from '@/shell/identity';
import { demoPath } from '@/shell/identity';
import { ConsentBadge, KeyAlertChip, NoAlerts } from '@/network/indicators';
import { Empty, Skeleton } from '@/network/NetworkSearchPage';
import { clearSelection, effectiveConsent, patientAlerts, setSelection } from '@/network/model';
import { addLocalDays, formatLocalDate, isLocalDate, localDateOf, weekDates } from '@/calendar/dates';
import { DAY_PAGE_LIMIT, MAX_DAY_PAGES, formatScheduleTime, hebronToday, msUntilHebronMidnight, orderDay, statusKey } from './model';
import { useProtectedPages } from './use-protected';
import { FailState } from './FailState';
import '@/network/network.css';
import './doctor.css';
import './i18n';

type DayPage = Awaited<ReturnType<typeof getDoctorDay>>;
type DayItem = DayPage['items'][number];
const SHOWN_ALERTS = 3;
type ScheduleView = 'day' | 'week';
type PageProps = { clinic: ShellClinic | null; title: string; scope: string };

export function MyDayPage(props: PageProps) {
  const [day, setDay] = useState(() => hebronToday(new Date()));
  const [view, setView] = useState<ScheduleView>('day');
  const [followingToday, setFollowingToday] = useState(true);
  // Browsing is intentional: focus must never replace a historical/future selection.
  useEffect(() => {
    if (!followingToday) return;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      clearTimeout(timer);
      setDay(hebronToday(new Date()));
      timer = setTimeout(check, msUntilHebronMidnight(new Date()));
    };
    check();
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => { clearTimeout(timer); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, [followingToday]);
  const selectDay = (date: string) => {
    if (!isLocalDate(date)) return;
    setFollowingToday(false);
    setDay(date);
  };
  const today = () => { setDay(hebronToday(new Date())); setView('day'); setFollowingToday(true); };
  // Remount the protected read on interval changes: no old records flash under a new heading.
  return <DaySchedule key={`${props.scope}:${day}:${view}`} {...props} day={day} view={view} selectDay={selectDay} selectView={setView} today={today} />;
}

function DaySchedule({ clinic, title, scope, day, view, selectDay, selectView, today }: PageProps & {
  day: string; view: ScheduleView; selectDay: (date: string) => void; selectView: (view: ScheduleView) => void; today: () => void;
}) {
  const { t } = useTranslation();
  const { locale, digitPreference } = useAmalPreferences();
  const { state, reload, loadMore } = useProtectedPages<DayPage>(`${scope}:${day}:${view}`,
    (cursor, signal) => getDoctorDay({ date: day, view, limit: DAY_PAGE_LIMIT, ...(cursor ? { cursor } : {}) }, { signal, cache: 'no-store' }),
    MAX_DAY_PAGES);
  const listRef = useRef<HTMLOListElement>(null); const wantFocus = useRef(false);
  useEffect(() => { if (state.kind === 'ok' && wantFocus.current) { wantFocus.current = false; listRef.current?.focus(); } }, [state]);
  useEffect(() => { if (state.kind === 'fail' && state.why !== 'error') clearSelection(); }, [state]);

  const shownDay = state.kind === 'ok' && isLocalDate(state.first.day) ? state.first.day : day;
  const dates = view === 'week' ? weekDates(shownDay) : [shownDay];
  const dateLabel = (date: string) => formatLocalDate(date, locale, digitPreference);
  const start = dateLabel(dates[0]);
  const end = dateLabel(dates[dates.length - 1]);
  const isToday = day === hebronToday(new Date());
  const items = state.kind === 'ok' ? orderDay(state.items as DayItem[]) : [];

  return (
    <section className="net doc" data-testid="page-myDay" aria-busy={state.kind === 'loading'}>
      <PageHeader icon={Stethoscope} section="reception" eyebrow={<>{clinic && <><bdi>{clinic.name}</bdi> · </>}{t('doc.day.browse')}</>} title={title}>
        <p className="doc-date" data-testid="text-day-date"><CalendarCheck size={18} aria-hidden="true" />{view === 'week' ? t('doc.day.weekDateLine', { start, end }) : t(isToday ? 'doc.day.dateLine' : 'doc.day.selectedDateLine', { date: start })}</p>
        <p className="net-hint">{t('doc.day.scope')}</p>
      </PageHeader>
      <div className="doc-browse" role="group" aria-label={t('doc.day.browse')}>
        <div className="doc-browse__views" role="group" aria-label={t('doc.day.browse')}>
          {(['day', 'week'] as const).map((v) => <button key={v} type="button" className="amal-btn amal-btn--secondary" aria-pressed={view === v} onClick={() => selectView(v)} data-testid={`button-day-view-${v}`}>{t(`doc.day.${v}View`)}</button>)}
        </div>
        <label className="doc-browse__date">{t('doc.day.chooseDate')}<input type="date" value={day} onChange={(e) => selectDay(e.target.value)} data-testid="input-day-date" /></label>
        <div className="doc-browse__steps">
          <button type="button" className="amal-btn amal-btn--secondary" onClick={() => selectDay(addLocalDays(day, view === 'week' ? -7 : -1))} data-testid="button-day-previous">{t(view === 'week' ? 'doc.day.previousWeek' : 'doc.day.previousDay')}</button>
          <button type="button" className="amal-btn amal-btn--secondary" onClick={today} data-testid="button-day-today">{t('doc.day.today')}</button>
          <button type="button" className="amal-btn amal-btn--secondary" onClick={() => selectDay(addLocalDays(day, view === 'week' ? 7 : 1))} data-testid="button-day-next">{t(view === 'week' ? 'doc.day.nextWeek' : 'doc.day.nextDay')}</button>
        </div>
      </div>
      <p className="net-sr" role="status" aria-live="polite" data-testid="status-my-day">{state.kind === 'loading' ? t('doc.common.loading') : ''}</p>

      {state.kind === 'loading' && <Skeleton rows={3} />}
      {state.kind === 'fail' && <FailState why={state.why} onRetry={reload} testPrefix="day" />}
      {state.kind === 'ok' && items.length === 0 && <Empty icon={<Clock size={30} />} title={t(view === 'week' ? 'doc.day.weekEmptyTitle' : isToday ? 'doc.day.emptyTitle' : 'doc.day.selectedEmptyTitle')} desc={t(view === 'week' ? 'doc.day.weekEmptyDesc' : isToday ? 'doc.day.emptyDesc' : 'doc.day.selectedEmptyDesc', { date: start, start, end })} testId="state-day-empty" gold />}
      {state.kind === 'ok' && items.length > 0 && (
        <>
          <ol ref={listRef} tabIndex={-1} className="doc-day" aria-label={t(view === 'week' ? 'doc.day.weekListLabel' : isToday ? 'doc.day.listLabel' : 'doc.day.selectedListLabel')} data-testid="list-my-day">
            {view === 'day' ? items.map((it) => <DayRow key={it.id} it={it} digits={digitPreference} scope={scope} />) : dates.map((date) => {
              const group = items.filter((it) => localDateOf(it.startsAt) === date);
              return <li key={date} className="doc-week-group" data-testid={`group-day-${date}`}>
                <h2>{dateLabel(date)}</h2>
                {group.length ? <ol className="doc-day" aria-label={dateLabel(date)}>{group.map((it) => <DayRow key={it.id} it={it} digits={digitPreference} scope={scope} />)}</ol> : <p className="doc-week-empty">{t(state.nextCursor || state.capped ? 'doc.day.pendingGroup' : 'doc.day.emptyGroup')}</p>}
              </li>;
            })}
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
      <time className="doc-row__time" dateTime={it.startsAt} data-testid={`text-day-time-${it.id}`} aria-label={t('doc.day.at', { time })}><bdi dir="ltr">{time}</bdi></time>
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
