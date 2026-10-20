import type { CalendarDoctor } from '../calendar/adapter';
import type { AvailabilitySlot } from './api';

/** Pure: one row per clinic doctor, nearest server-provided slot (if any), chronological, slotless last. */
export function quickRows(doctors: CalendarDoctor[], items: AvailabilitySlot[], preferDoctorId: number | null = null): { doctor: CalendarDoctor; slot: AvailabilitySlot | null }[] {
  const best = new Map<number, AvailabilitySlot>();
  for (const s of items) { const b = best.get(s.doctorId); if (!b || s.startsAt < b.startsAt) best.set(s.doctorId, s); }
  return doctors.map((d) => ({ doctor: d, slot: best.get(d.id) ?? null }))
    .sort((a, b) => (a.doctor.id === preferDoctorId ? -1 : b.doctor.id === preferDoctorId ? 1 : 0) || (a.slot && b.slot ? a.slot.startsAt.localeCompare(b.slot.startsAt) : a.slot ? -1 : b.slot ? 1 : 0));
}

