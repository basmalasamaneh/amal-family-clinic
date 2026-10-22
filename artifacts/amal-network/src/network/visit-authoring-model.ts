import { formatInTimeZone } from 'date-fns-tz';
import type { ClinicalVisitInput, NetworkVisit, VisitAddendumInput } from '@workspace/api-client-react';
import { CLINIC_TZ, isLocalDate, localToUtc } from '../calendar/dates';

export const localVisitNow = (now = new Date()) => formatInTimeZone(now, CLINIC_TZ, "yyyy-MM-dd'T'HH:mm");
/** Uses the calendar's DST overlap policy; rejects nonexistent wall times by round trip. */
export function visitTimeUTC(value: string, now = new Date()): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !isLocalDate(value.slice(0, 10))) throw new RangeError('date');
  const hour = Number(value.slice(11, 13)), minute = Number(value.slice(14));
  if (hour > 23 || minute > 59) throw new RangeError('date');
  const utc = localToUtc(value.slice(0, 10), hour * 60 + minute);
  if (localVisitNow(new Date(utc)) !== value || Date.parse(utc) > now.getTime() + 300_000) throw new RangeError('date');
  return utc;
}
export const disclosedAddenda = (visit: NetworkVisit) => visit.visibility === 'clinical' ? visit.addenda ?? [] : [];
export const mayAppend = (visit: NetworkVisit) => visit.visibility === 'clinical' && visit.canAddendum === true && typeof visit.visitId === 'number';

export function authoringFailure(error: unknown): 'authority' | 'validation' | 'conflict' | 'uncertain' {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  if (status === 401 || status === 403 || status === 404) return 'authority';
  if (status === 400 || status === 422) return 'validation';
  return status === 409 ? 'conflict' : 'uncertain';
}

/** Memory-only operation latch. Unknown outcomes retain the exact frozen request and operation id. */
export class VisitOperation {
  payload: Readonly<ClinicalVisitInput | VisitAddendumInput> | null = null;
  pending = false;
  begin(input: ClinicalVisitInput | VisitAddendumInput) {
    if (this.pending) return null;
    this.payload ??= Object.freeze({ ...input });
    this.pending = true;
    return this.payload;
  }
  uncertain() { this.pending = false; }
  /** Capability transport errors convey no authority decision; retain even an uncertain operation. */
  capabilityFailed(error: unknown) {
    if (authoringFailure(error) === 'authority') { this.reset(); return 'clear' as const; }
    return 'preserve' as const;
  }
  saveFailed(error: unknown) {
    const kind = authoringFailure(error);
    if (kind === 'authority' || kind === 'validation') this.reset();
    else this.uncertain();
    return kind;
  }
  reset() { this.pending = false; this.payload = null; }
}
