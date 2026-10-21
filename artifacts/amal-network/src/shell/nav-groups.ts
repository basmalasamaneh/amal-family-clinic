import type { AmalSection } from '@workspace/amal-ui/icon-map';
import type { ShellRoute } from './routes';

/** Presentation-only grouping of existing routes; routes and permissions are untouched. */
export type NavGroup = 'reception' | 'clinical' | 'patients' | 'network' | 'admin';
export const NAV_GROUP_ORDER: readonly NavGroup[] = ['reception', 'clinical', 'patients', 'network', 'admin'];
const GROUP_OF: Record<string, NavGroup> = {
  today: 'reception', week: 'reception', newBooking: 'reception', waitlist: 'reception', daySheet: 'reception', sync: 'reception', messages: 'reception',
  myDay: 'clinical',
  patientLookup: 'patients', consent: 'patients', import: 'patients', adoption: 'patients', duplicates: 'patients',
  networkSearch: 'network', patientCard: 'network', privacy: 'network',
  kpi: 'admin', networkHealth: 'admin', usersDevices: 'admin', clinicsDoctors: 'admin', audit: 'admin', developer: 'admin',
};
const SECTION_OF: Record<NavGroup, AmalSection> = { reception: 'reception', clinical: 'reception', patients: 'patients', network: 'network', admin: 'admin' };
export const groupOf = (id: string): NavGroup => GROUP_OF[id] ?? 'reception';
export const sectionOf = (id: string): AmalSection => SECTION_OF[groupOf(id)];
export function groupRoutes(items: ShellRoute[]): { group: NavGroup; items: ShellRoute[] }[] {
  return NAV_GROUP_ORDER.map((group) => ({ group, items: items.filter((r) => groupOf(r.id) === group) })).filter((g) => g.items.length > 0);
}
