import type { AppointmentStatus as BadgeStatus } from '@workspace/amal-ui';
import type { CalendarAppointment } from './adapter';

/**
 * Display mapping only. Lifecycle, conflict and sync metadata stay distinct in the adapter.
 * Priority: pending sync > cancelled > completed > no-show > conflict (flag or double_booked) > booked.
 * Unknown lifecycle values return null and are shown as "Unknown status", never as Booked.
 */
export function displayStatus(a: Pick<CalendarAppointment, 'lifecycle' | 'conflict' | 'syncPending'>): BadgeStatus | null {
  // Unknown lifecycle is never masked by sync metadata; the card shows both explicitly.
  if (a.lifecycle === 'unknown') return null;
  if (a.syncPending) return 'sync';
  switch (a.lifecycle) {
    case 'cancelled': return 'cancelled';
    case 'completed': return 'completed';
    case 'no_show': return 'noshow';
    case 'double_booked': return 'conflict';
    case 'booked': return a.conflict ? 'conflict' : 'booked';
    default: return null;
  }
}
