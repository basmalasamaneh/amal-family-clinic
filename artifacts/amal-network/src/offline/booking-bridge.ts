import {
  getSyncState, listAppointments, listDoctors, listPatients,
  type Appointment, type AppointmentInput, type SyncOutcome,
} from '@workspace/api-client-react';
import { localCache } from './index';
import { appointmentWindow } from './calendar';
import type { BookingProposal, CachedSnapshot, Result, ScopeTicket } from './types';
import type { CalendarAppointment, SchedulingReadAdapter } from '../calendar/adapter';
import type { PatientSearchAdapter } from '../booking/patients';
import { matchesPatient } from '../booking/normalize';
import { reportUnauthorized } from '../auth/session-events';
import './booking-messages';
import { syncClient, wakeSync } from '../sync/client';
import { browserQueueLock } from '../sync/runner';
import { isDemoReachable } from '../auth/demo-context';

class LocalBookingError extends Error {
  constructor(readonly code: string) { super(code); }
}
function value<T>(result: Result<T>): T {
  if (!result.ok) throw new LocalBookingError(result.error);
  return result.value;
}
export function localBookingErrorKey(error: unknown): string {
  const code = error instanceof LocalBookingError ? error.code : 'storage-failed';
  return `localBooking:${code}`;
}
function scope() { return value(localCache.captureScope()); }
// Shell grants its ticket asynchronously after verifying a session/permit.
async function readyScope(): Promise<ScopeTicket> {
  for (let n = 0; n < 40; n++) {
    const ticket = localCache.captureScope();
    if (ticket.ok) return ticket.value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return scope();
}
async function pages<T>(load: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>) {
  const result: T[] = [], seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await load(cursor);
    result.push(...page.items);
    cursor = page.nextCursor ?? undefined;
    if (cursor && seen.has(cursor)) throw new LocalBookingError('invalid-data');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return result;
}
const preparing = new Map<string, Promise<void>>();
/** Complete authorized pages only. Never infer coverage from a partial calendar response. */
export async function prepareBookingCache(): Promise<void> {
  const ticket = await readyScope();
  if (!navigator.onLine || !isDemoReachable()) return;
  const key = `${ticket.userId}:${ticket.clinicId}:${ticket.generation}`;
  const existing = preparing.get(key);
  if (existing) return existing;
  const task = (async () => {
    const state = await getSyncState();
    await browserQueueLock(state.deviceId, new AbortController().signal, async () => {
    const window = appointmentWindow();
    // Server durations are bounded to 1440 minutes. Include starts in the prior
    // 24h so a booking crossing midnight cannot disappear from conflict checks.
    const overlapFrom = new Date(Date.parse(window.startUtc) - 86_400_000).toISOString();
    const [doctors, patients, appointments] = await Promise.all([
      pages(cursor => listDoctors({ clinicId: ticket.clinicId, limit: 100, ...(cursor ? { cursor } : {}) })),
      pages(cursor => listPatients({ limit: 100, ...(cursor ? { cursor } : {}) })),
      pages(cursor => listAppointments({ clinicId: ticket.clinicId, from: overlapFrom, to: window.endUtc, limit: 100, ...(cursor ? { cursor } : {}) })),
    ]);
    value(await localCache.replaceSnapshot(ticket, {
      userId: ticket.userId, clinicId: ticket.clinicId,
      doctors: doctors.filter(d => d.clinicId === ticket.clinicId),
      patients: patients.filter(p => p.clinicId === ticket.clinicId),
      appointments: appointments.filter(a => a.clinicId === ticket.clinicId && Date.parse(a.endsAt) > Date.parse(window.startUtc)),
      coverage: { startUtc: window.startUtc, endUtc: window.endUtc },
    }));
    value(await localCache.prepareBookingStream(ticket, state));
    });
  })().catch(error => { handlePermission(error); throw error; }).finally(() => { preparing.delete(key); });
  preparing.set(key, task);
  return task;
}
function handlePermission(error: unknown) {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
  if (status === 401 || status === 403) {
    void localCache.setContext(null);
    reportUnauthorized();
  }
}
export async function getBookingSnapshot(): Promise<CachedSnapshot> {
  return value(await localCache.readSnapshot(await readyScope()));
}
export async function validateLocalBooking(input: Omit<AppointmentInput, 'clientOpId'>) {
  value(await localCache.validateBooking(scope(), { ...input, clientOpId: '00000000-0000-4000-8000-000000000000' }));
}
function provisional(p: BookingProposal): Appointment {
  return p.canonical ?? { ...p.input, id: p.localId, status: 'booked', version: 1 };
}
function changed() { window.dispatchEvent(new CustomEvent('amal:appointments-changed')); }

export async function saveLocalBooking(input: AppointmentInput): Promise<Appointment> {
  const ticket = scope();
  const proposal = value(await localCache.saveBooking(ticket, input));
  changed();
  wakeSync();
  return provisional(proposal);
}
/** One coordinated owner handles initial delivery and exact replay alike. */
export async function deliverLocalBooking(_operationId: string): Promise<void> {
  syncClient.retry();
}
/** Exact per-operation result, not HTTP status, reconciles canonical identity. */
export async function acceptBookingOutcome(ticket: ScopeTicket, operationId: string, outcome: SyncOutcome) {
  value(await localCache.acknowledgeBooking(ticket, operationId, outcome));
  changed();
}
export async function getLocalCalendar(q: { clinicId: number; from: string; to: string; doctorId?: number }): Promise<CalendarAppointment[]> {
  const ticket = await readyScope();
  if (q.clinicId !== ticket.clinicId) throw new LocalBookingError('unauthorized');
  const snapshot = value(await localCache.readSnapshot(ticket));
  const proposals = value(await localCache.listBookings(ticket));
  const tombstones = new Set(value(await localCache.readSyncState(ticket)).tombstoneIds);
  const ids = new Set(proposals.map(p => p.canonical?.id).filter(Boolean));
  const operationIds = new Set(proposals.filter(p => !p.canonical).map(p => p.operationId));
  const patientNames = new Map(snapshot.patients.map(p => [p.id, p.name]));
  const result: CalendarAppointment[] = snapshot.appointments
    .filter(a => !ids.has(a.id) && !(a.clientOpId && operationIds.has(a.clientOpId)))
    .map(a => ({ id: a.id, clinicId: a.clinicId, doctorId: a.doctorId, patientName: patientNames.get(a.patientId) ?? null,
      startsAt: a.startsAt, endsAt: a.endsAt, lifecycle: a.status === 'arrived' ? 'booked' : a.status,
      conflict: a.status === 'double_booked', syncPending: false, version: a.version }));
  for (const proposal of proposals) {
    if (proposal.canonical && tombstones.has(proposal.canonical.id)) continue;
    const a = proposal.canonical ? snapshot.appointments.find(a => a.id === proposal.canonical!.id) ?? proposal.canonical : provisional(proposal);
    result.push({ id: a.id, clinicId: a.clinicId, doctorId: a.doctorId, patientName: proposal.patient.name, clientOpId: proposal.operationId,
      startsAt: a.startsAt, endsAt: a.endsAt, lifecycle: a.status === 'arrived' ? 'booked' : a.status,
      syncPending: !proposal.canonical, conflict: proposal.outcome === 'conflict' || proposal.outcome === 'rejected',
      ...(proposal.canonical ? { version: a.version } : {}) });
  }
  return result.filter(a => a.startsAt >= q.from && a.startsAt < q.to && (!q.doctorId || a.doctorId === q.doctorId));
}
export const cachedPatientSearch: PatientSearchAdapter = {
  mode: 'real',
  async search(q, clinicId) {
    const ticket = scope();
    if (ticket.clinicId !== clinicId) throw new LocalBookingError('unauthorized');
    const snapshot = value(await localCache.readSnapshot(ticket));
    if (!snapshot.metadata) throw new LocalBookingError('identity-not-cached');
    return { items: snapshot.patients.filter(p => matchesPatient(p, q)), more: false, nextCursor: null };
  },
};
export const cachedSchedulingAdapter: SchedulingReadAdapter = {
  mode: 'real',
  async listDoctors(clinicId) {
    const ticket = await readyScope();
    if (ticket.clinicId !== clinicId) throw new LocalBookingError('unauthorized');
    const snapshot = value(await localCache.readSnapshot(ticket));
    if (!snapshot.metadata) throw new LocalBookingError('identity-not-cached');
    return snapshot.doctors;
  },
  listAppointments: getLocalCalendar,
  async clinicHours() { return null; },
};
