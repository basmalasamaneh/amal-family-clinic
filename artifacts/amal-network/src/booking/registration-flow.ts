import type { PatientHit } from './patients';
import { MIN_QUERY } from './patients';

export function completedEmpty(query: string, result: { kind: string; q?: string; items?: unknown[] }, current: boolean): boolean {
  return current && query.trim().length >= MIN_QUERY && result.kind === 'ok' && result.q === query.trim() && result.items?.length === 0;
}
/** Phone searches, including Arabic digits, must not become a person's name. */
export function registrationName(query: string): string {
  return /^\p{L}/u.test(query.trim()) ? query.trim() : '';
}
export interface CreatedRegistration { patient: PatientHit; operationId: string }
/** Never creates: retrying this phase can only refresh authorized data. */
export async function refreshRegisteredPatient(created: CreatedRegistration, clinicId: number,
  refresh: () => Promise<void>, read: () => Promise<{ patients: PatientHit[] }>, current: () => boolean): Promise<PatientHit> {
  if (!current()) throw new Error('stale-context');
  await refresh();
  if (!current()) throw new Error('stale-context');
  const snapshot = await read();
  if (!current()) throw new Error('stale-context');
  const patient = snapshot.patients.find(p => p.id === created.patient.id && p.clinicId === clinicId);
  if (!patient) throw new Error('identity-not-cached');
  return patient;
}
