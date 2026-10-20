import { formatInTimeZone } from 'date-fns-tz';
import { ar, enGB } from 'date-fns/locale';
import type { AmalLocale, DigitPreference } from '@workspace/amal-ui';
import type { AlertChip, NetworkPatient, NetworkPatientPage, NetworkVisit, LookupNetworkParams } from '@workspace/api-client-react';

/**
 * Network search domain helpers. Pure and side-effect free except the in-memory selection
 * holder, which never touches URLs, Web Storage, IndexedDB, caches or logs.
 */

export type ConsentView = 'none' | 'basic' | 'clinical' | 'unknown';
export const HEBRON = 'Asia/Hebron';
export const MIN_Q = 2;
export const MAX_Q = 200;
export const PAGE_LIMIT = 25;
export const MAX_REVALIDATE_PAGES = 20;

/** Server-provided effective level only. Never derived from visit visibility; anything unexpected is "unknown". */
export function effectiveConsent(p: NetworkPatient | null | undefined): ConsentView {
  const v = p ? (p as unknown as { effectiveConsentLevel?: unknown }).effectiveConsentLevel : undefined;
  return v === 'none' || v === 'basic' || v === 'clinical' ? v : 'unknown';
}

export function normalizeQuery(raw: string): string | null {
  const q = raw.trim().replace(/\s+/g, ' ');
  return q.length >= MIN_Q && q.length <= MAX_Q ? q : null;
}

const ts = (v: NetworkVisit) => { const n = Date.parse(v.seenAt); return Number.isFinite(n) ? n : 0; };
/** Newest first; ties keep server order (server already orders by date then internal id desc). */
export function orderVisits(visits: readonly NetworkVisit[]): NetworkVisit[] {
  return visits.map((v, i) => ({ v, i })).sort((a, b) => ts(b.v) - ts(a.v) || a.i - b.i).map((x) => x.v);
}
/** Only disclosed visits are ever considered. */
export function latestVisit(p: NetworkPatient): NetworkVisit | null { return orderVisits(p.visits)[0] ?? null; }

/** Alerts are shown only on visits the server marked clinical; legacy keyAlerts are never rendered alone. */
export function visitAlerts(v: NetworkVisit): AlertChip[] { return v.visibility === 'clinical' && Array.isArray(v.alerts) ? v.alerts : []; }
export function visitNote(v: NetworkVisit): string | null { return v.visibility === 'clinical' && typeof v.complaint === 'string' && v.complaint.trim() ? v.complaint : null; }
export function patientAlerts(p: NetworkPatient): AlertChip[] { return orderVisits(p.visits).flatMap(visitAlerts); }

export const CLINIC_TONES = 6;
/** Stable tone from the API clinic id; always rendered alongside the clinic name. */
export function clinicTone(clinicId: number): number { return ((Math.abs(Math.trunc(clinicId)) % CLINIC_TONES) + CLINIC_TONES) % CLINIC_TONES; }

export type RelUnit = 'day' | 'week' | 'month' | 'year';
export function relativeParts(iso: string, now: Date): { value: number; unit: RelUnit } | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const days = Math.floor(Math.max(0, now.getTime() - t) / 86_400_000);
  if (days < 7) return { value: -days, unit: 'day' };
  if (days < 60) return { value: -Math.floor(days / 7), unit: 'week' };
  if (days < 730) return { value: -Math.floor(days / 30.4375), unit: 'month' };
  return { value: -Math.floor(days / 365.25), unit: 'year' };
}
export function relativeLabel(iso: string, now: Date, locale: AmalLocale, digits: DigitPreference): string {
  const p = relativeParts(iso, now);
  if (!p) return '';
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto', numberingSystem: digits } as Intl.RelativeTimeFormatOptions).format(p.value, p.unit);
}

const toDigits = (s: string, d: DigitPreference) => d === 'latn' ? s : s.replace(/[0-9]/g, (n) => '٠١٢٣٤٥٦٧٨٩'[Number(n)]);
const fnsLocale = (l: AmalLocale) => (l === 'ar' ? ar : enGB);
/** UTC instant shown as an Asia/Hebron calendar day; date-only strings stay calendar dates and are never shifted. */
export function formatVisitDay(value: string, locale: AmalLocale, digits: DigitPreference): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return toDigits(formatInTimeZone(`${value}T12:00:00Z`, 'UTC', 'd MMMM yyyy', { locale: fnsLocale(locale) }), digits);
  }
  if (!Number.isFinite(Date.parse(value))) return '';
  return toDigits(formatInTimeZone(value, HEBRON, 'd MMMM yyyy', { locale: fnsLocale(locale) }), digits);
}
/** Legacy date-only visits arrive as Asia/Hebron start-of-day; midnight is never shown as a known visit time. */
export function formatVisitTime(value: string, digits: DigitPreference): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))) return '';
  if (formatInTimeZone(value, HEBRON, 'HH:mm:ss.SSS') === '00:00:00.000') return '';
  return toDigits(formatInTimeZone(value, HEBRON, 'HH:mm'), digits);
}
export function hebronYear(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(0, 4);
  return Number.isFinite(Date.parse(value)) ? formatInTimeZone(value, HEBRON, 'yyyy') : '';
}

export type FetchPage = (params: LookupNetworkParams, options?: RequestInit) => Promise<NetworkPatientPage>;

/** Re-runs the exact audited lookup and returns the same stable id, iterating cursors if needed. */
export async function findPatient(fetchPage: FetchPage, q: string, id: number, signal?: AbortSignal, maxPages = MAX_REVALIDATE_PAGES): Promise<NetworkPatient | null> {
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage(cursor ? { q, limit: PAGE_LIMIT, cursor } : { q, limit: PAGE_LIMIT }, { signal });
    const hit = page.items.find((p) => p.id === id);
    if (hit) return hit;
    if (!page.nextCursor) return null;
    cursor = page.nextCursor;
  }
  return null;
}

export type Failure = 'denied' | 'error' | 'session';
export function classifyFailure(e: unknown): Failure {
  const s = e && typeof e === 'object' && 'status' in e ? (e as { status: unknown }).status : null;
  if (s === 401) return 'session';
  if (s === 403 || s === 404) return 'denied';
  return 'error';
}
export const isAbortError = (e: unknown) => e instanceof DOMException ? e.name === 'AbortError' : !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'AbortError';

/** Dispatch on document after any consent change so open network views revalidate immediately. */
export const CONSENT_CHANGED_EVENT = 'amal:consent-changed';
export const REVALIDATE_MS = 60_000;

/* ---- Transient selection: module memory only, scoped to identity + clinic ---- */
export interface Selection { scope: string; q: string; id: number }
let selection: Selection | null = null;
export function setSelection(s: Selection): void { selection = { ...s }; }
export function getSelection(scope: string): Selection | null {
  if (selection && selection.scope !== scope) selection = null;
  return selection ? { ...selection } : null;
}
export function clearSelection(): void { selection = null; }
