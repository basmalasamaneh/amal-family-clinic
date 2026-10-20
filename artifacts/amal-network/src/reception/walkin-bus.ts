import { useSyncExternalStore } from 'react';
import type { PatientHit } from '@/booking/patients';

/**
 * Tiny in-memory bus so overlays rendered outside the WalkIn context (cancellation, tour,
 * conflict dialog portals) can request the global Walk-in. Opening stacks the walk-in drawer on
 * top; the originating overlay stays mounted, so its unsaved input is preserved.
 *
 * Context is only a hint: the provider revalidates clinic, and the drawer revalidates the doctor
 * against the live roster. Nothing is ever committed without the explicit "Book doctor at time" tap.
 */
export interface WalkInContext { patient?: PatientHit | null; doctorId?: number | null; clinicId?: number | null }
let enabled = false;
let opener: ((c?: WalkInContext) => void) | null = null;
/** Explicit selection published by the current screen (e.g. calendar doctor filter). */
let pageContext: WalkInContext | null = null;
const subs = new Set<() => void>();
export function registerWalkIn(fn: ((c?: WalkInContext) => void) | null): void { opener = fn; enabled = !!fn; subs.forEach((s) => s()); }
export function requestWalkIn(c?: WalkInContext): void { opener?.(c ?? pageContext ?? undefined); }
export function setWalkInPageContext(c: WalkInContext | null): void { pageContext = c; }
export function getWalkInPageContext(): WalkInContext | null { return pageContext; }
export function useWalkInAvailable(): boolean {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => enabled, () => false);
}
