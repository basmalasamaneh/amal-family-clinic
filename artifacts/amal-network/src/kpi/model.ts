import type { AmalLocale, DigitPreference } from '@workspace/amal-ui';
import type { KpiClinicAppointmentAggregate, KpiCollisionCounts, KpiConflictDay, KpiNoShowRate, KpiPeriod, KpiResult, KpiSourceCounts } from '@workspace/api-client-react';

/** Pure KPI view-model helpers. No fixtures, no inferred values: unavailable stays null. */
export type RangeKind = 'day' | 'week' | 'month';
export type CollisionMetric = keyof KpiCollisionCounts;
export type SeriesMode = 'daily' | 'cumulative';
export const SOURCE_KEYS = ['phone', 'walk-in', 'calendar', 'amal-network', 'unknown'] as const satisfies readonly (keyof KpiSourceCounts)[];
export type SourceKey = (typeof SOURCE_KEYS)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function utcNoon(d: string): number {
  if (!DATE_RE.test(d)) throw new RangeError('Expected YYYY-MM-DD');
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)), 12);
}
/** Calendar arithmetic on date-only strings; never shifts across zones. */
export function addDays(d: string, n: number): string { return new Date(utcNoon(d) + n * 864e5).toISOString().slice(0, 10); }
export function dayIndex(start: string, d: string): number { return Math.round((utcNoon(d) - utcNoon(start)) / 864e5); }
export function inclusiveEnd(p: Pick<KpiPeriod, 'endDateExclusive'>): string { return addDays(p.endDateExclusive, -1); }

/** Params identity guard: a response is shown only if it belongs to the currently selected window. */
export function matchesSelection(data: Pick<KpiResult, 'range'> | undefined, range: RangeKind): boolean { return !!data && data.range === range; }

export function num(v: number, locale: AmalLocale, digits: DigitPreference, maxFrac = 0): string {
  return new Intl.NumberFormat(locale, { numberingSystem: digits, maximumFractionDigits: maxFrac }).format(v);
}
/** API percent (already rounded to one decimal) or null → unavailable. */
export function pct(percent: number | null, locale: AmalLocale, digits: DigitPreference): string | null {
  return percent === null ? null : new Intl.NumberFormat(locale, { numberingSystem: digits, style: 'percent', maximumFractionDigits: 1 }).format(percent / 100);
}
export function shortDate(d: string, locale: AmalLocale, digits: DigitPreference): string {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', numberingSystem: digits, day: 'numeric', month: 'short' }).format(new Date(utcNoon(d)));
}
/** 0 Sunday … 6 Saturday; 2023-01-01 is a Sunday. Label only — bucketing comes from the API. */
export function weekdayName(w: number, locale: AmalLocale): string {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long' }).format(new Date(Date.UTC(2023, 0, 1 + w, 12)));
}

export interface ClinicPair { clinicId: number; clinicName: string; before: number | null; after: number | null }
/** Union of clinics by ID (data-supplied names; after-window name wins). Missing side is null, not 0. */
export function clinicPairs(r: KpiResult, metric: CollisionMetric): ClinicPair[] {
  const map = new Map<number, ClinicPair>();
  for (const c of r.before.metrics.clinics) map.set(c.clinicId, { clinicId: c.clinicId, clinicName: c.clinicName, before: c.collisions[metric], after: null });
  for (const c of r.after.metrics.clinics) {
    const e = map.get(c.clinicId);
    if (e) { e.after = c.collisions[metric]; e.clinicName = c.clinicName; }
    else map.set(c.clinicId, { clinicId: c.clinicId, clinicName: c.clinicName, before: null, after: c.collisions[metric] });
  }
  return [...map.values()].sort((a, b) => a.clinicId - b.clinicId);
}

export interface SeriesPoint { date: string; index: number; value: number; row: KpiConflictDay }
export interface DayRow { date: string; row: KpiConflictDay | null }
/** Observed points only, split where a day has no row. Never zero-filled. */
export function preventionSeries(period: KpiPeriod, daily: KpiConflictDay[], mode: SeriesMode) {
  const sorted = [...daily].filter((d) => DATE_RE.test(d.date)).sort((a, b) => a.date.localeCompare(b.date));
  const points: SeriesPoint[] = sorted
    .map((row) => ({ date: row.date, index: dayIndex(period.startDate, row.date), value: mode === 'daily' ? row.blocked : row.cumulativeBlocked, row }))
    .filter((p) => p.index >= 0 && p.index < period.days);
  const segments: SeriesPoint[][] = [];
  for (const p of points) {
    const last = segments[segments.length - 1];
    if (last && p.index - last[last.length - 1].index === 1) last.push(p); else segments.push([p]);
  }
  const byDate = new Map(points.map((p) => [p.date, p.row]));
  const rows: DayRow[] = Array.from({ length: period.days }, (_, i) => { const date = addDays(period.startDate, i); return { date, row: byDate.get(date) ?? null }; });
  const peak = points.reduce<SeriesPoint | null>((m, p) => (!m || p.value > m.value ? p : m), null);
  return { points, segments, rows, peak, observed: points.length, max: Math.max(0, ...points.map((p) => p.value)) };
}

export interface Slice { key: SourceKey; count: number; share: number }
export function sourceSlices(s: KpiSourceCounts): { total: number; slices: Slice[] } {
  const total = SOURCE_KEYS.reduce((n, k) => n + s[k], 0);
  return { total, slices: SOURCE_KEYS.map((key) => ({ key, count: s[key], share: total ? s[key] / total : 0 })) };
}

export interface RateRow { id: number; label: string; rate: KpiNoShowRate }
export function noShowRows(clinics: KpiClinicAppointmentAggregate[]): RateRow[] {
  return [...clinics].sort((a, b) => a.clinicId - b.clinicId).map((c) => ({ id: c.clinicId, label: c.clinicName, rate: c.noShow }));
}
export function topRate<T extends { rate: { percent: number | null } }>(rows: T[]): T | null {
  return rows.filter((r) => r.rate.percent !== null).reduce<T | null>((m, r) => (!m || r.rate.percent! > m.rate.percent! ? r : m), null);
}
/** Always seven buckets Sunday→Saturday; absent buckets stay unavailable. */
export const LOOKUP_TARGET_SECONDS = 10;
export const LOSS_TARGET = 0;
export type WeekdayRow = { weekday: number; missing: false; rate: KpiNoShowRate } | { weekday: number; missing: true; rate: { numerator: null; denominator: null; ratio: null; percent: null } };
/** Absent API buckets are marked missing with null counts — never synthesized zeros. */
export function weekdayRows(r: KpiResult): WeekdayRow[] {
  const by = new Map(r.after.metrics.weekdays.map((w) => [w.weekday, w.noShow]));
  return Array.from({ length: 7 }, (_, w): WeekdayRow => {
    const rate = by.get(w);
    return rate ? { weekday: w, missing: false, rate } : { weekday: w, missing: true, rate: { numerator: null, denominator: null, ratio: null, percent: null } };
  });
}

/** Range percentiles come from the merged server distribution, never averaged daily values. */
export function lookupView(r: KpiResult) {
  const l = r.after.telemetry.lookupTime;
  return { available: l.available, median: l.medianSeconds, p90: l.p90Seconds, samples: l.sampleCount, meetsTarget: meetsLookupTarget(l.medianSeconds), boundaries: l.measurementBoundaries };
}
/** Strict target: under 10 s. 10.0 does not meet it. */
export function meetsLookupTarget(seconds: number | null): boolean | null { return seconds === null ? null : seconds < LOOKUP_TARGET_SECONDS; }
/** Loss: null (unavailable) is distinct from measured 0. */
export function lossStatus(value: number | null): 'unavailable' | 'met' | 'missed' { return value === null ? 'unavailable' : value === LOSS_TARGET ? 'met' : 'missed'; }

/**
 * Highlight designation for Dr. Nabil's clinic. No upstream field or configuration exists in the
 * current contract, so this resolves to unavailable. Never matches by literal ID or name substring.
 */
export function resolveDesignation(_r: KpiResult): { kind: 'unavailable' } | { kind: 'designated'; clinicId: number } {
  return { kind: 'unavailable' };
}

export function isEmptyWindow(r: KpiResult): boolean {
  const c = r.after.telemetry.conflicts;
  return r.after.metrics.totalAppointments === 0
    && !r.after.telemetry.lookupTime.available
    && Object.values(c.cumulative).every((count) => count === 0)
    && c.daily.every((day) => day.blocked === 0 && day.warnings === 0 && day.overrides === 0)
    && r.after.telemetry.downtime.receivedCreates === 0;
}
export function partialItems(r: KpiResult): ('lookup' | 'loss' | 'network' | 'adoptionHistory' | 'designation')[] {
  const out: ('lookup' | 'loss' | 'network' | 'adoptionHistory' | 'designation')[] = [];
  if (!r.after.telemetry.lookupTime.available) out.push('lookup');
  if (!r.after.telemetry.downtime.lost.available) out.push('loss');
  if (!r.after.telemetry.networkActivity.available) out.push('network');
  if (!r.adoption.history.available) out.push('adoptionHistory');
  if (resolveDesignation(r).kind === 'unavailable') out.push('designation');
  return out;
}
export const ADOPTION_STEPS = ['trial', 'lite', 'full'] as const;
