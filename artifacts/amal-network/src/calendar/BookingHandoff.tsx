import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useSearch } from 'wouter';
import { CalendarDays } from 'lucide-react';
import type { ShellClinic } from '@/shell/identity';
import { createMockSchedulingAdapter, resolveSchedulingAdapter } from './adapter';
import { parseBooking } from './booking';
import { calHref } from './CalendarPage';
import { BookingDrawer } from '@/booking/BookingDrawer';
import { createFixtureBookingApi, realBookingApi } from '@/booking/api';
import { resolvePatientSearch } from '@/booking/patients';
import { focusAfterNavigation, returnFocusTargets } from '@/booking/focus';
import '@/booking/i18n';

/**
 * P2-04 booking drawer at /desk/new-booking. Real sessions call the generated appointment and
 * patient clients with no fallback. Fixture data is DEV-only: shell fixture sessions,
 * ?calendarDemo=..., or the booking-only ?bookingDemo=1 option. Fixture writes are simulated
 * locally and never reach the server.
 */
export function BookingHandoff({ clinic, fixture, title }: { clinic: ShellClinic | null; fixture: boolean; title: string }) {
  const { t } = useTranslation();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const demoKey = params.get('calendarDemo');
  const bookingDemo = import.meta.env.DEV && params.get('bookingDemo') === '1';
  const useFixture = import.meta.env.DEV && (fixture || !!demoKey || bookingDemo);
  const scheduling = useMemo(() => (bookingDemo ? createMockSchedulingAdapter('standard') : resolveSchedulingAdapter(search, fixture)), [demoKey, bookingDemo, fixture]); // eslint-disable-line react-hooks/exhaustive-deps
  const api = useMemo(() => (useFixture ? createFixtureBookingApi() : realBookingApi), [useFixture]);
  const patients = useMemo(() => resolvePatientSearch(useFixture), [useFixture]);
  const ctx = parseBooking(search, clinic?.id ?? null);
  const back = calHref('/desk/today', search);

  return (
    <section className="book" data-testid="page-booking-handoff" data-source={ctx?.source ?? 'none'}>
      <p className="cal-eyebrow">{clinic ? <bdi>{clinic.name}</bdi> : t('shell.page.noClinic')}</p>
      <h1 id="page-title" tabIndex={-1} className="cal-h1">{title}</h1>
      {!clinic && <p>{t('bk.noClinic')}</p>}
      <Link href={back} className="cal-btn" data-testid="link-back-today"><CalendarDays size={18} aria-hidden="true" />{t('calendar.booking.back')}</Link>
      {clinic && (
        <BookingDrawer key={clinic.id} clinic={clinic} ctx={ctx} title={title} scheduling={scheduling} patients={patients} api={api}
          onClose={(created) => { setLocation(back); focusAfterNavigation(returnFocusTargets(ctx, created?.id ?? null)); }} />
      )}
    </section>
  );
}
