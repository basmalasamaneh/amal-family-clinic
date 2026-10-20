import type { ShellRole } from '../shell/identity';

export const TOUR_VERSION = 1;
export interface TourStep { id: string; /** data-tour targets in priority; first visible wins, none = centered step. */ targets: string[]; titleKey: string; bodyKey: string }
const common = (role: ShellRole): TourStep[] => [
  { id: 'welcome', targets: [], titleKey: 'tour.welcome.title', bodyKey: `tour.welcome.${role}` },
  { id: 'nav', targets: ['nav-side', 'nav-bottom'], titleKey: 'tour.nav.title', bodyKey: `tour.nav.${role}` },
  { id: 'account', targets: ['user-menu'], titleKey: 'tour.account.title', bodyKey: 'tour.account.body' },
  { id: 'help', targets: ['help'], titleKey: 'tour.help.title', bodyKey: 'tour.help.body' },
  { id: 'data', targets: [], titleKey: 'tour.data.title', bodyKey: 'tour.data.body' },
];
export function tourFor(role: ShellRole | null): TourStep[] { return role ? common(role) : []; }

export type TourStatus = 'completed' | 'dismissed';
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }
export const tourKey = (userId: string, role: ShellRole, version = TOUR_VERSION) => `amal.tour.v${version}:${encodeURIComponent(userId)}:${role}`;
const kv = (): KV | null => { try { return window.localStorage; } catch { return null; } };
/** Stores only a status word per stable identity + role + version. Failures never block. */
export function readTour(userId: string, role: ShellRole, store: KV | null = kv()): TourStatus | null {
  try { const v = store?.getItem(tourKey(userId, role)); return v === 'completed' || v === 'dismissed' ? v : null; } catch { return null; }
}
export function writeTour(userId: string, role: ShellRole, status: TourStatus, store: KV | null = kv()): void {
  try { store?.setItem(tourKey(userId, role), status); } catch { /* storage disabled */ }
}
