import { fromZonedTime } from 'date-fns-tz';
import type { ListReminderLogParams } from '@workspace/api-client-react';

export const LOG_PAGE_SIZE = 25;
export const MAX_RANGE_DAYS = 92;
export const STATUSES = ['scheduled', 'sent', 'cancelled'] as const;
export type StatusFilter = '' | (typeof STATUSES)[number];
export interface LogFilters { status: StatusFilter; from: string; to: string }
export const EMPTY_FILTERS: LogFilters = { status: '', from: '', to: '' };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function validDay(v: string): boolean {
  if (!DAY.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
function nextDay(v: string): string {
  const d = new Date(`${v}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
/** Asia/Hebron local midnight as a UTC instant (DST aware). */
export function hebronMidnight(day: string): string {
  return fromZonedTime(`${day}T00:00:00`, 'Asia/Hebron').toISOString();
}

export type FilterError = 'errDate' | 'errOrder' | 'errRange' | null;
export function validateFilters(f: LogFilters): FilterError {
  if ((f.from && !validDay(f.from)) || (f.to && !validDay(f.to))) return 'errDate';
  if (f.from && f.to) {
    if (f.from > f.to) return 'errOrder';
    const days = (Date.parse(`${f.to}T12:00:00Z`) - Date.parse(`${f.from}T12:00:00Z`)) / 86_400_000 + 1;
    if (days > MAX_RANGE_DAYS) return 'errRange';
  }
  return null;
}

/** Inclusive local days become a half-open [from, to) UTC window on the intended due instant. */
export function toParams(clinicId: number, f: LogFilters, cursor: number | null): ListReminderLogParams {
  return {
    clinicId,
    limit: LOG_PAGE_SIZE,
    ...(cursor ? { cursor } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.from ? { from: hebronMidnight(f.from) } : {}),
    ...(f.to ? { to: hebronMidnight(nextDay(f.to)) } : {}),
  };
}

/** Confirmed backend cancellation codes; anything else gets authored generic text, never the raw value. */
export const KNOWN_REASONS = ['missed_window', 'appointment_changed', 'appointment_inactive', 'clinic_disabled', 'patient_opt_out', 'stale_schedule'] as const;
export function reasonKey(reason: string | null): string {
  if (!reason) return 'reason.unknown';
  const v = reason.replace(/^messages\.reason\./, '');
  return (KNOWN_REASONS as readonly string[]).includes(v) ? `reason.${v}` : 'reason.other';
}

export function errorStatus(e: unknown): number | null {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : null;
}
