import type { PatientInput } from '@workspace/api-client-react';
import type { LocalCacheDatabase } from './database';
import type { PatientRegistration, Scope } from './types';
import { requireValid } from './projections';
import { validateRegistration } from '../reception/registration';
import { formatInTimeZone } from 'date-fns-tz';

export async function registrationFor(db: LocalCacheDatabase, scope: Scope, localId: number) {
  requireValid(Number.isSafeInteger(localId) && localId < 0);
  return db.registrations.where('[userId+clinicId+localId]').equals([scope.userId, scope.clinicId, localId]).first();
}
export async function persistRegistration(db: LocalCacheDatabase, scope: Scope, raw: PatientInput, now: Date): Promise<PatientRegistration> {
  requireValid(raw && typeof raw.clientOpId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw.clientOpId));
  const input: PatientInput = { clientOpId: raw.clientOpId, name: raw.name, phone: raw.phone, dateOfBirth: raw.dateOfBirth,
    ...(raw.guardianName === undefined ? {} : { guardianName: raw.guardianName }),
    ...(raw.guardianRelation === undefined ? {} : { guardianRelation: raw.guardianRelation }) };
  const key: [string, number, string] = [scope.userId, scope.clinicId, input.clientOpId];
  const existing = await db.registrations.get(key);
  if (existing) {
    requireValid(JSON.stringify(existing.input) === JSON.stringify(input));
    return existing;
  }
  const validation = validateRegistration({ name: input.name, phone: input.phone, dob: input.dateOfBirth,
    guardianName: input.guardianName ?? '', guardianRelation: input.guardianRelation ?? '' }, formatInTimeZone(now, 'Asia/Hebron', 'yyyy-MM-dd'));
  requireValid(validation.ok);
  requireValid(input.guardianRelation === undefined || (typeof input.guardianRelation === 'string' && input.guardianRelation.length <= 100));
  requireValid(input.guardianName === undefined || (typeof input.guardianName === 'string' && input.guardianName.length <= 200));
  requireValid(!await db.registrations.filter(r => r.clientOpId === input.clientOpId).count());
  const next = ((await db.lifecycle.get('registration-local-id'))?.epoch ?? 0) + 1;
  requireValid(Number.isSafeInteger(next) && next > 0);
  const row: PatientRegistration = { ...scope, clientOpId: input.clientOpId, localId: -next, input,
    patient: { id: -next, clinicId: scope.clinicId, registrationOpId: input.clientOpId,
      name: validation.payload.name, phone: validation.payload.phone, dateOfBirth: validation.payload.dateOfBirth },
    canonical: null, status: 'pending', attempts: 0, errorCode: null };
  await db.lifecycle.put({ key: 'registration-local-id', epoch: next });
  await db.registrations.add(row);
  return row;
}
