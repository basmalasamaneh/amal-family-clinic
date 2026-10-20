import { createPatient, getAppointmentAvailability, listAppointments } from '@workspace/api-client-react';
import { withAuthReport } from '../booking/errors';
import type { PatientHit } from '../booking/patients';
import { localToUtc, todayLocal, addLocalDays, localMinutesOf, localDateOf } from '../calendar/dates';
import type { CalendarDoctor } from '../calendar/adapter';
import type { NewPatientPayload } from './registration';

export interface UpcomingItem { id: number; doctorId: number; startsAt: string; endsAt: string; status: string }
export interface Page<T> { items: T[]; nextCursor: string | null }
export interface AvailabilitySlot { doctorId: number; startsAt: string; endsAt: string }
export interface Availability { items: AvailabilitySlot[]; durationMinutes: number; checkedAt: string }
export type AvailabilityFn = (clinicId: number, patientId: number, signal?: AbortSignal) => Promise<Availability>;
export interface ReceptionApi {
  mode: 'real' | 'fixture';
  createPatient(input: NewPatientPayload & { clientOpId: string }): Promise<PatientHit>;
  upcoming(clinicId: number, patientId: number, cursor: string | null, signal?: AbortSignal): Promise<Page<UpcomingItem>>;
  availability: AvailabilityFn;
}
export const UPCOMING_PAGE = 10;
const ACTIVE = new Set(['booked', 'double_booked']);
/** Only scheduling fields leave this function; anything else in the response is dropped. */
export function toUpcoming(a: { id: number; doctorId: number; startsAt: string; endsAt: string; status: string }): UpcomingItem {
  return { id: a.id, doctorId: a.doctorId, startsAt: a.startsAt, endsAt: a.endsAt, status: a.status };
}
export function activeFuture(items: UpcomingItem[], nowMs = Date.now()): UpcomingItem[] {
  return items.filter((a) => ACTIVE.has(a.status) && Date.parse(a.startsAt) >= nowMs).sort((x, y) => x.startsAt.localeCompare(y.startsAt) || x.id - y.id);
}
function toHit(p: { id: number; name: string; phone: string; dateOfBirth: string; clinicId: number }): PatientHit {
  return { id: p.id, name: p.name, phone: p.phone || null, dateOfBirth: p.dateOfBirth || null, clinicId: p.clinicId };
}

export const realReceptionApi: ReceptionApi = {
  mode: 'real',
  createPatient: async (input) => toHit(await withAuthReport(createPatient(input))),
  async upcoming(clinicId, patientId, cursor, signal) {
    // Server filter: upcoming=true + patientId; from/to omitted (only allowed in this mode).
    const params = { clinicId, patientId, upcoming: true, limit: UPCOMING_PAGE, ...(cursor ? { cursor } : {}) };
    const page = await withAuthReport(listAppointments(params, { signal }));
    return { items: activeFuture(page.items.map(toUpcoming)), nextCursor: page.nextCursor };
  },
  async availability(clinicId, patientId, signal) {
    const res = await withAuthReport(getAppointmentAvailability({ clinicId, patientId }, { signal }));
    return { items: res.items.map((i) => ({ doctorId: i.doctorId, startsAt: i.startsAt, endsAt: i.endsAt })), durationMinutes: res.durationMinutes, checkedAt: res.checkedAt };
  },
};

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
});
/**
 * DEV FIXTURE ONLY (existing shell fixture sessions). Simulated, labelled in the UI, never sent to
 * the server. Same clientOpId returns the same invented patient; a changed payload is a 409.
 */
export function createFixtureReceptionApi(listDoctors: (clinicId: number, s?: AbortSignal) => Promise<CalendarDoctor[]>, latency = 250): ReceptionApi {
  const ops = new Map<string, { key: string; hit: PatientHit }>(); let seq = 9500;
  return {
    mode: 'fixture',
    async createPatient(input) {
      await wait(latency);
      const { clientOpId, ...rest } = input; const key = JSON.stringify(rest);
      const prior = ops.get(clientOpId);
      if (prior) { if (prior.key !== key) throw Object.assign(new Error('op reuse'), { status: 409, data: { code: 'IDEMPOTENCY_MISMATCH', messageKey: 'x', params: {} } }); return prior.hit; }
      const hit: PatientHit = { id: ++seq, name: rest.name, phone: rest.phone, dateOfBirth: rest.dateOfBirth, clinicId: 0 };
      ops.set(clientOpId, { key, hit }); return hit;
    },
    async upcoming(clinicId, patientId, _cursor, signal) {
      await wait(latency, signal);
      if (patientId !== 9001) return { items: [], nextCursor: null };
      const docs = await listDoctors(clinicId, signal); const d = docs[0];
      if (!d) return { items: [], nextCursor: null };
      const day = addLocalDays(todayLocal(), 2);
      return { items: [{ id: 880001, doctorId: d.id, startsAt: localToUtc(day, 9 * 60 + 30), endsAt: localToUtc(day, 9 * 60 + 50), status: 'booked' }], nextCursor: null };
    },
    async availability(clinicId, _patientId, signal) {
      await wait(latency, signal);
      const docs = await listDoctors(clinicId, signal); const dur = 20;
      const now = new Date(); const date = localDateOf(now.toISOString()); const mins = Math.ceil(localMinutesOf(now.toISOString()) / 5) * 5;
      const items = docs.map((d, i) => {
        const start = mins + 15 + i * 25;
        const [day, m] = start >= 8 * 60 && start + dur <= 15 * 60 ? [date, start] : [addLocalDays(date, start < 8 * 60 ? 0 : 1), 8 * 60 + i * 25];
        return { doctorId: d.id, startsAt: localToUtc(day, m), endsAt: localToUtc(day, m + dur) };
      });
      return { items, durationMinutes: dur, checkedAt: now.toISOString() };
    },
  };
}
