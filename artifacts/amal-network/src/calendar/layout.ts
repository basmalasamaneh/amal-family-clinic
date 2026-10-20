import type { CalendarAppointment } from './adapter';

export interface Placed { appt: CalendarAppointment; lane: number; lanes: number }
/** Assigns overlapping appointments to side-by-side lanes so none covers another. */
/**
 * `span` returns the half-open interval actually occupied on screen (e.g. grid rows), so lanes
 * are assigned on rendered geometry: two cards sharing a row always get different lanes.
 */
export function placeOverlaps(items: CalendarAppointment[], span: (a: CalendarAppointment) => [number, number] = (a) => [Date.parse(a.startsAt), Date.parse(a.endsAt)]): Placed[] {
  const iv = new Map(items.map((a) => { const [s, e] = span(a); return [a.id, [s, Math.max(e, s + 1e-9)] as [number, number]]; }));
  const S = (a: CalendarAppointment) => iv.get(a.id)![0]; const E = (a: CalendarAppointment) => iv.get(a.id)![1];
  const sorted = [...items].sort((a, b) => S(a) - S(b) || E(a) - E(b) || a.id - b.id);
  const out: Placed[] = [];
  let group: Placed[] = []; let groupEnd = -Infinity;
  let laneEnds: number[] = [];
  const flush = () => { const n = laneEnds.length || 1; group.forEach((p) => { p.lanes = n; }); out.push(...group); group = []; laneEnds = []; };
  for (const appt of sorted) {
    if (group.length && S(appt) >= groupEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= S(appt));
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(E(appt)); } else laneEnds[lane] = E(appt);
    group.push({ appt, lane, lanes: 1 });
    groupEnd = group.length === 1 ? E(appt) : Math.max(groupEnd, E(appt));
  }
  flush();
  return out;
}
