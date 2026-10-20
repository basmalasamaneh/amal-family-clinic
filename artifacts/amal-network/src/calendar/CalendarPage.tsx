import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useSearch } from 'wouter';
import { AlertTriangle, CalendarDays, CalendarPlus, CalendarRange, Clock3, RotateCw, UserRoundPlus, UsersRound } from 'lucide-react';
import { EmptyState, useAmalPreferences } from '@workspace/amal-ui';
import { demoPath, type ShellClinic } from '@/shell/identity';
import { DEMO_DATE, resolveSchedulingAdapter, type CalendarAppointment, type CalendarDoctor, type ClinicHours } from './adapter';
import { addLocalDays, dayRange, formatLocalDate, formatMinutes, isLocalDate, localDateOf, localMinutesOf, localToUtc, todayLocal, weekDates, weekRange } from './dates';
import { placeOverlaps } from './layout';
import { bookingQuery } from './booking';
import { AppointmentCard, CalSkeleton, DateNavigator } from './components';
import { setWalkInPageContext } from '@/reception/walkin-bus';
import { useSchedule } from './use-schedule';

/** Keeps explicit dev demo params (calendarDemo) on calendar links; shellDemo is added by demoPath. */
export function calHref(path: string, search: string): string {
  const demo = new URLSearchParams(search).get('calendarDemo');
  if (!demo) return demoPath(path);
  return demoPath(`${path}${path.includes('?') ? '&' : '?'}calendarDemo=${encodeURIComponent(demo)}`);
}

export function CalendarPage({ view, clinic, fixture, title }: { view: 'day' | 'week'; clinic: ShellClinic | null; fixture: boolean; title: string }) {
  const { t } = useTranslation();
  const { locale, digitPreference } = useAmalPreferences();
  const search = useSearch();
  const [, navigate] = useLocation();
  const demoKey = new URLSearchParams(search).get('calendarDemo');
  const adapter = useMemo(() => resolveSchedulingAdapter(search, fixture), [demoKey, fixture]); // eslint-disable-line react-hooks/exhaustive-deps
  const [today] = useMemoToday();
  const params = new URLSearchParams(search);
  const date = isLocalDate(params.get('date')) ? params.get('date')! : today;
  const doctorParam = Number(params.get('doctor')) || null;
  const range = view === 'day' ? dayRange(date) : weekRange(date);
  const { load, retry } = useSchedule(adapter, clinic?.id ?? null, range.from, range.to);

  const doctors = load.state === 'ready' ? load.data.doctors : [];
  const doctorId = doctorParam && doctors.some((d) => d.id === doctorParam) ? doctorParam : null;

  // Publish the validated doctor filter as a Walk-in hint (cleared on leave or clinic change).
  useEffect(() => { setWalkInPageContext(clinic && doctorId ? { clinicId: clinic.id, doctorId } : null); return () => setWalkInPageContext(null); }, [clinic, doctorId]);

  const qs = (next: { date?: string; doctor?: number | null }) => {
    const p = new URLSearchParams();
    const d = next.date ?? date; if (d !== today) p.set('date', d);
    const doc = next.doctor === undefined ? doctorId : next.doctor; if (doc) p.set('doctor', String(doc));
    const s = p.toString(); return s ? `?${s}` : '';
  };
  const go = (path: string, next: { date?: string; doctor?: number | null }) => navigate(calHref(`${path}${qs(next)}`, search));
  const base = view === 'day' ? '/desk/today' : '/desk/week';
  const onDate = (d: string, step?: number) => go(base, { date: step ? addLocalDays(d, step * (view === 'day' ? 1 : 7)) : d });

  // Drop a doctor filter that is not valid for this clinic once doctors are known.
  useEffect(() => {
    if (load.state === 'ready' && doctorParam && !doctorId) go(base, { doctor: null });
  }, [load.state, doctorParam, doctorId]); // eslint-disable-line react-hooks/exhaustive-deps

  const heading = view === 'day' ? formatLocalDate(date, locale, digitPreference) : t('calendar.week.heading', {
    from: formatLocalDate(weekDates(date)[0], locale, digitPreference, 'd MMM'),
    to: formatLocalDate(weekDates(date)[6], locale, digitPreference, 'd MMM yyyy'),
  });

  return (
    <section className="cal" data-testid={`page-calendar-${view}`} data-adapter={adapter.mode}>
      <header className="cal-head">
        <div className="cal-head__title">
          <p className="cal-eyebrow">
            {clinic ? <bdi>{clinic.name}</bdi> : t('shell.page.noClinic')}
            {adapter.mode === 'mock' && <span className="cal-mock" data-testid="badge-mock">{t('calendar.mock', { scenario: t(`calendar.scenarios.${adapter.scenario ?? 'standard'}`) })}</span>}
          </p>
          <h1 id="page-title" tabIndex={-1} className="cal-h1">{title}</h1>
          <p className="cal-date-label" data-testid="text-date-heading">
            {heading}{date === today ? <span className="cal-today-tag">{t('calendar.nav.isToday')}</span> : date === DEMO_DATE && adapter.mode === 'mock' ? <span className="cal-today-tag cal-today-tag--demo">{t('calendar.nav.isDemo')}</span> : null}
          </p>
        </div>
        <div className="cal-actions">
          {clinic && (
            <Link href={calHref(bookingQuery({ clinicId: clinic.id, source: 'phone', localDate: date, ...(doctorId ? { doctorId } : {}) }), search)} className="cal-btn cal-btn--primary" data-testid="link-new-booking">
              <CalendarPlus size={20} aria-hidden="true" />{t('calendar.actions.newBooking')}
            </Link>
          )}
        </div>
      </header>

      <div className="cal-tools">
        <DateNavigator view={view} date={date} today={today} demoDate={adapter.mode === 'mock' ? DEMO_DATE : null} onChange={onDate} />
        <div className="cal-tools__end">
          {doctors.length > 1 && (
            <label className="cal-filter">
              <UsersRound size={18} aria-hidden="true" />
              <span>{t('calendar.filter.label')}</span>
              <select value={doctorId ?? ''} onChange={(e) => go(base, { doctor: Number(e.target.value) || null })} data-testid="select-doctor">
                <option value="">{t('calendar.filter.all')}</option>
                {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          )}
          <div className="cal-switch" role="group" aria-label={t('calendar.view.label')}>
            <Link href={calHref(`/desk/today${qs({})}`, search)} className={`cal-btn${view === 'day' ? ' is-on' : ''}`} aria-current={view === 'day' ? 'page' : undefined} data-testid="link-view-today">
              <CalendarDays size={18} aria-hidden="true" />{t('calendar.view.day')}
            </Link>
            <Link href={calHref(`/desk/week${qs({})}`, search)} className={`cal-btn${view === 'week' ? ' is-on' : ''}`} aria-current={view === 'week' ? 'page' : undefined} data-testid="link-view-week">
              <CalendarRange size={18} aria-hidden="true" />{t('calendar.view.week')}
            </Link>
          </div>
        </div>
      </div>

      {!clinic ? (
        <EmptyState headingLevel={2} title={t('calendar.state.noClinic')} description={t('calendar.state.noClinicDesc')} />
      ) : load.state === 'loading' ? <CalSkeleton /> : load.state === 'error' ? (
        <div className="cal-state" role="alert" data-testid="state-calendar-error">
          <AlertTriangle size={28} aria-hidden="true" />
          <h2>{t('calendar.state.error')}</h2>
          <p>{t('calendar.state.errorDesc')}</p>
          <button type="button" className="cal-btn cal-btn--primary" onClick={retry} data-testid="button-calendar-retry"><RotateCw size={18} aria-hidden="true" />{t('calendar.state.retry')}</button>
        </div>
      ) : load.data.doctors.length === 0 ? (
        <div data-testid="state-no-doctors"><EmptyState headingLevel={2} title={t('calendar.state.noDoctors')} description={t('calendar.state.noDoctorsDesc')} /></div>
      ) : view === 'day' ? (
        <DayGrid clinicId={clinic.id} date={date} search={search} hours={load.data.hours}
          doctors={doctorId ? load.data.doctors.filter((d) => d.id === doctorId) : load.data.doctors}
          appointments={load.data.appointments.filter((a) => !doctorId || a.doctorId === doctorId)} />
      ) : (
        <WeekGrid date={date} today={today} search={search} doctorId={doctorId} doctors={load.data.doctors}
          appointments={load.data.appointments.filter((a) => !doctorId || a.doctorId === doctorId)} />
      )}
    </section>
  );
}

function useMemoToday(): [string] {
  const ref = useRef<string | null>(null);
  if (ref.current === null) ref.current = todayLocal();
  return [ref.current];
}

function DayGrid({ clinicId, date, search, hours, doctors, appointments }: {
  clinicId: number; date: string; search: string; hours: ClinicHours | null; doctors: CalendarDoctor[]; appointments: CalendarAppointment[];
}) {
  const { t } = useTranslation();
  const { digitPreference } = useAmalPreferences();
  const step = hours?.slotMinutes ?? 30;
  const dayAppts = appointments.filter((a) => localDateOf(a.startsAt) === date);
  const mins = dayAppts.flatMap((a) => [localMinutesOf(a.startsAt), localDateOf(a.endsAt) === date ? localMinutesOf(a.endsAt) : 24 * 60]);
  const open = hours ? hours.open : mins.length ? Math.floor(Math.min(...mins) / 60) * 60 : 0;
  const close = hours ? hours.close : mins.length ? Math.ceil(Math.max(...mins) / 60) * 60 : 0;
  const slots: number[] = [];
  for (let m = open; m < close; m += step) slots.push(m);
  const rowOf = (m: number) => Math.min(Math.max(Math.floor((m - open) / step), 0), slots.length - 1) + 1;

  return (
    <div className="cal-day-wrap">
      {!hours && (
        <p className="cal-note" role="note" data-testid="status-no-hours"><Clock3 size={18} aria-hidden="true" />{t('calendar.state.noHours')}</p>
      )}
      {dayAppts.length === 0 && (
        <p className="cal-note cal-note--soft" role="status" data-testid="state-no-appointments">{t('calendar.state.noAppointments')}</p>
      )}
      {slots.length === 0 && (
        <ul className="cal-docs" aria-label={t('calendar.day.region')} data-testid="calendar-day-doctors">
          {doctors.map((d) => (
            <li key={d.id} className="cal-docs__item" data-testid={`column-doctor-${d.id}`}>
              <h2 className="cal-day__doc"><bdi dir="auto">{d.name}</bdi></h2>
              <p className="cal-week__empty">{t('calendar.week.empty')}</p>
            </li>
          ))}
        </ul>
      )}
      {slots.length > 0 && (
        <div className="cal-day" role="region" aria-label={t('calendar.day.region')} tabIndex={0} data-testid="calendar-day"
          style={{ '--cal-cols': doctors.length, '--cal-rows': slots.length } as CSSProperties}>
          <div className="cal-day__corner" aria-hidden="true" />
          {doctors.map((d) => <h2 key={d.id} className="cal-day__doc" data-testid={`column-doctor-${d.id}`}><bdi dir="auto">{d.name}</bdi></h2>)}
          <ol className="cal-day__times" aria-hidden="true">
            {slots.map((m) => <li key={m}>{formatMinutes(m, digitPreference)}</li>)}
          </ol>
          {doctors.map((d) => {
            const rowsOf = (appt: CalendarAppointment): [number, number] => {
              const s = localMinutesOf(appt.startsAt);
              const e = localDateOf(appt.endsAt) === date ? localMinutesOf(appt.endsAt) : close;
              const r1 = rowOf(s); return [r1, Math.max(r1 + 1, rowOf(Math.max(e - 1, s)) + 1)];
            };
            // Lanes are assigned on rendered rows, so short appointments sharing a row never cover each other.
            const placed = placeOverlaps(dayAppts.filter((a) => a.doctorId === d.id), rowsOf);
            const lanes = Math.max(1, ...placed.map((p) => p.lanes));
            const busy = new Set<number>();
            placed.forEach(({ appt }) => {
              const s = localMinutesOf(appt.startsAt); const e = localDateOf(appt.endsAt) === date ? localMinutesOf(appt.endsAt) : 24 * 60;
              slots.forEach((m) => { if (m < e && m + step > s) busy.add(m); });
            });
            return (
              <ul key={d.id} className="cal-day__col" aria-label={d.name} style={{ '--cal-lanes': lanes } as CSSProperties}>
                {hours && slots.filter((m) => !busy.has(m)).map((m) => (
                  <li key={`s${m}`} style={{ gridRow: rowOf(m), gridColumn: '1 / -1' }}>
                    <Link
                      href={calHref(bookingQuery({ clinicId, doctorId: d.id, source: 'phone', localDate: date, startsAt: localToUtc(date, m), endsAt: localToUtc(date, m + step) }), search)}
                      className="cal-slot" data-testid={`slot-${d.id}-${m}`}
                      aria-label={t('calendar.day.slot', { time: formatMinutes(m, digitPreference), doctor: d.name })}
                    >
                      <span aria-hidden="true">{formatMinutes(m, digitPreference)}</span>
                      <UserRoundPlus size={18} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
                {placed.map(({ appt, lane }) => {
                  const [r1, r2] = rowsOf(appt);
                  return (
                    <li key={appt.id} style={{ gridRow: `${r1} / ${r2}`, gridColumn: lane + 1 }}>
                      <AppointmentCard appt={appt} doctor={d} />
                    </li>
                  );
                })}
              </ul>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WeekGrid({ date, today, search, doctorId, doctors, appointments }: {
  date: string; today: string; search: string; doctorId: number | null; doctors: CalendarDoctor[]; appointments: CalendarAppointment[];
}) {
  const { t } = useTranslation();
  const { locale, digitPreference } = useAmalPreferences();
  const byId = new Map(doctors.map((d) => [d.id, d]));
  return (
    <ol className="cal-week" data-testid="calendar-week">
      {weekDates(date).map((d) => {
        const items = appointments.filter((a) => localDateOf(a.startsAt) === d).sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id - b.id);
        const p = new URLSearchParams(); if (d !== today) p.set('date', d); if (doctorId) p.set('doctor', String(doctorId));
        return (
          <li key={d} className={`cal-week__day${d === today ? ' is-today' : ''}${d === date ? ' is-selected' : ''}`} data-testid={`week-day-${d}`}>
            <h2 className="cal-week__head">
              <Link href={calHref(`/desk/today${p.toString() ? `?${p}` : ''}`, search)} className="cal-week__link" aria-label={t('calendar.week.openDay', { date: formatLocalDate(d, locale, digitPreference) })} data-testid={`link-week-day-${d}`}>
                <span className="cal-week__dow">{formatLocalDate(d, locale, digitPreference, 'EEEE')}</span>
                <span className="cal-week__num">{formatLocalDate(d, locale, digitPreference, 'd MMM')}</span>
              </Link>
            </h2>
            {items.length === 0 ? <p className="cal-week__empty">{t('calendar.week.empty')}</p> : (
              <ul className="cal-week__list">
                {items.map((a) => <li key={a.id}><AppointmentCard appt={a} doctor={byId.get(a.doctorId)} showDoctor={!doctorId} compact /></li>)}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
