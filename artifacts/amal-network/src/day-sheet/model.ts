import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { CalendarAppointment, Lifecycle } from '../calendar/adapter';

export const SHEET_TIME_ZONE = 'Asia/Hebron' as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isLocalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Local Hebron midnight to next local midnight; 23h/25h on DST days. */
export function dayBounds(localDate: string): { startUtc: string; endUtc: string } {
  if (!isLocalDate(localDate)) throw new RangeError('Expected YYYY-MM-DD');
  return {
    startUtc: fromZonedTime(`${localDate}T00:00:00`, SHEET_TIME_ZONE).toISOString(),
    endUtc: fromZonedTime(`${addDays(localDate, 1)}T00:00:00`, SHEET_TIME_ZONE).toISOString(),
  };
}
export function localDateOfInstant(instant: Date | string): string {
  return formatInTimeZone(instant, SHEET_TIME_ZONE, 'yyyy-MM-dd');
}
/** Days within the upstream cache window [start, end); never extends retention. */
export function selectableDays(window: { localStartDate: string; localEndDate: string }): string[] {
  if (!isLocalDate(window.localStartDate) || !isLocalDate(window.localEndDate)) return [];
  const out: string[] = [];
  for (let d = window.localStartDate; d < window.localEndDate && out.length < 31; d = addDays(d, 1)) out.push(d);
  return out;
}
export function clampDay(requested: string | null, days: string[]): string | null {
  if (requested && days.includes(requested)) return requested;
  return days[0] ?? null;
}

export type Coverage = 'complete' | 'partial' | 'missing';
export interface CoverageInput {
  metadata: { coverageStartUtc: string; coverageEndUtc: string; refreshedAt: string } | null;
  window: { startUtc: string; endUtc: string };
  fullyCovered: boolean;
}
const ms = (s: string) => Date.parse(s);
export function dayCoverage(localDate: string, snap: CoverageInput | null): Coverage {
  if (!snap || !snap.metadata || !isLocalDate(localDate)) return 'missing';
  const { startUtc, endUtc } = dayBounds(localDate);
  const a = ms(startUtc), b = ms(endUtc);
  const lo = Math.max(ms(snap.metadata.coverageStartUtc), ms(snap.window.startUtc));
  const hi = Math.min(ms(snap.metadata.coverageEndUtc), ms(snap.window.endUtc));
  if (![lo, hi, a, b].every(Number.isFinite) || hi <= a || lo >= b) return 'missing';
  // fullyCovered also reports referential integrity: reads omit appointments
  // whose patient/doctor is missing. Range metadata alone cannot prove completeness.
  return snap.fullyCovered && lo <= a && hi >= b ? 'complete' : 'partial';
}

export type RowStatus = Exclude<Lifecycle, 'double_booked'> | 'double_booked';
export interface SheetRow {
  key: string;
  startsAt: string; endsAt: string;
  doctorId: number; doctorName: string | null;
  patientName: string | null;
  lifecycle: Lifecycle;
  provisional: boolean;
  attention: boolean;
}
export function buildRows(appts: CalendarAppointment[], doctors: { id: number; name: string }[], bounds: { startUtc: string; endUtc: string }, doctorId: number | null): SheetRow[] {
  const names = new Map(doctors.map(d => [d.id, d.name]));
  const a = ms(bounds.startUtc), b = ms(bounds.endUtc);
  const seen = new Set<string>();
  const rows: SheetRow[] = [];
  for (const x of appts) {
    const t = ms(x.startsAt);
    if (!Number.isFinite(t) || t < a || t >= b) continue;
    if (doctorId !== null && x.doctorId !== doctorId) continue;
    const key = x.clientOpId ? `op:${x.clientOpId}` : `id:${x.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      key, startsAt: x.startsAt, endsAt: x.endsAt, doctorId: x.doctorId, doctorName: names.get(x.doctorId) ?? null,
      patientName: x.patientName?.trim() ? x.patientName : null, lifecycle: x.lifecycle,
      provisional: x.syncPending, attention: x.conflict,
    });
  }
  return rows.sort((p, q) => p.startsAt.localeCompare(q.startsAt) || (p.doctorName ?? '').localeCompare(q.doctorName ?? '') || p.key.localeCompare(q.key));
}
export interface SheetCounts { total: number; provisional: number; attention: number; cancelled: number }
export function countRows(rows: SheetRow[]): SheetCounts {
  return {
    total: rows.length,
    provisional: rows.filter(r => r.provisional).length,
    attention: rows.filter(r => r.attention).length,
    cancelled: rows.filter(r => r.lifecycle === 'cancelled').length,
  };
}
export function toDisplayDigits(value: string, digits: 'latn' | 'arab'): string {
  return digits === 'latn' ? value : value.replace(/[0-9]/g, n => '٠١٢٣٤٥٦٧٨٩'[Number(n)]);
}
export function formatLocalTime(instant: string, digits: 'latn' | 'arab'): string {
  return toDisplayDigits(formatInTimeZone(instant, SHEET_TIME_ZONE, 'HH:mm'), digits);
}

/** Shell scope is `${userId}:${role}:${clinicId}`; user ids may contain ':' so parse from the end. */
export function parseScope(scope: string): { userId: string; clinicId: number } | null {
  const parts = scope.split(':');
  if (parts.length < 3) return null;
  const clinicId = Number(parts[parts.length - 1]);
  const userId = parts.slice(0, -2).join(':');
  return userId && Number.isSafeInteger(clinicId) && clinicId > 0 ? { userId, clinicId } : null;
}
export interface TicketLike { userId: string; clinicId: number; generation: number }
export function sameTicket(a: TicketLike | null | undefined, b: TicketLike | null | undefined): boolean {
  return !!a && !!b && a.userId === b.userId && a.clinicId === b.clinicId && a.generation === b.generation;
}
export function ticketMatchesScope(t: TicketLike | null | undefined, expected: { userId: string; clinicId: number } | null): boolean {
  return !!t && !!expected && t.userId === expected.userId && t.clinicId === expected.clinicId;
}
