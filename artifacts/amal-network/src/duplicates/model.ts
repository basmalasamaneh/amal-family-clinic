import { normName } from '@/imports/model';

/** Presentation-only comparison. Eligibility and merge permission always come from the server. */
export interface Person { id: number; name: string; dateOfBirth: string; phone: string }
export const canonPhone = (p: string) => p.replace(/[^\d]/g, '').replace(/^00/, '');
export type Diff = { name: boolean; dob: boolean; phone: boolean };
export function diff(a: Person, b: Person): Diff {
  return { name: normName(a.name) !== normName(b.name), dob: a.dateOfBirth !== b.dateOfBirth, phone: canonPhone(a.phone) !== canonPhone(b.phone) };
}
export type Verdict =
  | { kind: 'samePatient' }
  | { kind: 'notMatch'; reasons: ('both' | 'dob' | 'phone' | 'name')[] }
  | { kind: 'eligible' }
  | { kind: 'unlisted' };
/**
 * Any differing identity field means "Not a match". Identical-looking pairs are eligible ONLY
 * when the server listed them; the client never loosens eligibility.
 */
export function verdict(a: Person, b: Person, serverListed: boolean): Verdict {
  if (a.id === b.id) return { kind: 'samePatient' };
  const d = diff(a, b);
  const reasons: ('both' | 'dob' | 'phone' | 'name')[] = [];
  if (d.dob && d.phone) reasons.push('both'); else { if (d.dob) reasons.push('dob'); if (d.phone) reasons.push('phone'); }
  if (d.name) reasons.push('name');
  if (reasons.length) return { kind: 'notMatch', reasons };
  return serverListed ? { kind: 'eligible' } : { kind: 'unlisted' };
}
export const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
