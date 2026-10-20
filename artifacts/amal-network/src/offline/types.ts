/** Scope comes only from a verified session + authorized clinic, never a route parameter. */
export interface AuthorizedContext {
  userId: string;
  clinicId: number;
  /** Absolute UTC expiry of verified authorization. Unknown/offline-only identity must pass null. */
  authorizedUntil: string;
}

export interface Scope {
  userId: string;
  clinicId: number;
}

/** Opaque in practice: only tickets issued by the controller's WeakMap are accepted. */
export interface ScopeTicket extends Readonly<Scope> {
  readonly generation: number;
}

export type CacheErrorCode =
  | 'unauthorized' | 'stale-context' | 'invalid-data' | 'pending-outbox'
  | 'storage-unavailable' | 'storage-quota' | 'storage-blocked' | 'storage-failed';
export type Result<T> = { ok: true; value: T } | { ok: false; error: CacheErrorCode };
export type StorageStatus =
  | { state: 'idle' | 'checking' | 'ready' }
  | { state: 'error'; error: CacheErrorCode };

export interface DoctorProjection {
  id: number;
  clinicId: number;
  name: string;
}
export interface PatientProjection {
  id: number;
  clinicId: number;
  name: string;
  phone: string;
  /** Date only. Must not be timezone-converted. */
  dateOfBirth: string;
}
export type AppointmentStatus = 'booked' | 'arrived' | 'completed' | 'cancelled';
export interface AppointmentProjection {
  id: number;
  clinicId: number;
  doctorId: number;
  patientId: number;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  version: number;
}
export type CachedDoctor = DoctorProjection & Scope;
export type CachedPatient = PatientProjection & Scope;
export type CachedAppointment = AppointmentProjection & Scope;

export interface CalendarWindow {
  timeZone: 'Asia/Hebron';
  localStartDate: string;
  localEndDate: string;
  startUtc: string;
  endUtc: string;
}
export interface CacheMetadata extends Scope {
  refreshedAt: string;
  /** Authoritative source coverage, not a claim inferred from record counts. */
  coverageStartUtc: string;
  coverageEndUtc: string;
  windowStartUtc: string;
  windowEndUtc: string;
}
export interface AuthorizedSnapshot extends Scope {
  doctors: readonly DoctorProjection[];
  patients: readonly PatientProjection[];
  appointments: readonly AppointmentProjection[];
  coverage: { startUtc: string; endUtc: string };
}
export interface CachedSnapshot {
  doctors: CachedDoctor[];
  patients: CachedPatient[];
  appointments: CachedAppointment[];
  metadata: CacheMetadata | null;
  window: CalendarWindow;
  /** False after rollover until a refresh covers the whole new window. */
  fullyCovered: boolean;
}

export type AppointmentSource = 'phone' | 'walk-in' | 'online' | 'import';
/** Foundation only: no workflow calls these primitives and no replay is implemented. */
export type LocalOperation =
  | {
    operationId: string;
    type: 'appointment.create';
    entityId: null;
    payload: { doctorId: number; patientId: number; startsAt: string; endsAt: string; source: AppointmentSource };
  }
  | {
    operationId: string;
    type: 'appointment.update';
    entityId: number;
    payload: { startsAt: string; endsAt: string; expectedVersion: number };
  };
export type OutboxStatus = 'pending' | 'processing' | 'failed' | 'conflict' | 'succeeded';
export type RetryCode = 'network' | 'rate-limited' | 'conflict' | 'rejected' | 'unknown';
export type OutboxRecord = LocalOperation & Scope & {
  enqueuedAt: string;
  updatedAt: string;
  status: OutboxStatus;
  attempts: number;
  retryAt: string | null;
  errorCode: RetryCode | null;
};
export interface OutboxUpdate {
  status: OutboxStatus;
  attempts: number;
  retryAt?: string | null;
  errorCode?: RetryCode | null;
}
