import type { SchedulingSettings } from '@workspace/api-client-react';
import type { CalendarAppointment, ClinicHours } from './adapter';
import { localDateOf, localMinutesOf } from './dates';

/** Validated allowlist, also used when re-projecting persisted local metadata. */
export function validClinicHours(value: ClinicHours): boolean {
  return !!value && Number.isFinite(value.open) && Number.isFinite(value.close) &&
    value.open >= 0 && value.close <= 1440 && value.open < value.close &&
    Number.isInteger(value.slotMinutes) && value.slotMinutes > 0 && value.slotMinutes <= 1440 &&
    Array.isArray(value.workingDays) && value.workingDays.length <= 7 &&
    new Set(value.workingDays).size === value.workingDays.length &&
    value.workingDays.every(day => Number.isInteger(day) && day >= 0 && day <= 6);
}

/** Undefined = unavailable (e.g. an older cached snapshot); null = explicitly missing. */
export function fromSchedulingSettings(settings: SchedulingSettings | undefined): ClinicHours | null | undefined {
  if (settings == null) return settings;
  const minute = (clock: string) => {
    if (typeof clock !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(clock))
      throw new Error('Invalid clinic scheduling hours');
    const [h, m, s = 0] = clock.split(':').map(Number);
    return h * 60 + m + s / 60;
  };
  const hours = { open: minute(settings.openTime), close: minute(settings.closeTime),
    slotMinutes: settings.slotMinutes, workingDays: settings.workingDays };
  if (!validClinicHours(hours)) throw new Error('Invalid clinic scheduling hours');
  return { ...hours, workingDays: [...hours.workingDays] };
}

/** Render all appointments, but offer only complete configured slots on working days. */
export function dayGridHours(date: string, hours: ClinicHours | null | undefined, appointments: CalendarAppointment[]) {
  const step = hours?.slotMinutes ?? 30;
  const working = !!hours && hours.workingDays.includes(new Date(`${date}T12:00:00Z`).getUTCDay());
  const minutes = appointments.flatMap(a => [localMinutesOf(a.startsAt),
    localDateOf(a.endsAt) === date ? localMinutesOf(a.endsAt) : 1440]);
  const starts = [...(working ? [hours!.open] : []), ...minutes];
  const ends = [...(working ? [hours!.close] : []), ...minutes];
  // Anchor rows at the configured opening time. Extend in both directions for out-of-hours records.
  const anchor = working ? hours!.open : 0;
  const open = starts.length ? anchor + Math.floor((Math.min(...starts) - anchor) / step) * step : 0;
  const close = ends.length ? anchor + Math.ceil((Math.max(...ends) - anchor) / step) * step : 0;
  const slots: number[] = [];
  for (let m = open; m < close; m += step) slots.push(m);
  const available = slots.filter(m => working && m >= hours!.open && m + step <= hours!.close);
  return { step, open, close, slots, available, closed: !!hours && !working };
}
