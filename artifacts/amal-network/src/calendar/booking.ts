import { isLocalDate, localDateOf } from './dates';
export type BookingSource = 'phone' | 'walk-in';
export interface BookingContext { clinicId: number; doctorId?: number; /** Selected Asia/Hebron calendar date (YYYY-MM-DD). */ localDate?: string; startsAt?: string; endsAt?: string; source: BookingSource }

export function bookingQuery(ctx: BookingContext): string {
  const p = new URLSearchParams({ clinic: String(ctx.clinicId), source: ctx.source });
  if (ctx.doctorId) p.set('doctor', String(ctx.doctorId));
  if (ctx.localDate) p.set('date', ctx.localDate);
  if (ctx.startsAt) p.set('start', ctx.startsAt);
  if (ctx.endsAt) p.set('end', ctx.endsAt);
  return `/desk/new-booking?${p.toString()}`;
}
const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
/** Parses handoff context; context from another clinic than the current one is discarded. */
export function parseBooking(search: string, currentClinicId: number | null): BookingContext | null {
  const p = new URLSearchParams(search);
  const clinicId = Number(p.get('clinic'));
  if (currentClinicId === null || clinicId !== currentClinicId) return null;
  const source: BookingSource = p.get('source') === 'walk-in' ? 'walk-in' : 'phone';
  const doctorId = Number(p.get('doctor'));
  const start = p.get('start'); const end = p.get('end'); const date = p.get('date');
  const startOk = !!start && UTC_RE.test(start);
  // A slot's own local date wins; an explicit date is kept only when consistent.
  const localDate = startOk ? localDateOf(start!) : isLocalDate(date) ? date : undefined;
  return {
    clinicId, source,
    ...(Number.isSafeInteger(doctorId) && doctorId > 0 ? { doctorId } : {}),
    ...(localDate ? { localDate } : {}),
    ...(startOk ? { startsAt: start! } : {}),
    ...(end && UTC_RE.test(end) && start && end > start ? { endsAt: end } : {}),
  };
}
