import { isLocalDate } from './dates';

/** Calendar context carried across Today/Week/booking links: valid date and doctor filter only. */
export function calendarCarry(search: string): { date?: string; doctorId?: number } {
  const p = new URLSearchParams(search);
  const date = p.get('date'); const doctor = Number(p.get('doctor'));
  return { ...(isLocalDate(date) ? { date } : {}), ...(Number.isSafeInteger(doctor) && doctor > 0 ? { doctorId: doctor } : {}) };
}
/** Appends carried date/doctor and explicit calendarDemo to a calendar path. */
export function withCarry(path: string, search: string): string {
  const c = calendarCarry(search); const p = new URLSearchParams();
  if (c.date) p.set('date', c.date); if (c.doctorId) p.set('doctor', String(c.doctorId));
  const demo = new URLSearchParams(search).get('calendarDemo'); if (demo) p.set('calendarDemo', demo);
  const s = p.toString(); return s ? `${path}${path.includes('?') ? '&' : '?'}${s}` : path;
}
