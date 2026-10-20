import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearch } from 'wouter';
import { CalendarDays, Construction, DoorOpen, PhoneCall } from 'lucide-react';
import { useAmalPreferences } from '@workspace/amal-ui';
import type { ShellClinic } from '@/shell/identity';
import { resolveSchedulingAdapter } from './adapter';
import { parseBooking } from './booking';
import { formatLocalDate, formatTime, localDateOf } from './dates';
import { calHref } from './CalendarPage';

/** Honest P2-04 handoff: shows prefilled context, never saves or claims success. */
export function BookingHandoff({ clinic, fixture, title }: { clinic: ShellClinic | null; fixture: boolean; title: string }) {
  const { t } = useTranslation();
  const { locale, digitPreference } = useAmalPreferences();
  const search = useSearch();
  const ctx = parseBooking(search, clinic?.id ?? null);
  const demoKey = new URLSearchParams(search).get('calendarDemo');
  const adapter = useMemo(() => resolveSchedulingAdapter(search, fixture), [demoKey, fixture]); // eslint-disable-line react-hooks/exhaustive-deps
  const [doctorName, setDoctorName] = useState<string | null>(null);
  const doctorId = ctx?.doctorId;
  useEffect(() => {
    setDoctorName(null);
    if (!clinic || !doctorId) return;
    const ctl = new AbortController();
    adapter.listDoctors(clinic.id, ctl.signal)
      .then((ds) => { if (!ctl.signal.aborted) setDoctorName(ds.find((d) => d.id === doctorId && d.clinicId === clinic.id)?.name ?? null); })
      .catch(() => undefined);
    return () => ctl.abort();
  }, [adapter, clinic, doctorId]);

  const walkIn = ctx?.source === 'walk-in';
  const Icon = walkIn ? DoorOpen : PhoneCall;
  const steps = ['patient', 'slot', 'confirm'] as const;
  return (
    <section className="book" data-testid="page-booking-handoff" data-source={ctx?.source ?? 'none'}>
      <p className="cal-eyebrow">{clinic ? <bdi>{clinic.name}</bdi> : t('shell.page.noClinic')}</p>
      <h1 id="page-title" tabIndex={-1} className="cal-h1"><Icon size={28} aria-hidden="true" />{walkIn ? t('calendar.booking.walkInTitle') : title}</h1>
      <div className="book-notice" role="note" data-testid="status-booking-placeholder">
        <Construction size={22} aria-hidden="true" />
        <p>{t('calendar.booking.placeholder')}</p>
      </div>
      <dl className="book-ctx" data-testid="booking-context">
        <dt>{t('calendar.booking.source')}</dt><dd data-testid="text-booking-source">{t(`calendar.booking.sources.${ctx?.source ?? 'phone'}`)}</dd>
        <dt>{t('calendar.booking.clinic')}</dt><dd>{clinic ? <bdi>{clinic.name}</bdi> : '—'}</dd>
        <dt>{t('calendar.booking.doctor')}</dt><dd data-testid="text-booking-doctor">{doctorId ? <bdi dir="auto">{doctorName ?? t('calendar.booking.doctorId', { id: doctorId })}</bdi> : t('calendar.booking.notChosen')}</dd>
        <dt>{t('calendar.booking.time')}</dt>
        <dd data-testid="text-booking-time">{ctx?.startsAt ? <>
          {formatLocalDate(localDateOf(ctx.startsAt), locale, digitPreference)} · <bdi>{formatTime(ctx.startsAt, locale, digitPreference)}</bdi>{ctx.endsAt && <>–<bdi>{formatTime(ctx.endsAt, locale, digitPreference)}</bdi></>}
        </> : ctx?.localDate ? <>{formatLocalDate(ctx.localDate, locale, digitPreference)} · {walkIn ? t('calendar.booking.now') : t('calendar.booking.timeNotChosen')}</>
          : walkIn ? t('calendar.booking.now') : t('calendar.booking.notChosen')}</dd>
      </dl>
      <ol className="book-steps" aria-label={t('calendar.booking.stepsLabel')}>
        {steps.map((s, i) => (
          <li key={s} className="book-step" aria-disabled="true">
            <span className="book-step__n" aria-hidden="true">{i + 1}</span>
            <span><strong>{t(`calendar.booking.steps.${s}`)}</strong><small>{t('calendar.booking.stepPending')}</small></span>
          </li>
        ))}
      </ol>
      <Link href={calHref('/desk/today', search)} className="cal-btn" data-testid="link-back-today"><CalendarDays size={18} aria-hidden="true" />{t('calendar.booking.back')}</Link>
    </section>
  );
}
