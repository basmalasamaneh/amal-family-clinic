import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, CalendarCheck, FlaskConical, HelpCircle } from 'lucide-react';
import { StatusBadge, useAmalPreferences } from '@workspace/amal-ui';
import type { CalendarAppointment, CalendarDoctor } from './adapter';
import { formatLocalDate, formatNum, formatTime, localDateOf } from './dates';
import { displayStatus } from './status';
import { useSyncExternalStore } from 'react';
import { useCancellation } from './CancellationProvider';
import type { Schedule } from './use-schedule';
import '../booking/local-messages';

const emptyEntries: never[] = [];
const emptySubscribe = () => () => {};
const emptySnapshot = () => emptyEntries;

export function LocalCalendarNotice({ cache }: { cache: Schedule['localCache'] }) {
  const { t } = useTranslation();
  const { locale, digitPreference } = useAmalPreferences();
  if (!cache) return null;
  const metadata = cache.metadata;
  return <div className="cal-state cal-cache-notice" role="note" data-testid="calendar-cache-coverage">
    {metadata && <p>{t('localBookingUi.coverage', {
      from: formatLocalDate(localDateOf(metadata.coverageStartUtc), locale, digitPreference),
      to: formatLocalDate(localDateOf(new Date(Date.parse(metadata.coverageEndUtc) - 1).toISOString()), locale, digitPreference),
      refreshed: `${formatLocalDate(localDateOf(metadata.refreshedAt), locale, digitPreference)} ${formatTime(metadata.refreshedAt, locale, digitPreference)}`,
    })}</p>}
    {cache.refreshFailed && <p>{t('localBookingUi.refreshFailed')}</p>}
    {cache.incomplete && <p>{t('localBookingUi.incomplete')}</p>}
  </div>;
}

export function DateNavigator({ view, date, today, demoDate, onChange }: {
  view: 'day' | 'week'; date: string; today: string; demoDate: string | null; onChange: (date: string, step?: number) => void;
}) {
  const { t } = useTranslation();
  const { locale, digitPreference } = useAmalPreferences();
  const unit = view === 'day' ? 'day' : 'week';
  return (
    <div className="cal-nav" role="group" aria-label={t('calendar.nav.label')} data-testid="date-navigator">
      <button type="button" className="cal-btn cal-btn--icon" onClick={() => onChange(date, -1)} aria-label={t(`calendar.nav.prev.${unit}`)} data-testid="button-date-prev">
        <ChevronLeft size={22} aria-hidden="true" className="shell-dir-icon" />
      </button>
      <button type="button" className="cal-btn" onClick={() => onChange(today)} aria-pressed={date === today} data-testid="button-date-today">
        <CalendarCheck size={20} aria-hidden="true" />{t('calendar.nav.today')}
      </button>
      <button type="button" className="cal-btn cal-btn--icon" onClick={() => onChange(date, 1)} aria-label={t(`calendar.nav.next.${unit}`)} data-testid="button-date-next">
        <ChevronRight size={22} aria-hidden="true" className="shell-dir-icon" />
      </button>
      <label className="cal-date">
        <span className="shell-sr">{t('calendar.nav.pick')}</span>
        <input type="date" value={date} onChange={(e) => e.target.value && onChange(e.target.value)} data-testid="input-date" />
      </label>
      {demoDate && (
        <button type="button" className="cal-btn cal-btn--demo" onClick={() => onChange(demoDate)} data-testid="button-date-demo">
          <FlaskConical size={18} aria-hidden="true" />{t('calendar.nav.demo', { date: formatLocalDate(demoDate, locale, digitPreference, 'd MMM yyyy') })}
        </button>
      )}
    </div>
  );
}

export function AppointmentCard({ appt, doctor, showDoctor, compact }: { appt: CalendarAppointment; doctor?: CalendarDoctor; showDoctor?: boolean; compact?: boolean }) {
  const { t } = useTranslation();
  const cancellation = useCancellation();
  const entries = useSyncExternalStore(cancellation?.store.subscribe ?? emptySubscribe, cancellation?.store.getSnapshot ?? emptySnapshot);
  const pending = entries.some((item) => item.target.id === appt.id && item.state !== 'failed');
  const { locale, digitPreference } = useAmalPreferences();
  // Waiting for delivery is not a scheduling lifecycle (e.g. Booked or Cancelled).
  const status = displayStatus({ ...appt, syncPending: false });
  const start = formatTime(appt.startsAt, locale, digitPreference);
  const end = formatTime(appt.endsAt, locale, digitPreference);
  const mins = Math.round((Date.parse(appt.endsAt) - Date.parse(appt.startsAt)) / 60000);
  const name = appt.patientName ?? t('calendar.card.noName');
  const statusLabel = status ? t(`status.${status}`, { ns: 'amalUi' }) : t('calendar.card.unknownStatus');
  const doctorName = doctor?.name ?? t('calendar.card.noDoctor');
  return (
    <button
      type="button"
      onClick={() => { if (!appt.syncPending && appt.id > 0) cancellation?.open(appt); }}
      disabled={pending || appt.syncPending || appt.id < 0}
      className={`cal-card cal-card--${status ?? 'unknown'}${compact ? ' cal-card--compact' : ''}`}
      data-testid={`card-appointment-${appt.id}`}
    >
      <span className="cal-card__time"><bdi>{start}</bdi>–<bdi>{end}</bdi><span className="cal-card__dur">{Number.isFinite(mins) && mins > 0 ? t('calendar.card.minutes', { n: formatNum(mins, digitPreference) }) : ''}</span></span>
      <bdi className={`cal-card__name${appt.patientName ? '' : ' is-missing'}`} dir="auto">{name}</bdi>
      {showDoctor && <bdi className="cal-card__doc" dir="auto">{doctorName}</bdi>}
      <span className="cal-card__badges">
        {pending && <span className="cancel-pending">{t('pendingBadge', { ns: 'cancellation' })}</span>}
        {status ? <StatusBadge status={status} /> : (
          <span className="amal-status cal-status-unknown" data-testid="status-unknown"><HelpCircle size={15} aria-hidden="true" /><span>{statusLabel}</span></span>
        )}
        {appt.syncPending && <StatusBadge status="sync" />}
      </span>
    </button>
  );
}

export function CalSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="cal-skel" role="status" aria-live="polite" data-testid="state-calendar-loading">
      <span className="shell-sr">{t('calendar.state.loading')}</span>
      {[0, 1, 2].map((i) => <div key={i} className="cal-skel__col" aria-hidden="true"><span /><span /><span /></div>)}
    </div>
  );
}
