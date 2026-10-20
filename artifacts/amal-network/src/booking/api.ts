import {
  acquireAppointmentHold, checkAppointments, createAppointment, releaseAppointmentHold,
  type Appointment, type AppointmentCheckInput, type AppointmentHold, type AppointmentHoldInput, type AppointmentInput, type ConflictPreview,
} from '@workspace/api-client-react';
import { localMinutesOf } from '../calendar/dates';
import { newOpId } from './ops';
import { withAuthReport } from './errors';

export interface BookingApi {
  mode: 'real' | 'fixture';
  check(input: AppointmentCheckInput, signal?: AbortSignal): Promise<ConflictPreview>;
  hold(input: AppointmentHoldInput): Promise<AppointmentHold>;
  release(token: string): Promise<void>;
  create(input: AppointmentInput): Promise<Appointment>;
}
export const realBookingApi: BookingApi = {
  mode: 'real',
  check: (input, signal) => withAuthReport(checkAppointments(input, { signal })),
  hold: (input) => withAuthReport(acquireAppointmentHold(input)),
  release: (token) => withAuthReport(releaseAppointmentHold(token, { clientOpId: newOpId() })),
  create: (input) => withAuthReport(createAppointment(input)),
};

/**
 * DEV FIXTURE ONLY: deterministic simulated engine for fixture sessions. Nothing is persisted
 * and no request reaches the server. Rules: local 10:00–10:59 doctor overlap (with server-like
 * suggestions), outside 08:00–16:00 blocked, patient 9003 has a patient-overlap warning,
 * patient 9004 gets a same-day other-clinic notice.
 */
export function createFixtureBookingApi(): BookingApi {
  const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
  });
  const ops = new Map<string, Appointment>(); let seq = 700000;
  const preview = (i: AppointmentCheckInput): ConflictPreview => {
    const sm = localMinutesOf(i.startsAt); const em = sm + (Date.parse(i.endsAt) - Date.parse(i.startsAt)) / 60000;
    const conflicts: ConflictPreview['conflicts'] = [];
    if (sm < 8 * 60 || em > 16 * 60) conflicts.push({ type: 'outside-hours', with: null, severity: 'blocking', suggestedSlots: [] });
    else if (sm < 11 * 60 && em > 10 * 60) {
      const dur = Date.parse(i.endsAt) - Date.parse(i.startsAt); const base = Date.parse(i.startsAt);
      const at = (deltaMin: number) => ({ startsAt: new Date(base + deltaMin * 60000).toISOString(), endsAt: new Date(base + deltaMin * 60000 + dur).toISOString() });
      const offs = [11 * 60 - sm, 11 * 60 + 30 - sm, 9 * 60 + 30 - sm].filter((d) => sm + d >= 8 * 60);
      conflicts.push({ type: 'doctor-overlap', with: { appointmentId: 4812, clinicId: i.clinicId }, severity: 'blocking', suggestedSlots: offs.map(at) });
    }
    if (i.patientId === 9003) conflicts.push({ type: 'patient-overlap', with: null, severity: 'warning', suggestedSlots: [] });
    if (i.patientId === 9004) conflicts.push({ type: 'same-day-other-clinic', with: null, severity: 'info', suggestedSlots: [] });
    const ok = !conflicts.some((c) => c.severity === 'blocking') && (!conflicts.some((c) => c.severity === 'warning') || !!i.overrideReason?.trim());
    return { ok, conflicts };
  };
  return {
    mode: 'fixture',
    async check(i, signal) { await wait(300, signal); return preview(i); },
    async hold() { await wait(200); return { token: 'fixture-' + newOpId(), expiresAt: new Date(Date.now() + 30000).toISOString() }; },
    async release() { await wait(50); },
    async create(i) {
      await wait(400);
      const prior = ops.get(i.clientOpId); if (prior) return prior;
      if (!preview(i).ok) throw Object.assign(new Error('conflict'), { status: 409, data: { code: 'APPOINTMENT_CONFLICT', messageKey: 'conflict', params: {} } });
      const a: Appointment = { id: ++seq, clientOpId: i.clientOpId, clinicId: i.clinicId, doctorId: i.doctorId, patientId: i.patientId, startsAt: i.startsAt, endsAt: i.endsAt, source: i.source, status: 'booked', version: 1 };
      ops.set(i.clientOpId, a); return a;
    },
  };
}
