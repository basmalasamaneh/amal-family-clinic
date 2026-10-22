import type { CalendarAppointment } from './adapter';
import type { BookingProposal } from '../offline/types';

/** Failed proposals remain in the durable sync queue, not on appointment calendars. */
export function showCalendarProposal(proposal: Pick<BookingProposal, 'canonical' | 'outcome'>): boolean {
  return proposal.canonical !== null || proposal.outcome === 'pending';
}

/** Local canonical records and proposals win by identity; never replace proposals with server rows. */
export function mergeLocalCalendar(server: CalendarAppointment[], local: CalendarAppointment[]): CalendarAppointment[] {
  // A read-back can hide the duplicate card but cannot acknowledge a pending operation.
  const pendingOps = new Set(local.filter(a => a.syncPending && a.clientOpId).map(a => a.clientOpId));
  const records = new Map(server.filter(a => !a.clientOpId || !pendingOps.has(a.clientOpId)).map((appointment) => [appointment.id, appointment]));
  for (const appointment of local) records.set(appointment.id, appointment);
  return [...records.values()].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id - b.id);
}

export function coversCalendarRange(metadata: { coverageStartUtc: string; coverageEndUtc: string } | null, from: string, to: string): boolean {
  return !!metadata && Date.parse(metadata.coverageStartUtc) <= Date.parse(from) && Date.parse(metadata.coverageEndUtc) >= Date.parse(to);
}
