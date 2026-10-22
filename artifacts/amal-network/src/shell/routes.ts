import type { LucideIcon } from 'lucide-react';
import { AmalIcons as I } from '@workspace/amal-ui/icon-map';
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
  { id: 'today', path: '/desk/today', roles: ['front-desk'], icon: I.today },
  { id: 'week', path: '/desk/week', roles: ['front-desk'], icon: I.week },
  { id: 'newBooking', path: '/desk/new-booking', roles: ['front-desk'], icon: I.newBooking },
  { id: 'patientLookup', path: '/desk/patients', roles: ['front-desk'], icon: I.patients },
  { id: 'consent', path: '/desk/consent', roles: ['front-desk'], icon: I.consent, navHidden: true },
  { id: 'sync', path: '/desk/sync', roles: ['front-desk'], icon: I.sync },
  // P2-14 waitlist: reception only; server derives clinic and authorizes.
  { id: 'waitlist', path: '/desk/waitlist', roles: ['front-desk'], icon: I.waitlist },
  { id: 'daySheet', path: '/desk/day-sheet', roles: ['front-desk'], icon: I.daySheet },
  { id: 'myDay', path: '/doctor/my-day', roles: ['doctor'], icon: I.myDay },
  { id: 'networkSearch', path: '/doctor/network-search', roles: ['doctor'], icon: I.networkSearch },
  { id: 'patientCard', path: '/doctor/patient-card', roles: ['doctor'], icon: I.patientCard },
  { id: 'privacy', path: '/doctor/privacy', roles: ['doctor'], icon: I.privacy },
  { id: 'coordination', path: '/doctor/coordination', roles: ['doctor'], icon: I.networkHealth },
  // P1-13 simulated reminders: own-clinic log; server enforces scope.
  { id: 'messages', path: '/messages', roles: ['front-desk', 'admin'], icon: I.messages },
  { id: 'kpi', path: '/admin/kpi', roles: ['admin'], icon: I.kpi },
  { id: 'networkHealth', path: '/admin/network-health', roles: ['admin'], icon: I.networkHealth },
  { id: 'usersDevices', path: '/admin/users-devices', roles: ['admin'], icon: I.users },
  { id: 'clinicsDoctors', path: '/admin/clinics-doctors', roles: ['admin'], icon: I.clinics },
  { id: 'audit', path: '/admin/audit', roles: ['admin'], icon: I.changeLog },
  { id: 'developer', path: '/admin/developer', roles: ['admin'], icon: I.developer },
  // P1-07 import/merge APIs authorize doctor and front-desk only; admin status grants no patient-level access.
  { id: 'import', path: '/work/import', roles: ['front-desk', 'doctor'], icon: I.import },
  { id: 'adoption', path: '/work/adoption', roles: ['front-desk', 'doctor'], icon: I.adoption },
  { id: 'duplicates', path: '/work/duplicates', roles: ['front-desk', 'doctor'], icon: I.duplicates },
];

export const KNOWN_ROLES: readonly ShellRole[] = ['admin', 'doctor', 'front-desk'];

export function isKnownRole(role: unknown): role is ShellRole {
  return typeof role === 'string' && (KNOWN_ROLES as readonly string[]).includes(role);
}

export function routesFor(role: ShellRole | null, canCoordinate = false): ShellRoute[] {
  if (!isKnownRole(role)) return [];
  return SHELL_ROUTES.filter((r) => r.roles.includes(role) && (r.id !== 'coordination' || canCoordinate));
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
export function resolve(location: string, role: ShellRole | null, canCoordinate = false): Resolution {
  const path = location.replace(/\/+$/, '') || '/';
  const known = isKnownRole(role);
  if (path === '/') return known ? { kind: 'landing', to: landingFor(role)! } : { kind: 'noRole' };
  const route = SHELL_ROUTES.find((r) => r.path === path);
  if (!route) return { kind: 'notFound' };
  if (!known) return { kind: 'noRole' };
  if (!route.roles.includes(role)) return { kind: 'forbidden' };
  if (route.id === 'coordination' && !canCoordinate) return { kind: 'forbidden' };
  return { kind: 'page', route, isLanding: landingFor(role) === route.path };
}
