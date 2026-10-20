import type { AppointmentInput, SyncOutcome } from '@workspace/api-client-react';
import type { LocalCacheDatabase } from './database';
import type { BookingProposal, Scope, OutboxRecord, CacheErrorCode } from './types';
import { appointmentWindow } from './calendar';
import { projectOperation, requireValid, validId } from './projections';
import { parseBookingOutcome } from './sync-store';

export class BookingFailure extends Error {
  constructor(readonly code: CacheErrorCode) { super(code); }
}
const fail = (code: CacheErrorCode): never => { throw new BookingFailure(code); };
const rows = <T extends Scope>(table: import('dexie').Table<T, any>, scope: Scope) =>
  table.where('[userId+clinicId]').equals([scope.userId, scope.clinicId]);

/** No hold capabilities or arbitrary fields may enter durable proposals. */
export function bookingInput(raw: AppointmentInput, scope: Scope): AppointmentInput {
  requireValid(raw.clinicId === scope.clinicId && !raw.holdToken);
  const op = projectOperation({ operationId: raw.clientOpId, type: 'appointment.create', entityId: null, payload: raw });
  requireValid(op.type === 'appointment.create');
  requireValid(raw.overrideReason === undefined || (typeof raw.overrideReason === 'string' && raw.overrideReason.trim().length > 0 && raw.overrideReason.length <= 2000));
  return { clinicId: scope.clinicId, clientOpId: op.operationId, ...op.payload,
    ...(raw.overrideReason === undefined ? {} : { overrideReason: raw.overrideReason.trim() }) };
}

export async function validateBooking(db: LocalCacheDatabase, scope: Scope, input: AppointmentInput, now: Date) {
  const [doctor, patient, metadata] = await Promise.all([
    db.doctors.get([scope.userId, scope.clinicId, input.doctorId]),
    db.patients.get([scope.userId, scope.clinicId, input.patientId]),
    db.metadata.get([scope.userId, scope.clinicId]),
  ]);
  if (!doctor || !patient) fail('identity-not-cached');
  const window = appointmentWindow(now);
  if (!metadata || input.startsAt < metadata.coverageStartUtc || input.endsAt > metadata.coverageEndUtc ||
    input.startsAt < window.startUtc || input.endsAt > window.endUtc) fail('coverage');
  // Same blocking statuses and half-open intervals as appointments/engine.ts.
  const blocking = (status: string) => status === 'booked' || status === 'double_booked';
  const overlaps = (row: { doctorId: number; startsAt: string; endsAt: string }) =>
    row.doctorId === input.doctorId && row.startsAt < input.endsAt && row.endsAt > input.startsAt;
  const cached = await rows(db.appointments, scope).toArray();
  const deletedIds = new Set((await rows(db.syncTombstones, scope).toArray()).map(row => row.id));
  if (cached.some(a => blocking(a.status) && overlaps(a))) fail('doctor-overlap');
  if (await rows(db.proposals, scope).filter(p => {
    if (p.operationId === input.clientOpId) return false;
    if (p.canonical && deletedIds.has(p.canonical.id)) return false;
    const canonical = p.canonical && (cached.find(a => a.id === p.canonical!.id) ?? p.canonical);
    return canonical ? blocking(canonical.status) && overlaps(canonical) : overlaps(p.input);
  }).count()) fail('doctor-overlap');
  return { doctor: doctor!, patient: patient! };
}

/** Called only inside controller.scoped's single serialized rw transaction. */
export async function persistBooking(db: LocalCacheDatabase, scope: Scope, raw: AppointmentInput, now: Date): Promise<BookingProposal> {
  const input = bookingInput(raw, scope);
  const key: [string, number, string] = [scope.userId, scope.clinicId, input.clientOpId];
  const existing = await db.proposals.get(key);
  if (existing) {
    requireValid(JSON.stringify(existing.input) === JSON.stringify(input));
    return existing;
  }
  requireValid(!await db.proposals.filter(p => p.operationId === input.clientOpId).count());
  // Existing primitive outbox IDs cannot be reassigned to a new proposal.
  requireValid(!await db.outbox.get(key));
  const { patient, doctor } = await validateBooking(db, scope, input, now);
  const settings = await db.bookingScopes.get([scope.userId, scope.clinicId]);
  const stream = settings && await db.streams.get(settings.deviceId);
  if (!stream) fail('stream-not-ready');
  const sequence = stream!.nextSequence;
  requireValid(validId(sequence) && sequence < Number.MAX_SAFE_INTEGER);
  const counter = await db.lifecycle.get('booking-local-id');
  const next = (counter?.epoch ?? 0) + 1;
  requireValid(validId(next));
  const localId = -next;
  const proposal: BookingProposal = { ...scope, operationId: input.clientOpId, localId,
    deviceId: stream!.deviceId, sequence, input,
    patient: { id: patient.id, clinicId: patient.clinicId, name: patient.name, phone: patient.phone, dateOfBirth: patient.dateOfBirth },
    doctor: { id: doctor.id, clinicId: doctor.clinicId, name: doctor.name },
    canonical: null, outcome: 'pending', outcomeCode: null };
  const operation = projectOperation({ operationId: input.clientOpId, type: 'appointment.create', entityId: null, payload: input });
  const outbox: OutboxRecord = { ...scope, ...operation,
    booking: { localId, deviceId: proposal.deviceId, sequence },
    enqueuedAt: now.toISOString(), updatedAt: now.toISOString(), status: 'pending', attempts: 0, retryAt: null, errorCode: null };
  await db.lifecycle.put({ key: 'booking-local-id', epoch: next });
  await db.streams.put({ deviceId: proposal.deviceId, nextSequence: sequence + 1 });
  await db.proposals.add(proposal);
  await db.outbox.add(outbox);
  return proposal;
}

/** A transport success is not acknowledgement. All identifying fields must match. */
export async function acknowledgeBooking(db: LocalCacheDatabase, scope: Scope, operationId: string, outcome: SyncOutcome, now: Date) {
  outcome = parseBookingOutcome(outcome);
  const key: [string, number, string] = [scope.userId, scope.clinicId, operationId];
  const proposal = await db.proposals.get(key);
  const outbox = await db.outbox.get(key);
  requireValid(proposal && outbox && outcome.clientOpId === operationId && outcome.sequence === proposal.sequence);
  if (proposal.outcome === 'applied') return;
  if (outcome.status === 'applied') {
    const a = outcome.result, input = proposal.input;
    requireValid(a && validId(a.id) && validId(a.version) && a.clientOpId === operationId &&
      a.clinicId === scope.clinicId && a.doctorId === input.doctorId && a.patientId === input.patientId &&
      new Date(a.startsAt).toISOString() === input.startsAt && new Date(a.endsAt).toISOString() === input.endsAt &&
      a.source === input.source && a.status === 'booked');
    proposal.canonical = { id: a.id, clinicId: a.clinicId, doctorId: a.doctorId, patientId: a.patientId,
      startsAt: input.startsAt, endsAt: input.endsAt, source: a.source, status: a.status,
      version: a.version, clientOpId: operationId };
    proposal.canonicalHistory = [...(proposal.canonicalHistory ?? []), proposal.canonical];
    outbox.status = 'succeeded';
    outbox.errorCode = null;
  } else {
    requireValid(['conflict', 'rejected', 'blocked'].includes(outcome.status));
    outbox.status = outcome.status === 'conflict' ? 'conflict' : 'failed';
    outbox.errorCode = outcome.status === 'conflict' ? 'conflict' : 'rejected';
  }
  proposal.outcome = outcome.status;
  // Do not cache raw errors, patient warnings, or other clinics' appointments.
  proposal.outcomeCode = outcome.status === 'applied' ? null :
    outcome.status === 'rejected' ? outcome.error.code : outcome.code;
  outbox.updatedAt = now.toISOString();
  await db.proposals.put(proposal);
  await db.outbox.put(outbox);
}
