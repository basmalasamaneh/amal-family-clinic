import {
  acquireAppointmentHold, checkAppointments, listAppointments, releaseAppointmentHold, updateAppointment,
  AppointmentCheckInputSource,
  type Appointment, type AppointmentCheckInput, type AppointmentHold, type AppointmentHoldInput, type AppointmentUpdate, type ConflictPreview,
} from '@workspace/api-client-react';
import { addLocalDays, localDateOf, localToUtc } from '../calendar/dates';
import { newOpId } from './ops';
import { withAuthReport } from './errors';

export type EditSource = (typeof AppointmentCheckInputSource)[keyof typeof AppointmentCheckInputSource];
export const isEditSource = (s: unknown): s is EditSource =>
  typeof s === 'string' && (Object.values(AppointmentCheckInputSource) as string[]).includes(s);
const LEGACY: Record<string, EditSource> = { calendar_app: 'phone', in_person: 'walk-in' };
/** Preview-only mapping for the check contract; never sent in the PATCH (source is not editable). */
export function checkSourceOf(s: unknown): EditSource | null {
  if (isEditSource(s)) return s;
  return typeof s === 'string' && LEGACY[s] ? LEGACY[s]! : null;
}
export const EDITABLE = ['booked', 'double_booked'] as const;
export const isEditableStatus = (s: unknown) => typeof s === 'string' && (EDITABLE as readonly string[]).includes(s);

export interface EditTarget { id: number; clinicId: number; doctorId: number; startsAt: string }

/** Real API only. There is no single-appointment GET, so the live row is located by an exact list query + ID. */
export interface EditApi {
  load(target: EditTarget, signal?: AbortSignal): Promise<Appointment | null>;
  check(input: AppointmentCheckInput, signal?: AbortSignal): Promise<ConflictPreview>;
  hold(input: AppointmentHoldInput): Promise<AppointmentHold>;
  release(token: string): Promise<void>;
  update(id: number, input: AppointmentUpdate): Promise<Appointment>;
}

async function scan(target: EditTarget, from: string, to: string, signal?: AbortSignal): Promise<Appointment | null> {
  const seen = new Set<string>(); let cursor: string | undefined;
  do {
    const page = await withAuthReport(listAppointments({ clinicId: target.clinicId, from, to, doctorId: target.doctorId, limit: 100, ...(cursor ? { cursor } : {}) }, { signal }));
    if (!Array.isArray(page.items)) throw new Error('Invalid page');
    const hit = page.items.find((a) => a.id === target.id && a.clinicId === target.clinicId);
    if (hit) return hit;
    cursor = page.nextCursor ?? undefined;
    if (cursor && seen.has(cursor)) throw new Error('Repeated cursor');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return null;
}
export const BROAD_FROM = '0001-01-01T00:00:00.000Z';
export const BROAD_TO = '9999-12-31T23:59:59.999Z';
/** Narrow window around the known start first; on a miss, a paginated all-dates scan (clinic + doctor) so a far move is not mistaken for deletion. */
async function findLive(target: EditTarget, signal?: AbortSignal): Promise<Appointment | null> {
  const day = localDateOf(target.startsAt);
  const near = await scan(target, localToUtc(addLocalDays(day, -1), 0), localToUtc(addLocalDays(day, 2), 0), signal);
  return near ?? scan(target, BROAD_FROM, BROAD_TO, signal);
}

export const realEditApi: EditApi = {
  load: findLive,
  check: (input, signal) => withAuthReport(checkAppointments(input, { signal })),
  hold: (input) => withAuthReport(acquireAppointmentHold(input)),
  release: (token) => withAuthReport(releaseAppointmentHold(token, { clientOpId: newOpId() })),
  update: (id, input) => withAuthReport(updateAppointment(id, input)),
};

export const isVersionConflict = (code: string | null) => code === 'VERSION_CONFLICT';
