import type { LucideIcon } from 'lucide-react';
import {
  Activity, BarChart3, Building2, CalendarDays, CalendarPlus, CalendarRange, Code2, Copy, FileUp, Globe2, ListOrdered, Handshake, IdCard, MessageSquareText,
  Printer, RefreshCcw, ScrollText, Search, ShieldCheck, Stethoscope, Users,
} from 'lucide-react';
import type { ShellRole } from './identity';

export interface ShellRoute {
  id: string;
  path: string;
  roles: readonly ShellRole[];
  icon: LucideIcon;
  /** Reachable only from an in-page entry (e.g. a selected patient), never listed in navigation. */
  navHidden?: true;
}

/** Single source of truth for shell routes and navigation (master plan Section 11). */
export const SHELL_ROUTES: readonly ShellRoute[] = [
  { id: 'today', path: '/desk/today', roles: ['front-desk'], icon: CalendarDays },
  { id: 'week', path: '/desk/week', roles: ['front-desk'], icon: CalendarRange },
  { id: 'newBooking', path: '/desk/new-booking', roles: ['front-desk'], icon: CalendarPlus },
  { id: 'patientLookup', path: '/desk/patients', roles: ['front-desk'], icon: Search },
  { id: 'consent', path: '/desk/consent', roles: ['front-desk'], icon: ShieldCheck, navHidden: true },
  { id: 'sync', path: '/desk/sync', roles: ['front-desk'], icon: RefreshCcw },
  // P2-14 waitlist: reception only; server derives clinic and authorizes.
  { id: 'waitlist', path: '/desk/waitlist', roles: ['front-desk'], icon: ListOrdered },
  { id: 'daySheet', path: '/desk/day-sheet', roles: ['front-desk'], icon: Printer },
  { id: 'myDay', path: '/doctor/my-day', roles: ['doctor'], icon: Stethoscope },
  { id: 'networkSearch', path: '/doctor/network-search', roles: ['doctor'], icon: Globe2 },
  { id: 'patientCard', path: '/doctor/patient-card', roles: ['doctor'], icon: IdCard },
  { id: 'privacy', path: '/doctor/privacy', roles: ['doctor'], icon: ShieldCheck },
  // P1-13 simulated reminders: own-clinic log; server enforces scope.
  { id: 'messages', path: '/messages', roles: ['front-desk', 'admin'], icon: MessageSquareText },
  { id: 'kpi', path: '/admin/kpi', roles: ['admin'], icon: BarChart3 },
  { id: 'networkHealth', path: '/admin/network-health', roles: ['admin'], icon: Activity },
  { id: 'usersDevices', path: '/admin/users-devices', roles: ['admin'], icon: Users },
  { id: 'clinicsDoctors', path: '/admin/clinics-doctors', roles: ['admin'], icon: Building2 },
  { id: 'audit', path: '/admin/audit', roles: ['admin'], icon: ScrollText },
  { id: 'developer', path: '/admin/developer', roles: ['admin'], icon: Code2 },
  // P1-07 import/merge APIs authorize doctor and front-desk only; admin status grants no patient-level access.
  { id: 'import', path: '/work/import', roles: ['front-desk', 'doctor'], icon: FileUp },
  { id: 'adoption', path: '/work/adoption', roles: ['front-desk', 'doctor'], icon: Handshake },
  { id: 'duplicates', path: '/work/duplicates', roles: ['front-desk', 'doctor'], icon: Copy },
];

export const KNOWN_ROLES: readonly ShellRole[] = ['admin', 'doctor', 'front-desk'];

export function isKnownRole(role: unknown): role is ShellRole {
  return typeof role === 'string' && (KNOWN_ROLES as readonly string[]).includes(role);
}

export function routesFor(role: ShellRole | null): ShellRoute[] {
  if (!isKnownRole(role)) return [];
  return SHELL_ROUTES.filter((r) => r.roles.includes(role));
}

export function landingFor(role: ShellRole | null): string | null {
  return routesFor(role).find((r) => !r.navHidden)?.path ?? null;
}

export type Resolution =
  | { kind: 'landing'; to: string }
  | { kind: 'page'; route: ShellRoute; isLanding: boolean }
  | { kind: 'forbidden' }
  | { kind: 'noRole' }
  | { kind: 'notFound' };

/** Guards direct URLs as well as links. Presentation only; the server must still authorize. */
export function resolve(location: string, role: ShellRole | null): Resolution {
  const path = location.replace(/\/+$/, '') || '/';
  const known = isKnownRole(role);
  if (path === '/') return known ? { kind: 'landing', to: landingFor(role)! } : { kind: 'noRole' };
  const route = SHELL_ROUTES.find((r) => r.path === path);
  if (!route) return { kind: 'notFound' };
  if (!known) return { kind: 'noRole' };
  if (!route.roles.includes(role)) return { kind: 'forbidden' };
  return { kind: 'page', route, isLanding: landingFor(role) === route.path };
}
