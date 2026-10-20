import type {
  AppointmentProjection, AuthorizedSnapshot, CachedAppointment, CachedDoctor, CachedPatient,
  LocalOperation, Scope,
} from './types';

export class InvalidProjection extends Error {}
export function requireValid(condition: unknown): asserts condition {
  if (!condition) throw new InvalidProjection();
}
export const validId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
export const validText = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512;
export function utcInstant(value: unknown): string {
  requireValid(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value));
  dateOnly(value.slice(0, 10));
  requireValid(Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60);
  const parsed = new Date(value);
  requireValid(Number.isFinite(parsed.getTime()));
  return parsed.toISOString();
}
function dateOnly(value: unknown): string {
  requireValid(typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value));
  requireValid(new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
  return value;
}
function interval(startsAt: unknown, endsAt: unknown) {
  const start = utcInstant(startsAt);
  const end = utcInstant(endsAt);
  requireValid(end > start);
  return { startsAt: start, endsAt: end };
}

/** Explicit allowlists: never spread a server object into IndexedDB. */
export function projectSnapshot(input: AuthorizedSnapshot, scope: Scope): {
  doctors: CachedDoctor[]; patients: CachedPatient[]; appointments: CachedAppointment[];
  coverageStartUtc: string; coverageEndUtc: string;
} {
  requireValid(input && input.userId === scope.userId && input.clinicId === scope.clinicId);
  requireValid(Array.isArray(input.doctors) && Array.isArray(input.patients) && Array.isArray(input.appointments));
  const check = (row: { id: number; clinicId: number }) => {
    requireValid(row && validId(row.id) && row.clinicId === scope.clinicId);
  };
  const doctors = input.doctors.map((row) => {
    check(row);
    requireValid(validText(row.name));
    return { ...scope, id: row.id, name: row.name };
  });
  const patients = input.patients.map((row) => {
    check(row);
    requireValid(validText(row.name) && typeof row.phone === 'string' && row.phone.length <= 64);
    return { ...scope, id: row.id, name: row.name, phone: row.phone, dateOfBirth: dateOnly(row.dateOfBirth) };
  });
  const doctorIds = new Set(doctors.map((row) => row.id));
  const patientIds = new Set(patients.map((row) => row.id));
  const statuses: AppointmentProjection['status'][] = ['booked', 'arrived', 'completed', 'cancelled', 'no_show', 'double_booked'];
  const appointments = input.appointments.map((row) => {
    check(row);
    requireValid(doctorIds.has(row.doctorId) && patientIds.has(row.patientId));
    requireValid(statuses.includes(row.status) && validId(row.version));
    return {
      ...scope, id: row.id, doctorId: row.doctorId, patientId: row.patientId,
      ...(typeof row.clientOpId === 'string' && /^[0-9a-f-]{36}$/i.test(row.clientOpId) ? { clientOpId: row.clientOpId } : {}),
      ...interval(row.startsAt, row.endsAt), status: row.status, version: row.version,
    };
  });
  for (const rows of [doctors, patients, appointments]) {
    requireValid(new Set(rows.map((row) => row.id)).size === rows.length);
  }
  const coverageStartUtc = utcInstant(input.coverage?.startUtc);
  const coverageEndUtc = utcInstant(input.coverage?.endUtc);
  requireValid(coverageEndUtc > coverageStartUtc);
  return { doctors, patients, appointments, coverageStartUtc, coverageEndUtc };
}

export function projectOperation(input: LocalOperation): LocalOperation {
  requireValid(input && typeof input.operationId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.operationId));
  const times = interval(input.payload?.startsAt, input.payload?.endsAt);
  if (input.type === 'appointment.create') {
    requireValid(input.entityId === null && validId(input.payload.doctorId) && validId(input.payload.patientId));
    requireValid(['phone', 'walk-in', 'online', 'import'].includes(input.payload.source));
    const reason = input.payload.overrideReason;
    requireValid(reason === undefined || (typeof reason === 'string' && reason.trim().length > 0 && reason.length <= 2000));
    return {
      operationId: input.operationId, type: input.type, entityId: null,
      payload: { ...times, doctorId: input.payload.doctorId, patientId: input.payload.patientId, source: input.payload.source,
        ...(reason === undefined ? {} : { overrideReason: reason.trim() }) },
    };
  }
  requireValid(input.type === 'appointment.update' && validId(input.entityId) && validId(input.payload.expectedVersion));
  return { operationId: input.operationId, type: input.type, entityId: input.entityId, payload: { ...times, expectedVersion: input.payload.expectedVersion } };
}
