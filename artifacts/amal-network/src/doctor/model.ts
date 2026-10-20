import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { DigitPreference } from '@workspace/amal-ui';
import { HEBRON } from '@/network/model';

/** Asia/Hebron calendar date (YYYY-MM-DD) for an instant. */
export function hebronToday(now: Date): string { return formatInTimeZone(now, HEBRON, 'yyyy-MM-dd'); }

/** Half-open UTC interval [start, end) of an Asia/Hebron calendar day, DST-safe. */
export function hebronDayInterval(day: string): { start: Date; end: Date } {
  const [y, m, d] = day.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return { start: fromZonedTime(`${day}T00:00:00`, HEBRON), end: fromZonedTime(`${next}T00:00:00`, HEBRON) };
}

/** Milliseconds until the next Asia/Hebron midnight (minimum 1s). */
export function msUntilHebronMidnight(now: Date): number {
  return Math.max(1000, hebronDayInterval(hebronToday(now)).end.getTime() - now.getTime());
}

const toDigits = (s: string, d: DigitPreference) => d === 'latn' ? s : s.replace(/[0-9]/g, (n) => '٠١٢٣٤٥٦٧٨٩'[Number(n)]);
/** Scheduled UTC instant shown in Asia/Hebron. Unlike visit times, midnight is a real scheduled time and is shown. */
export function formatScheduleTime(iso: string, digits: DigitPreference): string {
  if (!/T/.test(iso) || !Number.isFinite(Date.parse(iso))) return '';
  return toDigits(formatInTimeZone(iso, HEBRON, 'HH:mm'), digits);
}
export function formatAuditInstant(iso: string, digits: DigitPreference): { day: string; time: string } {
  if (!Number.isFinite(Date.parse(iso))) return { day: '', time: '' };
  return { day: formatInTimeZone(iso, HEBRON, 'yyyy-MM-dd'), time: formatScheduleTime(iso, digits) };
}

export const DAY_STATUSES = ['booked', 'double_booked', 'completed', 'no_show', 'cancelled'] as const;
export function statusKey(s: unknown): string { return (DAY_STATUSES as readonly unknown[]).includes(s) ? String(s) : 'unknown'; }

/** Chronological by scheduled time, then id; unparseable times last. */
export function orderDay<T extends { id: number; startsAt: string }>(items: readonly T[]): T[] {
  const k = (s: string) => { const n = Date.parse(s); return Number.isFinite(n) ? n : Infinity; };
  return [...items].sort((a, b) => k(a.startsAt) - k(b.startsAt) || a.id - b.id);
}

export type ModeView = 'full' | 'lite' | 'trial' | 'trialUnavailable' | 'unknown';
export type SharingView = 'consent' | 'localOnly';
/** Never defaults to Full: unrecognized modes are unknown; Trial without server trial state is labeled unavailable. */
export function privacyView(p: { mode?: unknown; effectiveSharing?: unknown; trialStateAvailable?: unknown } | null | undefined): { mode: ModeView; sharing: SharingView } {
  const raw = p?.mode;
  let mode: ModeView = raw === 'full' ? 'full' : raw === 'lite' ? 'lite' : raw === 'trial' ? (p?.trialStateAvailable === true ? 'trial' : 'trialUnavailable') : 'unknown';
  if (raw === 'trial' && p?.trialStateAvailable !== true) mode = 'trialUnavailable';
  const sharing: SharingView = p?.effectiveSharing === 'consent' && (mode === 'full' || mode === 'trial') ? 'consent' : 'localOnly';
  return { mode, sharing };
}

export const AUDIT_PAGE_LIMIT = 25;
export const MAX_AUDIT_PAGES = 8;
export const DAY_PAGE_LIMIT = 50;
export const MAX_DAY_PAGES = 10;

/** Monotonic request gate: only the latest begun request may commit; invalidate() discards all in flight. */
export function createGate() {
  let n = 0;
  return { begin: () => ++n, isCurrent: (t: number) => t === n, invalidate: () => { n++; } };
}

/** Appends a page, dropping ids already present, and reports whether the bound is reached. */
export function appendPage<T extends { id: number }>(prev: readonly T[], page: { items: readonly T[]; nextCursor: string | null }, pages: number, max: number) {
  const seen = new Set(prev.map((i) => i.id));
  const items = [...prev, ...page.items.filter((i) => !seen.has(i.id))];
  const capped = pages >= max && page.nextCursor !== null;
  return { items, nextCursor: capped ? null : page.nextCursor, capped };
}

/**
 * Re-reads from the first page through page `target` (bounded by `max`) as one fresh sequence.
 * Nothing from earlier reads is reused, so a consent/mode downgrade between pages can never leave old payloads.
 */
export async function fetchThrough<P extends { items: { id: number }[]; nextCursor: string | null }>(
  fetchPage: (cursor: string | undefined, signal: AbortSignal) => Promise<P>, target: number, max: number, signal: AbortSignal,
): Promise<{ first: P; items: P['items']; nextCursor: string | null; pages: number; capped: boolean }> {
  const want = Math.max(1, Math.min(target, max));
  const first = await fetchPage(undefined, signal);
  let r = appendPage([] as { id: number }[], first, 1, max);
  let cursor = first.nextCursor; let pages = 1;
  while (pages < want && cursor) {
    const p = await fetchPage(cursor, signal);
    pages++;
    r = appendPage(r.items, p, pages, max);
    cursor = p.nextCursor;
  }
  return { first, items: r.items as P['items'], nextCursor: r.nextCursor, pages, capped: r.capped };
}
